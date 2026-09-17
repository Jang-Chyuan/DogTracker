import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { createHistoryDatabase, HISTORY_DEFAULTS, historyGeometry, validateHistory } from '../src/mapHistory/HistoryDatabase';
import { historyWindow, parseHistoryStart } from '../src/mapHistory/HistoryTime';

test('fixed date and time remain stable, support crossing midnight and reject invalid dates', () => {
  const p = { ...HISTORY_DEFAULTS, timeMode: 'fixed', startDate: '2026-09-16', startTime: '23:30', hours: 2 };
  const first = historyWindow(p, 1);
  expect(historyWindow(p, 999999999)).toEqual(first);
  expect(new Date(first.until).getDate()).toBe(17);
  expect(new Date(first.until).getHours()).toBe(1);
  expect(first.until - first.since).toBe(7200000);
  expect(() => parseHistoryStart('2026-02-30', '08:00')).toThrow();
  expect(() => parseHistoryStart('2026-09-17', '24:00')).toThrow();
  expect(() => parseHistoryStart('2026-09-17', '08:60')).toThrow();
  expect(() => parseHistoryStart('2026-09-17', '8:00')).toThrow();
  expect(validateHistory({ hours: 3 }).timeMode).toBe('recent');
});

test('fixed SQL window includes start and excludes end, and survives saved settings reload', async () => {
  const connection = createMemoryConnection();
  try {
    await createDogDatabase(connection).initialize();
    const history = createHistoryDatabase(connection);
    await history.load();
    const p = { ...HISTORY_DEFAULTS, phone: false, timeMode: 'fixed', startDate: '2026-09-16', startTime: '08:00', hours: 3 };
    await history.save(p);
    expect(await history.load()).toEqual(p);
    const { since, until } = historyWindow(p);
    const insert = connection.sqlite.prepare('INSERT INTO dog_status(received_at,master_id,slave_id,slave_lat,slave_lon) VALUES(?,7,4,25,121)');
    [since - 1, since, until - 1, until].forEach(time => insert.run(time));
    const result = await history.read(p, null, until + 86400000);
    expect(result.client.count).toBe(2);
    expect(result.since).toBe(since);
    expect(result.until).toBe(until);
  } finally { connection.close(); }
});

test('history isolates cloud owners and devices, respects time bounds and independent source switches', async () => {
  const connection = createMemoryConnection();
  try {
    await createDogDatabase(connection).initialize();
    await createCloudDatabase(connection).initialize();
    const history = createHistoryDatabase(connection);
    expect(await history.load()).toEqual(HISTORY_DEFAULTS);
    const prefs = { ...HISTORY_DEFAULTS, enabled: true, source: 'cloud', hours: 1 };
    await history.save(prefs);
    expect(await history.load()).toEqual(prefs);
    const sql = connection.sqlite;
    sql.exec('CREATE TABLE myLocationTracker(id INTEGER PRIMARY KEY, recorded_at INTEGER, latitude REAL, longitude REAL, speed_kmh REAL)');
    sql.exec('INSERT INTO myLocationTracker VALUES(1, 5000000, 25, 121, 3)');
    const insert = sql.prepare('INSERT INTO supabase_dog_status(received_at,owner_user_id,master_id,slave_id,slave_lat,slave_lon) VALUES(?,?,?,?,25,121)');
    insert.run(5000000, 'alice', 7, 4);
    insert.run(5000000, 'bob', 7, 4);
    insert.run(5000000, 'alice', 5, 4);
    insert.run(5000000, 'alice', 7, 1);
    insert.run(1, 'alice', 7, 4);
    insert.run(9000000, 'alice', 7, 4);
    const result = await history.read(prefs, 'alice', 6000000);
    expect(result.client.count).toBe(1);
    expect(result.phone.count).toBe(1);
    expect((await history.read(prefs, null, 6000000)).client.count).toBe(0);
    const off = await history.read({ ...prefs, phone: false, client: false }, 'alice', 6000000);
    expect(off.phone.count + off.client.count).toBe(0);
  } finally { connection.close(); }
});

test('keyset query preserves records sharing a timestamp across pages', async () => {
  const connection = createMemoryConnection();
  try {
    await createDogDatabase(connection).initialize();
    const history = createHistoryDatabase(connection);
    await history.load();
    const insert = connection.sqlite.prepare('INSERT INTO dog_status(received_at,master_id,slave_id,slave_lat,slave_lon) VALUES(5000000,7,4,25,121)');
    connection.sqlite.exec('BEGIN');
    for (let i = 0; i < 1002; i += 1) insert.run();
    connection.sqlite.exec('COMMIT');
    const result = await history.read({ ...HISTORY_DEFAULTS, hours: 1, phone: false }, null, 6000000);
    expect(result.client.count).toBe(1002);
    expect(result.client.latest.id).toBe(1002);
  } finally { connection.close(); }
});

test('route geometry breaks at missing fixes and long gaps, retains latest marker and caps drawing', () => {
  const p = (time, latitude = 25) => ({ time, latitude, longitude: 121 });
  const result = historyGeometry([p(0), p(10000), p(20000, null), p(30000), p(200000)]);
  expect(result.segments).toHaveLength(3);
  expect(result.latest.time).toBe(200000);
  const many = historyGeometry(Array.from({ length: 5000 }, (_, i) => p(i * 130000)));
  expect(many.limited).toBe(true);
  expect(many.segments.flat()).toHaveLength(4000);
  expect(many.latest.time).toBe(4999 * 130000);
  expect(() => validateHistory({ hours: -1 })).toThrow();
  expect(() => validateHistory({ master: 1.5 })).toThrow();
});
