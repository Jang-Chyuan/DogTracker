/* eslint-env node */
import fs from 'fs';
import path from 'path';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';

// Execute the actual native statement on SQLite as well as the fallback path.
// JVM compile checks the Android caller; this avoids substituting a test SQL copy.
const native = fs.readFileSync(path.join(__dirname,
  '../android/app/src/main/java/com/dogtracker/DogStatusStore.kt'), 'utf8');
const nativeSQL = native.match(/db\.execSQL\("(DELETE FROM dog_status[^"]+)"/)[1];

test.each(['fallback', 'native SQL'])('%s retains exact per-dog boundary, holes, and received-time disorder', async mode => {
  const db = createMemoryConnection();
  try {
    await createDogDatabase(db).initialize();
    const sql = db.sqlite;
    sql.exec('BEGIN');
    const insert = sql.prepare('INSERT INTO dog_status(id, received_at, slave_id) VALUES (?, ?, ?)');
    let id = 1;
    const expected = new Map();
    for (const [slave, count] of [[1,1], [2,9999], [3,10000], [4,10001], [5,10008]]) {
      const ids = [];
      for(let i=0;i<count;i+=1) {
        ids.push(id); insert.run(id, 10000-i, slave); id+=3;
      }
      expected.set(slave, ids.slice(-10000));
    }
    insert.run(id, 0, null);
    sql.exec("INSERT INTO supabase_dog_status(received_at, slave_id) VALUES(1,4); COMMIT");
    if (mode === 'fallback') await createDogDatabase(db).initialize();
    else for (const slave of expected.keys()) sql.prepare(nativeSQL).run(slave, slave);
    for (const [slave, ids] of expected) expect(sql.prepare('SELECT id FROM dog_status WHERE slave_id=? ORDER BY id')
      .all(slave).map(row => row.id)).toEqual(ids);
    expect(sql.prepare('SELECT COUNT(*) AS n FROM dog_status WHERE slave_id IS NULL').get().n).toBe(1);
    expect(sql.prepare('SELECT COUNT(*) AS n FROM supabase_dog_status').get().n).toBe(1);
    // Idempotence and the next insertion keep the cap without relying on contiguous ids.
    const lastId=expected.get(4).at(-1);
    insert.run(id+9, -100, 4);
    if (mode === 'fallback') await createDogDatabase(db).initialize();
    else sql.prepare(nativeSQL).run(4,4);
    expect(sql.prepare('SELECT id FROM dog_status WHERE slave_id=4 ORDER BY id').all().map(row=>row.id))
      .toEqual([...expected.get(4).slice(1),id+9]);
    expect(lastId).toBeLessThan(id+9);
  } finally { db.close(); }
});
