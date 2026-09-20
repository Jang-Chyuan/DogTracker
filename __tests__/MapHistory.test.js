import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
// A history read now returns one client track per selected dog.
const trackOf = (data, source) =>
  (source === 'phone' ? data.phone : data.clients[0]);
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { createHistoryDatabase, expireHistory, HISTORY_DATABASE_METHODS, HISTORY_DEFAULTS, historyGeometry, validateHistory } from '../src/mapHistory/HistoryDatabase';
import { historyWindow, parseHistoryRange } from '../src/mapHistory/HistoryTime';
import { serializeHistory } from '../src/mapHistory/HistoryExport';
import { dogHistoryLabel } from '../src/mapHistory/DogAliases';

test('dog aliases persist locally and clearing one restores its device label', async () => {
  const connection = createMemoryConnection();
  try {
    const db = createHistoryDatabase(connection);
    await createDogDatabase(connection).initialize();
    await db.load();
    await db.save({ ...HISTORY_DEFAULTS, dogAliases: { 4: ' 小黑 ', 6: '小黑' } });
    const loaded = await createHistoryDatabase(connection).load();
    expect(dogHistoryLabel(4, loaded.dogAliases)).toBe('小黑 狗 4');
    expect(dogHistoryLabel(6, loaded.dogAliases)).toBe('小黑 狗 6');
    await db.save({ ...loaded, dogAliases: { ...loaded.dogAliases, 4: ' ' } });
    expect(dogHistoryLabel(4, (await db.load()).dogAliases)).toBe('狗 4');
  } finally { connection.close(); }
});

test('rolling cutoff preserves a straight route after its simplified start expires', () => {
  const points = Array.from({ length: 61 }, (_, i) => ({ time: i * 1000, latitude: 25, longitude: 121 + i * 0.0001 }));
  const track = historyGeometry(points);
  expect(track.segments[0]).toHaveLength(2);
  const data = { since: 0, until: 60001, phone: track, clients: [{ ...track, slaveId: 4 }] };
  const clipped = expireHistory(data, { hours: 1, timeMode: 'recent' }, 3600001);
  for (const source of ['phone', 'client']) {
    expect(trackOf(clipped, source).count).toBe(60);
    expect(trackOf(clipped, source).segments[0]).toHaveLength(2);
    expect(trackOf(clipped, source).segments[0][0].time).toBe(1000);
    expect(trackOf(clipped, source).segments[0][1].time).toBe(60000);
  }
  const again = expireHistory(clipped, { hours: 1, timeMode: 'recent' }, 3605001);
  expect(again.phone.segments[0][0].time).toBe(6000);
  expect(track.segments[0][0].time).toBe(0);
});

test('expiry preserves invalid-fix and session breaks before simplifying', () => {
  const point = (time, session_id = 'a', latitude = 25) => ({ time, session_id, latitude, longitude: 121 });
  const track = historyGeometry([point(0), point(1000), point(2000), point(3000, 'a', null),
    point(4000), point(5000), point(6000, 'b'), point(7000, 'b')]);
  const result = expireHistory({ since: 0, until: 8000, phone: track, clients: [{ ...track, slaveId: 4 }] },
    { hours: 1, timeMode: 'recent' }, 3600001);
  expect(result.phone.segments.map(segment => segment.map(p => p.time))).toEqual([[1000, 2000], [4000, 5000], [6000, 7000]]);
});

test('recent history expires cached lines and markers without new data; fixed ranges remain', () => {
  const track = historyGeometry([1000, 6000, 11000].map(time => ({ time, latitude: 25, longitude: 121 })));
  const data = { since: 0, until: 12000, phone: track,
    clients: [{ slaveId: 4, ...track }] };
  const preferences = { ...HISTORY_DEFAULTS, hours: 1 };
  const partial = expireHistory(data, preferences, 3606000);
  expect(partial.phone.count).toBe(2);
  expect(partial.phone.segments.flat().every(point => point.time >= 6000)).toBe(true);
  const empty = expireHistory(data, preferences, 3611001);
  for (const source of ['phone', 'client']) {
    expect(trackOf(empty, source).count).toBe(0);
    expect(trackOf(empty, source).segments).toEqual([]);
    expect(trackOf(empty, source).latest).toBeNull();
  }
  expect(expireHistory(data, { ...preferences, timeMode: 'fixed' }, 99999999)).toBe(data);
  expect(data.phone.count).toBe(3);
});

test('a fixed range is two timestamps, and old saved queries convert to one', () => {
  const start = new Date(2026, 8, 16, 23, 30).getTime();
  const p = { ...HISTORY_DEFAULTS, timeMode: 'fixed', startAt: start, endAt: start + 7200000 };
  const first = historyWindow(p, 1);
  // A fixed range does not move with the clock.
  expect(historyWindow(p, 999999999)).toEqual(first);
  expect(new Date(first.until).getDate()).toBe(17);
  expect(new Date(first.until).getHours()).toBe(1);
  expect(() => parseHistoryRange(start, start)).toThrow('晚於');
  expect(() => parseHistoryRange(start, start + 241 * 3600000)).toThrow('240');
  expect(() => parseHistoryRange(null, start)).toThrow('選擇');
  // The card used to store a typed date, a typed time and a duration.
  const converted = validateHistory({ timeMode: 'fixed', startDate: '2026-09-16',
    startTime: '23:30', hours: 2 });
  expect(converted.startAt).toBe(start);
  expect(converted.endAt).toBe(start + 7200000);
  expect(converted.startDate).toBeUndefined();
  expect(validateHistory({ hours: 3 }).timeMode).toBe('recent');
  // Only the offered presets are kept, since the card no longer takes typing.
  expect(validateHistory({ hours: 7 }).hours).toBe(3);
});

test('fixed SQL window includes start and excludes end, and survives saved settings reload', async () => {
  const connection = createMemoryConnection();
  try {
    await createDogDatabase(connection).initialize();
    const history = createHistoryDatabase(connection);
    await history.load();
    const start = new Date(2026, 8, 16, 8, 0).getTime();
    const p = { ...HISTORY_DEFAULTS, phone: false, timeMode: 'fixed',
      startAt: start, endAt: start + 3 * 3600000 };
    await history.save(p);
    expect(await history.load()).toEqual(p);
    const { since, until } = historyWindow(p);
    const insert = connection.sqlite.prepare('INSERT INTO dog_status(received_at,master_id,slave_id,slave_lat,slave_lon) VALUES(?,7,4,25,121)');
    [since - 1, since, until - 1, until].forEach(time => insert.run(time));
    const result = await history.read(p, null, until + 86400000);
    expect(trackOf(result, 'client').count).toBe(2);
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
    const prefs = { ...HISTORY_DEFAULTS, source: 'cloud', hours: 1 };
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
    expect(trackOf(result, 'client').count).toBe(1);
    expect(result.phone.count).toBe(1);
    expect(trackOf(await history.read(prefs, null, 6000000), 'client').count).toBe(0);
    const off = await history.read({ ...prefs, phone: false, client: false }, 'alice', 6000000);
    expect(off.phone.count + trackOf(off, 'client').count).toBe(0);
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
    expect(trackOf(result, 'client').count).toBe(1002);
    expect(trackOf(result, 'client').latest.id).toBe(1002);
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
  expect(validateHistory({ hours: -1 }).hours).toBe(3);
  expect(() => validateHistory({ master: 1.5 })).toThrow();
});

test('history lines and exports skip rows with no GPS fix', () => {
  // 0,0 is what the tracker sends without a fix; drawing it stretches the line
  // from Taoyuan to the Gulf of Guinea and puts a marker there.
  const rows = [
    { id: 1, time: 1000, latitude: 25.03, longitude: 121.56, speed_kmh: 1 },
    { id: 2, time: 2000, latitude: 0, longitude: 0, speed_kmh: 0 },
    { id: 3, time: 3000, latitude: 25.04, longitude: 121.57, speed_kmh: 2 },
  ];
  const geometry = historyGeometry(rows);
  expect(geometry.count).toBe(2);
  expect(geometry.segments.flat().every(point => point.latitude !== 0)).toBe(true);
  expect(geometry.latest).toMatchObject({ id: 3 });
  const gpx = serializeHistory('gpx', { phone: rows, client: [], since: 1000, until: 4000 });
  expect(gpx).not.toContain('lat="0"');
  expect(gpx.match(/<trkpt /g)).toHaveLength(2);
});

test('every history database method is bound by the app composition', () => {
  // A method missing from the list is undefined only on a phone: the screens
  // call the adapter, the tests call the repository.
  const connection = createMemoryConnection();
  try {
    expect([...HISTORY_DATABASE_METHODS].sort())
      .toEqual(Object.keys(createHistoryDatabase(connection)).sort());
  } finally { connection.close(); }
});

test('the card is offered the Master/Slave pairs this phone actually holds', async () => {
  const connection = createMemoryConnection();
  try {
    await createDogDatabase(connection).initialize();
    await createCloudDatabase(connection).initialize();
    const history = createHistoryDatabase(connection);
    await history.load();
    const ble = connection.sqlite.prepare(
      'INSERT INTO dog_status(received_at,master_id,slave_id,slave_lat,slave_lon) VALUES(?,?,?,25,121)');
    ble.run(1000, 3, 7); ble.run(2000, 3, 7); ble.run(3000, 5, 2);
    const cloud = connection.sqlite.prepare(
      'INSERT INTO supabase_dog_status(received_at,owner_user_id,master_id,slave_id,slave_lat,slave_lon) VALUES(?,?,?,?,25,121)');
    cloud.run(1000, 'alice', 7, 4); cloud.run(2000, 'alice', 5, 4); cloud.run(3000, 'bob', 9, 9);
    // A Master-only row carries no slave id; Number(null) is 0, it sorted
    // first, and the card offered it as "狗 0".
    ble.run(4000, 3, null);
    expect(await history.listDevices('ble')).toEqual([
      { master: 5, slave: 2 }, { master: 3, slave: 7 },
    ]);
    expect(await history.listDevices('cloud', 'alice')).toEqual([
      { master: 5, slave: 4 }, { master: 7, slave: 4 },
    ]);
    // Another account's rows are never offered, and no account means no list.
    expect(await history.listDevices('cloud')).toEqual([]);
  } finally { connection.close(); }
});
