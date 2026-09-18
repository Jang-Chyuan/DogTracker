// Borrows the tracking connection; never opens or closes a second SQLite engine.
const TRIM_HISTORY = `DELETE FROM supabase_dog_status WHERE id IN (
  SELECT id FROM supabase_dog_status
  ORDER BY received_at DESC, id DESC LIMIT -1 OFFSET 15000
)`;

// The tracking session forwards these to the owner of the SQLite connection;
// keep both sides in step or a caller gets `undefined is not a function`.
export const CLOUD_DATABASE_METHODS = ['initialize', 'loadSyncState', 'savePage',
  'loadBuckets', 'saveBucket', 'countRange', 'latestBySlave', 'listHistory', 'count'];

export function createCloudDatabase(connection) {
  const rows = result => result.results || result.rows?._array || [];
  const requireOwner = owner => {
    if (!owner) throw new Error('請先登入');
  };
  return {
    async initialize() {
      const columns = new Set(rows(await connection.executeAsync(
        'PRAGMA table_info(supabase_dog_status)',
      )).map(column => column.name));
      for (const [name, type] of [
        ['owner_user_id', 'TEXT'], ['event_id', 'TEXT'],
        ['downloaded_at', 'INTEGER'], ['remote_received_at', 'TEXT'],
      ]) {
        if (!columns.has(name)) {
          await connection.executeAsync(`ALTER TABLE supabase_dog_status ADD COLUMN ${name} ${type}`);
        }
      }
      await connection.executeAsync(`CREATE UNIQUE INDEX IF NOT EXISTS idx_cloud_owner_event
        ON supabase_dog_status(owner_user_id, event_id)`);
      await connection.executeAsync(`CREATE INDEX IF NOT EXISTS idx_cloud_owner_history
        ON supabase_dog_status(owner_user_id, received_at DESC, id DESC)`);
      await connection.executeAsync(`CREATE INDEX IF NOT EXISTS idx_cloud_owner_master_received
        ON supabase_dog_status(owner_user_id, master_id, received_at)`);
      await connection.executeAsync(`CREATE TABLE IF NOT EXISTS cloud_sync_state (
        owner_user_id TEXT NOT NULL, master_id INTEGER NOT NULL,
        through_at TEXT NOT NULL, event_id TEXT, updated_at INTEGER NOT NULL,
        PRIMARY KEY (owner_user_id, master_id)
      )`);
      // Verified cloud row count per closed hour; see CloudReconcile.
      await connection.executeAsync(`CREATE TABLE IF NOT EXISTS cloud_sync_buckets (
        owner_user_id TEXT NOT NULL, master_id INTEGER NOT NULL,
        bucket_start INTEGER NOT NULL, cloud_count INTEGER NOT NULL,
        verified_at INTEGER NOT NULL,
        PRIMARY KEY (owner_user_id, master_id, bucket_start)
      )`);
      // Also apply retention to databases downloaded by older app versions.
      await connection.executeAsync(TRIM_HISTORY);
    },
    async loadSyncState(owner, masterId) {
      requireOwner(owner);
      return rows(await connection.executeAsync(
        'SELECT * FROM cloud_sync_state WHERE owner_user_id = ? AND master_id = ?',
        [owner, masterId],
      ))[0] || null;
    },
    async savePage(owner, records, checkpoint = null) {
      requireOwner(owner);
      if (!records.length && !checkpoint) return;
      const columns = [
        'event_id', 'remote_received_at', 'received_at', 'master_id', 'slave_id',
        'sequence', 'slave_lat', 'slave_lon', 'speed_kmh', 'satellites', 'hdop',
        'activity', 'activity_valid', 'battery_mv', 'battery_percentage',
        'battery_valid', 'gps_time', 'activity_time', 'rssi', 'snr', 'raw_payload',
      ];
      // Telemetry events are immutable. Ignore only already downloaded events;
      // a failed page rolls back as a whole. Compatible with Android 8 SQLite.
      const query = `INSERT INTO supabase_dog_status
        (owner_user_id, downloaded_at, ${columns.join(', ')})
        SELECT ${Array(columns.length + 2).fill('?').join(', ')}
        WHERE NOT EXISTS (SELECT 1 FROM supabase_dog_status
          WHERE owner_user_id = ? AND event_id = ?)`;
      const now = Date.now();
      const commands = records.map(record => ({
        query,
        params: [owner, now, ...columns.map(key => record[key] ?? null), owner, record.event_id],
      }));
      if (checkpoint) {
        if (!Number.isInteger(checkpoint.masterId) || !Number.isFinite(Date.parse(checkpoint.throughAt))) {
          throw new Error('同步進度格式不正確');
        }
        commands.push({
          query: `INSERT OR REPLACE INTO cloud_sync_state
            (owner_user_id, master_id, through_at, event_id, updated_at) VALUES (?, ?, ?, ?, ?)`,
          params: [owner, checkpoint.masterId, checkpoint.throughAt, checkpoint.eventId ?? null, now],
        });
      }
      // Global cap across accounts/Masters. Keep newest reception times, not
      // newest download order, so manual historical downloads cannot evict newer rows.
      commands.push({ query: TRIM_HISTORY, params: [] });
      // Progress, retention and downloaded rows commit together.
      await connection.executeBatchAsync(commands);
    },
    async loadBuckets(owner, masterId, fromBucket) {
      requireOwner(owner);
      return rows(await connection.executeAsync(`SELECT bucket_start, cloud_count
        FROM cloud_sync_buckets WHERE owner_user_id = ? AND master_id = ? AND bucket_start >= ?`,
      [owner, masterId, fromBucket]));
    },
    async saveBucket(owner, masterId, bucketStart, cloudCount) {
      requireOwner(owner);
      if (![masterId, bucketStart, cloudCount].every(Number.isInteger)) {
        throw new Error('核對紀錄格式不正確');
      }
      // Keep two days so a phone that was away for a day still has the previous
      // verification to compare against; older hours are outside the window.
      await connection.executeBatchAsync([
        { query: `INSERT OR REPLACE INTO cloud_sync_buckets
          (owner_user_id, master_id, bucket_start, cloud_count, verified_at) VALUES (?, ?, ?, ?, ?)`,
        params: [owner, masterId, bucketStart, cloudCount, Date.now()] },
        { query: 'DELETE FROM cloud_sync_buckets WHERE owner_user_id = ? AND bucket_start < ?',
          params: [owner, bucketStart - 48 * 60 * 60 * 1000] },
      ]);
    },
    async countRange(owner, masterId, fromMs, toMs) {
      requireOwner(owner);
      const result = rows(await connection.executeAsync(`SELECT COUNT(*) AS count
        FROM supabase_dog_status WHERE owner_user_id = ? AND master_id = ?
        AND received_at >= ? AND received_at < ?`, [owner, masterId, fromMs, toMs]));
      return Number(result[0]?.count || 0);
    },
    // Newest downloaded row per dog, whichever Master reported it. Rows without
    // a position cannot place a marker, so they are not candidates; 0,0 is what
    // the hardware sends with no GPS fix. SQLite fills the bare columns from the
    // row that matched MAX(received_at).
    async latestBySlave(owner, sinceMs) {
      requireOwner(owner);
      return rows(await connection.executeAsync(`SELECT slave_id, master_id,
          MAX(received_at) AS received_at, slave_lat, slave_lon, speed_kmh, battery_percentage
        FROM supabase_dog_status
        WHERE owner_user_id = ? AND received_at >= ?
          AND slave_lat IS NOT NULL AND slave_lon IS NOT NULL
          AND NOT (slave_lat = 0 AND slave_lon = 0)
        GROUP BY slave_id ORDER BY slave_id`, [owner, sinceMs]));
    },
    async listHistory(owner, offset = 0) {
      requireOwner(owner);
      return rows(await connection.executeAsync(`SELECT * FROM supabase_dog_status
        WHERE owner_user_id = ? ORDER BY received_at DESC, id DESC LIMIT 50 OFFSET ?`,
      [owner, Math.max(0, Math.floor(Number(offset) || 0))]));
    },
    async count(owner) {
      requireOwner(owner);
      const result = rows(await connection.executeAsync(
        'SELECT COUNT(*) AS count FROM supabase_dog_status WHERE owner_user_id = ?', [owner],
      ));
      return Number(result[0]?.count || 0);
    },
  };
}
