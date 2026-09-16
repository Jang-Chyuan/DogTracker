// Borrows the tracking connection; never opens or closes a second SQLite engine.
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
    },
    async savePage(owner, records) {
      requireOwner(owner);
      if (!records.length) return;
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
      await connection.executeBatchAsync(records.map(record => ({
        query,
        params: [owner, now, ...columns.map(key => record[key] ?? null), owner, record.event_id],
      })));
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
