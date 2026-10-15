/* eslint-env node, jest */
// 稽核 A F3: no single native call reads a 20,000-row result, and a cloud
// publication keeps its one transaction for readers while the staged copies
// go afterwards in bounded transactions of their own.
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { readPages, READ_PAGE_ROWS } from '../src/database/PagedRead';
import { HOLD_LOOKBACK_MS } from '../src/placement/HoldStore';

const { DatabaseSync } = require('node:module').createRequire(__filename)('node:sqlite');
const owner = 'contention-owner';
const delta = 'cloud_auto_supabase_dog_status';

function open() {
  const sqlite = new DatabaseSync(':memory:');
  const calls = [];
  let failBatch = null, failSql = null;
  const execute = (sql, params = []) => ({ results: sqlite.prepare(sql).all(...params) });
  return {
    sqlite, calls,
    failNextBatch(test) { failBatch = test; },
    failSql(test) { failSql = test; },
    async executeAsync(sql, params = []) {
      if (failSql?.(sql)) throw new Error('disk I/O error');
      const result = execute(sql, params);
      calls.push({ kind: 'sql', sql, rows: result.results.length, changes: Number(sqlite.prepare('SELECT changes() n').get().n) });
      return result;
    },
    async executeBatchAsync(commands) {
      const test = failBatch; failBatch = null;
      sqlite.exec('BEGIN EXCLUSIVE');
      try {
        for (const command of commands) execute(command.query, command.params);
        if (test?.(commands)) throw new Error('database is locked');
        sqlite.exec('COMMIT');
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
      calls.push({ kind: 'batch', commands });
    },
  };
}
const count = (connection, table, where = '') =>
  Number(connection.sqlite.prepare(`SELECT COUNT(*) n FROM ${table} ${where}`).get().n);
const cloudRow = (k, slave = 2) => ({ event_id: `e-${slave}-${k}`, master_id: 7, slave_id: slave,
  received_at: 1_000_000 + k * 1000, track_at: 1_000_000 + k * 1000, slave_lat: 24.99 + k / 1e6, slave_lon: 121.31,
  satellites: 9, activity_valid: 0, battery_valid: 0, raw_payload: '{}' });

async function setup() {
  const connection = open();
  await createDogDatabase(connection).initialize();
  const cloud = createCloudDatabase(connection);
  await cloud.initialize();
  return { connection, cloud };
}
async function stage(cloud, rows, from = 0) {
  for (let k = from; k < from + rows; k += 1000) {
    const page = [];
    for (let j = k; j < Math.min(from + rows, k + 1000); j++) page.push(cloudRow(j));
    await cloud.savePage(owner, page, { masterId: 7, throughAt: new Date(2_000_000 + k).toISOString(), eventId: page.at(-1).event_id });
  }
}

describe('readPages', () => {
  test('reads up to the limit, a page at a time, continuing from the last row', async () => {
    const connection = open();
    connection.sqlite.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v INTEGER)');
    for (let i = 1; i <= 2500; i++) connection.sqlite.prepare('INSERT INTO t VALUES (?, ?)').run(i, i * 2);
    const page = (last, size) => ({ query: 'SELECT * FROM t WHERE id > ? ORDER BY id LIMIT ?', params: [last ? last.id : 0, size] });
    const all = await readPages(connection, page, 20000);
    expect(all.map(row => row.id)).toEqual(Array.from({ length: 2500 }, (_, i) => i + 1));
    expect(connection.calls.map(call => call.rows)).toEqual([1000, 1000, 500]);
    connection.calls.length = 0;
    expect((await readPages(connection, page, 1200)).length).toBe(1200);
    expect(connection.calls.map(call => call.rows)).toEqual([1000, 200]);
    connection.calls.length = 0;
    // A full last page: one more (empty) call proves the end.
    connection.sqlite.exec('DELETE FROM t WHERE id > 2000');
    expect((await readPages(connection, page, 20000)).length).toBe(2000);
    expect(connection.calls.map(call => call.rows)).toEqual([1000, 1000, 0]);
  });
});

describe('holdRows after a long absence', () => {
  test('returns the same rows as one 20,000-row read, never more than a page a call', async () => {
    const { connection, cloud } = await setup();
    const insert = connection.sqlite.prepare(`INSERT INTO dog_status (received_at, master_id, slave_id, slave_lat, slave_lon,
      satellites, activity_valid, battery_valid) VALUES (?, 7, ?, ?, 121.31, 9, 0, 0)`);
    for (let i = 0; i < 2600; i++) insert.run(5_000_000 + i * 500, i % 2 ? 2 : 4, 24.99 + i / 1e6);
    await cloud.beginDownload(owner, 'auto');
    await stage(cloud, 2300);
    await cloud.publishDownload(owner, 'auto');
    const expected = table => connection.sqlite.prepare(`SELECT id FROM ${table} WHERE id > 10 ORDER BY id LIMIT 20000`).all().map(row => row.id);
    const { repairs } = (await cloud.holdRows(owner, 0)).cursors;
    connection.calls.length = 0;
    const batch = await cloud.holdRows(owner, 0, { dog_status: 10, supabase_dog_status: 10, repairs });
    expect(batch.reset).toBe(false);
    expect(batch.rows.filter(row => row.source === 'ble').map(row => row.id)).toEqual(expected('dog_status'));
    expect(batch.rows.filter(row => row.source === 'cloud').map(row => row.id)).toEqual(expected('supabase_dog_status'));
    expect(batch.cursors.dog_status).toBe(expected('dog_status').at(-1));
    expect(Math.max(...connection.calls.filter(call => call.kind === 'sql').map(call => call.rows))).toBeLessThanOrEqual(READ_PAGE_ROWS);
  });

  test('a cold start replays a silent dog’s long window in pages, in time order', async () => {
    const { connection, cloud } = await setup();
    const insert = connection.sqlite.prepare(`INSERT INTO dog_status (received_at, master_id, slave_id, slave_lat, slave_lon,
      satellites, activity_valid, battery_valid) VALUES (?, 7, ?, 24.99, 121.31, 9, 0, 0)`);
    const since = 50_000_000;
    // Dog 3 went silent before `since`: its last half hour, one row a second
    // and pairs sharing a time, is replayed from the cold start.
    const times = [];
    for (let i = 0; i < 1500; i++) times.push(since - 1000 - Math.floor(i / 2) * 1000);
    for (const time of times.reverse()) insert.run(time, 3);
    insert.run(since + 10, 5);
    connection.calls.length = 0;
    const batch = await cloud.holdRows(null, since);
    const replay = batch.rows.filter(row => row.slave_id === 3);
    const newest = Math.max(...times);
    const expected = connection.sqlite.prepare(`SELECT id, received_at FROM dog_status WHERE slave_id = 3
      AND received_at >= ? AND received_at < ? ORDER BY received_at, id`).all(newest - HOLD_LOOKBACK_MS, since);
    expect(expected.length).toBeGreaterThan(READ_PAGE_ROWS);
    expect(replay.map(row => row.id)).toEqual(expected.map(row => row.id));
    expect(Math.max(...connection.calls.filter(call => call.kind === 'sql').map(call => call.rows))).toBeLessThanOrEqual(READ_PAGE_ROWS);
  });
});

describe('latest snapshot built from the archive', () => {
  test('a dog’s whole hold context is read in pages and stripped of the paging column', async () => {
    const { connection, cloud } = await setup();
    await cloud.beginDownload(owner, 'auto');
    await stage(cloud, 1500);
    await cloud.publishDownload(owner, 'auto');
    connection.calls.length = 0;
    const snapshot = await cloud.readLatestSnapshot(owner);
    const context = snapshot.contexts[2].rows;
    const expected = connection.sqlite.prepare(`SELECT id FROM supabase_dog_status WHERE owner_user_id=? AND slave_id=2
      AND CAST(COALESCE(track_at,received_at) AS INTEGER)>=? ORDER BY CAST(COALESCE(track_at,received_at) AS INTEGER), id`)
      .all(owner, cloudRow(1499).track_at - HOLD_LOOKBACK_MS).map(row => row.id);
    expect(expected.length).toBeGreaterThan(READ_PAGE_ROWS);
    expect(context.map(row => row.id)).toEqual(expected);
    expect(context.every(row => !('page_time' in row))).toBe(true);
    expect(Math.max(...connection.calls.filter(call => call.kind === 'sql').map(call => call.rows))).toBeLessThanOrEqual(READ_PAGE_ROWS);
  });
});

describe('publishDownload', () => {
  test('one transaction publishes every staged row; the staged copies go afterwards, a page a transaction', async () => {
    const { connection, cloud } = await setup();
    await cloud.beginDownload(owner, 'auto');
    await stage(cloud, 2500);
    expect(count(connection, delta)).toBe(2500);
    connection.calls.length = 0;
    await cloud.publishDownload(owner, 'auto', 3_000_000);
    expect(count(connection, 'supabase_dog_status', `WHERE owner_user_id='${owner}'`)).toBe(2500);
    expect(count(connection, delta)).toBe(0);
    const batches = connection.calls.filter(call => call.kind === 'batch');
    expect(batches).toHaveLength(1);
    const publication = batches[0].commands.map(command => command.query);
    expect(publication.filter(query => /^INSERT OR IGNORE INTO supabase_dog_status/.test(query))).toHaveLength(3);
    expect(publication.some(query => query.includes(`DELETE FROM ${delta}`))).toBe(false);
    expect(publication.some(query => /DELETE FROM cloud_download_jobs/.test(query))).toBe(true);
    expect(publication.some(query => /cloud_archive_publication/.test(query))).toBe(true);
    const clears = connection.calls.filter(call => call.kind === 'sql' && call.sql.startsWith(`DELETE FROM ${delta}`));
    expect(clears.map(call => call.changes)).toEqual([1000, 1000, 500]);
    const after = connection.calls.indexOf(batches[0]);
    expect(clears.every(call => connection.calls.indexOf(call) > after)).toBe(true);
  });

  test('a failed publication leaves the published rows, the job and every staged row as they were', async () => {
    const { connection, cloud } = await setup();
    await cloud.beginDownload(owner, 'auto');
    await stage(cloud, 1500);
    connection.failNextBatch(() => true);
    await expect(cloud.publishDownload(owner, 'auto', 3_000_000)).rejects.toThrow();
    expect(count(connection, 'supabase_dog_status')).toBe(0);
    expect(count(connection, delta)).toBe(1500);
    expect(await cloud.readArchivePublication(owner)).toBeNull();
    await cloud.publishDownload(owner, 'auto', 3_000_000);
    expect(count(connection, 'supabase_dog_status')).toBe(1500);
    expect(count(connection, delta)).toBe(0);
  });

  test('staged copies left by an interrupted clear are not read, and the next download clears them first', async () => {
    const { connection, cloud } = await setup();
    await cloud.beginDownload(owner, 'auto');
    await stage(cloud, 1500);
    connection.failSql(sql => sql.startsWith(`DELETE FROM ${delta}`));
    await cloud.publishDownload(owner, 'auto', 3_000_000);
    connection.failSql(null);
    // Published, the job gone; what was staged is still on disk but unread.
    expect(count(connection, 'supabase_dog_status')).toBe(1500);
    expect(count(connection, delta)).toBe(1500);
    expect(await cloud.countRange(owner, 7, 0, 10_000_000)).toBe(1500);
    expect(await cloud.readArchivePublication(owner)).toEqual({ owner, cutoff: 3_000_000, revision: 1 });
    await cloud.beginDownload(owner, 'auto');
    expect(count(connection, delta)).toBe(0);
    await stage(cloud, 200, 1500);
    expect(await cloud.countRange(owner, 7, 0, 10_000_000)).toBe(1700);
    await cloud.publishDownload(owner, 'auto', 4_000_000);
    expect(count(connection, 'supabase_dog_status')).toBe(1700);
    expect(count(connection, delta)).toBe(0);
  });

  test('a new manual scope replaces an unfinished one, clearing its staged rows in bounded transactions', async () => {
    const { connection, cloud } = await setup();
    await cloud.beginDownload(owner, 'manual', '2:1');
    for (let k = 0; k < 1200; k += 600) {
      await cloud.savePage(owner, Array.from({ length: 600 }, (_, j) => cloudRow(k + j)));
    }
    expect(count(connection, 'cloud_manual_supabase_dog_status')).toBe(1200);
    connection.calls.length = 0;
    await cloud.beginDownload(owner, 'manual', '2:2');
    expect(count(connection, 'cloud_manual_supabase_dog_status')).toBe(0);
    const clears = connection.calls.filter(call => call.kind === 'sql' && call.sql.startsWith('DELETE FROM cloud_manual_supabase_dog_status'));
    expect(clears.map(call => call.changes)).toEqual([1000, 200]);
    expect(connection.sqlite.prepare("SELECT scope FROM cloud_download_jobs WHERE kind='manual'").get().scope).toBe('2:2');
  });
});
