// 2026-10-16, the user's phone (signed in, no receiver): dog 4's cloud rows
// carry "activityScore": 0, "activityValid": 0, "activityTimestamp": 0
// (uploaded over Wi-Fi), yet the card said 「休息中・超過 6 小時」. Invalid
// readings are no rest: the 活動量 row says 「—」.
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { mapCloudTelemetry } from '../src/cloud/CloudTelemetry';
import { dogCardReadings, CARD_ACTIVITY_LOOKBACK_MS } from '../src/activity/DogCardReadings';
import { activityRow } from '../src/map/DogCardModel';

const NOW = Date.parse('2026-10-16T06:33:00Z');
const OWNER = '11111111-1111-4111-8111-111111111111';
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// Dog 4 from receiver 7 over Wi-Fi, one row every 30 s for 8 hours.
function cloudRows() {
  const rows = [];
  for (let n = 1, at = NOW - 8 * 3600000; at < NOW; n += 1, at += 30000) {
    rows.push({ event_id: uuid(n), received_at: new Date(at).toISOString(), master_id: 7, slave_id: 4, seq: n % 65536,
      rssi: -80, snr: 6, upload_source: 'wifi', phone_received_at: null,
      payload: { lat: 24989200, lon: 121313800, speed: 0, satellites: 9, hdop: 110, gpsTimestamp: 0,
        activityScore: 0, activityValid: 0, activityTimestamp: 0,
        batteryMillivolts: 3900, batteryPercentage: 70, batteryValid: 1, slaveId: 4 } });
  }
  return rows;
}

test('cloud rows with activityValid 0 are no rest: 「—」', async () => {
  const connection = createMemoryConnection();
  try {
    await createDogDatabase(connection).initialize();
    const database = createCloudDatabase(connection);
    await database.initialize?.();
    await database.savePage(OWNER, cloudRows().map(mapCloudTelemetry));
    const rows = await database.dogCardRows(OWNER, 4, NOW - CARD_ACTIVITY_LOOKBACK_MS);
    const { activity } = dogCardReadings(rows, NOW);
    expect(activityRow(activity, { reference: NOW, positionAt: NOW - 30000, stale: false }))
      .toMatchObject({ word: '—', detail: null });
  } finally { connection.close(); }
});

// The same with the tables as the native BLE service creates them first
// (DogStatusStore.kt: activity is TEXT there, the _valid flags NOT NULL
// DEFAULT 0), which is how they exist on a phone that ran the service.
test('the same rows in the native service\'s tables: still 「—」', async () => {
  const connection = createMemoryConnection();
  try {
    const fields = ['master_id INTEGER', 'slave_id INTEGER', 'slave_lat REAL', 'slave_lon REAL', 'master_lat REAL',
      'master_lon REAL', 'distance_meters REAL', 'speed_kmh REAL', 'satellites INTEGER', 'hdop REAL', 'activity TEXT',
      'activity_valid INTEGER NOT NULL DEFAULT 0', 'battery_mv INTEGER', 'battery_percentage INTEGER',
      'usb_present INTEGER', 'battery_valid INTEGER NOT NULL DEFAULT 0', 'master_battery_mv INTEGER',
      'master_battery_percentage INTEGER', 'master_battery_valid INTEGER NOT NULL DEFAULT 0', 'rssi REAL', 'snr REAL',
      'gps_time TEXT', 'activity_time TEXT', 'packet_type TEXT', 'sequence INTEGER', 'packet_length INTEGER'].join(',');
    for (const table of ['dog_status', 'supabase_dog_status']) {
      await connection.executeAsync(`CREATE TABLE ${table} (id INTEGER PRIMARY KEY AUTOINCREMENT,
        received_at INTEGER NOT NULL, ${fields}, raw_payload TEXT)`);
    }
    await createDogDatabase(connection).initialize();
    const database = createCloudDatabase(connection);
    await database.initialize?.();
    await database.savePage(OWNER, cloudRows().map(mapCloudTelemetry));
    const rows = await database.dogCardRows(OWNER, 4, NOW - CARD_ACTIVITY_LOOKBACK_MS);
    expect(rows.cloud).toEqual([]);
    const { activity } = dogCardReadings(rows, NOW);
    expect(activityRow(activity, { reference: NOW, positionAt: NOW - 30000, stale: false }))
      .toMatchObject({ word: '—', detail: null });
  } finally { connection.close(); }
});
