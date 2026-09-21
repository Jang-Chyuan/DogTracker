import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createRealTrackingRepository } from '../src/repositories/RealTrackingRepository';
import { createHistoryDatabase, HISTORY_DEFAULTS } from '../src/mapHistory/HistoryDatabase';
import { serializeHistory } from '../src/mapHistory/HistoryExport';

test('BLE live, history and export use persisted display coordinates and retain original payloads', async () => {
  const db = createMemoryConnection();
  try {
    const database = createDogDatabase(db);
    await database.initialize();
    const insert = db.sqlite.prepare(`INSERT INTO dog_status
      (received_at,master_id,slave_id,slave_lat,slave_lon,speed_kmh,raw_payload) VALUES (?,7,?, ?,121,0,'original')`);
    for (const slave of [4, 6, 8]) [25,25.003,25.006].forEach((lat,i) => insert.run(1000+i*10000,slave,lat));
    const repo = createRealTrackingRepository(database);
    expect((await repo.getLatest()).slaveLat).toBeCloseTo(25.003,8);
    const history = createHistoryDatabase(db);
    const prefs = { ...HISTORY_DEFAULTS, phone:false, source:'ble', slaves:[4,6,8] };
    const data = await history.read(prefs,null,30000);
    for (const track of data.clients) expect(track.latest.latitude).toBeCloseTo(25.003,8);
    const exported = await history.read(prefs,null,30000,()=>true,true);
    expect(exported.clients[2].rows[2]).toMatchObject({ raw_latitude:25.006, display_source:'ble-smoothed-v1' });
    expect(serializeHistory('csv',exported)).toContain('ble-smoothed-v1');
    expect(serializeHistory('gpx',exported)).toContain('lat="25.003"');
    expect(db.sqlite.prepare('SELECT slave_lat,raw_payload FROM dog_status ORDER BY id DESC LIMIT 1').get())
      .toMatchObject({ slave_lat:25.006, raw_payload:'original' });
    const again = await createRealTrackingRepository(database).getLatest();
    expect(again.slaveLat).toBeCloseTo(25.003,8);
    // Late native/JS insertion invalidates the following two display records.
    insert.run(16000,8,25.012);
    expect(db.sqlite.prepare('SELECT display_version FROM dog_status WHERE slave_id=8 AND received_at=21000').get().display_version).toBeNull();
    const narrow = await history.read(prefs,null,30000,()=>true,false,{since:20000,until:30000});
    expect(narrow.clients[2].latest.latitude).toBeCloseTo(25.007,8);
    expect(narrow.clients[0].latest.latitude).toBeCloseTo(25.003,8);
  } finally { db.close(); }
});
