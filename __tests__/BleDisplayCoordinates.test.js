import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createRealTrackingRepository } from '../src/repositories/RealTrackingRepository';

test('BLE live uses persisted display coordinates and retains original payloads', async () => {
  const db = createMemoryConnection();
  try {
    const database = createDogDatabase(db);
    await database.initialize();
    const insert = db.sqlite.prepare(`INSERT INTO dog_status
      (received_at,master_id,slave_id,slave_lat,slave_lon,speed_kmh,raw_payload) VALUES (?,7,?, ?,121,0,'original')`);
    for (const slave of [4, 6, 8]) [25,25.003,25.006].forEach((lat,i) => insert.run(1000+i*10000,slave,lat));
    const repo = createRealTrackingRepository(database);
    expect((await repo.getLatest()).slaveLat).toBeCloseTo(25.003,8);
    // (The retired range history read of these display columns went in 064;
    // the v3 history and its export read the raw fixes: historyDayRows.)
    expect(db.sqlite.prepare('SELECT slave_lat,raw_payload FROM dog_status ORDER BY id DESC LIMIT 1').get())
      .toMatchObject({ slave_lat:25.006, raw_payload:'original' });
    const again = await createRealTrackingRepository(database).getLatest();
    expect(again.slaveLat).toBeCloseTo(25.003,8);
    // Late native/JS insertion invalidates the following two display records.
    insert.run(16000,8,25.012);
    expect(db.sqlite.prepare('SELECT display_version FROM dog_status WHERE slave_id=8 AND received_at=21000').get().display_version).toBeNull();
  } finally { db.close(); }
});
