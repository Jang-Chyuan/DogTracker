import { mapDogStatusRow } from '../models/TrackingPoint';

/**
 * Reads real tracking data from dog_status and exposes UI-facing models.
 * UI reads materialize separate display coordinates; original tracking fields
 * and raw payloads remain unchanged.
 */
export function createRealTrackingRepository(database) {
  if (!database) throw new TypeError('database is required');

  async function display(records) {
    const rows = database.displayRows ? await database.displayRows(records) : records;
    return rows.map(row => mapDogStatusRow({ ...row,
      slave_lat: row.display_version === 1 ? row.display_latitude : row.slave_lat,
      slave_lon: row.display_version === 1 ? row.display_longitude : row.slave_lon,
    }));
  }

  return {
    async getLatest() {
      const row = await database.getLatestStatusRow();
      return row ? (await display([row]))[0] : null;
    },

    async getAfterId(cursor, limit = 100) {
      const rows = await database.listStatusRowsAfterId(cursor, limit);
      return display(rows);
    },

    async getByTimeCursor(startAt, endAt, cursor = null, limit = 1000) {
      const rows = await database.listStatusRowsByTimeCursor(
        startAt,
        endAt,
        cursor?.receivedAt ?? null,
        cursor?.id ?? null,
        limit,
      );
      return display(rows);
    },

    async getLatestByTimeCursor(startAt, endAt, cursor = null, limit = 1000) {
      const rows = await database.listLatestStatusRowsByTimeCursor(
        startAt,
        endAt,
        cursor?.receivedAt ?? null,
        cursor?.id ?? null,
        limit,
      );
      return display(rows);
    },

    async getPositionContext(latest) {
      if (!latest) return [];
      const rows = await database.getLatestValidStatusRows(
        latest.masterId,
        latest.slaveId,
        latest.id,
      );
      return display(rows);
    },

    async getByDateRange(startAt, endAt, limit = 1000, offset = 0) {
      const rows = await database.listStatusRowsByDateRange(
        startAt,
        endAt,
        limit,
        offset,
      );
      return display(rows);
    },
  };
}
