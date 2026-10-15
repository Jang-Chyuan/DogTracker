/* eslint-env node */
import fs from 'fs';
import path from 'path';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createHistoryDatabase } from '../src/mapHistory/HistoryDatabase';
import {
  DOG_TOTAL_CAP, DOG_RECORD_FLOOR, DOG_RETENTION_DAYS, RETENTION_BATCH, RETENTION_SQL,
  ROUTE_RECORD_CAP, ROUTE_RETENTION_DAYS, dogCapSql, pruneDogStatus, readLocalRetention, retentionCutoff, retentionStartDay,
} from '../src/database/LocalRetention';
import { retentionLabels } from '../src/settings/useLocalRetention';

// LocalRetention.kt prunes on the phone; its statements are the ones below
// (checked first), so running them here on SQLite runs the phone's SQL.
const kotlin = fs.readFileSync(path.join(__dirname,
  '../android/app/src/main/java/com/dogtracker/LocalRetention.kt'), 'utf8');
const constant = name => kotlin.match(new RegExp(`const val ${name} = ([^\\n]+)`))[1].trim();
const kotlinNumber = name => Number(constant(name).replace(/_/g, '').replace(/L$/, ''));
const kotlinString = name => JSON.parse(constant(name));
const trackerSource = fs.readFileSync(path.join(__dirname,
  '../android/app/src/main/java/com/dogtracker/location/LocationTrackerStore.kt'), 'utf8');
const trackerSql = prefix => trackerSource.match(new RegExp('"(' + prefix + '[^"]+)"'))[1];

const DAY = 86400000;
// 2026-10-15 12:00 on this machine's clock (the rule counts local days).
const NOW = new Date(2026, 9, 15, 12, 0, 0).getTime();

test('the phone and the JS fallback use the same numbers and statements', () => {
  expect(kotlinNumber('ROUTE_DAYS')).toBe(ROUTE_RETENTION_DAYS);
  expect(kotlinNumber('ROUTE_CAP')).toBe(ROUTE_RECORD_CAP);
  expect(kotlinNumber('DOG_DAYS')).toBe(DOG_RETENTION_DAYS);
  expect(kotlinNumber('DOG_FLOOR')).toBe(DOG_RECORD_FLOOR);
  expect(kotlinNumber('DOG_TOTAL_CAP')).toBe(DOG_TOTAL_CAP);
  expect(kotlinNumber('BATCH')).toBe(RETENTION_BATCH);
  expect({
    table: kotlinString('TABLE_SQL'), nextDog: kotlinString('NEXT_DOG_SQL'),
    dogNthNewest: kotlinString('DOG_NTH_NEWEST_SQL'), dogDelete: kotlinString('DOG_DELETE_SQL'),
    dogCount: kotlinString('DOG_COUNT_SQL'), dogNewestTime: kotlinString('DOG_NEWEST_TIME_SQL'),
    dogOldest: kotlinString('DOG_OLDEST_SQL'),
    dogCapHead: kotlinString('DOG_CAP_HEAD'), dogCapTerm: kotlinString('DOG_CAP_TERM'),
    dogCapTail: kotlinString('DOG_CAP_TAIL'),
    routeNewestId: kotlinString('ROUTE_NEWEST_ID_SQL'), routeDelete: kotlinString('ROUTE_DELETE_SQL'),
    routeCapDelete: kotlinString('ROUTE_CAP_DELETE_SQL'),
    // 記錄清單's 「已存約 N 筆」 reads the same two ends.
    routeEnds: JSON.parse(trackerSource.match(/const val SPAN_SQL = ("[^\n]+")/)[1]),
  }).toEqual(RETENTION_SQL);
  expect(kotlin).toMatch(/DOG_CAP_HEAD \+ List\(count\) \{ DOG_CAP_TERM \}\.joinToString\(" OR "\) \+ DOG_CAP_TAIL/);
  expect(dogCapSql(2)).toBe(`${RETENTION_SQL.dogCapHead}${RETENTION_SQL.dogCapTerm} OR ${RETENTION_SQL.dogCapTerm}${RETENTION_SQL.dogCapTail}`);
  // A year of my route, 30 days of the dogs (使用者 2026-10-15).
  expect([ROUTE_RETENTION_DAYS, ROUTE_RECORD_CAP, DOG_RETENTION_DAYS]).toEqual([365, 4000000, 30]);
  // No per-row trims are left in the writers' transactions.
  expect(trackerSource).not.toMatch(/OFFSET 80000|DELETE FROM myLocationTracker WHERE id IN/);
  const store = fs.readFileSync(path.join(__dirname, '../android/app/src/main/java/com/dogtracker/DogStatusStore.kt'), 'utf8');
  expect(store).not.toMatch(/DELETE FROM dog_status WHERE slave_id/);
});

test('a window is whole local days, today included', () => {
  expect(retentionStartDay(NOW, 365)).toBe('2025-10-16');
  expect(retentionStartDay(NOW, 30)).toBe('2026-09-16');
  expect(retentionStartDay(NOW, 7)).toBe('2026-10-09');
  expect(retentionCutoff(NOW, 7)).toBe(new Date(2026, 9, 9).getTime());
  expect(retentionStartDay(new Date(2026, 9, 15, 0, 0, 0, 1).getTime(), 1)).toBe('2026-10-15');
  expect(retentionStartDay(new Date(2026, 9, 14, 23, 59, 59, 999).getTime(), 1)).toBe('2026-10-14');
  // 設定 says the first day kept, in the date row's form.
  expect(retentionLabels(null, NOW)).toEqual({
    route: '只存在這支手機，保留到 2025/10/16（最近 1 年）',
    dogs: '這支手機收到的保留到 9/16（最近 30 天）；很久沒收到的狗留著最後的位置',
  });
});

/** The phone's route sweep (LocalRetention.sweep), with the shared statements. */
async function sweepRoute(db, now) {
  const all = Number.MAX_SAFE_INTEGER;
  const drain = async (params, sql = RETENTION_SQL.routeDelete) => {
    for (;;) {
      const { rowsAffected } = await db.executeAsync(sql, [...params, RETENTION_BATCH]);
      if (rowsAffected < RETENTION_BATCH) return;
    }
  };
  const newest = Object.values((await db.executeAsync(RETENTION_SQL.routeNewestId)).results[0])[0];
  if (newest > ROUTE_RECORD_CAP) await drain([newest - ROUTE_RECORD_CAP], RETENTION_SQL.routeCapDelete);
  await drain([all, retentionCutoff(now, ROUTE_RETENTION_DAYS)]);
}

function routeDatabase() {
  const db = createMemoryConnection();
  db.sqlite.exec(trackerSql('CREATE TABLE'));
  db.sqlite.exec(trackerSql('CREATE INDEX'));
  const insert = db.sqlite.prepare(trackerSql('INSERT INTO'));
  return { db, add: time => insert.run(time, time, 25, 121, 5, null, null, null) };
}

test('my route: rows before the 365th day go, the window stays whole', async () => {
  const { db, add } = routeDatabase();
  try {
    const cutoff = retentionCutoff(NOW, ROUTE_RETENTION_DAYS);
    db.sqlite.exec('BEGIN');
    // 80,000 rows over 400 days, one every 432 s.
    for (let i = 0; i < 80000; i += 1) add(NOW - 400 * DAY + i * 432000);
    add(cutoff - 1);
    add(cutoff);
    db.sqlite.exec('COMMIT');
    const inside = db.sqlite.prepare('SELECT COUNT(*) n FROM myLocationTracker WHERE recorded_at >= ?').get(cutoff).n;
    await sweepRoute(db, NOW);
    expect(db.sqlite.prepare('SELECT COUNT(*) n, MIN(recorded_at) oldest FROM myLocationTracker').get())
      .toEqual({ n: inside, oldest: cutoff });
    // Idempotent.
    await sweepRoute(db, NOW);
    expect(db.sqlite.prepare('SELECT COUNT(*) n FROM myLocationTracker').get().n).toBe(inside);
  } finally { db.close(); }
});

test('my route: the cap keeps the newest rows as written, whatever their time', async () => {
  const { db, add } = routeDatabase();
  try {
    db.sqlite.exec('BEGIN');
    // Written while the clock ran a day ahead, then the cap's worth of rows.
    add(NOW + DAY);
    db.sqlite.prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
      INSERT INTO myLocationTracker (recorded_at, location_at, latitude, longitude) SELECT ?, ?, 25, 121 FROM n`)
      .run(ROUTE_RECORD_CAP, NOW - 1000, NOW - 1000);
    db.sqlite.exec('COMMIT');
    await sweepRoute(db, NOW);
    expect(db.sqlite.prepare('SELECT COUNT(*) n, MIN(id) first, MAX(recorded_at) newest FROM myLocationTracker').get())
      .toEqual({ n: ROUTE_RECORD_CAP, first: 2, newest: NOW - 1000 });
    // At the cap, 設定 says the day of the oldest row kept.
    db.sqlite.prepare('UPDATE myLocationTracker SET recorded_at=? WHERE id=2').run(new Date(2026, 9, 1, 8).getTime());
    expect((await readLocalRetention(db, NOW)).route).toEqual({ days: 365, from: '2026-10-01' });
  } finally { db.close(); }
});

async function dogDatabase() {
  const db = createMemoryConnection();
  await createDogDatabase(db).initialize();
  const insert = db.sqlite.prepare('INSERT INTO dog_status(id, received_at, slave_id) VALUES (?, ?, ?)');
  return { db, insert, ids: slave => db.sqlite.prepare('SELECT id FROM dog_status WHERE slave_id=? ORDER BY id').all(slave).map(r => r.id) };
}

test('dogs: 30 days; a quiet dog keeps its newest rows; holes and received-time disorder', async () => {
  const { db, insert, ids } = await dogDatabase();
  try {
    const cutoff = retentionCutoff(NOW, DOG_RETENTION_DAYS);
    const sql = db.sqlite;
    sql.exec('BEGIN');
    let id = 1;
    const expected = new Map();
    // Quiet dogs, all rows weeks old (ids with holes, times running backwards):
    // each keeps exactly its newest 10,000 as written, as before #198.
    for (const [slave, count] of [[1, 1], [2, 9999], [3, 10000], [4, 10001], [5, 10008]]) {
      const all = [];
      for (let i = 0; i < count; i += 1) { all.push(id); insert.run(id, cutoff - 20 * DAY - i, slave); id += 3; }
      expected.set(slave, all.slice(-DOG_RECORD_FLOOR));
    }
    // A dog heard every day: 12,000 rows before the window, 12,000 inside.
    const busy = [];
    for (let i = 0; i < 12000; i += 1) insert.run(id++, cutoff - 12000 + i, 6);
    for (let i = 0; i < 12000; i += 1) { busy.push(id); insert.run(id++, cutoff + i, 6); }
    expected.set(6, busy);
    insert.run(id++, 0, null);
    sql.exec("INSERT INTO supabase_dog_status(received_at, slave_id) VALUES(1, 4); COMMIT");
    const removed = await pruneDogStatus(db, NOW);
    for (const [slave, kept] of expected) expect(ids(slave)).toEqual(kept);
    expect(removed).toBe(1 + 8 + 12000);
    expect(sql.prepare('SELECT COUNT(*) AS n FROM dog_status WHERE slave_id IS NULL').get().n).toBe(1);
    expect(sql.prepare('SELECT COUNT(*) AS n FROM supabase_dog_status').get().n).toBe(1);
    // A new packet of a quiet dog moves its floor on by one row.
    insert.run(id + 9, -100, 4);
    await pruneDogStatus(db, NOW);
    expect(ids(4)).toEqual([...expected.get(4).slice(1), id + 9]);
  } finally { db.close(); }
});

test('dogs: above the total cap the oldest rows of any dog go first, never a floor or a newest day', async () => {
  const { db, insert, ids } = await dogDatabase();
  try {
    const at = (day, hour) => new Date(2026, 9, day, hour).getTime();
    db.sqlite.exec('BEGIN');
    let id = 1;
    // Dog 8: quiet since 9/20, exactly its floor. Dog 10: oldest ids, all today
    // (its newest day). Dog 9: a few early rows, then today. Dog 7: the bulk.
    for (let i = 0; i < DOG_RECORD_FLOOR; i += 1) insert.run(id++, new Date(2026, 8, 20, 8).getTime() + i * 1000, 8);
    for (let i = 0; i < 30000; i += 1) insert.run(id++, at(15, 0) + i * 1000, 10);
    for (let i = 0; i < 5000; i += 1) insert.run(id++, at(9, 6) + i * 1000, 9);
    const dog7 = id;
    for (let i = 0; i < 455700; i += 1) insert.run(id++, at(10, 0) + i * 1000, 7);
    for (let i = 0; i < 10000; i += 1) insert.run(id++, at(15, 7) + i * 1000, 9);
    db.sqlite.exec('COMMIT');
    const removed = await pruneDogStatus(db, NOW);
    // 510,700 rows: the 10,700 oldest the cap may take are dog 9's early ones
    // and dog 7's first; dog 8 (floor) and dog 10 (newest day) keep every row.
    expect(removed).toBe(10700);
    expect(db.sqlite.prepare('SELECT COUNT(*) n FROM dog_status').get().n).toBe(DOG_TOTAL_CAP);
    expect(ids(8)).toHaveLength(DOG_RECORD_FLOOR);
    expect(ids(10)).toHaveLength(30000);
    expect(ids(9)).toHaveLength(10000);
    expect(ids(7)[0]).toBe(dog7 + 5700);
    // 設定: the rule says 9/16; the dogs are now kept from 10/10.
    expect((await readLocalRetention(db, NOW)).dogs).toEqual({ days: 30, from: '2026-10-10' });
    // Nothing more to take: a second sweep keeps everything.
    expect(await pruneDogStatus(db, NOW)).toBe(0);
  } finally { db.close(); }
});

test('dogs: at the cap with nothing the cap may take, the sweep stops', async () => {
  const { db, insert } = await dogDatabase();
  try {
    db.sqlite.exec('BEGIN');
    // One dog, all today: its newest day.
    for (let i = 0; i < DOG_TOTAL_CAP + 10; i += 1) insert.run(i + 1, new Date(2026, 9, 15, 0).getTime() + i * 50, 3);
    db.sqlite.exec('COMMIT');
    expect(await pruneDogStatus(db, NOW)).toBe(0);
    expect((await readLocalRetention(db, NOW)).dogs.from).toBe('2026-09-16');
  } finally { db.close(); }
});

test('dogs heard at the same time (ids interleaved): the cap still takes a batch a statement', async () => {
  const { db, insert, ids } = await dogDatabase();
  try {
    db.sqlite.exec('BEGIN');
    let id = 1;
    // Two dogs heard together from 9/20, a packet each every 4 s (about 12 days).
    const start = new Date(2026, 8, 20).getTime();
    const each = DOG_TOTAL_CAP / 2 + 600;
    for (let i = 0; i < each; i += 1) {
      insert.run(id++, start + i * 4000, 12);
      insert.run(id++, start + i * 4000 + 1, 13);
    }
    db.sqlite.exec('COMMIT');
    const statements = [];
    const counted = { executeAsync: (sql, params) => { statements.push(sql); return db.executeAsync(sql, params); } };
    expect(await pruneDogStatus(counted, NOW)).toBe(1200);
    // The 1,200 oldest ids, both dogs alike, in three statements (500, 500, 200).
    expect(statements.filter(sql => sql.startsWith(RETENTION_SQL.dogCapHead))).toHaveLength(3);
    expect(ids(12)[0]).toBe(1201);
    expect(ids(13)[0]).toBe(1202);
    expect(ids(12)).toHaveLength(each - 600);
  } finally { db.close(); }
});

test('the cap and a day of my route walk the rowid, not every takeable row or the whole table', async () => {
  const { db } = await dogDatabase();
  const { db: route } = routeDatabase();
  try {
    db.sqlite.exec('ANALYZE');
    const plan = (sqlite, sql) => sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .all(...Array(sql.split('?').length - 1).fill(0)).map(row => row.detail).join(' | ');
    const cap = plan(db.sqlite, dogCapSql(3));
    expect(cap).toMatch(/INTEGER PRIMARY KEY \(rowid>\?\)/);
    expect(cap).not.toMatch(/MULTI-INDEX|TEMP B-TREE/);
    // HistoryDatabase's phone pages: the time index finds the ids, the pages walk between them.
    expect(plan(route.sqlite, 'SELECT id FROM myLocationTracker WHERE recorded_at >= ? AND recorded_at < ? AND id > ? AND id <= ? ORDER BY id LIMIT 2000'))
      .toMatch(/rowid>\? AND rowid<\?/);
    // The sweep's statements: the route cap on the rowid, the time rule on the
    // time index, a dog's window on (slave_id, received_at) — never a walk of
    // every row when there is nothing to take.
    const inner = sql => sql.match(/\((SELECT .*)\)$/)[1];
    expect(plan(route.sqlite, inner(RETENTION_SQL.routeCapDelete))).toMatch(/INTEGER PRIMARY KEY \(rowid<\?\)/);
    expect(plan(route.sqlite, inner(RETENTION_SQL.routeDelete))).toMatch(/idx_myLocationTracker_time \(recorded_at<\?\)/);
    expect(plan(db.sqlite, inner(RETENTION_SQL.dogDelete))).toMatch(/\(slave_id=\? AND received_at<\?\)/);
  } finally { db.close(); route.close(); }
});

test('a day of my route: every row in the window between its first and last id, then only new ones', async () => {
  const { db, add } = routeDatabase();
  try {
    const history = createHistoryDatabase(db);
    const day = new Date(2026, 9, 10).getTime();
    db.sqlite.exec('BEGIN');
    for (let i = 0; i < 3000; i += 1) add(day - 3 * DAY + i * 1000);
    // 5,000 rows of the day (three pages), one written while the clock ran a
    // week behind (a high id dated into the day), rows of later days between.
    for (let i = 0; i < 5000; i += 1) add(day + 8 * 3600000 + i * 1000);
    for (let i = 0; i < 3000; i += 1) add(day + 2 * DAY + i * 1000);
    add(day + 12 * 3600000);
    db.sqlite.exec('COMMIT');
    const first = await history.historyDayRows({ subject: 'phone', start: day, end: day + DAY });
    const inDay = first.rows.filter(row => row.time >= day && row.time < day + DAY);
    expect(inDay).toHaveLength(5001);
    // Polling: nothing new, then one new row of the day.
    const again = await history.historyDayRows({ subject: 'phone', start: day, end: day + DAY, after: first.after });
    expect(again.rows.filter(row => row.time >= day && row.time < day + DAY)).toHaveLength(0);
    add(day + 13 * 3600000);
    const next = await history.historyDayRows({ subject: 'phone', start: day, end: day + DAY, after: again.after });
    expect(next.rows.filter(row => row.time >= day && row.time < day + DAY)).toHaveLength(1);
  } finally { db.close(); }
});

test('設定 says the rule\'s day while no cap was reached, also without tables', async () => {
  const empty = createMemoryConnection();
  try {
    expect(await readLocalRetention(empty, NOW)).toEqual({
      route: { days: 365, from: '2025-10-16' }, dogs: { days: 30, from: '2026-09-16' } });
  } finally { empty.close(); }
  const { db, insert } = await dogDatabase();
  try {
    insert.run(1, NOW - 40 * DAY, 3);
    expect((await readLocalRetention(db, NOW)).dogs.from).toBe('2026-09-16');
    expect(await createHistoryDatabase(db).localRetention(NOW)).toEqual(await readLocalRetention(db, NOW));
  } finally { db.close(); }
});

test('the calendar\'s days of a dog: one seek a day, the same days as a scan, pruned days gone', async () => {
  const { db, insert } = await dogDatabase();
  try {
    const history = createHistoryDatabase(db);
    db.sqlite.exec('BEGIN');
    let id = 1;
    // 35 days, rows around the clock (and one written while the clock was set back).
    for (let day = 0; day < 35; day += 1) {
      for (let i = 0; i < 300; i += 1) insert.run(id++, NOW - day * DAY - i * 287000, 5);
    }
    insert.run(id++, NOW - 40 * DAY, 5);
    insert.run(id++, NOW, 6);
    db.sqlite.exec('COMMIT');
    const scan = () => db.sqlite.prepare(`SELECT DISTINCT strftime('%Y-%m-%d', received_at / 1000, 'unixepoch', 'localtime') AS day
      FROM dog_status WHERE slave_id = 5 ORDER BY day`).all().map(row => row.day);
    expect(await history.historyDays({ subject: 'dog', slaveId: 5 })).toEqual(scan());
    // Above the floor, pruning takes whole days off the calendar.
    for (let i = 0; i < DOG_RECORD_FLOOR; i += 1) insert.run(id++, NOW - 1000, 5);
    await pruneDogStatus(db, NOW);
    const days = await history.historyDays({ subject: 'dog', slaveId: 5 });
    expect(days).toEqual(scan());
    expect(days[0]).toBe(retentionStartDay(NOW, DOG_RETENTION_DAYS));
    expect(days).toHaveLength(30);
  } finally { db.close(); }
});
