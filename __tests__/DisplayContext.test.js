import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { ensureBleDisplayColumns, persistBleDisplayCoordinates } from '../src/ble/BleDisplayCoordinates';

// The cloud copy's display cache is retired (2026-10-09): the live rows only.
test.each([true])('bounded predecessor seeks preserve smoothing with statistics (BLE=%s)', async ble => {
  const db = createMemoryConnection();
  try {
    await createDogDatabase(db).initialize(); await ensureBleDisplayColumns(db);
    await createCloudDatabase(db).initialize();
    const table = ble ? 'dog_status' : 'supabase_dog_status';
    const clock = ble ? 'received_at' : 'CAST(COALESCE(track_at, received_at) AS INTEGER)';
    const insert = db.sqlite.prepare(`INSERT INTO ${table}
      (received_at,master_id,slave_id,slave_lat,slave_lon${ble ? '' : ',owner_user_id,track_at'})
      VALUES (?,NULL,4,?,121${ble ? '' : ",'a',?"})`);
    for (let i = 0; i < 1600; i++) {
      const time = i < 1400 ? 1000 : 2000;
      insert.run(...(ble ? [time,25+i/100000] : [9999,25+i/100000,time]));
    }
    const fields = `id,${clock} AS time,slave_lat AS latitude,slave_lon AS longitude,speed_kmh,master_id`;
    const page = db.sqlite.prepare(`SELECT *,${clock} AS time,slave_lat AS latitude,slave_lon AS longitude
      FROM ${table} WHERE id BETWEEN 1399 AND 1402 ORDER BY ${clock},id`).all();
    const first = page[0];
    const reference = db.sqlite.prepare(`SELECT ${fields} FROM ${table}
      WHERE master_id IS NULL AND slave_id=4 ${ble ? '' : "AND owner_user_id='a'"}
      AND (${clock}<? OR (${clock}=? AND id<?)) ORDER BY ${clock} DESC,id DESC LIMIT 2`)
      .all(first.time,first.time,first.id);
    let prior;
    for (let pass = 0; pass < 2; pass++) {
      db.sqlite.exec('UPDATE ' + table + ' SET display_version=NULL');
      db.executeAsync.mockClear();
      const output = await persistBleDisplayCoordinates(db,page);
      const [query,params] = db.executeAsync.mock.calls.find(([q]) => q.includes('UNION ALL'));
      expect(db.sqlite.prepare(query).all(...params)).toEqual(reference);
      if (prior) expect(output).toEqual(prior);
      prior = output;
      db.sqlite.exec('ANALYZE');
    }
  } finally { db.close(); }
});
