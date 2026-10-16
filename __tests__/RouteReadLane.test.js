/* eslint-env node */
import fs from 'fs';
import path from 'path';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { createHistoryDatabase } from '../src/mapHistory/HistoryDatabase';

// 2026-10-15: coming back to the App and opening 我的路線 waited ~10 s on the
// phone, minutes on a signed-in emulator: its reads queued on the App's one
// database lane behind the cloud sync (and a DISTINCT over the account's
// ~1M cloud rows that every history open ran). My route reads on its own
// lane; that DISTINCT is an index skip-scan.
const tracker = fs.readFileSync(path.join(__dirname,
  '../android/app/src/main/java/com/dogtracker/location/LocationTrackerStore.kt'), 'utf8');
const trackerSql = prefix => tracker.match(new RegExp('"(' + prefix + '[^"]+)"'))[1];
const DAY = 86400000;
const day = new Date(2026, 9, 15).getTime();

function routeDatabase() {
  const db = createMemoryConnection();
  db.sqlite.exec(trackerSql('CREATE TABLE'));
  db.sqlite.exec(trackerSql('CREATE INDEX'));
  const insert = db.sqlite.prepare(trackerSql('INSERT INTO'));
  return { db, add: time => insert.run(time, time, 25, 121, 5, null, null, null) };
}

/** `db` with a read lane that records its SQL; the main lane records too. */
function lanes(db) {
  const main = [], read = [];
  const conn = {
    executeAsync: (sql, params) => { main.push(sql); return db.executeAsync(sql, params); },
    executeBatchAsync: commands => { main.push('BATCH'); return db.executeBatchAsync(commands); },
    reader: { executeAsync: (sql, params) => { read.push(sql); return db.executeAsync(sql, params); } },
  };
  return { conn, main, read };
}

test('my route\'s day, calendar and 「今天 x km」 read only on the read lane', async () => {
  const { db, add } = routeDatabase();
  try {
    for (let i = 0; i < 50; i += 1) add(day + 8 * 3600000 + i * 5000);
    const { conn, main, read } = lanes(db);
    const history = createHistoryDatabase(conn);
    const first = await history.historyDayRows({ subject: 'phone', start: day, end: day + DAY });
    expect(first.rows).toHaveLength(50);
    add(day + 9 * 3600000);
    const again = await history.historyDayRows({ subject: 'phone', start: day, end: day + DAY, after: first.after, verify: true });
    expect(again.rows).toHaveLength(1);
    expect(await history.historyDays({ subject: 'phone' })).toEqual(['2026-10-15']);
    expect(await history.phoneRouteSince(day)).toHaveLength(51);
    expect(main).toEqual([]);
    expect(read.length).toBeGreaterThan(5);
    // The lane takes SELECTs only (BleBackgroundModule.readDatabase).
    expect(read.every(sql => /^\s*(SELECT|WITH)\b/i.test(sql))).toBe(true);
  } finally { db.close(); }
});

test('a day whose ids are far apart (a row written under a wrong clock) is read on the time index, whole', async () => {
  const { db, add } = routeDatabase();
  try {
    db.sqlite.exec('BEGIN');
    add(day + 12 * 3600000); // id 1: dated into the day long before it came
    for (let i = 0; i < 20000; i += 1) add(day - 30 * DAY + i * 1000);
    for (let i = 0; i < 3000; i += 1) add(day + 8 * 3600000 + i * 1000);
    db.sqlite.exec('COMMIT');
    const { conn, read } = lanes(db);
    const result = await createHistoryDatabase(conn).historyDayRows({ subject: 'phone', start: day, end: day + DAY });
    expect(result.rows.filter(row => row.time >= day && row.time < day + DAY)).toHaveLength(3001);
    const page = read.find(sql => /\+id > CAST\(\? AS INTEGER\) ORDER BY \+id/.test(sql));
    expect(page).toBeDefined();
    const plan = db.sqlite.prepare(`EXPLAIN QUERY PLAN ${page}`).all(day, day + DAY, 0).map(row => row.detail).join(' | ');
    expect(plan).toMatch(/idx_myLocationTracker_time/);
    // A dense day still walks the rowid between its ends.
    read.length = 0;
    await createHistoryDatabase(conn).historyDayRows({ subject: 'phone', start: day - 30 * DAY, end: day - 29 * DAY });
    expect(read.some(sql => /AND id > \? AND id <= \? ORDER BY id/.test(sql))).toBe(true);
  } finally { db.close(); }
});

test('listDevices: one seek per pair, the same pairs as a DISTINCT, for this phone and the account\'s cloud copy', async () => {
  const db = createMemoryConnection();
  try {
    await createDogDatabase(db).initialize();
    await createCloudDatabase(db).initialize();
    const local = db.sqlite.prepare('INSERT INTO dog_status(received_at, master_id, slave_id) VALUES (?, ?, ?)');
    const cloud = db.sqlite.prepare('INSERT INTO supabase_dog_status(received_at, master_id, slave_id, owner_user_id) VALUES (?, ?, ?, ?)');
    db.sqlite.exec('BEGIN');
    for (let i = 0; i < 3000; i += 1) {
      local.run(i, 3, 12); local.run(i, 3, 13); local.run(i, 5, 12);
      cloud.run(i, 3, 12, 'me'); cloud.run(i, 4, 13, 'me'); cloud.run(i, 9, 99, 'someone else');
    }
    local.run(1, null, 14); local.run(1, 7, null); local.run(1, 0, 15);
    cloud.run(1, null, 14, 'me');
    db.sqlite.exec('COMMIT');
    const statements = [];
    const conn = { executeAsync: (sql, params) => { statements.push(sql); return db.executeAsync(sql, params); } };
    const history = createHistoryDatabase(conn);
    expect(await history.listDevices('ble')).toEqual([
      { master: 3, slave: 12 }, { master: 5, slave: 12 }, { master: 3, slave: 13 }]);
    expect(await history.listDevices('cloud', 'me')).toEqual([{ master: 3, slave: 12 }, { master: 4, slave: 13 }]);
    expect(await history.listDevices('cloud', null)).toEqual([]);
    expect(statements.some(sql => /DISTINCT/.test(sql))).toBe(false);
    // Each seek is an index search, never a scan of the table.
    for (const sql of new Set(statements)) {
      const plan = db.sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...Array(sql.split('?').length - 1).fill(1))
        .map(row => row.detail).join(' | ');
      expect(plan).toMatch(/SEARCH .* USING (COVERING )?INDEX/);
    }
  } finally { db.close(); }
});

test('a dog\'s day: this phone\'s rows on the read lane, found by (slave_id, received_at), the cloud copy on the App\'s queue', async () => {
  const db = createMemoryConnection();
  try {
    await createDogDatabase(db).initialize();
    await createCloudDatabase(db).initialize();
    const insert = db.sqlite.prepare('INSERT INTO dog_status(received_at, master_id, slave_id, slave_lat, slave_lon, satellites) VALUES (?, 3, ?, 24.99, 121.31, 9)');
    db.sqlite.exec('BEGIN');
    // Thirty days of two dogs heard together, then the day read.
    for (let i = 0; i < 30 * 1440; i += 1) { insert.run(day - 30 * DAY + i * 60000, 12); insert.run(day - 30 * DAY + i * 60000 + 1, 13); }
    for (let i = 0; i < 3000; i += 1) { insert.run(day + 8 * 3600000 + i * 1000, 12); insert.run(day + 8 * 3600000 + i * 1000 + 1, 13); }
    db.sqlite.exec('COMMIT');
    const { conn, main, read } = lanes(db);
    const result = await createHistoryDatabase(conn).historyDayRows({ subject: 'dog', slaveId: 12, start: day, end: day + DAY, owner: 'me' });
    expect(result.rows.filter(row => row.time >= day && row.time < day + DAY)).toHaveLength(3000);
    expect(read.some(sql => /FROM dog_status/.test(sql))).toBe(true);
    expect(main.some(sql => /FROM dog_status\b/.test(sql) && !/supabase_dog_status/.test(sql))).toBe(false);
    expect(main.some(sql => /supabase_dog_status/.test(sql))).toBe(true);
    // The span is answered from the (slave_id, received_at) index, the pages walk only the day's ids.
    db.sqlite.exec('ANALYZE');
    const span = read.find(sql => /MIN\(id\) AS low/.test(sql) && /dog_status/.test(sql));
    const plan = sql => db.sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...Array(sql.split('?').length - 1).fill(0))
      .map(row => row.detail).join(' | ');
    expect(plan(span)).toMatch(/slave_id=\? AND received_at>\? AND received_at<\?/);
    const page = read.find(sql => /FROM dog_status WHERE slave_id = \? .* AND id > \? AND id <= \? ORDER BY id/s.test(sql));
    expect(page).toBeDefined();
  } finally { db.close(); }
});

test('a dog\'s day with ids far apart: read on (slave_id, received_at) and sorted, never a walk of every row of the dog', async () => {
  const db = createMemoryConnection();
  try {
    await createDogDatabase(db).initialize();
    const insert = db.sqlite.prepare('INSERT INTO dog_status(received_at, master_id, slave_id, slave_lat, slave_lon, satellites) VALUES (?, 3, 12, 24.99, 121.31, 9)');
    db.sqlite.exec('BEGIN');
    insert.run(day + 9 * 3600000); // id 1, dated into the day
    for (let i = 0; i < 30 * 1440; i += 1) insert.run(day - 30 * DAY + i * 60000);
    for (let i = 0; i < 500; i += 1) insert.run(day + 8 * 3600000 + i * 1000);
    db.sqlite.exec('COMMIT');
    db.sqlite.exec('ANALYZE');
    const { conn, read } = lanes(db);
    const result = await createHistoryDatabase(conn).historyDayRows({ subject: 'dog', slaveId: 12, start: day, end: day + DAY });
    expect(result.rows.filter(row => row.time >= day && row.time < day + DAY)).toHaveLength(501);
    const page = read.find(sql => /FROM dog_status WHERE slave_id = \? .*\+id > CAST\(\? AS INTEGER\) ORDER BY \+id/s.test(sql));
    expect(page).toBeDefined();
    const plan = db.sqlite.prepare(`EXPLAIN QUERY PLAN ${page}`).all(12, day, day + DAY, 0).map(row => row.detail).join(' | ');
    expect(plan).toMatch(/slave_id=\? AND received_at>\? AND received_at<\?/);
  } finally { db.close(); }
});
