import { mapDogStatusRow } from '../models/TrackingPoint';

export function createDemoTrackingRepository(database) {
  if (!database) throw new TypeError('database is required');
  return {
    async getLatest() {
      const row = await database.getLatestRow();
      return row ? mapDogStatusRow(row) : null;
    },
    async getAfterId(cursor, limit = 100) {
      const rows = await database.listRowsAfterId(cursor, limit);
      return rows.map(mapDogStatusRow);
    },
    async getByTimeCursor(startAt, endAt, cursor = null, limit = 1000) {
      const rows = await database.listRowsByTimeCursor(
        startAt,
        endAt,
        cursor?.receivedAt ?? null,
        cursor?.id ?? null,
        limit,
      );
      return rows.map(mapDogStatusRow);
    },
    async getLatestByTimeCursor(startAt, endAt, cursor = null, limit = 1000) {
      const rows = await database.listLatestRowsByTimeCursor(
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
      const rows = await database.getLatestValidRows(
        latest.masterId,
        latest.slaveId,
        latest.id,
      );
      return rows.map(mapDogStatusRow);
    },
    async getByDateRange(startAt, endAt, limit = 1000, offset = 0) {
      const rows = await database.listRowsByDateRange(
        startAt,
        endAt,
        limit,
        offset,
      );
      return rows.map(mapDogStatusRow);
    },
  };
}
