import { mapDogStatusRow } from '../models/TrackingPoint';

/**
 * Reads real tracking data from dog_status and exposes UI-facing models.
 * The repository has no BLE dependency and never writes tracking rows.
 */
export function createRealTrackingRepository(database) {
  if (!database) throw new TypeError('database is required');

  return {
    async getLatest() {
      const row = await database.getLatestStatusRow();
      return row ? mapDogStatusRow(row) : null;
    },

    async getAfterId(cursor, limit = 100) {
      const rows = await database.listStatusRowsAfterId(cursor, limit);
      return rows.map(mapDogStatusRow);
    },

    async getByTimeCursor(startAt, endAt, cursor = null, limit = 1000) {
      const rows = await database.listStatusRowsByTimeCursor(
        startAt,
        endAt,
        cursor?.receivedAt ?? null,
        cursor?.id ?? null,
        limit,
      );
      return rows.map(mapDogStatusRow);
    },

    async getLatestByTimeCursor(startAt, endAt, cursor = null, limit = 1000) {
      const rows = await database.listLatestStatusRowsByTimeCursor(
        startAt,
        endAt,
        cursor?.receivedAt ?? null,
        cursor?.id ?? null,
        limit,
      );
      return rows.map(mapDogStatusRow);
    },

    async getPositionContext(latest) {
      if (!latest) return [];
      const rows = await database.getLatestValidStatusRows(
        latest.masterId,
        latest.slaveId,
        latest.id,
      );
      return rows.map(mapDogStatusRow);
    },

    async getByDateRange(startAt, endAt, limit = 1000, offset = 0) {
      const rows = await database.listStatusRowsByDateRange(
        startAt,
        endAt,
        limit,
        offset,
      );
      return rows.map(mapDogStatusRow);
    },
  };
}
