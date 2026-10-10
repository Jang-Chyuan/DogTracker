import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';

const owner = 'synthetic-owner';
const time = 1791500000000;
const row = (id, offset = id) => ({ event_id: `event-${id}`, master_id: 7,
  slave_id: 6, received_at: time + offset, track_at: time + offset,
  track_time_version: 1, activity_valid: 0, battery_valid: 0 });

async function setup(run) {
  const connection = createMemoryConnection();
  try {
    await createDogDatabase(connection).initialize();
    const cloud = createCloudDatabase(connection, { maxRows: 20000 });
    await cloud.initialize();
    await run(connection, cloud);
  } finally { connection.close(); }
}
async function legacy(connection, table, ids, account = owner) {
  for (const id of ids) await connection.executeAsync(
    `UPDATE ${table} SET track_time_version=NULL,track_at=NULL WHERE owner_user_id=? AND event_id=?`,
    [account, `event-${id}`]);
}
// The previous production overlay, including its full-row projection and
// anti-shadow before the global order/limit. SQLite is the reference here.
async function reference(connection, kind = 'auto', account = owner) {
  const columns = (await connection.executeAsync('PRAGMA table_info(supabase_dog_status)')).results.map(r => r.name);
  const delta = `cloud_${kind}_supabase_dog_status`;
  return (await connection.executeAsync(`SELECT event_id FROM (
    SELECT ${columns.join(',')} FROM ${delta} UNION ALL
    SELECT ${columns.map(name => `p.${name}`).join(',')} FROM supabase_dog_status p
    WHERE NOT EXISTS (SELECT 1 FROM ${delta} d
      WHERE d.owner_user_id=p.owner_user_id AND d.event_id=p.event_id))
    WHERE owner_user_id=? AND track_time_version IS NULL AND event_id IS NOT NULL
    ORDER BY received_at DESC LIMIT 200`, [account])).results;
}
async function equalReference(connection, cloud, kind = 'auto', account = owner) {
  const actual = await cloud.pendingTrackTimes(account);
  expect(actual).toEqual(await reference(connection, kind, account));
  expect(actual.every(r => Object.keys(r).join(',') === 'event_id')).toBe(true);
  return actual;
}

test.each([0, 100, 350])('pending newest-200 equals the old SQLite overlay with %i published legacy rows', count => setup(async (connection, cloud) => {
  await cloud.savePage(owner, Array.from({ length: 500 }, (_, i) => row(i)));
  await legacy(connection, 'supabase_dog_status', Array.from({ length: count }, (_, i) => i));
  await cloud.beginDownload(owner);
  expect(await equalReference(connection, cloud)).toHaveLength(Math.min(200, count));
}));

test('completed COW shadows are removed before the published branch limit and preserve metadata', () => setup(async (connection, cloud) => {
  const records = Array.from({ length: 450 }, (_, i) => row(i));
  await cloud.savePage(owner, records);
  await legacy(connection, 'supabase_dog_status', records.map((_, i) => i));
  await cloud.beginDownload(owner);
  const repaired = records.slice(100);
  await cloud.repairTrackTimes(owner, repaired.map(r => ({ event_id: r.event_id,
    received_at: new Date(r.received_at).toISOString(), upload_source: 'wifi' })), repaired.map(r => r.event_id));
  const before = (await connection.executeAsync('SELECT * FROM cloud_auto_supabase_dog_status ORDER BY event_id')).results;
  expect(before).toHaveLength(350);
  expect(before.every(r => r.had_base === 1 && r.track_time_version === 1 && r.base_track_time_version === null)).toBe(true);
  expect(await equalReference(connection, cloud)).toHaveLength(100);
  expect((await connection.executeAsync('SELECT * FROM cloud_auto_supabase_dog_status ORDER BY event_id')).results).toEqual(before);
  expect((await connection.executeAsync('SELECT COUNT(*) n FROM supabase_dog_status WHERE track_time_version IS NULL')).results[0].n).toBe(450);
}));

test('global newest-200 merges 1000 staged legacy rows with published candidates and isolates owners', () => setup(async (connection, cloud) => {
  await cloud.savePage(owner, Array.from({ length: 300 }, (_, i) => row(i, i * 2)));
  await cloud.savePage('other-owner', [row(9999, 99999)]);
  await legacy(connection, 'supabase_dog_status', Array.from({ length: 300 }, (_, i) => i));
  await legacy(connection, 'supabase_dog_status', [9999], 'other-owner');
  await cloud.beginDownload(owner);
  await cloud.savePage(owner, Array.from({ length: 1000 }, (_, i) => row(1000 + i, i * 2 + 1)));
  await legacy(connection, 'cloud_auto_supabase_dog_status', Array.from({ length: 1000 }, (_, i) => 1000 + i));
  expect(await equalReference(connection, cloud)).toHaveLength(200);
  expect(await cloud.pendingTrackTimes('other-owner')).toEqual([{ event_id: 'event-9999' }]);
}));

test('manual selects its own delta, legacy null IDs are excluded, and no-job reads stay published', () => setup(async (connection, cloud) => {
  await cloud.savePage(owner, [row(1)]);
  await legacy(connection, 'supabase_dog_status', [1]);
  expect(await cloud.pendingTrackTimes(owner)).toEqual([{ event_id: 'event-1' }]);
  await cloud.beginDownload(owner);
  await cloud.savePage(owner, [row(2)]);
  await legacy(connection, 'cloud_auto_supabase_dog_status', [2]);
  await cloud.beginManualScope(owner, 6, '2026-10-09');
  await cloud.savePage(owner, [row(3)]);
  await legacy(connection, 'cloud_manual_supabase_dog_status', [3]);
  await connection.executeAsync('INSERT INTO cloud_manual_supabase_dog_status(owner_user_id,received_at,track_time_version) VALUES(?,?,NULL)', [owner, time + 99999]);
  expect(await equalReference(connection, cloud, 'manual')).toEqual([{ event_id: 'event-3' }, { event_id: 'event-1' }]);
}));

test.each([40, 250])('equal received-at timestamps retain the original unordered cutoff contract (%i per branch)', count => setup(async (connection, cloud) => {
  await cloud.savePage(owner, Array.from({ length: count }, (_, i) => row(i, 0)));
  await legacy(connection, 'supabase_dog_status', Array.from({ length: count }, (_, i) => i));
  await cloud.beginDownload(owner);
  await cloud.savePage(owner, Array.from({ length: count }, (_, i) => row(1000 + i, 0)));
  await legacy(connection, 'cloud_auto_supabase_dog_status', Array.from({ length: count }, (_, i) => 1000 + i));
  const actual = await cloud.pendingTrackTimes(owner);
  const previous = await reference(connection);
  expect(actual).toHaveLength(Math.min(200, count * 2));
  expect(new Set(actual.map(r => r.event_id)).size).toBe(actual.length);
  const allowed = new Set(Array.from({ length: count }, (_, i) => [`event-${i}`, `event-${1000 + i}`]).flat());
  expect(actual.every(r => allowed.has(r.event_id))).toBe(true);
  if (count * 2 <= 200) expect(actual.map(r => r.event_id).sort()).toEqual(previous.map(r => r.event_id).sort());
  // Neither query promises an event-id tie-break at the 200-row boundary.
  expect(previous).toHaveLength(actual.length);
}));

test('empty pending set seeks both track-repair indexes instead of scanning the owner overlay', () => setup(async (connection, cloud) => {
  await cloud.savePage(owner, Array.from({ length: 500 }, (_, i) => row(i)));
  await cloud.beginDownload(owner);
  const execute = connection.executeAsync;
  let pending;
  connection.executeAsync = async (sql, params) => {
    if (/SELECT event_id FROM \(/.test(sql)) pending = { sql, params };
    return execute(sql, params);
  };
  expect(await cloud.pendingTrackTimes(owner)).toEqual([]);
  const details = (await execute(`EXPLAIN QUERY PLAN ${pending.sql}`, pending.params)).results.map(r => r.detail).join('\n');
  expect(details).toMatch(/SEARCH cloud_auto_supabase_dog_status USING .*track_repair.*owner_user_id=\? AND track_time_version=\?/);
  expect(details).toMatch(/SEARCH p USING .*track_repair.*owner_user_id=\? AND track_time_version=\?/);
}));
