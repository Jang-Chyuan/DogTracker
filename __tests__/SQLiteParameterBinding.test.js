/* eslint-env jest */
// F9: Android's native SQLite owner binds every SELECT parameter as TEXT, so
// the test connection does too: a comparison against an expression with no
// affinity must CAST its parameter, or it is wrong on the phone while it
// passes against node:sqlite's typed binding.
import fs from 'fs';
import path from 'path';
import { androidBoundParams, createMemoryConnection, sqlVerb } from '../__fixtures__/SQLiteConnection';

const native = name => fs.readFileSync(path.join(__dirname, '../android/app/src/main/java/com/dogtracker', name), 'utf8');

async function seeded(binding, checkBinding = false) {
  const db = createMemoryConnection({ binding, checkBinding });
  db.sqlite.exec('CREATE TABLE t (a INTEGER, b INTEGER, c TEXT)');
  await db.executeAsync('INSERT INTO t VALUES (?,?,?)', [5, null, 5]);
  await db.executeAsync('INSERT INTO t VALUES (?,?,?)', [null, 10, 'x']);
  return db;
}
const count = async (db, query, params) => (await db.executeAsync(query, params)).results[0].n;

describe('SQLite parameter binding (as on Android)', () => {
  test('a SELECT parameter is TEXT: an uncast comparison with an expression goes wrong, as on the phone', async () => {
    const phone = await seeded();
    const typed = await seeded('typed');
    const uncast = 'SELECT COUNT(*) n FROM t WHERE COALESCE(a,b) >= ?';
    expect(await count(typed, uncast, [5])).toBe(2);
    expect(await count(phone, uncast, [5])).toBe(0);
    // A number always sorts before text: 5 > '3' is false.
    expect(await count(typed, 'SELECT COUNT(*) n FROM t WHERE a+0 > ?', [3])).toBe(1);
    expect(await count(phone, 'SELECT COUNT(*) n FROM t WHERE a+0 > ?', [3])).toBe(0);
    // CAST, or a plain column (its affinity converts the text back), is right either way.
    expect(await count(phone, 'SELECT COUNT(*) n FROM t WHERE COALESCE(a,b) >= CAST(? AS INTEGER)', [5])).toBe(2);
    expect(await count(phone, 'SELECT COUNT(*) n FROM t WHERE CAST(COALESCE(a,b) AS INTEGER) >= ?', [5])).toBe(2);
    expect(await count(phone, 'SELECT COUNT(*) n FROM t WHERE b >= ?', [5])).toBe(1);
  });

  test('by default a read whose answer depends on the binding fails the test', async () => {
    const db = await seeded(undefined, true);
    await expect(db.executeAsync('SELECT COUNT(*) n FROM t WHERE COALESCE(a,b) >= ?', [5]))
      .rejects.toThrow('SQL answer depends on parameter binding');
    expect(await count(db, 'SELECT COUNT(*) n FROM t WHERE COALESCE(a,b) >= CAST(? AS INTEGER)', [5])).toBe(2);
  });

  test('other statements bind typed, whole numbers as INTEGER', async () => {
    const db = await seeded();
    // node:sqlite on its own would store '5.0' in the TEXT column.
    expect(db.sqlite.prepare("SELECT c, typeof(a) ta FROM t WHERE c<>'x'").get()).toEqual(
      expect.objectContaining({ c: '5', ta: 'integer' }));
    await db.executeAsync('UPDATE t SET b=? WHERE a=?', [true, 5]);
    expect(db.sqlite.prepare('SELECT b FROM t WHERE a=5').get().b).toBe(1);
    expect(androidBoundParams('INSERT INTO t VALUES (?)', [1.5, undefined, 'x'])).toEqual([1.5, null, 'x']);
    expect(androidBoundParams('select * from t where a=?', [5, true, null, 1.5])).toEqual(['5', '1', null, '1.5']);
  });

  test('the fixture reads statements the way both native owners do', () => {
    expect(sqlVerb('  WITH x AS (SELECT 1) SELECT * FROM x')).toBe('WITH');
    expect(sqlVerb('\nselect 1')).toBe('SELECT');
    for (const file of ['DogStatusStore.kt', 'CloudLatestStore.kt']) {
      const source = native(file);
      expect(source).toContain('verb in setOf("SELECT", "PRAGMA", "WITH", "EXPLAIN")');
      // Reads: rawQuery with String arguments (booleans as "1"/"0").
      expect(source).toMatch(/is Boolean -> if \(value\) "1" else "0"\s+else -> value\.toString\(\)/);
      // Writes: typed.
      expect(source).toMatch(/is Float, is Double -> statement\.bindDouble/);
      expect(source).toMatch(/is Number -> statement\.bindLong/);
    }
  });
});
