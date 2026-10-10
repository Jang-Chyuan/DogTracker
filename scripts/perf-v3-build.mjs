// v3 (lane-b-e2e, bf5ccef) schema + indexes at the retention caps.
// DDL copied verbatim, in the order an Android install runs it:
//   DogStatusStore.kt init -> BleUploadQueue.initialize -> LocalDatabases (drop demo)
//   -> DogDatabase.initialize -> CloudDatabase.initialize -> HistoryDatabase.load
//   -> ensureBleDisplayColumns -> LocationTrackerStore init -> settings/avatars/address cache.
// Tables are created (with every ALTER) first, filled, then indexed and the trigger added:
// the final schema is identical to the app's, only faster to build.
// Run: TZ=Asia/Taipei node --experimental-sqlite build.mjs
import { DatabaseSync } from 'node:sqlite';
import { existsSync, statSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';

const FILE = process.argv[2] || '/private/tmp/dogtracker-perf-v3.db';
for (const s of ['', '-wal', '-shm']) if (existsSync(FILE + s)) unlinkSync(FILE + s);
const db = new DatabaseSync(FILE);
db.exec('PRAGMA journal_mode=WAL');
db.exec('PRAGMA synchronous=OFF');

// ---- DogStatusStore.kt:22-48 (column list and types built exactly like `definitions`) ----
const FIELDS = ['master_id', 'slave_id', 'slave_lat', 'slave_lon', 'master_lat', 'master_lon',
  'distance_meters', 'speed_kmh', 'satellites', 'hdop', 'activity', 'activity_valid', 'battery_mv',
  'battery_percentage', 'usb_present', 'battery_valid', 'master_battery_mv', 'master_battery_percentage',
  'master_battery_valid', 'rssi', 'snr', 'gps_time', 'activity_time', 'packet_type', 'sequence', 'packet_length'];
const TEXT = new Set(['activity', 'gps_time', 'activity_time', 'packet_type']);
const REAL = new Set(['slave_lat', 'slave_lon', 'master_lat', 'master_lon', 'distance_meters', 'speed_kmh', 'hdop', 'rssi', 'snr']);
const definitions = FIELDS.map(n => `${n} ${TEXT.has(n) ? 'TEXT' : REAL.has(n) ? 'REAL' : 'INTEGER'}${n.endsWith('_valid') ? ' NOT NULL DEFAULT 0' : ''}`).join(',');
db.exec(`CREATE TABLE IF NOT EXISTS dog_status (id INTEGER PRIMARY KEY AUTOINCREMENT, received_at INTEGER NOT NULL, ${definitions}, raw_payload TEXT)`);
db.exec(`CREATE TABLE IF NOT EXISTS supabase_dog_status (id INTEGER PRIMARY KEY AUTOINCREMENT, received_at INTEGER NOT NULL, ${definitions}, raw_payload TEXT)`);
// BleUploadQueue.kt:12-14
db.exec("CREATE TABLE IF NOT EXISTS ble_upload_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL)");
db.exec("CREATE TABLE IF NOT EXISTS ble_upload_settings (owner_user_id TEXT NOT NULL,master_id INTEGER NOT NULL,mode TEXT NOT NULL CHECK(mode IN ('wifi','phone')),PRIMARY KEY(owner_user_id,master_id))");
db.exec("CREATE TABLE IF NOT EXISTS ble_upload_queue (id INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT NOT NULL UNIQUE,owner_user_id TEXT NOT NULL,master_id INTEGER NOT NULL,received_at INTEGER NOT NULL,payload_json TEXT NOT NULL,fingerprint TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_retry_at INTEGER NOT NULL DEFAULT 0,last_error TEXT NOT NULL DEFAULT '',sent_at INTEGER,slave_id INTEGER)");
// CloudDatabase.js:73-83 (ALTERs; usb_present already exists)
for (const [name, type] of [['owner_user_id', 'TEXT'], ['event_id', 'TEXT'], ['downloaded_at', 'INTEGER'],
  ['remote_received_at', 'TEXT'], ['display_latitude', 'REAL'], ['display_longitude', 'REAL'],
  ['display_version', 'INTEGER'], ['track_at', 'INTEGER'], ['upload_source', 'TEXT'],
  ['phone_received_at', 'INTEGER'], ['track_time_version', 'INTEGER']]) {
  db.exec(`ALTER TABLE supabase_dog_status ADD COLUMN ${name} ${type}`);
}
// HistoryDatabase.js:116
db.exec('CREATE TABLE IF NOT EXISTS map_history_settings (id INTEGER PRIMARY KEY CHECK (id=1), value TEXT NOT NULL)');
// BleDisplayCoordinates.js:8-10
for (const [name, type] of [['display_latitude', 'REAL'], ['display_longitude', 'REAL'], ['display_version', 'INTEGER']]) {
  db.exec(`ALTER TABLE dog_status ADD COLUMN ${name} ${type}`);
}
// LocationTrackerStore.kt:12, 18-21
db.exec('CREATE TABLE IF NOT EXISTS myLocationTracker (id INTEGER PRIMARY KEY AUTOINCREMENT, recorded_at INTEGER NOT NULL, location_at INTEGER NOT NULL, latitude REAL NOT NULL, longitude REAL NOT NULL, accuracy_meters REAL, altitude_meters REAL, speed_kmh REAL, heading_degrees REAL)');
for (const [name, type] of [['raw_latitude', 'REAL'], ['raw_longitude', 'REAL'], ['session_id', 'TEXT'],
  ['raw_speed_kmh', 'REAL'], ['speed_accuracy_mps', 'REAL'], ['motion_state', 'TEXT'],
  ['display_latitude', 'REAL'], ['display_longitude', 'REAL'], ['display_source', 'TEXT'], ['display_location_at', 'INTEGER']]) {
  db.exec(`ALTER TABLE myLocationTracker ADD COLUMN ${name} ${type}`);
}
// CloudDatabase.js:111-122, SettingsDatabase.js:7, HistoryDatabase.js:26, AddressCache.js:12
db.exec(`CREATE TABLE IF NOT EXISTS cloud_sync_state (
  owner_user_id TEXT NOT NULL, master_id INTEGER NOT NULL,
  through_at TEXT NOT NULL, event_id TEXT, updated_at INTEGER NOT NULL,
  PRIMARY KEY (owner_user_id, master_id))`);
db.exec(`CREATE TABLE IF NOT EXISTS cloud_sync_buckets (
  owner_user_id TEXT NOT NULL, master_id INTEGER NOT NULL,
  bucket_start INTEGER NOT NULL, cloud_count INTEGER NOT NULL,
  verified_at INTEGER NOT NULL,
  PRIMARY KEY (owner_user_id, master_id, bucket_start))`);
db.exec('CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)');
db.exec('CREATE TABLE IF NOT EXISTS dog_avatars (slave_id INTEGER PRIMARY KEY NOT NULL, value TEXT NOT NULL)');
db.exec(`CREATE TABLE IF NOT EXISTS address_cache (latitude REAL NOT NULL, longitude REAL NOT NULL, value TEXT,
  failed_at INTEGER, updated_at INTEGER NOT NULL, PRIMARY KEY (latitude, longitude))`);

// ---- data shape: 6 dogs, 2 Masters, every dog reports every 6 s ----
const DOGS = [[7, 2], [7, 4], [7, 6], [3, 7], [3, 9], [3, 11]];
const NOW = Date.parse('2026-10-09T12:00:00+08:00');
const OWNER = 'fb96978f-cfc2-403c-bbfc-ffdf3bc7b25e';
const STEP = 6000;
const DAY = 86400000;
const BLE_PER_DOG = 10000;                                   // DogStatusStore.kt:107, DogDatabase.js:7
const CLOUD_MAX_ROWS = Math.floor(500 * 1024 * 1024 / 560);  // CloudDatabase.js:18-20 = 936,228
const CLOUD_PER_DOG = Math.floor(CLOUD_MAX_ROWS / DOGS.length);
const PHONE_CAP = 80000;                                      // LocationTrackerStore.kt:10
const QUEUE_PENDING = 20000;                                  // BleUploadQueue.kt:54 (queue full)
const QUEUE_SENT = 1000;                                      // UploadDatabase.js:62

const at = (i, slave) => NOW - i * STEP - slave * 97;        // dog clock grid, newest i=0
const fix = (i, slave) => {
  const bad = (i + slave) % 50 === 0;                         // 2 % no fix (0,0 or NULL)
  if (bad) return i % 2 ? [0, 0] : [null, null];
  return [24.95 + ((i * 7 + slave) % 1000) / 100000, 121.12 + ((i * 11 + slave) % 1000) / 100000];
};
const activity = (i, slave) => (((i * 13 + slave) % 100) / 100).toFixed(2);
const activityTime = t => new Date(t).toISOString().slice(11, 19);
const payloadOf = (m, s, i, lat, lon) => JSON.stringify({ t: 'dog_status', mid: m, sid: s, slat: lat, slon: lon,
  mlat: 24.95, mlon: 121.12, dst: 123.4, spd: i % 15, sat: 3 + (i % 10), hd: 1.1, act: activity(i, s),
  av: 1, bmv: 3900 + (i % 300), bp: 60 + (i % 40), bv: 1, rssi: -70 - (i % 20), snr: 8.5, seq: i % 65536, len: 42 });

function insertAll(table, columns, rows) {
  const stmt = db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`);
  let n = 0;
  db.exec('BEGIN');
  for (const values of rows) {
    stmt.run(...values);
    n += 1;
    if (n % 200000 === 0) { db.exec('COMMIT'); db.exec('BEGIN'); process.stdout.write(`  ${table} ${n}\n`); }
  }
  db.exec('COMMIT');
  return n;
}

// dog_status: 10,000 rows per dog (the per-dog cap), oldest first so ids follow time.
// Every BLE row keeps raw_payload (Kotlin never clears it). Display coordinates were
// materialised by earlier reads, except the newest 3 rows per dog.
const bleCols = ['received_at', ...FIELDS, 'raw_payload', 'display_latitude', 'display_longitude', 'display_version'];
function* bleRows() {
  for (let i = BLE_PER_DOG - 1; i >= 0; i -= 1) {
    for (const [m, s] of DOGS) {
      const t = at(i, s);
      const [lat, lon] = fix(i, s);
      const v = {
        master_id: m, slave_id: s, slave_lat: lat, slave_lon: lon, master_lat: 24.95, master_lon: 121.12,
        distance_meters: 123.4 + (i % 100), speed_kmh: (i % 15) + 0.5, satellites: 3 + ((i * 7 + s) % 10),
        hdop: 1.1, activity: activity(i, s), activity_valid: (i + s) % 33 === 0 ? 0 : 1,
        battery_mv: 3900 + (i % 300), battery_percentage: 60 + (i % 40), usb_present: i % 500 < 20 ? 1 : 0,
        battery_valid: 1, master_battery_mv: 4000, master_battery_percentage: 80, master_battery_valid: 1,
        rssi: -70 - (i % 20), snr: 8.5, gps_time: new Date(t).toISOString(), activity_time: activityTime(t),
        packet_type: 'dog_status', sequence: i % 65536, packet_length: 42,
      };
      const displayed = i >= 3 && lat !== null;
      yield [t, ...FIELDS.map(f => v[f]), payloadOf(m, s, i, lat, lon),
        displayed ? lat : null, displayed ? lon : null, displayed ? 1 : null];
    }
  }
}

// supabase_dog_status: the 500 MB cap, ~10.8 days per dog. Same dog clock as BLE, so the
// last ~17 h overlap the BLE rows (same activity_time and track_at: ActivityData's dedupe
// finds them). Cloud rows lack Master position/battery/packet fields (no such payload keys).
// raw_payload only for the last 24 h (CLOUD_PAYLOAD_MS). track_time_version NULL for the
// newest 300 rows (repair pending); display coordinates materialised for rows older than a day.
const cloudCols = ['received_at', 'master_id', 'slave_id', 'slave_lat', 'slave_lon', 'speed_kmh', 'satellites',
  'hdop', 'activity', 'activity_valid', 'battery_mv', 'battery_percentage', 'usb_present', 'battery_valid',
  'rssi', 'snr', 'gps_time', 'activity_time', 'sequence', 'raw_payload', 'owner_user_id', 'event_id',
  'downloaded_at', 'remote_received_at', 'display_latitude', 'display_longitude', 'display_version',
  'track_at', 'upload_source', 'phone_received_at', 'track_time_version'];
function* cloudRows() {
  const LAG = 20; // the copy ends ~2 min before NOW (download every 30 s + upload lag)
  for (let i = CLOUD_PER_DOG - 1 + LAG; i >= LAG; i -= 1) {
    for (const [m, s] of DOGS) {
      const t = at(i, s);
      const [lat, lon] = fix(i, s);
      const server = t + 1500;
      const old = t < NOW - DAY;
      yield [server, m, s, lat, lon, (i % 15) + 0.5, 3 + ((i * 7 + s) % 10), 1.1, activity(i, s),
        (i + s) % 33 === 0 ? 0 : 1, 3900 + (i % 300), 60 + (i % 40), i % 500 < 20 ? 1 : 0, 1,
        -70 - (i % 20), 8.5, new Date(t).toISOString(), activityTime(t), i % 65536,
        old ? null : payloadOf(m, s, i, lat, lon), OWNER,
        createHash('md5').update(`${m}-${s}-${i}`).digest('hex').replace(/^(.{8})(.{4})(.{4})(.{4})/, '$1-$2-$3-$4-'),
        NOW, new Date(server).toISOString(),
        old && lat !== null ? lat : null, old && lat !== null ? lon : null, old && lat !== null ? 1 : null,
        t, i % 3 ? 'wifi' : 'phone', i % 3 ? null : t, i < LAG + 50 ? null : 1];
    }
  }
}

// myLocationTracker: the 80,000 row cap. Recording 07:00-17:00 local each day at 3 s
// (LocationPipeline.kt intervalSeconds: 1 s fast / 3 s >10 km/h / 5 s otherwise) => ~6.7 days.
const phoneCols = ['recorded_at', 'location_at', 'latitude', 'longitude', 'accuracy_meters', 'altitude_meters',
  'speed_kmh', 'heading_degrees', 'raw_latitude', 'raw_longitude', 'session_id', 'raw_speed_kmh',
  'speed_accuracy_mps', 'motion_state', 'display_latitude', 'display_longitude', 'display_source', 'display_location_at'];
function* phoneRows() {
  const times = [];
  for (let t = NOW; times.length < PHONE_CAP; t -= 3000) {
    const hour = new Date(t).getHours(); // TZ=Asia/Taipei
    if (hour >= 7 && hour < 17) times.push(t);
  }
  times.reverse();
  for (let k = 0; k < times.length; k += 1) {
    const t = times[k];
    const lat = 24.95 + (k % 2000) / 200000, lon = 121.12 + (k % 1700) / 200000;
    yield [t, t - 400, lat, lon, 8 + (k % 20), 120, 4.2, k % 360, lat + 0.00001, lon - 0.00001,
      `sess-${new Date(t).toDateString()}`, 4.3, 0.8, 'walking', lat, lon, 'animated', t - 400];
  }
}

// ble_upload_queue: worst case = full queue (20,000 pending, phone offline) + 1,000 sent.
const queueCols = ['event_id', 'owner_user_id', 'master_id', 'received_at', 'payload_json', 'fingerprint',
  'status', 'attempts', 'next_retry_at', 'last_error', 'sent_at', 'slave_id'];
function* queueRows() {
  const total = QUEUE_PENDING + QUEUE_SENT;
  for (let k = 0; k < total; k += 1) {
    const [m, s] = DOGS[k % DOGS.length];
    const t = NOW - (total - k) * 1000;
    const sent = k < QUEUE_SENT;
    const payload = payloadOf(m, s, k, 24.95, 121.12);
    yield [`q-${k}-${m}-${s}`, OWNER, m, t, payload, createHash('sha256').update(payload).digest('hex'),
      sent ? 'sent' : 'pending', sent ? 1 : 2, sent ? 0 : NOW - 5000 + (k % 20) * 1000,
      sent ? '' : '網路連線失敗', sent ? t + 500 : null, s];
  }
}

const t0 = Date.now();
const counts = {
  dog_status: insertAll('dog_status', bleCols, bleRows()),
  supabase_dog_status: insertAll('supabase_dog_status', cloudCols, cloudRows()),
  myLocationTracker: insertAll('myLocationTracker', phoneCols, phoneRows()),
  ble_upload_queue: insertAll('ble_upload_queue', queueCols, queueRows()),
};
db.prepare("INSERT INTO ble_upload_meta(key,value) VALUES('phone_id','8d0a3f6e-1111-4222-8333-944455556666'),('owner',?)").run(OWNER);
db.prepare("INSERT INTO ble_upload_settings VALUES(?,7,'phone'),(?,3,'phone')").run(OWNER, OWNER);
for (const m of [7, 3]) {
  db.prepare('INSERT INTO cloud_sync_state VALUES(?,?,?,?,?)').run(OWNER, m, new Date(NOW - 120000).toISOString(), 'evt', NOW);
  for (let h = 1; h <= 48; h += 1) {
    db.prepare('INSERT INTO cloud_sync_buckets VALUES(?,?,?,?,?)')
      .run(OWNER, m, Math.floor(NOW / 3600000) * 3600000 - h * 3600000, 1800, NOW);
  }
}
db.prepare('INSERT INTO map_history_settings VALUES(1,?)').run(JSON.stringify({ masters: [3, 7], slaves: [2, 4] }));
db.prepare("INSERT INTO app_settings VALUES('tracking','{}')").run();
for (const [, s] of DOGS) db.prepare('INSERT INTO dog_avatars VALUES(?,?)').run(s, '{"kind":"preset","id":"shiba"}');
console.log(`data ${((Date.now() - t0) / 1000).toFixed(0)}s`, counts);

const t1 = Date.now();
// ---- indexes, verbatim, in app order ----
// DogStatusStore.kt:51-52, 71-72 (idx_dog_status_received_at is dropped again by DogDatabase.js:125)
db.exec('CREATE INDEX IF NOT EXISTS idx_supabase_dog_status_received_at_id ON supabase_dog_status(received_at, id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_supabase_dog_status_slave_received ON supabase_dog_status(slave_id, received_at DESC)');
db.exec('CREATE INDEX IF NOT EXISTS idx_dog_status_slave_received ON dog_status(slave_id, received_at DESC)');
// BleUploadQueue.kt:33-35
db.exec('CREATE INDEX IF NOT EXISTS idx_ble_upload_latest ON ble_upload_queue(owner_user_id,status,master_id,slave_id,id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_ble_upload_pending ON ble_upload_queue(owner_user_id,status,next_retry_at,id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_ble_upload_fingerprint ON ble_upload_queue(owner_user_id,master_id,fingerprint,received_at)');
// DogDatabase.js:118-125
db.exec('CREATE INDEX IF NOT EXISTS idx_dog_status_received_at_id ON dog_status(received_at, id)');
db.exec('DROP INDEX IF EXISTS idx_dog_status_received_at');
// CloudDatabase.js:88-110
db.exec('DROP INDEX IF EXISTS idx_cloud_track_stream');
db.exec(`CREATE INDEX IF NOT EXISTS idx_cloud_track_stream_numeric
  ON supabase_dog_status(owner_user_id, master_id, slave_id, CAST(COALESCE(track_at, received_at) AS INTEGER), id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_cloud_track_successors
  ON supabase_dog_status(owner_user_id, master_id, slave_id, track_at, id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_cloud_latest_packet
  ON supabase_dog_status(owner_user_id, slave_id, CAST(COALESCE(track_at, received_at) AS INTEGER) DESC, id DESC)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_cloud_latest_fix
  ON supabase_dog_status(owner_user_id, slave_id, CAST(COALESCE(track_at, received_at) AS INTEGER) DESC, id DESC)
  WHERE slave_lat IS NOT NULL AND slave_lon IS NOT NULL AND NOT (slave_lat=0 AND slave_lon=0)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_cloud_payload_cleanup
  ON supabase_dog_status(received_at) WHERE raw_payload IS NOT NULL`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_cloud_track_repair
  ON supabase_dog_status(owner_user_id, track_time_version, received_at DESC)`);
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_cloud_owner_event
  ON supabase_dog_status(owner_user_id, event_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_cloud_owner_history
  ON supabase_dog_status(owner_user_id, received_at DESC, id DESC)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_cloud_owner_master_received
  ON supabase_dog_status(owner_user_id, master_id, received_at)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_cloud_display_stream
  ON supabase_dog_status(owner_user_id, master_id, slave_id, received_at, id)`);
// HistoryDatabase.js:117
db.exec('CREATE INDEX IF NOT EXISTS idx_history_client ON dog_status(master_id, slave_id, received_at, id)');
// BleDisplayCoordinates.js:11-19
db.exec('CREATE INDEX IF NOT EXISTS idx_ble_display_stream ON dog_status(master_id, slave_id, received_at, id)');
db.exec(`CREATE TRIGGER IF NOT EXISTS invalidate_ble_display_after_insert
    AFTER INSERT ON dog_status BEGIN
      UPDATE dog_status SET display_version=NULL, display_latitude=NULL, display_longitude=NULL
      WHERE id IN (SELECT id FROM dog_status WHERE master_id IS NEW.master_id AND slave_id IS NEW.slave_id
        AND (received_at > NEW.received_at OR (received_at=NEW.received_at AND id>NEW.id))
        ORDER BY received_at,id LIMIT 2);
    END`);
// LocationTrackerStore.kt:13
db.exec('CREATE INDEX IF NOT EXISTS idx_myLocationTracker_time ON myLocationTracker(recorded_at DESC, id DESC)');
console.log(`indexes ${((Date.now() - t1) / 1000).toFixed(0)}s`);
db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
db.close();
console.log(`file ${(statSync(FILE).size / 1048576).toFixed(0)} MB`);
