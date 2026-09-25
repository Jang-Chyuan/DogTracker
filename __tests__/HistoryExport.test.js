import { serializeHistory } from '../src/mapHistory/HistoryExport';
import { createHistoryDatabase, HISTORY_DEFAULTS } from '../src/mapHistory/HistoryDatabase';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';

test('cloud export materializes smoothing before the map is opened and retains raw CSV columns', async () => {
  const connection = createMemoryConnection();
  try {
    await createDogDatabase(connection).initialize();
    await createCloudDatabase(connection).initialize();
    const insert = connection.sqlite.prepare('INSERT INTO supabase_dog_status(owner_user_id,master_id,slave_id,received_at,slave_lat,slave_lon,speed_kmh) VALUES(?,7,4,?,?,121,0)');
    insert.run('alice', 1000, 25);
    insert.run('alice', 2000, 25.006);
    insert.run('alice', 3000, 0);
    connection.sqlite.exec('UPDATE supabase_dog_status SET slave_lon=0 WHERE received_at=3000');
    const db = createHistoryDatabase(connection);
    const prefs = { ...HISTORY_DEFAULTS, source: 'cloud', phone: false };
    const data = await db.read(prefs, 'alice', 4000, () => true, true);
    const p = data.clients[0].rows[1];
    expect(p.latitude).toBeCloseTo(25.003, 8);
    const csv = serializeHistory('csv', data);
    expect(csv).toContain(`"${p.latitude}","121"`);
    expect(csv).toContain('"25.006","121"');
    expect(csv).toContain('"cloud-smoothed-v1"');
    const gpx = serializeHistory('gpx', data);
    expect(gpx).toContain(`<trkpt lat="${p.latitude}" lon="121">`);
    expect(gpx).not.toContain('lat="25.006"');
    expect(gpx).not.toContain('lat="0"');
    expect(gpx.match(/<trkpt /g)).toHaveLength(2);
    const map = await db.read(prefs, 'alice', 4000);
    expect(map.clients[0].latest.latitude).toBe(p.latitude);
  } finally { connection.close(); }
});

test('history and export prefer saved display coordinates and preserve raw GPS', async () => {
  const connection = createMemoryConnection();
  try {
    connection.sqlite.exec(`CREATE TABLE myLocationTracker(id INTEGER PRIMARY KEY, recorded_at INTEGER,
      location_at INTEGER, latitude REAL, longitude REAL, accuracy_meters REAL, altitude_meters REAL,
      heading_degrees REAL, speed_kmh REAL, raw_latitude REAL, raw_longitude REAL,
      display_latitude REAL, display_longitude REAL, display_source TEXT);
      INSERT INTO myLocationTracker VALUES(1,1000,900,25,121,3,0,0,2,25.1,121.1,25.0001,121.0001,'animated');
      INSERT INTO myLocationTracker VALUES(2,2000,1900,25.02,121.02,3,0,0,2,NULL,NULL,NULL,NULL,NULL);`);
    const db = createHistoryDatabase(connection);
    const settings = { ...HISTORY_DEFAULTS, client: false };
    const result = await db.read(settings, null, 3000, () => true, true);
    expect(result.phone[0].latitude).toBe(25.0001);
    expect(result.phone[0].raw_latitude).toBe(25.1);
    expect(result.phone[0].display_source).toBe('animated');
    expect(result.phone[1].latitude).toBe(25.02);
    expect(connection.sqlite.prepare('SELECT latitude FROM myLocationTracker WHERE id=1').get().latitude).toBe(25);
    const map = await db.read(settings, null, 3000);
    expect(map.phone.segments[0][0].latitude).toBe(25.0001);
    connection.sqlite.exec('UPDATE myLocationTracker SET display_latitude=24.98 WHERE id=1');
    const recovered = await db.read(settings, null, 3000, () => true, true);
    expect(recovered.phone[0]).toMatchObject({ latitude: 25, longitude: 121, display_source: 'pipeline-recovered' });
    expect((await db.read(settings, null, 3000)).phone.segments[0][0].latitude).toBe(25);
    expect(connection.sqlite.prepare('SELECT display_latitude FROM myLocationTracker WHERE id=1').get().display_latitude).toBe(24.98);
  } finally { connection.close(); }
});

test('CSV preserves optional precision and acquisition time, uses BOM and quotes cells', () => {
  const result = serializeHistory('csv', { phone: [{ id: 1, time: 1000, location_at: 900, latitude: 25, longitude: 121, accuracy_meters: 4.5 }], clients: [{ slaveId: 4, rows: [] }] });
  expect(result.startsWith('\uFEFFsource,')).toBe(true);
  expect(result).toContain('"1970-01-01T00:00:00.900Z"');
  expect(result).toContain('"4.5","","",""');
});

test('GPX separates sources and gaps without simplifying the exported points', () => {
  const point = (time, latitude = 25) => ({ time, latitude, longitude: 121 });
  const result = serializeHistory('gpx', { since: 0, until: 300000,
    phone: [point(0), point(10000), point(20000, null), point(30000), point(200000)],
    clients: [{ slaveId: 4, rows: [point(0)] }] });
  expect(result.match(/<trkpt /g)).toHaveLength(5);
  expect(result.match(/<trkseg>/g)).toHaveLength(4);
  expect(result).toContain('<name>phone</name>');
  // One named track per dog, so several dogs stay readable in one file.
  expect(result).toContain('<name>dog-4</name>');
  expect(result).not.toContain('lat="null"');
});

test('raw export queries full selected interval, not the capped or simplified map geometry', async () => {
  const connection = createMemoryConnection();
  try {
    await createDogDatabase(connection).initialize();
    const history = createHistoryDatabase(connection);
    await history.load();
    const insert = connection.sqlite.prepare('INSERT INTO dog_status(received_at, master_id,slave_id,slave_lat,slave_lon) VALUES(?,7,4,25,121)');
    connection.sqlite.exec('BEGIN');
    for (let i = 1; i <= 4100; i += 1) insert.run(i);
    connection.sqlite.exec('COMMIT');
    const settings = { ...HISTORY_DEFAULTS, phone: false };
    const raw = await history.read(settings, null, 99999999, () => true, true, { since: 1, until: 4101 });
    expect(raw.client).toHaveLength(4100);
    expect(raw.phone).toEqual([]);
    expect(serializeHistory('gpx', raw).match(/<trkpt /g)).toHaveLength(4100);
  } finally { connection.close(); }
});

test('phone Timeline reads migrated provenance and splits separate recording sessions', async () => {
  const connection = createMemoryConnection();
  try {
    connection.sqlite.exec(`CREATE TABLE myLocationTracker (
      id INTEGER PRIMARY KEY, recorded_at INTEGER, location_at INTEGER,
      latitude REAL, longitude REAL, speed_kmh REAL, accuracy_meters REAL,
      altitude_meters REAL, heading_degrees REAL, raw_latitude REAL, raw_longitude REAL, session_id TEXT);
      INSERT INTO myLocationTracker VALUES
        (1,1000,900,25,121,0,20,NULL,NULL,25.00001,121,'first'),
        (2,6000,5900,25.001,121,0,20,NULL,NULL,25.00101,121,'second'),
        (3,11000,10900,25.002,121,0,20,NULL,NULL,25.00201,121,'second');`);
    const history = createHistoryDatabase(connection);
    const settings = { ...HISTORY_DEFAULTS, client: false };
    const bounds = { since: 1000, until: 11000 };
    const raw = await history.read(settings, null, 0, () => true, true, bounds);
    expect(raw.phone).toHaveLength(2);
    expect(raw.phone[0].raw_latitude).toBe(25.00001);
    expect(serializeHistory('csv', raw)).toContain('"25.00001","121","first"');
    expect(serializeHistory('gpx', raw).match(/<trkseg>/g)).toHaveLength(2);
    const map = await history.read(settings, null, 0, () => true, false, bounds);
    expect(map.phone.segments).toHaveLength(2);
  } finally { connection.close(); }
});
