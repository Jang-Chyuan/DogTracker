import { open } from 'react-native-nitro-sqlite';

function rowsFromResult(result) {
  return result.results || result.rows?._array || [];
}

export function createDogDatabase(connection) {
  const db =
    connection ||
    open({
      name: 'dogtracker.sqlite',
      location: 'databases',
    });

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
        CREATE INDEX IF NOT EXISTS idx_dog_status_received_at_id
        ON dog_status(received_at, id)
      `);

      // Builds before keyset pagination used a redundant received_at-only
      // index. Remove it after the replacement exists so upgraded databases do
      // not pay for two equivalent index writes forever.
      await db.executeAsync('DROP INDEX IF EXISTS idx_dog_status_received_at');

      // Retention is owned by the hardware/storage policy, not this UI App.
      // Remove the legacy trigger from databases initialized by older builds;
      // omitting CREATE TRIGGER alone would leave that trigger active forever.
      await db.executeAsync(
        'DROP TRIGGER IF EXISTS trim_dog_status_after_insert',
      );

      const tableInfo = await db.executeAsync('PRAGMA table_info(dog_status)');
      const columnNames = new Set(
        (tableInfo.results || []).map(column => column.name),
      );
      if (!columnNames.has('master_id')) {
        await db.executeAsync(
          'ALTER TABLE dog_status ADD COLUMN master_id INTEGER',
        );
      }
      if (!columnNames.has('slave_id')) {
        await db.executeAsync(
          'ALTER TABLE dog_status ADD COLUMN slave_id INTEGER',
        );
      }
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

      return result.insertId;
    },

    async getLatestStatusRow() {
      const result = await db.executeAsync(
        `SELECT *
         FROM dog_status
         ORDER BY id DESC
         LIMIT 1`,
      );

      return rowsFromResult(result)[0] ?? null;
    },

    async listStatusRowsAfterId(cursor = 0, limit = 100) {
      const safeCursor = Math.max(0, Number(cursor) || 0);
      const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 1000));
      const result = await db.executeAsync(
        `SELECT *
         FROM dog_status
         WHERE id > ?
         ORDER BY id ASC
         LIMIT ?`,
        [safeCursor, safeLimit],
      );

      return rowsFromResult(result);
    },

    async listStatusRowsByTimeCursor(
      startAt,
      endAt,
      afterReceivedAt = null,
      afterId = null,
      limit = 1000,
    ) {
      const start = Number(startAt);
      const end = Number(endAt);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
        throw new RangeError('Invalid dog_status time range');
      }

      const safeLimit = Math.max(
        1,
        Math.min(Math.floor(Number(limit)) || 1000, 1000),
      );
      const hasCursor = afterReceivedAt !== null || afterId !== null;
      if (hasCursor) {
        if (afterReceivedAt === null || afterId === null) {
          throw new RangeError('Invalid dog_status time cursor');
        }
        const receivedAt = Number(afterReceivedAt);
        const id = Number(afterId);
        if (
          !Number.isFinite(receivedAt) ||
          !Number.isFinite(id) ||
          id < 0 ||
          receivedAt < start ||
          receivedAt > end
        ) {
          throw new RangeError('Invalid dog_status time cursor');
        }
        const result = await db.executeAsync(
          `SELECT *
           FROM dog_status
           WHERE received_at <= ?
             AND (received_at > ? OR (received_at = ? AND id > ?))
           ORDER BY received_at ASC, id ASC
           LIMIT ?`,
          [end, receivedAt, receivedAt, Math.floor(id), safeLimit],
        );
        return rowsFromResult(result);
      }

      const result = await db.executeAsync(
        `SELECT *
         FROM dog_status
         WHERE received_at >= ? AND received_at <= ?
         ORDER BY received_at ASC, id ASC
         LIMIT ?`,
        [start, end, safeLimit],
      );
      return rowsFromResult(result);
    },

    async listLatestStatusRowsByTimeCursor(
      startAt,
      endAt,
      beforeReceivedAt = null,
      beforeId = null,
      limit = 1000,
    ) {
      const start = Number(startAt);
      const end = Number(endAt);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
        throw new RangeError('Invalid dog_status latest time range');
      }
      const safeLimit = Math.max(
        1,
        Math.min(Math.floor(Number(limit)) || 1000, 1000),
      );
      const hasCursor = beforeReceivedAt !== null || beforeId !== null;
      if (hasCursor) {
        if (beforeReceivedAt === null || beforeId === null) {
          throw new RangeError('Invalid dog_status latest time cursor');
        }
        const receivedAt = Number(beforeReceivedAt);
        const id = Number(beforeId);
        if (
          !Number.isFinite(receivedAt) ||
          !Number.isFinite(id) ||
          id < 0 ||
          receivedAt < start ||
          receivedAt > end
        ) {
          throw new RangeError('Invalid dog_status latest time cursor');
        }
        const result = await db.executeAsync(
          `SELECT *
           FROM dog_status
           WHERE received_at >= ?
             AND (received_at < ? OR (received_at = ? AND id < ?))
           ORDER BY received_at DESC, id DESC
           LIMIT ?`,
          [start, receivedAt, receivedAt, Math.floor(id), safeLimit],
        );
        return rowsFromResult(result);
      }
      const result = await db.executeAsync(
        `SELECT *
         FROM dog_status
         WHERE received_at >= ? AND received_at <= ?
         ORDER BY received_at DESC, id DESC
         LIMIT ?`,
        [start, end, safeLimit],
      );
      return rowsFromResult(result);
    },

    async getLatestValidStatusRows(masterId, slaveId, maxId) {
      const safeMaxId = Math.max(0, Math.floor(Number(maxId) || 0));
      const result = await db.executeAsync(
        `SELECT *
         FROM dog_status
         WHERE id IN (
           SELECT id FROM dog_status
           WHERE id <= ? AND master_id IS ?
             AND master_lat BETWEEN -90 AND 90
             AND master_lon BETWEEN -180 AND 180
           ORDER BY id DESC LIMIT 1
         ) OR id IN (
           SELECT id FROM dog_status
           WHERE id <= ? AND slave_id IS ?
             AND slave_lat BETWEEN -90 AND 90
             AND slave_lon BETWEEN -180 AND 180
           ORDER BY id DESC LIMIT 1
         )
         ORDER BY id ASC`,
        [safeMaxId, masterId ?? null, safeMaxId, slaveId ?? null],
      );
      return rowsFromResult(result);
    },

    async listStatusRowsByDateRange(startAt, endAt, limit = 1000, offset = 0) {
      const start = Number(startAt);
      const end = Number(endAt);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
        throw new RangeError('Invalid dog_status date range');
      }

      const safeLimit = Math.max(1, Math.min(Number(limit) || 1000, 1000));
      const safeOffset = Math.max(0, Number(offset) || 0);
      const result = await db.executeAsync(
        `SELECT *
         FROM dog_status
         WHERE received_at >= ? AND received_at <= ?
         ORDER BY received_at ASC, id ASC
         LIMIT ? OFFSET ?`,
        [start, end, safeLimit, safeOffset],
      );

      return rowsFromResult(result);
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
