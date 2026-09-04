import { open } from 'react-native-nitro-sqlite';

const MAX_STATUS_RECORDS_PER_SLAVE = 10000;
const CLEANUP_INTERVAL_INSERTS = 100;

export function createDogDatabase() {
  const db = open({
    name: 'dogtracker.sqlite',
    location: 'databases',
  });
  let insertsSinceCleanup = 0;

  async function cleanupOldRecords() {
    const slaves = await db.executeAsync(`
      SELECT DISTINCT slave_id
      FROM dog_status
      WHERE slave_id IS NOT NULL
    `);

    for (const { slave_id: slaveId } of slaves.results || []) {
      await db.executeAsync(
        `DELETE FROM dog_status
         WHERE slave_id = ?
           AND id NOT IN (
             SELECT id
             FROM dog_status
             WHERE slave_id = ?
             ORDER BY id DESC
             LIMIT ?
           )`,
        [slaveId, slaveId, MAX_STATUS_RECORDS_PER_SLAVE],
      );
    }

    insertsSinceCleanup = 0;
  }

  return {
    async initialize() {
      await db.executeAsync(`
        CREATE TABLE IF NOT EXISTS dog_status (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          received_at INTEGER NOT NULL,
          master_id INTEGER,
          slave_id INTEGER,

          slave_lat REAL,
          slave_lon REAL,
          master_lat REAL,
          master_lon REAL,

          distance_meters REAL,
          speed_kmh REAL,
          satellites INTEGER,
          hdop REAL,

          activity TEXT,
          activity_valid INTEGER NOT NULL DEFAULT 0,

          battery_mv INTEGER,
          battery_percentage INTEGER,
          battery_valid INTEGER NOT NULL DEFAULT 0,

          master_battery_mv INTEGER,
          master_battery_percentage INTEGER,
          master_battery_valid INTEGER NOT NULL DEFAULT 0,

          rssi REAL,
          snr REAL,

          gps_time TEXT,
          activity_time TEXT,
          packet_type TEXT,
          sequence INTEGER,
          packet_length INTEGER,

          raw_payload TEXT
        )
      `);

      await db.executeAsync(`
        CREATE INDEX IF NOT EXISTS idx_dog_status_received_at
        ON dog_status(received_at DESC)
      `);

      // Remove the legacy trigger, which capped all slaves at 10,000 rows in
      // total. Cleanup is now batched and applies the limit independently.
      await db.executeAsync('DROP TRIGGER IF EXISTS trim_dog_status_after_insert');

      const tableInfo = await db.executeAsync('PRAGMA table_info(dog_status)');
      const columnNames = new Set(
        (tableInfo.results || []).map(column => column.name),
      );
      if (!columnNames.has('master_id')) {
        await db.executeAsync('ALTER TABLE dog_status ADD COLUMN master_id INTEGER');
      }
      if (!columnNames.has('slave_id')) {
        await db.executeAsync('ALTER TABLE dog_status ADD COLUMN slave_id INTEGER');
      }

      await db.executeAsync(`
        CREATE INDEX IF NOT EXISTS idx_dog_status_slave_received
        ON dog_status(slave_id, received_at DESC)
      `);

      await cleanupOldRecords();
    },

    async saveStatus(status, rawPayload = null) {
      const receivedAt = Date.now();

      const result = await db.executeAsync(
        `INSERT INTO dog_status (
          received_at,
          master_id,
          slave_id,
          slave_lat,
          slave_lon,
          master_lat,
          master_lon,
          distance_meters,
          speed_kmh,
          satellites,
          hdop,
          activity,
          activity_valid,
          battery_mv,
          battery_percentage,
          battery_valid,
          master_battery_mv,
          master_battery_percentage,
          master_battery_valid,
          rssi,
          snr,
          gps_time,
          activity_time,
          packet_type,
          sequence,
          packet_length,
          raw_payload
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?
        )`,
        [
          receivedAt,
          status.masterId,
          status.slaveId,
          status.slaveLat,
          status.slaveLon,
          status.masterLat,
          status.masterLon,
          status.distanceMeters,
          status.speedKmh,
          status.satellites,
          status.hdop,
          status.activity,
          status.activityValid ? 1 : 0,
          status.batteryMillivolts,
          status.batteryPercentage,
          status.batteryValid ? 1 : 0,
          status.masterBatteryMillivolts,
          status.masterBatteryPercentage,
          status.masterBatteryValid ? 1 : 0,
          status.rssi,
          status.snr,
          status.gpsTime,
          status.activityTime,
          status.type,
          status.sequence,
          status.length,
          rawPayload,
        ],
      );

      insertsSinceCleanup += 1;
      if (insertsSinceCleanup >= CLEANUP_INTERVAL_INSERTS) {
        await cleanupOldRecords();
      }

      return result.insertId;
    },

    async listHistory(limit = 100) {
      const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 1000));

      const result = await db.executeAsync(
        `SELECT *
         FROM dog_status
         ORDER BY received_at DESC
         LIMIT ?`,
        [safeLimit],
      );

      return result.results;
    },

    async deleteAll() {
      await db.executeAsync('DELETE FROM dog_status');
      insertsSinceCleanup = 0;
    },

    cleanupOldRecords,

    close() {
      db.close();
    },
  };
}
