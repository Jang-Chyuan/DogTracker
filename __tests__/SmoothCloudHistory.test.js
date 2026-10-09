import { smoothCloudHistory } from '../src/mapHistory/SmoothCloudHistory';
import { persistCloudDisplayCoordinates } from '../src/cloud/CloudDisplayCoordinates';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';

const point = (time, latitude, extra = {}) => ({ time, latitude, longitude: 121, speed_kmh: 0, master_id: 7, ...extra });

test('uses three raw samples and reduces smoothing above 10 km/h without mutation', () => {
  const points = [point(0, 25), point(10000, 25.003), point(20000, 25.006), point(30000, 25.009, { speed_kmh: 20 })];
  const before = JSON.stringify(points);
  const result = smoothCloudHistory(points);
  expect(result[1].latitude).toBeCloseTo(25.0015, 8);
  expect(result[2].latitude).toBeCloseTo(25.003, 8);
  expect(result[3].latitude).toBeCloseTo(25.00855, 8);
  expect(JSON.stringify(points)).toBe(before);
});

test('invalid fixes, gaps, Master switches and date line reset the smoothing window', () => {
  for (const breaker of [point(10000, 0, { longitude: 0 }), point(10000, null)]) {
    const result = smoothCloudHistory([point(0, 25), breaker, point(20000, 26)]);
    expect(result[2].latitude).toBe(26);
  }
  for (const next of [point(130000, 26), point(10000, 26, { master_id: 5 }), point(-1, 26)]) {
    expect(smoothCloudHistory([point(0, 25), next])[1].latitude).toBe(26);
  }
  expect(smoothCloudHistory([point(0, 25, { longitude: 179 }), point(10000, 25, { longitude: -179 })])[1].longitude).toBe(-179);
});

// Moved from the retired range read (064, audit D06/T06): the stored display
// columns, written by persistCloudDisplayCoordinates directly.
const cloudPage = (connection, owner = 'alice') => connection.sqlite.prepare(`SELECT *, received_at AS time,
  slave_lat AS latitude, slave_lon AS longitude FROM supabase_dog_status WHERE owner_user_id=? ORDER BY received_at, id`).all(owner);

test('saved display points are computed once while SQLite keeps the raw GPS', async () => {
  const connection = createMemoryConnection();
  try {
    await createDogDatabase(connection).initialize();
    await createCloudDatabase(connection).initialize();
    const insert = connection.sqlite.prepare('INSERT INTO supabase_dog_status(received_at,owner_user_id,master_id,slave_id,slave_lat,slave_lon,speed_kmh) VALUES(?, ?, 7, 4, ?, 121, 0)');
    [25, 25.003, 25.006].forEach((latitude, i) => insert.run(1000 + i * 10000, 'alice', latitude));
    const shown = await persistCloudDisplayCoordinates(connection, cloudPage(connection), 'alice');
    expect(shown[2].latitude).toBeCloseTo(25.003, 8);
    const saved = connection.sqlite.prepare('SELECT display_latitude, display_version FROM supabase_dog_status ORDER BY received_at').all();
    expect(saved[2].display_latitude).toBe(shown[2].latitude);
    expect(saved.every(p => p.display_version === 1)).toBe(true);
    connection.executeBatchAsync.mockClear();
    const again = await persistCloudDisplayCoordinates(connection, cloudPage(connection), 'alice');
    expect(again[2].latitude).toBe(shown[2].latitude);
    expect(connection.executeBatchAsync).not.toHaveBeenCalled();
    expect(connection.sqlite.prepare('SELECT slave_lat FROM supabase_dog_status ORDER BY received_at').all().map(p => p.slave_lat)).toEqual([25, 25.003, 25.006]);
  } finally { connection.close(); }
});

test('late downloads invalidate stored smoothing but duplicates do not', async () => {
  const connection = createMemoryConnection();
  try {
    await createDogDatabase(connection).initialize();
    const cloud = createCloudDatabase(connection);
    await cloud.initialize();
    const record = (event_id, received_at, slave_lat) => ({ event_id, received_at, master_id: 7, slave_id: 4, slave_lat, slave_lon: 121, speed_kmh: 0, activity_valid: 0, battery_valid: 0 });
    await cloud.savePage('alice', [record('a', 1000, 25), record('c', 21000, 25.006)]);
    const latest = async () => (await persistCloudDisplayCoordinates(connection, cloudPage(connection), 'alice')).at(-1).latitude;
    expect(await latest()).toBeCloseTo(25.003, 8);
    await cloud.savePage('alice', [record('b', 11000, 25.009)]);
    expect(connection.sqlite.prepare("SELECT display_version FROM supabase_dog_status WHERE event_id='c'").get().display_version).toBeNull();
    expect(await latest()).toBeCloseTo(25.005, 8);
    await cloud.savePage('alice', [record('b', 11000, 25.009)]);
    expect(connection.sqlite.prepare("SELECT display_version FROM supabase_dog_status WHERE event_id='c'").get().display_version).toBe(1);
  } finally { connection.close(); }
});

test('page boundaries, accounts and dogs have independent raw smoothing context', async () => {
  const connection = createMemoryConnection();
  try {
    await createDogDatabase(connection).initialize();
    await createCloudDatabase(connection).initialize();
    const insert = connection.sqlite.prepare('INSERT INTO supabase_dog_status(received_at,owner_user_id,master_id,slave_id,slave_lat,slave_lon,speed_kmh) VALUES(?, ?, 7, ?, ?, 121, 0)');
    for (let i = 0; i < 1002; i += 1) insert.run(i * 1000, 'alice', 4, 25 + i * 0.00001);
    insert.run(1000500, 'bob', 4, 40);
    insert.run(1000500, 'alice', 5, 30);
    const page = cloudPage(connection);
    // Two pages: the second one's context comes from the stored rows before it.
    await persistCloudDisplayCoordinates(connection, page.slice(0, 1000), 'alice');
    const second = await persistCloudDisplayCoordinates(connection, page.slice(1000), 'alice');
    const dog4 = second.filter(row => row.slave_id === 4);
    expect(dog4.at(-1).latitude).toBeCloseTo(25.01, 8); // not pulled towards bob's 40
    expect(second.find(row => row.slave_id === 5).latitude).toBe(30);
  } finally { connection.close(); }
});
