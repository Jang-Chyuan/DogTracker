// Borrows the tracking connection; never opens or closes a second SQLite engine.
import { withCloudDisplayLock } from './CloudDisplayCoordinates';

/**
 * How much of this phone the downloaded copy may use.
 *
 * Measured with this schema and its four indexes: 797 bytes a row with the
 * original JSON, 541 without. One dog reports about 14,000 rows a day, so the
 * old cap of 15,000 rows in total (~11 MB) held barely a day and quietly threw
 * away days the user had downloaded on purpose.
 */
export const CLOUD_BUDGET_BYTES = 500 * 1024 * 1024;
const BYTES_PER_ROW = 560;
export const CLOUD_MAX_ROWS = Math.floor(CLOUD_BUDGET_BYTES / BYTES_PER_ROW);
// The whole original JSON is only worth keeping while it can still explain a
// live problem; after that its fields are already in columns of their own.
export const CLOUD_PAYLOAD_MS = 24 * 60 * 60 * 1000;
// Measured at the cap on 950,000 rows: the trim costs about 9 ms when there is
// nothing to delete, so it stays on every page and keeps its place in the same
// transaction as the rows and the progress. Clearing old payloads costs about
// 50 ms because it has to look at the rows themselves, so it runs every 20
// pages instead; the worst case is a day's payloads living 20,000 rows longer.
const PAYLOAD_EVERY_PAGES = 20;
const DROP_OLD_PAYLOAD = `UPDATE supabase_dog_status SET raw_payload = NULL
  WHERE raw_payload IS NOT NULL AND received_at < ?`;

// The tracking session forwards these to the owner of the SQLite connection;
// keep both sides in step or a caller gets `undefined is not a function`.
export const CLOUD_DATABASE_METHODS = ['initialize', 'loadSyncState', 'savePage',
  'loadBuckets', 'saveBucket', 'countRange', 'latestBySlave', 'trackBySlave',
  'listHistory', 'count', 'usage'];

/** `maxRows` is only for tests: filling a real cap takes half a million rows. */
export function createCloudDatabase(connection, { maxRows = CLOUD_MAX_ROWS } = {}) {
  const cap = Number.isInteger(maxRows) && maxRows > 0 ? maxRows : CLOUD_MAX_ROWS;
  const trimHistory = `DELETE FROM supabase_dog_status WHERE id IN (
    SELECT id FROM supabase_dog_status
    ORDER BY received_at DESC, id DESC LIMIT -1 OFFSET ${cap}
  )`;
  let pagesSaved = 0;
  const rows = result => result.results || result.rows?._array || [];
  const requireOwner = owner => {
    if (!owner) throw new Error('請先登入');
  };
  // Every dog this account has downloaded, smallest id first. Reading the list
  // first turns "the newest row of each dog" into one index seek per dog
  // instead of one pass over the whole window; idx_cloud_display_stream
  // answers it without touching a row.
  const slaveIds = async owner => rows(await connection.executeAsync(
    `SELECT DISTINCT slave_id FROM supabase_dog_status
     WHERE owner_user_id = ? AND slave_id IS NOT NULL ORDER BY slave_id`, [owner],
  )).map(row => Number(row.slave_id)).filter(id => Number.isInteger(id) && id > 0);
  return {
    async initialize() {
      const columns = new Set(rows(await connection.executeAsync(
        'PRAGMA table_info(supabase_dog_status)',
      )).map(column => column.name));
      for (const [name, type] of [
        ['owner_user_id', 'TEXT'], ['event_id', 'TEXT'],
        ['downloaded_at', 'INTEGER'], ['remote_received_at', 'TEXT'],
        ['display_latitude', 'REAL'], ['display_longitude', 'REAL'], ['display_version', 'INTEGER'],
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
      // Only the rows that still carry their original JSON. DROP_OLD_PAYLOAD
      // used to walk every row older than a day to find the few thousand with
      // a payload left: 212 ms every twenty pages, against 0.01 ms with this.
      await connection.executeAsync(`CREATE INDEX IF NOT EXISTS idx_cloud_payload
        ON supabase_dog_status(received_at) WHERE raw_payload IS NOT NULL`);
      await connection.executeAsync(`CREATE INDEX IF NOT EXISTS idx_cloud_display_stream
        ON supabase_dog_status(owner_user_id, master_id, slave_id, received_at, id)`);
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
      await connection.executeAsync(trimHistory);
      await connection.executeAsync(DROP_OLD_PAYLOAD, [Date.now() - CLOUD_PAYLOAD_MS]);
    },
    async loadSyncState(owner, masterId) {
      requireOwner(owner);
      return rows(await connection.executeAsync(
        'SELECT * FROM cloud_sync_state WHERE owner_user_id = ? AND master_id = ?',
        [owner, masterId],
      ))[0] || null;
    },
    async savePage(owner, records, checkpoint = null) {
      return withCloudDisplayLock(connection, async () => {
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
        const commands = records.flatMap(record => ([{
          // A late insertion changes subsequent rolling windows. Invalidate in
          // the same transaction; a duplicate download leaves saved coordinates alone.
          query: `UPDATE supabase_dog_status SET display_latitude=NULL, display_longitude=NULL, display_version=NULL
            WHERE id IN (SELECT id FROM supabase_dog_status
              WHERE owner_user_id=? AND master_id=? AND slave_id=? AND received_at>?
              ORDER BY received_at, id LIMIT 2)
            AND display_version IS NOT NULL AND NOT EXISTS
            (SELECT 1 FROM supabase_dog_status WHERE owner_user_id=? AND event_id=?)`,
          params: [owner, record.master_id ?? null, record.slave_id ?? null, record.received_at ?? null, owner, record.event_id ?? null],
        }, {
          query,
          params: [owner, now, ...columns.map(key => record[key] ?? null), owner, record.event_id],
        }]));
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
        commands.push({ query: trimHistory, params: [] });
        pagesSaved += 1;
        if (pagesSaved % PAYLOAD_EVERY_PAGES === 0) {
          commands.push({ query: DROP_OLD_PAYLOAD, params: [now - CLOUD_PAYLOAD_MS] });
        }
        // Progress, retention and downloaded rows commit together.
        await connection.executeBatchAsync(commands);
      });
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
    /**
     * Every downloaded position of every dog since a moment, for the home map's
     * path: the live feed only holds the pair this phone is connected to, so
     * without this the dogs that arrived through the cloud had markers and no
     * line. Ordered per dog so the caller can cut it into segments.
     */
    async trackBySlave(owner, sinceMs, limit = 6000) {
      requireOwner(owner);
      const slaves = await slaveIds(owner);
      if (!slaves.length) return [];
      // One budget shared equally instead of one global LIMIT. Ordered by dog,
      // a single LIMIT was spent entirely on the first dogs, so the last dog
      // could be left without a line; and because it ordered by time ascending
      // it kept the *oldest* rows of the window, drawing a path that ended
      // where the dog was hours ago. Each dog now keeps its newest rows.
      const each = Math.max(1, Math.floor(Math.max(1, Math.floor(limit)) / slaves.length));
      const found = [];
      for (const slaveId of slaves) {
        const page = rows(await connection.executeAsync(`SELECT slave_id, master_id, received_at,
            slave_lat, slave_lon
          FROM supabase_dog_status
          WHERE owner_user_id = ? AND slave_id = ? AND received_at >= ?
            AND slave_lat IS NOT NULL AND slave_lon IS NOT NULL
            AND NOT (slave_lat = 0 AND slave_lon = 0)
          ORDER BY received_at DESC LIMIT ?`, [owner, slaveId, sinceMs, each]));
        found.push(...page.reverse());
      }
      return found;
    },
    async latestBySlave(owner, sinceMs) {
      requireOwner(owner);
      const found = [];
      // GROUP BY had to read every row of the window — 86,400 of them for one
      // day of six dogs — to find six answers, and this runs every ten seconds
      // while the map is open. Asking each dog for its own newest row reads
      // six: 55 ms against 0.08 ms at the cap.
      for (const slaveId of await slaveIds(owner)) {
        const [row] = rows(await connection.executeAsync(`SELECT slave_id, master_id,
            received_at, slave_lat, slave_lon, speed_kmh, battery_percentage
          FROM supabase_dog_status
          WHERE owner_user_id = ? AND slave_id = ? AND received_at >= ?
            AND slave_lat IS NOT NULL AND slave_lon IS NOT NULL
            AND NOT (slave_lat = 0 AND slave_lon = 0)
          ORDER BY received_at DESC LIMIT 1`, [owner, slaveId, sinceMs]));
        if (row) found.push(row);
      }
      return found;
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
    /**
     * What the downloaded copy costs this phone, for the cloud page to show.
     * Counted across accounts because the budget is the phone's, not one
     * account's, and estimated from the measured bytes a row: SQLite cannot
     * report the size of one table without the dbstat extension.
     */
    async usage() {
      // Two statements, because COUNT(*) and MIN() want different indexes and
      // SQLite can only pick one: asked together they cost 30 ms, apart 3 ms
      // and 0.01 ms. The oldest row is the first entry of the time index.
      const counted = rows(await connection.executeAsync(
        'SELECT COUNT(*) AS count FROM supabase_dog_status'))[0];
      const oldest = rows(await connection.executeAsync(
        'SELECT received_at FROM supabase_dog_status ORDER BY received_at LIMIT 1'))[0];
      const count = Number(counted?.count || 0);
      return {
        rows: count,
        bytes: count * BYTES_PER_ROW,
        budget: CLOUD_BUDGET_BYTES,
        from: Number.isFinite(oldest?.received_at) ? Number(oldest.received_at) : null,
      };
    },
  };
}
