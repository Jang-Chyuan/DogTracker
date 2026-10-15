/* eslint-env node */
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createRealTrackingRepository } from '../src/repositories/RealTrackingRepository';
import { DEFAULT_MAX_BATCHES_PER_REFRESH, DEFAULT_TRACKING_BATCH_SIZE } from '../src/tracking/TrackingFeed';

// 2026-10-16: right after the App came back, the live map parsed 1,000-row
// pages of dog_status with each packet's raw JSON (~0.9 MB a page) and handed
// each page to the map in one go: JS stalls of seconds. The live reads leave
// raw_payload out (no live model reads it) and come in pages of 250.
test('the live map\'s reads carry every column but the raw payload', async () => {
  const db = createMemoryConnection();
  try {
    const dogs = createDogDatabase(db);
    // Before the migrations ran nothing is known about the table: every column.
    await dogs.initialize();
    db.sqlite.prepare(`INSERT INTO dog_status (received_at, master_id, slave_id, slave_lat, slave_lon, battery_mv, raw_payload)
      VALUES (?, 3, 12, 24.99, 121.31, 3900, ?)`).run(1000, JSON.stringify({ big: 'x'.repeat(500) }));
    db.sqlite.prepare(`INSERT INTO dog_status (received_at, master_id, slave_id, slave_lat, slave_lon, battery_mv, raw_payload)
      VALUES (?, 3, 12, 24.98, 121.30, 3890, ?)`).run(2000, '{}');
    const reads = [
      await dogs.getLatestStatusRow(),
      ...await dogs.listStatusRowsAfterId(0, 10),
      ...await dogs.listStatusRowsByTimeCursor(0, 5000, null, null, 10),
      ...await dogs.listStatusRowsByTimeCursor(0, 5000, 1000, 1, 10),
      ...await dogs.listLatestStatusRowsByTimeCursor(0, 5000, null, null, 10),
      ...await dogs.listLatestStatusRowsByTimeCursor(0, 5000, 2000, 2, 10),
      ...await dogs.getLatestValidStatusRows(3, 12, 2),
    ];
    expect(reads.length).toBeGreaterThan(6);
    for (const row of reads) {
      expect(row).not.toHaveProperty('raw_payload');
      expect(row).toEqual(expect.objectContaining({ master_id: 3, slave_id: 12, battery_mv: expect.any(Number) }));
    }
    const point = await createRealTrackingRepository(dogs).getLatest();
    expect(point).toEqual(expect.objectContaining({ slaveId: 12, batteryMillivolts: 3890, rawPayload: null }));
  } finally { db.close(); }
});

test('pages of 250, as many rows per refresh as before', () => {
  expect(DEFAULT_TRACKING_BATCH_SIZE).toBe(250);
  expect(DEFAULT_TRACKING_BATCH_SIZE * DEFAULT_MAX_BATCHES_PER_REFRESH).toBe(20000);
});
