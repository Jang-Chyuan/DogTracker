import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { createLatestSnapshotDatabase } from '../src/cloud/CloudLatestSnapshot';
import { withConnectionLock } from '../src/database/connectionLock';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const packet = { slave_id: 6, master_id: 7, event_id: 'invented-current', received_at: 1000,
  track_at: 1000, slave_lat: 25, slave_lon: 121 };
const snapshot = { cutoff: 2000, masterIds: [7], dogs: [{ slaveId: 6, packet, fix: packet }] };
let archive, latest;
beforeEach(() => { archive = createMemoryConnection(); latest = createMemoryConnection(); });
afterEach(() => { archive.close(); latest.close(); });

test('independent real SQLite latest schema and verified packet readback complete while archive native transaction remains held', async () => {
  await createDogDatabase(archive).initialize();
  const database = createCloudDatabase(archive, { latestConnection: latest });
  const held = deferred(), entered = deferred();
  const draining = withConnectionLock(archive, async () => {
    archive.sqlite.exec('BEGIN EXCLUSIVE TRANSACTION'); entered.resolve();
    await held.promise; archive.sqlite.exec('ROLLBACK');
  });
  await entered.promise;
  try {
    await database.initializeLatest(); await database.publishLatestSnapshot('a', snapshot);
    expect(await database.readLatestSnapshot('a', { positionsOnly: true })).toMatchObject({ verified: true, revision: 1,
      packets: [expect.objectContaining(packet)], rows: [expect.objectContaining(packet)] });
    expect(archive.sqlite.isTransaction).toBe(true);
    expect(latest.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row => row.name))
      .toEqual(['cloud_latest_lifecycle', 'cloud_latest_snapshot', 'cloud_snapshot_state']);
    expect(archive.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='cloud_latest_snapshot'").all()).toEqual([]);
  } finally { held.resolve(); await draining; }
});

test('same native lock with a different JS wrapper is rejected instead of claiming isolation', () => {
  const lockKey = {}; archive.lockKey = lockKey; latest.lockKey = lockKey;
  expect(() => createCloudDatabase(archive, { latestConnection: latest })).toThrow('independent native lock');
});

test('offline bootstrap held during actual archive cache read does not block or overwrite newer durable remote snapshot', async () => {
  const held = deferred(), entered = deferred(), bootstrap = jest.fn(() => withConnectionLock(archive, async () => {
    archive.sqlite.exec('BEGIN EXCLUSIVE TRANSACTION'); entered.resolve(); await held.promise;
    archive.sqlite.exec('ROLLBACK'); return { packets: [], fixes: [] };
  }));
  const database = createLatestSnapshotDatabase(latest, async () => {}, bootstrap);
  const fallback = database.readLatestSnapshot('a'); await entered.promise;
  try {
    await database.publishLatestSnapshot('a', snapshot);
    expect(await database.readLatestSnapshot('a', { positionsOnly: true })).toMatchObject({ verified: true, revision: 1 });
    expect(archive.sqlite.isTransaction).toBe(true);
    held.resolve();
    expect(await fallback).toMatchObject({ verified: true, revision: 1, packets: [expect.objectContaining(packet)] });
    expect(bootstrap).toHaveBeenCalledTimes(1);
  } finally { held.resolve(); await fallback; }
});

test('failed native commit rolls back the whole separate latest set and never certifies an empty or partial snapshot', async () => {
  const database = createCloudDatabase(archive, { latestConnection: latest });
  await database.publishLatestSnapshot('a', snapshot);
  latest.sqlite.exec("CREATE TRIGGER reject_snapshot BEFORE INSERT ON cloud_snapshot_state WHEN NEW.cutoff=3000 BEGIN SELECT RAISE(ABORT, 'invented fail'); END");
  await expect(database.publishLatestSnapshot('a', { cutoff: 3000, dogs: [] })).rejects.toThrow('invented fail');
  expect(await database.readLatestSnapshot('a', { positionsOnly: true })).toMatchObject({ verified: true, revision: 1,
    packets: [expect.objectContaining(packet)] });
});

test('account replacement fences late bootstrap and cached owners remain partitioned in the new file', async () => {
  const held = deferred(), entered = deferred(); let current = true;
  const database = createLatestSnapshotDatabase(latest, async () => {}, async () => {
    entered.resolve(); await held.promise; return { packets: [packet], fixes: [packet] };
  });
  const fallback = database.readLatestSnapshot('old-account', { isCurrent: () => current }); await entered.promise;
  current = false;
  await database.publishLatestSnapshot('new-account', { cutoff: 3000, dogs: [] });
  held.resolve(); expect(await fallback).toBeNull();
  expect(await database.readLatestSnapshot('new-account', { positionsOnly: true })).toMatchObject({ verified: true,
    packets: [], rows: [], cutoff: 3000, revision: 1 });
  expect(await database.readLatestSnapshot('old-account', { positionsOnly: true })).toBeNull();
});

test('successful empty authorized remote set prevents held old cache from resurrecting a revoked dog', async () => {
  const held = deferred(), entered = deferred();
  const database = createLatestSnapshotDatabase(latest, async () => {}, async () => {
    entered.resolve(); await held.promise; return { packets: [packet], fixes: [packet] };
  });
  const fallback = database.readLatestSnapshot('a'); await entered.promise;
  await database.publishLatestSnapshot('a', { cutoff: 3000, masterIds: [], dogs: [] });
  held.resolve();
  expect(await fallback).toMatchObject({ verified: true, packets: [], rows: [], revision: 1, cutoff: 3000 });
  expect(latest.sqlite.prepare('SELECT * FROM cloud_latest_snapshot').all()).toEqual([]);
});
