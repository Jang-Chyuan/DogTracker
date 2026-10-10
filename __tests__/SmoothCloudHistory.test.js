import { smoothCloudHistory } from '../src/mapHistory/SmoothCloudHistory';
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

// 2026-10-09: the cloud display-coordinate cache is retired (nothing read it
// after 064). New installs never add its columns; an install that had them
// keeps them, unused, and downloads still save.
const columnsOf = connection => connection.sqlite.prepare('PRAGMA table_info(supabase_dog_status)').all()
  .map(column => column.name);
const record = (event_id, received_at, slave_lat) => ({ event_id, received_at, master_id: 7, slave_id: 4, slave_lat,
  slave_lon: 121, speed_kmh: 0, activity_valid: 0, battery_valid: 0 });

test('a new install has no cloud display columns', async () => {
  const connection = createMemoryConnection();
  try {
    await createDogDatabase(connection).initialize();
    const cloud = createCloudDatabase(connection);
    await cloud.initialize();
    expect(columnsOf(connection).filter(name => name.startsWith('display_'))).toEqual([]);
    await cloud.savePage('alice', [record('a', 1000, 25), record('c', 21000, 25.006)]);
    await cloud.savePage('alice', [record('b', 11000, 25.009)]);
    expect(connection.sqlite.prepare('SELECT event_id, slave_lat FROM supabase_dog_status ORDER BY received_at').all())
      .toEqual([{ event_id: 'a', slave_lat: 25 }, { event_id: 'b', slave_lat: 25.009 }, { event_id: 'c', slave_lat: 25.006 }]);
  } finally { connection.close(); }
});

test('an install with the old cache upgrades: the columns stay, untouched, and downloads save', async () => {
  const connection = createMemoryConnection();
  try {
    await createDogDatabase(connection).initialize();
    for (const [name, type] of [['display_latitude', 'REAL'], ['display_longitude', 'REAL'], ['display_version', 'INTEGER']]) {
      connection.sqlite.exec(`ALTER TABLE supabase_dog_status ADD COLUMN ${name} ${type}`);
    }
    connection.sqlite.prepare(`INSERT INTO supabase_dog_status(received_at,master_id,slave_id,slave_lat,
      slave_lon,display_latitude,display_longitude,display_version) VALUES(500,7,4,24.9,121,24.9,121,1)`).run();
    const cloud = createCloudDatabase(connection);
    await cloud.initialize();
    await cloud.savePage('alice', [record('a', 1000, 25)]);
    expect(columnsOf(connection)).toEqual(expect.arrayContaining(['display_latitude', 'display_version']));
    expect(connection.sqlite.prepare('SELECT COUNT(*) AS n FROM supabase_dog_status').get().n).toBe(2);
    expect(connection.sqlite.prepare('SELECT track_at, display_version FROM supabase_dog_status WHERE received_at=500').get())
      .toEqual({ track_at: 500, display_version: 1 });
  } finally { connection.close(); }
});
