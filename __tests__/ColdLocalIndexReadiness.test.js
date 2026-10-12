/* eslint-env node */
import fs from 'fs';
import path from 'path';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';

const native = fs.readFileSync(path.join(__dirname, '../android/app/src/main/java/com/dogtracker/DogStatusStore.kt'), 'utf8');
const nativeIndex = native.match(/db\.execSQL\("(CREATE INDEX IF NOT EXISTS idx_dog_status_received_at_id[^"\n]+)"\)/)[1];
const historySQL = 'SELECT * FROM dog_status WHERE received_at>=0 AND received_at<=1200 ORDER BY received_at DESC, id DESC LIMIT 2';
const plan = db => db.sqlite.prepare(`EXPLAIN QUERY PLAN ${historySQL}`).all().map(row => row.detail).join(' ');
const schemaVersion = db => db.sqlite.prepare('PRAGMA schema_version').get().schema_version;
let db;
beforeEach(async () => {
  db = createMemoryConnection(); await createDogDatabase(db).initialize();
  db.sqlite.exec(`INSERT INTO dog_status(id,received_at,slave_id,master_id) VALUES
    (2,1000,6,7),(4,1000,6,7),(6,900,6,7),(8,1100,6,7),(10,1100,6,7),(12,500,6,7)`);
});
afterEach(() => db.close());

test('native cold open reuses actual existing composite index without rebuilding retired index or changing latest row/query plan', async () => {
  const version = schemaVersion(db), expected = await createDogDatabase(db).getLatestStatusRow();
  expect(expected.id).toBe(12); expect(plan(db)).toContain('idx_dog_status_received_at_id');
  db.sqlite.exec(nativeIndex);
  expect(schemaVersion(db)).toBe(version);
  expect(await createDogDatabase(db).getLatestStatusRow()).toEqual(expected);
  expect(plan(db)).toContain('idx_dog_status_received_at_id');
  expect(db.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='idx_dog_status_received_at'").all()).toEqual([]);
});

test('an older install still gets the needed composite index and retires only its redundant index during JS initialization', async () => {
  db.sqlite.exec('DROP INDEX idx_dog_status_received_at_id; CREATE INDEX idx_dog_status_received_at ON dog_status(received_at DESC)');
  const expected = await createDogDatabase(db).getLatestStatusRow();
  db.sqlite.exec(nativeIndex); await createDogDatabase(db).initialize();
  expect(await createDogDatabase(db).getLatestStatusRow()).toEqual(expected);
  expect(db.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='idx_dog_status_received_at'").all()).toEqual([]);
  expect(plan(db)).toContain('idx_dog_status_received_at_id');
  const indexes = db.sqlite.prepare("PRAGMA index_info(idx_dog_status_received_at_id)").all();
  expect(indexes.map(row => row.name)).toEqual(['received_at', 'id']);
});

test('native-first fresh schema and descending keyset history preserve both timestamp and ID tie order', async () => {
  db.sqlite.exec('DROP INDEX idx_dog_status_received_at_id'); db.sqlite.exec(nativeIndex);
  const database = createDogDatabase(db);
  const first = await database.listLatestStatusRowsByTimeCursor(0, 1200, null, null, 2);
  expect(first.map(row => row.id)).toEqual([10, 8]);
  const next = await database.listLatestStatusRowsByTimeCursor(0, 1200, 1100, 8, 2);
  expect(next.map(row => row.id)).toEqual([4, 2]);
  expect(plan(db)).not.toContain('TEMP B-TREE');
});
