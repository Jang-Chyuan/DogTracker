import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { bleDisplayRows } from '../src/ble/BleDisplayCoordinates';

const deferred = () => {
  let resolve;
  const promise = new Promise(value => { resolve = value; });
  return { promise, resolve };
};
const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
const read = db => db.sqlite.prepare('SELECT * FROM dog_status ORDER BY received_at,id').all();
const insert = (db, time, latitude) => db.sqlite.prepare(`INSERT INTO dog_status
  (received_at,master_id,slave_id,slave_lat,slave_lon,speed_kmh,raw_payload)
  VALUES (?,7,6,?,121,0,'invented')`).run(time, latitude);
const schemaQuery = query => /^(PRAGMA table_info\(dog_status\)|ALTER TABLE dog_status|CREATE INDEX IF NOT EXISTS idx_ble_display_stream|CREATE TRIGGER IF NOT EXISTS invalidate_ble_display)/.test(query);

test('a warm display read does not queue archive proof behind repeated schema work', async () => {
  const db = createMemoryConnection(), held = deferred();
  let display, proof;
  try {
    await createDogDatabase(db).initialize();
    const cloud = createCloudDatabase(db);
    await cloud.initialize();
    db.sqlite.exec("INSERT INTO cloud_archive_publication VALUES('invented-owner',9000,2)");
    insert(db, 1000, 25); insert(db, 2000, 25.003); insert(db, 3000, 25.006);
    await bleDisplayRows(db, read(db));
    const page = read(db), execute = db.executeAsync.getMockImplementation();
    db.executeAsync.mockImplementation(async (query, params) => {
      if (schemaQuery(query)) await held.promise;
      return execute(query, params);
    });
    display = bleDisplayRows(db, page);
    let accepted = null;
    proof = cloud.readArchivePublication('invented-owner').then(value => { accepted = value; });
    await flush();
    expect(accepted).toEqual({ owner: 'invented-owner', cutoff: 9000, revision: 2 });
    expect(await display).toEqual(page);
  } finally {
    held.resolve();
    await Promise.allSettled([display, proof]);
    db.close();
  }
});

test('an unsuccessful schema setup is retried; partial setup does not release a display result', async () => {
  const db = createMemoryConnection();
  try {
    await createDogDatabase(db).initialize(); insert(db, 1000, 25);
    const execute = db.executeAsync.getMockImplementation();
    let fail = true;
    db.executeAsync.mockImplementation(async (query, params) => {
      if (fail && query.startsWith('CREATE TRIGGER IF NOT EXISTS invalidate_ble_display')) {
        fail = false; throw new Error('synthetic setup failure');
      }
      return execute(query, params);
    });
    await expect(bleDisplayRows(db, read(db))).rejects.toThrow('synthetic setup failure');
    expect(read(db)[0].display_version).toBeNull();
    await expect(bleDisplayRows(db, read(db))).resolves.toHaveLength(1);
    expect(db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all())
      .toContainEqual({ name: 'invalidate_ble_display_after_insert' });
    insert(db, 500, 25.002);
    expect(read(db)[1].display_version).toBeNull();
  } finally { db.close(); }
});

test('cached schema retains the context/write lock until uncached display work has finished', async () => {
  const db = createMemoryConnection(), held = deferred();
  let display, proof;
  try {
    await createDogDatabase(db).initialize();
    const cloud = createCloudDatabase(db); await cloud.initialize();
    db.sqlite.exec("INSERT INTO cloud_archive_publication VALUES('invented-owner',9000,2)");
    insert(db, 1000, 25); await bleDisplayRows(db, read(db));
    insert(db, 2000, 25.003);
    const execute = db.executeAsync.getMockImplementation();
    db.executeAsync.mockImplementation(async (query, params) => {
      if (query.includes('UNION ALL')) await held.promise;
      return execute(query, params);
    });
    display = bleDisplayRows(db, read(db));
    let accepted = false;
    proof = cloud.readArchivePublication('invented-owner').then(() => { accepted = true; });
    await flush(); expect(accepted).toBe(false);
    held.resolve(); await display; await proof;
    expect(accepted).toBe(true);
    expect(read(db).every(row => row.display_version === 1)).toBe(true);
  } finally { held.resolve(); await Promise.allSettled([display, proof]); db.close(); }
});

test('a persist failure retries the write without rerunning an already successful schema setup', async () => {
  const db = createMemoryConnection();
  try {
    await createDogDatabase(db).initialize(); insert(db, 1000, 25);
    const batch = db.executeBatchAsync.getMockImplementation();
    db.executeBatchAsync.mockImplementationOnce(async () => { throw new Error('synthetic write failure'); });
    await expect(bleDisplayRows(db, read(db))).rejects.toThrow('synthetic write failure');
    expect(read(db)[0].display_version).toBeNull();
    db.executeAsync.mockClear(); db.executeBatchAsync.mockImplementation(batch);
    await expect(bleDisplayRows(db, read(db))).resolves.toEqual([
      expect.objectContaining({ display_latitude: 25, display_version: 1, raw_payload: 'invented' }),
    ]);
    expect(db.executeAsync.mock.calls.filter(([query]) => schemaQuery(query))).toEqual([]);
    expect(read(db)[0]).toMatchObject({ slave_lat: 25, raw_payload: 'invented', display_version: 1 });
  } finally { db.close(); }
});

test('schema readiness belongs to the connection, not a shared lock or old wrapper', async () => {
  const first = createMemoryConnection(), second = createMemoryConnection();
  const key = {};
  first.lockKey = key; second.lockKey = key;
  try {
    await createDogDatabase(first).initialize(); await createDogDatabase(second).initialize();
    insert(first, 1000, 25); insert(second, 1000, 26);
    await bleDisplayRows(first, read(first));
    const result = await bleDisplayRows(second, read(second));
    expect(result[0]).toMatchObject({ display_latitude: 26, display_version: 1 });
    expect(second.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all())
      .toContainEqual({ name: 'invalidate_ble_display_after_insert' });
  } finally { first.close(); second.close(); }
});

test('warm late-insert smoothing preserves raw payload and matches a fresh connection', async () => {
  const warm = createMemoryConnection(), fresh = createMemoryConnection();
  try {
    for (const db of [warm, fresh]) {
      await createDogDatabase(db).initialize();
      insert(db, 1000, 25); insert(db, 3000, 25.006); insert(db, 4000, 25.009);
    }
    await bleDisplayRows(warm, read(warm));
    for (const db of [warm, fresh]) insert(db, 2000, 25.003);
    const output = await bleDisplayRows(warm, read(warm));
    expect(output).toEqual(await bleDisplayRows(fresh, read(fresh)));
    expect(read(warm).map(({ slave_lat, raw_payload }) => ({ slave_lat, raw_payload })))
      .toEqual(read(fresh).map(({ slave_lat, raw_payload }) => ({ slave_lat, raw_payload })));
  } finally { warm.close(); fresh.close(); }
});
