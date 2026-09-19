import { openTrackingDatabase } from './TrackingDatabaseConnection';
import { NativeModules, Platform } from 'react-native';

const MAX_STATUS_RECORDS_PER_SLAVE = 10000;
const CLEANUP_INTERVAL_INSERTS = 100;

function rowsFromResult(result) {
  return result.results || result.rows?._array || [];
}

export function createDogDatabase(connection) {
  const db = connection || openTrackingDatabase();

  let insertsSinceCleanup = 0;

  async function cleanupOldRecords() {
    const slaves = await db.executeAsync(`
      SELECT DISTINCT slave_id
      FROM dog_status
      WHERE slave_id IS NOT NULL
    `);

    for (const { slave_id: slaveId } of slaves.results || []) {
      // Compare against the id of the oldest row worth keeping instead of
      // building a 10,000 id list on every call. The subquery answers NULL
      // while a dog has fewer rows than the cap, and `id < NULL` deletes
      // nothing, which is the same outcome as the previous NOT IN form.
      await db.executeAsync(
        `DELETE FROM dog_status
         WHERE slave_id = ?
           AND id < (
             SELECT id
             FROM dog_status
             WHERE slave_id = ?
             ORDER BY id DESC
             LIMIT 1 OFFSET ?
           )`,
        [slaveId, slaveId, MAX_STATUS_RECORDS_PER_SLAVE],
      );
    }

    insertsSinceCleanup = 0;
  }

  /**
   * Give SQLite the row counts it needs to choose between two indexes.
   *
   * Without `sqlite_stat1` the planner assumes every indexed value is roughly
   * as rare as any other, and picks the wrong index for queries that run every
   * second: "the newest row with a position for this dog" took 24 ms instead of
   * 0.05 ms, and one downloaded page took 196 ms instead of 33 ms. ANALYZE
   * costs 380 ms at the cloud cap of 936,000 rows, so it runs once, when the
   * statistics table does not exist yet. `PRAGMA optimize` then re-runs it only
   * when SQLite judges the numbers stale; it costs nothing when they are not.
   */
  async function analyze() {
    const existing = await db.executeAsync(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='sqlite_stat1'",
    );
    if (!rowsFromResult(existing).length) await db.executeAsync('ANALYZE');
    else await db.executeAsync('PRAGMA optimize');
  }

  const native = Platform.OS === 'android' ? NativeModules.BleBackground : null;

  return {
    async initialize() {
      // Android queries and writes share DogStatusStore's SQLite engine.
      // Other platforms retain the Nitro fallback and upstream retention.
      await db.executeAsync('PRAGMA busy_timeout=5000');
      if (native?.initializeDatabase) await native.initializeDatabase();
      // Cloud downloads use a separate table with the same local row format.
      // Table names are fixed here, never supplied by downloaded data.
      for (const table of ['dog_status', 'supabase_dog_status']) {
        await db.executeAsync(`
        CREATE TABLE IF NOT EXISTS ${table} (
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
      }

      await db.executeAsync(`
        CREATE INDEX IF NOT EXISTS idx_supabase_dog_status_received_at_id
        ON supabase_dog_status(received_at, id)
      `);
      await db.executeAsync(`
        CREATE INDEX IF NOT EXISTS idx_supabase_dog_status_slave_received
        ON supabase_dog_status(slave_id, received_at DESC)
      `);

      await db.executeAsync(`
        CREATE INDEX IF NOT EXISTS idx_dog_status_received_at_id
        ON dog_status(received_at, id)
      `);

      // Builds before keyset pagination used a redundant received_at-only
      // index. Remove it after the replacement exists so upgraded databases do
      // not pay for two equivalent index writes forever.
      await db.executeAsync('DROP INDEX IF EXISTS idx_dog_status_received_at');

      // Replace the legacy all-slaves trigger with upstream per-slave retention.
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
      await db.executeAsync('CREATE INDEX IF NOT EXISTS idx_dog_status_slave_received ON dog_status(slave_id, received_at DESC)');
      // "Which dogs and Masters does this phone hold?" reads only these two
      // columns. Without an index in this order the history card had to sort
      // every row: 39 ms at the 60,000 row cap, against 0.01 ms with it.
      await db.executeAsync('CREATE INDEX IF NOT EXISTS idx_dog_status_slave_master ON dog_status(slave_id, master_id)');
      await analyze();
      if (!native?.initializeDatabase) await cleanupOldRecords();
    },

    async saveStatus(status, rawPayload = null) {
      if (native?.initializeDatabase) return undefined;
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
      if (insertsSinceCleanup >= CLEANUP_INTERVAL_INSERTS) await cleanupOldRecords();
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
        // Two sargable halves instead of one OR. See the DESC page below for
        // why: the OR form makes SQLite sort the whole window before it can
        // take a page.
        const result = await db.executeAsync(
          `SELECT * FROM (
             SELECT * FROM dog_status
             WHERE received_at = ? AND id > ? AND received_at <= ?
             ORDER BY id ASC LIMIT ?
           )
           UNION ALL
           SELECT * FROM (
             SELECT * FROM dog_status
             WHERE received_at > ? AND received_at <= ?
             ORDER BY received_at ASC, id ASC LIMIT ?
           )
           LIMIT ?`,
          [receivedAt, Math.floor(id), end, safeLimit,
            receivedAt, end, safeLimit, safeLimit],
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
        // The live window asks for this page every second, and the OR form
        // cost 80 ms of it: SQLite cannot keep an index's order across an OR,
        // so it searched the index twice and sorted the whole window (up to
        // 60,000 rows) before taking 1,000. Splitting the cursor into its two
        // halves lets each half walk idx_dog_status_received_at_id in order,
        // and the concatenation is already sorted because every row of the
        // first half shares the cursor's received_at. Measured 2.2 ms.
        //
        // Row values -- (received_at, id) < (?, ?) -- would be shorter and
        // just as fast, but minSdkVersion 24 still ships SQLite 3.9, and they
        // need 3.15.
        const result = await db.executeAsync(
          `SELECT * FROM (
             SELECT * FROM dog_status
             WHERE received_at = ? AND id < ? AND received_at >= ?
             ORDER BY id DESC LIMIT ?
           )
           UNION ALL
           SELECT * FROM (
             SELECT * FROM dog_status
             WHERE received_at >= ? AND received_at < ?
             ORDER BY received_at DESC, id DESC LIMIT ?
           )
           LIMIT ?`,
          [receivedAt, Math.floor(id), start, safeLimit,
            start, receivedAt, safeLimit, safeLimit],
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
      if (native?.listHistory) {
        return JSON.parse(await native.listHistory(
          Math.floor(Math.max(1, Math.min(Number(limit) || 100, 1000))),
        ));
      }
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
      if (native?.deleteHistory) return native.deleteHistory();
      insertsSinceCleanup = 0;
      await db.executeAsync('DELETE FROM dog_status');
    },

    close() {
      db.close();
    },
  };
}
