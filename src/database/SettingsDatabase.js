// Keep the original key so existing POC installs retain their saved values.
const TRACKING_PREFERENCES_KEY = 'map_preferences';

export function createSettingsDatabase(connection) {
  return {
    async initialize() {
      await connection.executeAsync(`CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL
      )`);
    },
    async load() {
      const result = await connection.executeAsync(
        'SELECT value FROM app_settings WHERE key = ?',
        [TRACKING_PREFERENCES_KEY],
      );
      const rows = result.results || result.rows?._array || [];
      return rows.length ? JSON.parse(rows[0].value) : {};
    },
    async save(value) {
      // Android 8's system SQLite predates UPSERT. This table contains only
      // key/value settings, so replacing the matching key is safe.
      await connection.executeAsync(
        'INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)',
        [TRACKING_PREFERENCES_KEY, JSON.stringify(value)],
      );
    },
    async reset() {
      await connection.executeAsync('DELETE FROM app_settings WHERE key = ?', [
        TRACKING_PREFERENCES_KEY,
      ]);
    },
  };
}
