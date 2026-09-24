// Borrows the tracking connection; never opens or closes a second SQLite engine.
import { withCloudDisplayLock } from './CloudDisplayCoordinates';
import { cloudTrackTime } from './CloudTrackTime';

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
  'listHistory', 'count', 'usage', 'pendingTrackTimes', 'repairTrackTimes', 'latestStatusRows'];

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
  return {
    initialize() {
      return withCloudDisplayLock(connection, async () => {
      const columns = new Set(rows(await connection.executeAsync(
        'PRAGMA table_info(supabase_dog_status)',
      )).map(column => column.name));
      for (const [name, type] of [
        ['owner_user_id', 'TEXT'], ['event_id', 'TEXT'],
        ['downloaded_at', 'INTEGER'], ['remote_received_at', 'TEXT'],
        ['display_latitude', 'REAL'], ['display_longitude', 'REAL'], ['display_version', 'INTEGER'],
        ['track_at', 'INTEGER'], ['upload_source', 'TEXT'], ['phone_received_at', 'INTEGER'],
        ['track_time_version', 'INTEGER'],
      ]) {
        if (!columns.has(name)) {
          await connection.executeAsync(`ALTER TABLE supabase_dog_status ADD COLUMN ${name} ${type}`);
        }
      }
      // Restartable migration. Old downloads omitted phone metadata entirely;
      // fill safe fallback times now and repair metadata in bounded network pages.
      await connection.executeAsync(`UPDATE supabase_dog_status SET track_at=received_at,
        display_latitude=NULL, display_longitude=NULL, display_version=NULL WHERE track_at IS NULL`);
      await connection.executeAsync('DROP INDEX IF EXISTS idx_cloud_track_stream');
      await connection.executeAsync(`CREATE INDEX IF NOT EXISTS idx_cloud_track_stream_numeric
        ON supabase_dog_status(owner_user_id, master_id, slave_id, CAST(COALESCE(track_at, received_at) AS INTEGER), id)`);
      await connection.executeAsync(`CREATE INDEX IF NOT EXISTS idx_cloud_track_repair
        ON supabase_dog_status(owner_user_id, track_time_version, received_at DESC)`);
      await connection.executeAsync(`CREATE UNIQUE INDEX IF NOT EXISTS idx_cloud_owner_event
        ON supabase_dog_status(owner_user_id, event_id)`);
      await connection.executeAsync(`CREATE INDEX IF NOT EXISTS idx_cloud_owner_history
        ON supabase_dog_status(owner_user_id, received_at DESC, id DESC)`);
      await connection.executeAsync(`CREATE INDEX IF NOT EXISTS idx_cloud_owner_master_received
        ON supabase_dog_status(owner_user_id, master_id, received_at)`);
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
      });
    },
    async loadSyncState(owner, masterId) {
      requireOwner(owner);
      return rows(await connection.executeAsync(
        'SELECT * FROM cloud_sync_state WHERE owner_user_id = ? AND master_id = ?',
        [owner, masterId],
      ))[0] || null;
    },
    async pendingTrackTimes(owner) {
      requireOwner(owner);
      return rows(await connection.executeAsync(`SELECT event_id FROM supabase_dog_status
        WHERE owner_user_id=? AND track_time_version IS NULL AND event_id IS NOT NULL
        ORDER BY received_at DESC LIMIT 200`, [owner]));
    },
    async repairTrackTimes(owner, metadata, requested) {
      requireOwner(owner);
      return withCloudDisplayLock(connection, async () => {
        const commands = [];
        for (const item of metadata) {
          const time = cloudTrackTime(item);
          if (!Number.isFinite(time.track_at) || !requested.includes(item.event_id)) continue;
          // Both old and new neighbours can change when a row moves in time.
          commands.push({ query: `UPDATE supabase_dog_status SET display_latitude=NULL,
            display_longitude=NULL, display_version=NULL WHERE owner_user_id=?
            AND (master_id,slave_id) IN (SELECT master_id,slave_id FROM supabase_dog_status
              WHERE owner_user_id=? AND event_id=? AND track_at IS NOT ?)`,
          params: [owner, owner, item.event_id, time.track_at] });
          commands.push({ query: `UPDATE supabase_dog_status SET track_at=?, upload_source=?,
            phone_received_at=?, track_time_version=1 WHERE owner_user_id=? AND event_id=?`,
          params: [time.track_at, time.upload_source, time.phone_received_at, owner, item.event_id] });
        }
        // Deleted/inaccessible cloud events retain their original local data and
        // fallback time, without blocking metadata repair for later pages.
        for (const id of requested) commands.push({ query: `UPDATE supabase_dog_status
          SET track_time_version=-1 WHERE owner_user_id=? AND event_id=? AND track_time_version IS NULL`,
        params: [owner, id] });
        await connection.executeBatchAsync(commands);
      });
    },
    async savePage(owner, records, checkpoint = null) {
      return withCloudDisplayLock(connection, async () => {
        requireOwner(owner);
        if (!records.length && !checkpoint) return;
        const columns = [
          'track_at', 'upload_source', 'phone_received_at', 'track_time_version',
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
              WHERE owner_user_id=? AND master_id=? AND slave_id=? AND track_at>?
              ORDER BY track_at, id LIMIT 2)
            AND display_version IS NOT NULL AND NOT EXISTS
            (SELECT 1 FROM supabase_dog_status WHERE owner_user_id=? AND event_id=?)`,
          params: [owner, record.master_id ?? null, record.slave_id ?? null, record.track_at ?? record.received_at ?? null, owner, record.event_id ?? null],
        }, {
          query,
          params: [owner, now, ...columns.map(key => key === 'track_at' ? record.track_at ?? record.received_at : record[key] ?? null), owner, record.event_id],
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
      return rows(await connection.executeAsync(`SELECT slave_id, master_id, received_at,
          slave_lat, slave_lon
        FROM supabase_dog_status
        WHERE owner_user_id = ? AND received_at >= ?
          AND slave_lat IS NOT NULL AND slave_lon IS NOT NULL
          AND NOT (slave_lat = 0 AND slave_lon = 0)
        ORDER BY slave_id, received_at LIMIT ?`, [owner, sinceMs, Math.floor(limit)]));
    },
    async latestBySlave(owner, sinceMs) {
      requireOwner(owner);
      // SQLite's single MAX selects the other columns from a row attaining
      // that maximum. Rank/filter by position time, retaining received_at as
      // the original cloud ingestion time for diagnostics and sync cursors.
      return rows(await connection.executeAsync(`SELECT slave_id, master_id,
          MAX(CAST(COALESCE(track_at, received_at) AS INTEGER)) AS track_at,
          received_at, slave_lat, slave_lon, speed_kmh, battery_percentage
        FROM supabase_dog_status
        WHERE owner_user_id = ? AND CAST(COALESCE(track_at, received_at) AS INTEGER) >= ?
          AND slave_lat IS NOT NULL AND slave_lon IS NOT NULL
          AND NOT (slave_lat = 0 AND slave_lon = 0)
        GROUP BY slave_id ORDER BY slave_id`, [owner, sinceMs]));
    },
    async latestStatusRows(owner, sinceMs) {
      requireOwner(owner);
      const cloud = rows(await connection.executeAsync(`SELECT slave_id, master_id,
        MAX(CAST(COALESCE(track_at, received_at) AS INTEGER)) AS track_at,
        received_at, slave_lat, slave_lon, speed_kmh, battery_percentage, battery_valid,
        'cloud' AS source
        FROM supabase_dog_status WHERE owner_user_id = ?
          AND CAST(COALESCE(track_at, received_at) AS INTEGER) >= ?
        GROUP BY slave_id`, [owner, sinceMs]));
      // Read both the latest packet and last valid fix per local dog. No raw
      // history pages are retained in React, including after a restart.
      const local = rows(await connection.executeAsync(`SELECT slave_id, master_id,
        MAX(received_at) AS track_at, received_at, slave_lat, slave_lon,
        speed_kmh, battery_percentage, battery_valid, distance_meters, 'ble' AS source
        FROM dog_status WHERE received_at >= ? GROUP BY slave_id
        UNION ALL
        SELECT slave_id, master_id, MAX(received_at) AS track_at, received_at,
        slave_lat, slave_lon, speed_kmh, battery_percentage, battery_valid,
        distance_meters, 'ble' AS source
        FROM dog_status WHERE received_at >= ? AND slave_lat IS NOT NULL
          AND slave_lon IS NOT NULL AND NOT (slave_lat = 0 AND slave_lon = 0)
        GROUP BY slave_id`, [sinceMs, sinceMs]));
      return [...local, ...cloud];
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
      const result = rows(await connection.executeAsync(
        `SELECT COUNT(*) AS count, MIN(received_at) AS from_at
         FROM supabase_dog_status`));
      const count = Number(result[0]?.count || 0);
      return {
        rows: count,
        bytes: count * BYTES_PER_ROW,
        budget: CLOUD_BUDGET_BYTES,
        from: Number.isFinite(result[0]?.from_at) ? Number(result[0].from_at) : null,
      };
    },
  };
}
