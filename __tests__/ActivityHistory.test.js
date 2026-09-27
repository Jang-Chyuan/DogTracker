import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { readActivityHistory } from '../src/cloud/ActivityHistory';

test('minute means preserve valid zero and gaps, prefer BLE and isolate cloud accounts', async () => {
  const db = createMemoryConnection();
  const now = 48 * 3600000;
  try {
    db.sqlite.exec(`CREATE TABLE dog_status(slave_id INTEGER,received_at INTEGER,activity TEXT,activity_valid INTEGER);
      CREATE TABLE supabase_dog_status(owner_user_id TEXT,slave_id INTEGER,received_at INTEGER,track_at INTEGER,activity REAL,activity_valid INTEGER);`);
    db.sqlite.exec(`INSERT INTO dog_status VALUES
      (8,${now-60000},'0.4',1),(8,${now-59000},'0.6',1),(8,${now-58000},'1',0),
      (8,${now-120000},'0',1),(4,${now-60000},'1',1);
      INSERT INTO supabase_dog_status VALUES
      ('a',8,${now},${now-60000},0.9,1),('a',8,${now},${now-180000},0.475,1),
      ('b',8,${now},${now-240000},1,1),('a',8,${now},${now-4*3600000},1,1),
      ('a',8,${now},${now-9*3600000},0.7,1),
      ('a',8,${now},${now-25*3600000},0.8,1);`);
    const result = await readActivityHistory(db, 'a', 8, now);
    expect(result).toHaveLength(1440);
    expect(result[1438]).toMatchObject({ value: 0.5, count: 2, source: 'ble' });
    expect(result[1437].value).toBe(0);
    expect(result[1436]).toMatchObject({ value: 0.475, source: 'cloud' });
    expect(result[1435].value).toBeNull();
    expect(result[1439].value).toBeNull();
    expect(result[1199]).toMatchObject({ value: 1, source: 'cloud' });
    expect(result[899]).toMatchObject({ value: 0.7, source: 'cloud' });
    expect(result.filter(p => p.value != null)).toHaveLength(5);
    expect((await readActivityHistory(db, null, 8, now))[1436].value).toBeNull();
  } finally { db.close(); }
});
