// Borrows the tracking connection; never opens or closes a second SQLite engine.
const TRIM_HISTORY = `DELETE FROM supabase_dog_status WHERE id IN (
  SELECT id FROM supabase_dog_status
  ORDER BY received_at DESC, id DESC LIMIT -1 OFFSET 15000
)`;

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
      await connection.executeAsync(`CREATE TABLE IF NOT EXISTS cloud_sync_state (
        owner_user_id TEXT NOT NULL, master_id INTEGER NOT NULL,
        through_at TEXT NOT NULL, event_id TEXT, updated_at INTEGER NOT NULL,
        PRIMARY KEY (owner_user_id, master_id)
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
