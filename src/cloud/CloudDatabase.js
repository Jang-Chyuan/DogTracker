import { initializeHistoryCoverage, invalidateEvictedCoverage } from './HistoryCoverage';
import { t } from '../i18n';
import { createStagedCloudDatabase } from './CloudStaging';
import { createLatestSnapshotDatabase } from './CloudLatestSnapshot';
// Borrows the tracking connection; never opens or closes a second SQLite engine.
import { withConnectionLock } from '../database/connectionLock';
import { cloudTrackTime } from './CloudTrackTime';
import { readActivityEarliest, readActivityPeriod } from '../activity/ActivityData';
import { readDogCardRows } from '../activity/DogCardReadings';
import { predictEnvironment, ENVIRONMENT_WINDOW_MS } from '../ml/Environment';
import { HOLD_CONFIG } from '../placement/IndoorHold';
import { HOLD_LOOKBACK_MS } from '../placement/HoldStore';
import { optimizeDatabase } from '../database/DatabaseStatistics';

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
  WHERE id IN (SELECT id FROM supabase_dog_status
    WHERE raw_payload IS NOT NULL AND received_at < ? ORDER BY received_at LIMIT 1000)`;

// Enumerate dogs by seeking to the next indexed id, then seek each newest row.
// DISTINCT still walks the whole account even when its output has only six dogs.
export function latestCloudStatusQuery(validFix) {
  const fix = validFix ? 'AND slave_lat IS NOT NULL AND slave_lon IS NOT NULL AND NOT (slave_lat=0 AND slave_lon=0)' : '';
  return `SELECT slave_id, master_id, CAST(COALESCE(track_at, received_at) AS INTEGER) AS track_at,
    received_at, slave_lat, slave_lon, speed_kmh, battery_percentage, battery_valid, usb_present, 'cloud' AS source
    FROM supabase_dog_status WHERE id IN (
      SELECT (SELECT id FROM supabase_dog_status AS newest
        WHERE newest.owner_user_id=devices.owner AND newest.slave_id=devices.slave_id ${fix}
          AND CAST(COALESCE(track_at, received_at) AS INTEGER)>=devices.since
        ORDER BY CAST(COALESCE(track_at, received_at) AS INTEGER) DESC, id DESC LIMIT 1)
      FROM (
        WITH RECURSIVE dogs(slave_id, owner, since) AS (
          SELECT MIN(slave_id), ?, ? FROM supabase_dog_status WHERE owner_user_id=?
          UNION ALL
          SELECT (SELECT MIN(slave_id) FROM supabase_dog_status
            WHERE owner_user_id=dogs.owner AND slave_id>dogs.slave_id), owner, since
          FROM dogs WHERE slave_id IS NOT NULL)
        SELECT * FROM dogs WHERE slave_id IS NOT NULL) AS devices)
    ORDER BY slave_id`;
}

// The tracking session forwards these to the owner of the SQLite connection;
// keep both sides in step or a caller gets `undefined is not a function`.
export const CLOUD_DATABASE_METHODS = ['readLatestSnapshot', 'publishLatestSnapshot', 'initialize', 'beginDownload', 'publishDownload', 'beginManualScope', 'publishManualScope', 'loadSyncState', 'savePage',
  'loadBuckets', 'saveBucket', 'countRange', 'latestBySlave', 'trackBySlave',
  'listHistory', 'count', 'usage', 'pendingTrackTimes', 'repairTrackTimes', 'latestStatusRows', 'activityPeriod', 'activityEarliest', 'dogCardRows', 'holdRows', 'loadRangeState', 'saveRangeState', 'historyDownloadStates', 'setHistoryDownloadState', 'wifiUploads'];

/** `maxRows` is only for tests: filling a real cap takes half a million rows. */
const initialization = new WeakMap();

export function createCloudDatabase(connection, options = {}) {
  const maxRows = Number.isInteger(options.maxRows) && options.maxRows > 0 ? options.maxRows : CLOUD_MAX_ROWS;
  const database = createStagedCloudDatabase(connection, { ...options, maxRows }, createCloudDatabaseCore);
  return { ...database, ...createLatestSnapshotDatabase(connection, database.initialize) };
}

function createCloudDatabaseCore(connection, { maxRows = CLOUD_MAX_ROWS } = {}) {
  const cap = Number.isInteger(maxRows) && maxRows > 0 ? maxRows : CLOUD_MAX_ROWS;
  const trimHistory = `DELETE FROM supabase_dog_status WHERE id IN (
    SELECT id FROM supabase_dog_status
    ORDER BY received_at DESC, id DESC LIMIT -1 OFFSET ${cap}
  )`;
  let pagesSaved = 0;
  // Bumped when stored rows move in time, so the indoor hold replays them.
  let trackRepairs = 0;
  const rows = result => result.results || result.rows?._array || [];
  const requireOwner = owner => {
    if (!owner) throw new Error(t("c572"));
  };
  return {
    invalidatePublished() { trackRepairs++; },
    async historyDownloadStates(owner, ids) {
      return withConnectionLock(connection, async () => {
      await initializeHistoryCoverage(connection);
      const list = Array.isArray(ids) ? ids : [ids];
      if (!list.length) return [];
      return rows(await connection.executeAsync(`SELECT slave_id,day,complete,range_start,range_end,received_before FROM history_download_state WHERE owner=? AND slave_id IN (${list.map(() => '?').join(',')})`, [owner, ...list])).map(row => Object.fromEntries(Object.entries(row).filter(([name, value]) =>
        !['range_start', 'range_end', 'received_before'].includes(name) || value != null)));
      });
    },
    async setHistoryDownloadState(owner, slaveId, day, complete, coverage = {}) {
      return withConnectionLock(connection, async () => {
      await initializeHistoryCoverage(connection);
      await connection.executeAsync('INSERT OR REPLACE INTO history_download_state(owner,slave_id,day,complete,range_start,range_end,received_before) VALUES(?,?,?,?,?,?,?)', [owner, slaveId, day, complete ? 1 : 0, coverage.range_start ?? null, coverage.range_end ?? null, coverage.received_before ?? null]);
      });
    },
    async loadRangeState(owner) {
      await connection.executeAsync('CREATE TABLE IF NOT EXISTS receiver_range_state (scope TEXT PRIMARY KEY, value TEXT NOT NULL)');
      const saved = rows(await connection.executeAsync('SELECT value FROM receiver_range_state WHERE scope=?', [owner ?? 'local']))[0]?.value;
      return saved ? JSON.parse(saved) : {};
    },
    async saveRangeState(owner, ranges) {
      await connection.executeAsync('CREATE TABLE IF NOT EXISTS receiver_range_state (scope TEXT PRIMARY KEY, value TEXT NOT NULL)');
      await connection.executeAsync('INSERT OR REPLACE INTO receiver_range_state(scope,value) VALUES(?,?)', [owner ?? 'local', JSON.stringify(ranges)]);
    },
    initialize() {
      // UI/headless wrappers of one native owner share migration work.
      // A new owner/standalone handle migrates again; failed opens remain retryable.
      const key = connection.lockKey || connection;
      if (initialization.has(key)) return initialization.get(key);
      const ready = withConnectionLock(connection, async () => {
      const columns = new Set(rows(await connection.executeAsync(
        'PRAGMA table_info(supabase_dog_status)',
      )).map(column => column.name));
      for (const [name, type] of [
        ['owner_user_id', 'TEXT'], ['event_id', 'TEXT'],
        ['downloaded_at', 'INTEGER'], ['remote_received_at', 'TEXT'],
        ['publication_version', 'INTEGER NOT NULL DEFAULT 0'],
        ['track_at', 'INTEGER'], ['upload_source', 'TEXT'], ['phone_received_at', 'INTEGER'],
        ['track_time_version', 'INTEGER'], ['usb_present', 'INTEGER'],
      ]) {
        if (!columns.has(name)) {
          await connection.executeAsync(`ALTER TABLE supabase_dog_status ADD COLUMN ${name} ${type}`);
        }
      }
      // Restartable migration. Old downloads omitted phone metadata entirely;
      // fill safe fallback times now and repair metadata in bounded network pages.
      // The display-coordinate cache (display_latitude, display_longitude,
      // display_version) is retired (2026-10-09): nothing read it after the
      // range read went (064). Installs that had it keep the columns, unused;
      // new installs never add them.
      await connection.executeAsync(`UPDATE supabase_dog_status SET track_at=received_at
        WHERE track_at IS NULL`);
      await connection.executeAsync('DROP INDEX IF EXISTS idx_cloud_track_stream');
      await connection.executeAsync(`CREATE INDEX IF NOT EXISTS idx_cloud_track_stream_numeric
        ON supabase_dog_status(owner_user_id, master_id, slave_id, CAST(COALESCE(track_at, received_at) AS INTEGER), id)`);
      // Late-insert invalidation uses raw track_at, not the expression index.
      await connection.executeAsync(`CREATE INDEX IF NOT EXISTS idx_cloud_track_successors
        ON supabase_dog_status(owner_user_id, master_id, slave_id, track_at, id)`);
      await connection.executeAsync(`CREATE INDEX IF NOT EXISTS idx_cloud_latest_packet
        ON supabase_dog_status(owner_user_id, slave_id, CAST(COALESCE(track_at, received_at) AS INTEGER) DESC, id DESC)`);
      await connection.executeAsync(`CREATE INDEX IF NOT EXISTS idx_cloud_latest_fix
        ON supabase_dog_status(owner_user_id, slave_id, CAST(COALESCE(track_at, received_at) AS INTEGER) DESC, id DESC)
        WHERE slave_lat IS NOT NULL AND slave_lon IS NOT NULL AND NOT (slave_lat=0 AND slave_lon=0)`);
      await connection.executeAsync(`CREATE INDEX IF NOT EXISTS idx_cloud_payload_cleanup
        ON supabase_dog_status(received_at) WHERE raw_payload IS NOT NULL`);
      await connection.executeAsync(`CREATE INDEX IF NOT EXISTS idx_cloud_track_repair
        ON supabase_dog_status(owner_user_id, track_time_version, received_at DESC)`);
      await connection.executeAsync(`CREATE UNIQUE INDEX IF NOT EXISTS idx_cloud_owner_event
        ON supabase_dog_status(owner_user_id, event_id)`);
      await connection.executeAsync(`CREATE INDEX IF NOT EXISTS idx_cloud_owner_history
        ON supabase_dog_status(owner_user_id, received_at DESC, id DESC)`);
      await connection.executeAsync(`CREATE INDEX IF NOT EXISTS idx_cloud_owner_master_received
        ON supabase_dog_status(owner_user_id, master_id, received_at)`);
      // Per-stream order (owner, Master, Slave, time); its name is from the
      // retired display cache, kept so an upgrade does not build it twice.
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
      await initializeHistoryCoverage(connection);
      await connection.executeBatchAsync([{ query: invalidateEvictedCoverage(trimHistory), params: [] }, { query: trimHistory, params: [] }]);
      await connection.executeAsync(DROP_OLD_PAYLOAD, [Date.now() - CLOUD_PAYLOAD_MS]);
      // All cloud indexes/migrations exist before statistics are collected.
      await optimizeDatabase(connection);
      });
      initialization.set(key, ready);
      ready.catch(() => initialization.delete(key));
      return ready;
    },
    async loadSyncState(owner, masterId) {
      requireOwner(owner);
      return rows(await connection.executeAsync(
        'SELECT * FROM cloud_sync_state WHERE owner_user_id = ? AND master_id = ?',
        [owner, masterId],
      ))[0] || null;
    },
    /**
     * 最後上傳成功…（經 Wi-Fi） per receiver (S2/S3, 070): the newest row each
     * Master sent to Supabase through its own Wi-Fi, as the stored copy shows
     * it → { [masterId]: receivedAt }.
     *
     * Read over the whole stored table rather than over each dog's newest row:
     * once this phone has uploaded something newer for every dog of a Master,
     * all those newest rows are 'phone' and the receiver's own Wi-Fi history
     * would look as if it had never uploaded at all.
     *
     * `upload_source` is not indexed, so this walks the account's rows. The
     * caller refreshes after successful downloads, route changes and return
     * to the foreground — never on the upload pass.
     */
    async wifiUploads(owner) {
      requireOwner(owner);
      return Object.fromEntries(rows(await connection.executeAsync(
        `SELECT master_id, MAX(received_at) time FROM supabase_dog_status
          WHERE owner_user_id=? AND upload_source='wifi' GROUP BY master_id`, [owner]))
        .map(row => [Number(row.master_id), Number(row.time)])
        .filter(([master, time]) => Number.isInteger(master) && Number.isFinite(time) && time > 0));
    },
    async pendingTrackTimes(owner) {
      requireOwner(owner);
      return rows(await connection.executeAsync(`SELECT event_id FROM supabase_dog_status
        WHERE owner_user_id=? AND track_time_version IS NULL AND event_id IS NOT NULL
        ORDER BY received_at DESC LIMIT 200`, [owner]));
    },
    async repairTrackTimes(owner, metadata, requested, copies = []) {
      requireOwner(owner);
      return withConnectionLock(connection, async () => {
        const commands = [...copies];
        for (const item of metadata) {
          const time = cloudTrackTime(item);
          if (!Number.isFinite(time.track_at) || !requested.includes(item.event_id)) continue;
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
        if (metadata.length) trackRepairs += 1;
      });
    },
    async savePage(owner, records, checkpoint = null) {
      return withConnectionLock(connection, async () => {
        requireOwner(owner);
        if (!records.length && !checkpoint) return;
        const columns = [
          'track_at', 'upload_source', 'phone_received_at', 'track_time_version',
          'event_id', 'remote_received_at', 'received_at', 'master_id', 'slave_id',
          'sequence', 'slave_lat', 'slave_lon', 'speed_kmh', 'satellites', 'hdop',
          'activity', 'activity_valid', 'battery_mv', 'battery_percentage',
          'battery_valid', 'usb_present', 'gps_time', 'activity_time', 'rssi', 'snr', 'raw_payload',
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
          params: [owner, now, ...columns.map(key => key === 'track_at' ? record.track_at ?? record.received_at : record[key] ?? null), owner, record.event_id],
        }));
        if (checkpoint) {
          if (!Number.isInteger(checkpoint.masterId) || !Number.isFinite(Date.parse(checkpoint.throughAt))) {
            throw new Error(t("c574"));
          }
          commands.push({
            query: `INSERT OR REPLACE INTO cloud_sync_state
              (owner_user_id, master_id, through_at, event_id, updated_at) VALUES (?, ?, ?, ?, ?)`,
            params: [owner, checkpoint.masterId, checkpoint.throughAt, checkpoint.eventId ?? null, now],
          });
        }
        // Global cap across accounts/Masters. Keep newest reception times, not
        // newest download order, so manual historical downloads cannot evict newer rows.
        commands.push({ query: invalidateEvictedCoverage(trimHistory), params: [] });
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
        throw new Error(t("c573"));
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
    // Newest downloaded fix per dog, whichever Master reported it; 0,0 is no fix.
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
      return rows(await connection.executeAsync(latestCloudStatusQuery(true), [owner, sinceMs, owner]));
    },
    // The activity page (A4): one dog's readings of a period, and its first.
    activityPeriod: (owner, slaveId, period) => readActivityPeriod(connection, owner, slaveId, period),
    activityEarliest: (owner, slaveId) => readActivityEarliest(connection, owner, slaveId),
    // The open dog card's activity and battery readings (DogCardReadings).
    dogCardRows: (owner, slaveId, since) => readDogCardRows(connection, owner, slaveId, since),
    // Signed out (no owner) only this phone's own BLE rows: signing in is
    // optional, and the receiver's dogs still need their latest packets.
    async latestStatusRows(owner, sinceMs, now = Date.now()) {
      const cloud = owner
        ? rows(await connection.executeAsync(latestCloudStatusQuery(false), [owner, sinceMs, owner])) : [];
      // Read both the latest packet and last valid fix per local dog. No raw
      // history pages are retained in React, including after a restart.
      const pickLocal = validFix => `SELECT slave_id, master_id,
        received_at AS track_at, received_at, slave_lat, slave_lon,
        (SELECT MIN(first.received_at) FROM dog_status first
          WHERE first.master_id = dog_status.master_id AND first.slave_id = dog_status.slave_id) AS first_received_at,
        speed_kmh, battery_percentage, battery_valid, usb_present, distance_meters, 'ble' AS source
        FROM dog_status WHERE id IN (
          WITH RECURSIVE dogs(slave_id) AS (
            SELECT MIN(slave_id) FROM dog_status
            UNION ALL SELECT (SELECT MIN(slave_id) FROM dog_status WHERE slave_id>dogs.slave_id)
              FROM dogs WHERE slave_id IS NOT NULL),
          devices(slave_id) AS (
            SELECT slave_id FROM dogs WHERE slave_id IS NOT NULL
            UNION ALL SELECT NULL WHERE EXISTS (SELECT 1 FROM dog_status WHERE slave_id IS NULL))
          SELECT (SELECT id FROM dog_status newest
            WHERE newest.slave_id IS devices.slave_id AND received_at>=?
              ${validFix ? 'AND slave_lat IS NOT NULL AND slave_lon IS NOT NULL AND NOT (slave_lat=0 AND slave_lon=0)' : ''}
            ORDER BY received_at DESC, id DESC LIMIT 1) FROM devices)`;
      const local = rows(await connection.executeAsync(
        `${pickLocal(false)} UNION ALL ${pickLocal(true)}`, [sinceMs, sinceMs]));
      return Promise.all([...local, ...cloud].map(async row => {
        const isCloud = row.source === 'cloud';
        const table = isCloud ? 'supabase_dog_status' : 'dog_status';
        const clock = isCloud ? 'CAST(COALESCE(track_at, received_at) AS INTEGER)' : 'received_at';
        const pair = [row.master_id, row.slave_id];
        const account = isCloud ? [owner] : [];
        const completedBefore = Math.floor(now / ENVIRONMENT_WINDOW_MS) * ENVIRONMENT_WINDOW_MS;
        const latest = rows(await connection.executeAsync(`SELECT MAX(${clock}) AS time FROM ${table}
          WHERE master_id = ? AND slave_id = ? AND ${clock} >= ? AND ${clock} < ?
          ${isCloud ? 'AND owner_user_id = ?' : ''}`,
        [...pair, sinceMs, completedBefore, ...account]))[0]?.time;
        if (!Number.isFinite(latest)) return { ...row, environment: null };
        const windowStart = Math.floor(latest / ENVIRONMENT_WINDOW_MS) * ENVIRONMENT_WINDOW_MS;
        const window = rows(await connection.executeAsync(`SELECT master_id, slave_id,
          ${clock} AS track_at, received_at, slave_lat, slave_lon,
          satellites, hdop, rssi, snr, usb_present FROM ${table}
          WHERE master_id = ? AND slave_id = ? AND ${clock} >= ? AND ${clock} < ?
          ${isCloud ? 'AND owner_user_id = ?' : ''}`,
        [...pair, windowStart, windowStart + ENVIRONMENT_WINDOW_MS, ...account]));
        return { ...row, environment: predictEnvironment(window) };
      }));
    },
    /**
     * Rows for the indoor hold, from both the BLE table and this account's
     * cloud copy. A cold start (no cursors) reads the last lookback window and
     * each dog's last good fixes before it; later calls read only rows added
     * since the cursors, so a poll stays small whatever the retention holds.
     */
    async holdRows(owner, sinceMs, cursors = null, quality = HOLD_CONFIG) {
      // Rows already read may have moved in time: start over from the window.
      const reset = !!cursors && cursors.repairs !== trackRepairs;
      if (reset) cursors = null;
      const shared = `id, master_id, slave_id, slave_lat AS latitude, slave_lon AS longitude,
        satellites, hdop, rssi, snr, usb_present`;
      const read = async (table, clock, account) => {
        // Only this phone's own rows know where its receiver was (the receiver
        // range is judged against that); the cloud copy has no such column.
        const columns = account ? shared
          : `${shared}, master_lat AS master_latitude, master_lon AS master_longitude`;
        // A cursor is insertion order, independent of corrected track time.
        // Unary + keeps SQLite on the rowid seek rather than an owner/time scan.
        const accountFilter = account ? `${cursors ? '+' : ''}owner_user_id = ? AND ` : '';
        const params = account ? [owner] : [];
        const fresh = rows(await connection.executeAsync(cursors
          ? `SELECT ${columns}, ${clock} AS time FROM ${table}
            WHERE ${accountFilter}id > ? ORDER BY id LIMIT 20000`
          : `SELECT ${columns}, ${clock} AS time FROM ${table}
            WHERE ${accountFilter}${clock} >= ? ORDER BY id LIMIT 20000`,
        [...params, cursors ? cursors[table] ?? 0 : sinceMs]));
        let seeds = [];
        const older = [];
        if (!cursors) {
          // A dog silent for longer than the window (charging, out of range)
          // replays its own last half hour instead, so it keeps its hold.
          const heard = new Set(fresh.map(row => row.slave_id));
          const silent = rows(await connection.executeAsync(`SELECT slave_id, MAX(${clock}) AS newest
            FROM ${table} WHERE ${accountFilter}${clock} < ? GROUP BY slave_id`,
          [...params, sinceMs])).filter(row => !heard.has(row.slave_id));
          const windows = new Map();
          for (const row of silent) {
            const from = Number(row.newest) - HOLD_LOOKBACK_MS;
            windows.set(row.slave_id, from);
            older.push(...rows(await connection.executeAsync(`SELECT ${columns}, ${clock} AS time FROM ${table}
              WHERE ${accountFilter}slave_id = ? AND ${clock} >= ? AND ${clock} < ? ORDER BY ${clock}, id LIMIT 20000`,
            [...params, row.slave_id, from, sinceMs])));
          }
          // Indoors for hours or days (charging in a kennel): the anchor is the
          // last good fixes before the replayed window, however long ago.
          for (const slave of [...heard, ...windows.keys()]) {
            const until = windows.get(slave) ?? sinceMs;
            seeds = seeds.concat(rows(await connection.executeAsync(`SELECT ${columns}, ${clock} AS time
              FROM ${table} WHERE ${accountFilter}slave_id = ? AND ${clock} < ?
                AND satellites >= ? AND slave_lat IS NOT NULL AND slave_lon IS NOT NULL
                AND NOT (slave_lat = 0 AND slave_lon = 0)
              ORDER BY ${clock} DESC LIMIT 40`,
            [...params, slave, until, quality.goodMinSatellites])));
          }
        }
        // Ordered by id: the last row carries the cursor (no spread over 20000 ids).
        const last = fresh.length ? Number(fresh[fresh.length - 1].id) : cursors?.[table] ?? 0;
        if (!cursors && !fresh.length) {
          const top = rows(await connection.executeAsync(`SELECT MAX(id) AS id FROM ${table}
            ${account ? 'WHERE owner_user_id = ?' : ''}`, params))[0]?.id;
          return { fresh: older, seeds, last: Number(top) || 0 };
        }
        return { fresh: [...older, ...fresh], seeds, last };
      };
      const tag = (batch, source) => ({ ...batch, fresh: batch.fresh.map(row => ({ ...row, source })),
        seeds: batch.seeds.map(row => ({ ...row, source })) });
      const ble = tag(await read('dog_status', 'received_at', false), 'ble');
      const cloud = owner
        ? tag(await read('supabase_dog_status', 'CAST(COALESCE(track_at, received_at) AS INTEGER)', true), 'cloud')
        : { fresh: [], seeds: [], last: 0 };
      return {
        rows: [...ble.fresh, ...cloud.fresh],
        seeds: [...ble.seeds, ...cloud.seeds],
        cursors: { dog_status: ble.last, supabase_dog_status: cloud.last, repairs: trackRepairs },
        reset,
      };
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
        // Separate aggregate subqueries permit SQLite's fast COUNT and MIN seek,
        // while one statement keeps both answers in the same read snapshot.
        `SELECT (SELECT COUNT(*) FROM supabase_dog_status) AS count,
                (SELECT MIN(received_at) FROM supabase_dog_status) AS from_at`));
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
