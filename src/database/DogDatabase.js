import { open } from 'react-native-nitro-sqlite';

const MAX_STATUS_RECORDS = 10000;

export function createDogDatabase() {
  const db = open({
    name: 'dogtracker.sqlite',
    location: 'databases',
  });

  return {
    async initialize() {
      await db.executeAsync(`
        CREATE TABLE IF NOT EXISTS dog_status (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          received_at INTEGER NOT NULL,

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

      await db.executeAsync(`
        CREATE TRIGGER IF NOT EXISTS trim_dog_status_after_insert
        AFTER INSERT ON dog_status
        BEGIN
          DELETE FROM dog_status
          WHERE id NOT IN (
            SELECT id
            FROM dog_status
            ORDER BY id DESC
            LIMIT ${MAX_STATUS_RECORDS}
          );
        END
      `);

      await db.executeAsync(`
        DELETE FROM dog_status
        WHERE id NOT IN (
          SELECT id
          FROM dog_status
          ORDER BY id DESC
          LIMIT ${MAX_STATUS_RECORDS}
        )
      `);
    },

    async saveStatus(status, rawPayload = null) {
      const receivedAt = Date.now();

      const result = await db.executeAsync(
        `INSERT INTO dog_status (
          received_at,
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
          ?, ?, ?, ?, ?
        )`,
        [
          receivedAt,
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
    },

    close() {
      db.close();
    },
  };
}
