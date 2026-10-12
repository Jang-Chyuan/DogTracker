import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { createLatestSnapshotDatabase } from '../src/cloud/CloudLatestSnapshot';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const packet = { slave_id: 6, master_id: 7, event_id: 'invented-current', received_at: 1000,
  track_at: 1000, slave_lat: 25, slave_lon: 121 };
const snapshot = { cutoff: 2000, masterIds: [7], dogs: [{ slaveId: 6, packet, fix: packet }] };
let connection;
beforeEach(() => { connection = createMemoryConnection(); });
afterEach(() => { connection.close(); });

test('real latest publish and empty read use only their two tables without archive initialization', async () => {
  const database = createCloudDatabase(connection);
  await database.initializeLatest();
  await database.publishLatestSnapshot('a', snapshot);
  expect(await database.readLatestSnapshot('a', { positionsOnly: true })).toMatchObject({ verified: true, revision: 1, packets: [expect.objectContaining(packet)] });
  expect(await database.readLatestSnapshot('b', { positionsOnly: true })).toBeNull();
  await database.publishLatestSnapshot('a', { cutoff: 3000, masterIds: [7], dogs: [] });
  expect(await database.readLatestSnapshot('a', { bootstrap: false })).toMatchObject({ verified: true, rows: [], packets: [] });
  expect(connection.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row => row.name))
    .toEqual(['cloud_latest_snapshot', 'cloud_snapshot_state']);
});

test('failed latest schema remains retryable and concurrent latest reads await real schema readiness', async () => {
  const held = deferred(), entered = deferred();
  const execute = connection.executeAsync.getMockImplementation(); let first = true;
  connection.executeAsync.mockImplementation(async (sql, params) => {
    if (first && sql.includes('CREATE TABLE IF NOT EXISTS cloud_latest_snapshot')) {
      first = false; entered.resolve(); await held.promise; throw new Error('invented DDL failure');
    }
    return execute(sql, params);
  });
  const database = createCloudDatabase(connection);
  const a = database.initializeLatest(), b = database.readLatestSnapshot('a', { positionsOnly: true });
  const settled = Promise.allSettled([a, b]);
  await entered.promise;
  expect(connection.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='cloud_snapshot_state'").all()).toEqual([]);
  held.resolve(); expect((await settled).map(value => value.status)).toEqual(['rejected', 'rejected']);
  expect(await database.readLatestSnapshot('a', { positionsOnly: true })).toBeNull();
});

test('offline bootstrap waits outside the snapshot lock and cannot overwrite a remote snapshot that won', async () => {
  const held = deferred(), entered = deferred(), bootstrap = jest.fn(async () => ({ packets: [], fixes: [] }));
  const database = createLatestSnapshotDatabase(connection, async () => {}, bootstrap, async () => { entered.resolve(); await held.promise; });
  const fallback = database.readLatestSnapshot('a'); await entered.promise;
  await database.publishLatestSnapshot('a', snapshot);
  held.resolve();
  expect(await fallback).toMatchObject({ verified: true, revision: 1, packets: [expect.objectContaining(packet)] });
  expect(bootstrap).not.toHaveBeenCalled();
});

test('a cancelled offline bootstrap does not install a stale owner cache', async () => {
  const held = deferred(), entered = deferred(); let current = true;
  const database = createLatestSnapshotDatabase(connection, async () => {}, async () => {
    entered.resolve(); await held.promise; return { packets: [packet], fixes: [packet] };
  });
  const fallback = database.readLatestSnapshot('a', { isCurrent: () => current }); await entered.promise;
  current = false; held.resolve();
  expect(await fallback).toBeNull();
  expect(connection.sqlite.prepare('SELECT * FROM cloud_snapshot_state').all()).toEqual([]);
});


test('schema single-flight is per wrapper and a replacement sharing its native lock is initialized again', async () => {
  const first = createCloudDatabase(connection), same = createCloudDatabase(connection);
  await Promise.all([first.initializeLatest(), same.initializeLatest()]);
  expect(connection.executeAsync.mock.calls.filter(([sql]) => sql.includes('CREATE TABLE IF NOT EXISTS cloud_latest_snapshot'))).toHaveLength(1);
  const replacement = createMemoryConnection(), lockKey = {};
  connection.lockKey = lockKey; replacement.lockKey = lockKey;
  try {
    expect(await createCloudDatabase(replacement).readLatestSnapshot('a', { positionsOnly: true })).toBeNull();
    expect(replacement.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).toHaveLength(2);
  } finally { replacement.close(); }
});
