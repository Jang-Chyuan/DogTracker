import { openTrackingDatabase } from '../database/TrackingDatabaseConnection';
import { distanceMeters } from './IndoorHold';

// Lazy wrapper borrows Android's existing SQLite owner; never opens another engine.
export function createAddressCache({ connection, limit = 500 } = {}) {
  let ready;
  const db = async () => {
    if (!ready)
      ready = Promise.resolve()
        .then(async () => {
          connection = connection || openTrackingDatabase();
          await connection.executeAsync(`CREATE TABLE IF NOT EXISTS address_cache (
        latitude REAL NOT NULL, longitude REAL NOT NULL, value TEXT,
        failed_at INTEGER, updated_at INTEGER NOT NULL,
        PRIMARY KEY (latitude, longitude)
      )`);
          return connection;
        })
        .catch(error => {
          ready = null;
          throw error;
        });
    return ready;
  };
  return {
    async find(point) {
      const database = await db();
      const result = await database.executeAsync(
        'SELECT * FROM address_cache ORDER BY updated_at DESC LIMIT ?',
        [limit],
      );
      const candidates = (result.results || result.rows?._array || [])
        .map(row => ({
          anchor: { latitude: row.latitude, longitude: row.longitude },
          value: row.value,
          failedAt: row.failed_at ?? undefined,
        }))
        .filter(entry => distanceMeters(point, entry.anchor) <= 50)
        .sort(
          (a, b) =>
            distanceMeters(point, a.anchor) - distanceMeters(point, b.anchor),
        );
      return candidates[0] || null;
    },
    async save(entry) {
      if (!entry?.anchor || entry.pending) return;
      const database = await db();
      await database.executeAsync(
        'INSERT OR REPLACE INTO address_cache (latitude, longitude, value, failed_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        [
          entry.anchor.latitude,
          entry.anchor.longitude,
          entry.value,
          entry.failedAt ?? null,
          Date.now(),
        ],
      );
      await database.executeAsync(
        'DELETE FROM address_cache WHERE rowid NOT IN (SELECT rowid FROM address_cache ORDER BY updated_at DESC LIMIT ?)',
        [limit],
      );
    },
  };
}
