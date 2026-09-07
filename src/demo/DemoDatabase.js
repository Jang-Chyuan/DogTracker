function rowsFromResult(result) {
  return result.results || result.rows?._array || [];
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(Math.floor(parsed), maximum));
}

const COLUMNS = [
  'received_at',
  'master_id',
  'slave_id',
  'slave_lat',
  'slave_lon',
  'master_lat',
  'master_lon',
  'distance_meters',
  'speed_kmh',
  'satellites',
  'hdop',
  'activity',
  'activity_valid',
  'battery_mv',
  'battery_percentage',
  'battery_valid',
  'master_battery_mv',
  'master_battery_percentage',
  'master_battery_valid',
  'rssi',
  'snr',
  'gps_time',
  'activity_time',
  'packet_type',
  'sequence',
  'packet_length',
  'raw_payload',
];
const INSERT = `INSERT INTO demo_dog_status (${COLUMNS.join(', ')})`;
const VALUES = COLUMNS.map(() => '?').join(', ');
const parameters = row => COLUMNS.map(column => row[column]);
function requireSeed(rows) {
  if (!Array.isArray(rows) || rows.length !== 3)
    throw new TypeError('Demo 預設資料必須有三筆');
}

/** App-owned schema and queries. No statement in this module touches dog_status. */
export function createDemoDatabase(connection) {
  if (!connection) throw new TypeError('connection is required');

  return {
    async initialize() {
      // An additive, repeatable migration. Do not change the shared user_version:
      // the hardware writer owns the existing schema and its migration policy.
      await connection.executeAsync(`
        CREATE TABLE IF NOT EXISTS demo_dog_status (
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
      await connection.executeAsync(`
        CREATE INDEX IF NOT EXISTS idx_demo_dog_status_received_at
        ON demo_dog_status(received_at, id)
      `);
      await connection.executeAsync(`CREATE TABLE IF NOT EXISTS demo_metadata (
        key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL
      )`);
    },

    async ensureSeed(rows) {
      requireSeed(rows);
      // One native transaction: no partial seed. Existing populated installs
      // are marked as initialized without replacing or appending to their data.
      await connection.executeBatchAsync([
        {
          query: `INSERT OR IGNORE INTO demo_metadata (key, value)
          SELECT 'seed_v1', CASE WHEN EXISTS (SELECT 1 FROM demo_dog_status)
          THEN 'done' ELSE 'pending' END`,
        },
        ...rows.map(row => ({
          query: `${INSERT} SELECT ${VALUES} WHERE EXISTS
            (SELECT 1 FROM demo_metadata WHERE key = 'seed_v1' AND value = 'pending')`,
          params: parameters(row),
        })),
        {
          query:
            "UPDATE demo_metadata SET value = 'done' WHERE key = 'seed_v1'",
        },
      ]);
    },

    async resetToSeed(rows) {
      requireSeed(rows);
      // IDs remain monotonic. A failed insert rolls the deletion back too.
      await connection.executeBatchAsync([
        { query: 'DELETE FROM demo_dog_status' },
        ...rows.map(row => ({
          query: `${INSERT} VALUES (${VALUES})`,
          params: parameters(row),
        })),
        {
          query:
            "INSERT INTO demo_metadata (key, value) VALUES ('seed_v1', 'done') ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        },
      ]);
    },

    async getSummary() {
      const result = await connection.executeAsync(`SELECT COUNT(*) AS count,
        (SELECT packet_type FROM demo_dog_status ORDER BY id DESC LIMIT 1) AS latest_type
        FROM demo_dog_status`);
      const summary = rowsFromResult(result)[0];
      if (!summary || !Number.isSafeInteger(summary.count) || summary.count < 0)
        throw new Error('無法讀取 Demo 筆數');
      return {
        count: summary.count,
        latestPreset: /^DEMO_[ABC]$/.test(summary.latest_type || '')
          ? summary.latest_type.slice(-1)
          : null,
      };
    },

    async insertRow(row) {
      const result = await connection.executeAsync(
        `${INSERT} VALUES (${VALUES})`,
        parameters(row),
      );
      return result.insertId;
    },

    async getLatestRow() {
      const result = await connection.executeAsync(
        'SELECT * FROM demo_dog_status ORDER BY id DESC LIMIT 1',
      );
      return rowsFromResult(result)[0] ?? null;
    },

    async listRowsAfterId(cursor = 0, limit = 100) {
      const result = await connection.executeAsync(
        'SELECT * FROM demo_dog_status WHERE id > ? ORDER BY id ASC LIMIT ?',
        [
          boundedInteger(cursor, 0, 0, Number.MAX_SAFE_INTEGER),
          boundedInteger(limit, 100, 1, 1000),
        ],
      );
      return rowsFromResult(result);
    },

    async listRowsByTimeCursor(
      startAt,
      endAt,
      afterReceivedAt = null,
      afterId = null,
      limit = 1000,
    ) {
      const start = Number(startAt);
      const end = Number(endAt);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
        throw new RangeError('Invalid demo_dog_status time range');
      }
      const safeLimit = boundedInteger(limit, 1000, 1, 1000);
      const hasCursor = afterReceivedAt !== null || afterId !== null;
      if (hasCursor) {
        if (afterReceivedAt === null || afterId === null) {
          throw new RangeError('Invalid demo_dog_status time cursor');
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
          throw new RangeError('Invalid demo_dog_status time cursor');
        }
        const result = await connection.executeAsync(
          `SELECT * FROM demo_dog_status
           WHERE received_at <= ?
             AND (received_at > ? OR (received_at = ? AND id > ?))
           ORDER BY received_at ASC, id ASC LIMIT ?`,
          [end, receivedAt, receivedAt, Math.floor(id), safeLimit],
        );
        return rowsFromResult(result);
      }
      const result = await connection.executeAsync(
        `SELECT * FROM demo_dog_status
         WHERE received_at >= ? AND received_at <= ?
         ORDER BY received_at ASC, id ASC LIMIT ?`,
        [start, end, safeLimit],
      );
      return rowsFromResult(result);
    },

    async listLatestRowsByTimeCursor(
      startAt,
      endAt,
      beforeReceivedAt = null,
      beforeId = null,
      limit = 1000,
    ) {
      const start = Number(startAt);
      const end = Number(endAt);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
        throw new RangeError('Invalid demo_dog_status latest time range');
      }
      const safeLimit = boundedInteger(limit, 1000, 1, 1000);
      const hasCursor = beforeReceivedAt !== null || beforeId !== null;
      if (hasCursor) {
        if (beforeReceivedAt === null || beforeId === null) {
          throw new RangeError('Invalid demo_dog_status latest time cursor');
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
          throw new RangeError('Invalid demo_dog_status latest time cursor');
        }
        const result = await connection.executeAsync(
          `SELECT * FROM demo_dog_status
           WHERE received_at >= ?
             AND (received_at < ? OR (received_at = ? AND id < ?))
           ORDER BY received_at DESC, id DESC LIMIT ?`,
          [start, receivedAt, receivedAt, Math.floor(id), safeLimit],
        );
        return rowsFromResult(result);
      }
      const result = await connection.executeAsync(
        `SELECT * FROM demo_dog_status
         WHERE received_at >= ? AND received_at <= ?
         ORDER BY received_at DESC, id DESC LIMIT ?`,
        [start, end, safeLimit],
      );
      return rowsFromResult(result);
    },

    async getLatestValidRows(masterId, slaveId, maxId) {
      const safeMaxId = boundedInteger(maxId, 0, 0, Number.MAX_SAFE_INTEGER);
      const result = await connection.executeAsync(
        `SELECT * FROM demo_dog_status
         WHERE id IN (
           SELECT id FROM demo_dog_status
           WHERE id <= ? AND master_id IS ?
             AND master_lat BETWEEN -90 AND 90
             AND master_lon BETWEEN -180 AND 180
           ORDER BY id DESC LIMIT 1
         ) OR id IN (
           SELECT id FROM demo_dog_status
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

    async listRowsByDateRange(startAt, endAt, limit = 1000, offset = 0) {
      const start = Number(startAt);
      const end = Number(endAt);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
        throw new RangeError('Invalid demo_dog_status date range');
      }
      const result = await connection.executeAsync(
        `SELECT * FROM demo_dog_status
         WHERE received_at >= ? AND received_at <= ?
         ORDER BY received_at ASC, id ASC LIMIT ? OFFSET ?`,
        [
          start,
          end,
          boundedInteger(limit, 1000, 1, 1000),
          boundedInteger(offset, 0, 0, Number.MAX_SAFE_INTEGER),
        ],
      );
      return rowsFromResult(result);
    },
  };
}
