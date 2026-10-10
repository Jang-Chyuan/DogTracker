import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase, CLOUD_DATABASE_METHODS } from '../src/cloud/CloudDatabase';

const fix = (id, slave = 4, time = 1000) => ({ event_id: id, slave_id: slave, master_id: 7,
  received_at: time, track_at: time, slave_lat: 25, slave_lon: 121, usb_present: null, activity_valid: 0, battery_valid: 0 });
const snapshot = (dogs, cutoff = 2000) => ({ cutoff, dogs });
let connection, database;
beforeEach(async () => {
  connection = createMemoryConnection(); await createDogDatabase(connection).initialize();
  database = createCloudDatabase(connection); await database.initialize();
});
afterEach(() => connection.close());

test('map snapshot keeps packet and last fix separate without advancing history or its seek cursor', async () => {
  const old = fix('fix');
  const packet = { ...fix('packet', 4, 1500), slave_lat: 0, slave_lon: 0, battery_percentage: 55 };
  await database.publishLatestSnapshot('a', snapshot([{ slaveId: 4, packet, fix: old }]));
  const read = await database.readLatestSnapshot('a');
  expect(read).toMatchObject({ revision: 1, cutoff: 2000, rows: [expect.objectContaining({ event_id: 'fix', track_at: 1000 })],
    packets: [expect.objectContaining({ event_id: 'packet', battery_percentage: 55, environment: null })] });
  expect(await database.count('a')).toBe(0);
  expect(await database.loadSyncState('a', 7)).toBeNull();
  expect(await database.readLatestSnapshot('b')).toMatchObject({ verified: false, rows: [] });
  expect(CLOUD_DATABASE_METHODS).toEqual(expect.arrayContaining(['readLatestSnapshot', 'publishLatestSnapshot']));
});

test('archive publication, metadata repair and retention cannot move the map snapshot', async () => {
  await database.publishLatestSnapshot('a', snapshot([{ slaveId: 4, packet: fix('current'), fix: fix('current') }]));
  const before = await database.readLatestSnapshot('a');
  await database.beginDownload('a');
  await database.savePage('a', [fix('archive-new', 4, 1800)], { masterId: 7, throughAt: '2026-10-10T00:00:00Z' });
  await database.publishDownload('a');
  expect(await database.readLatestSnapshot('a')).toEqual(before);
});

test('one atomic full replacement removes inaccessible dogs and survives reopen, including complete-empty', async () => {
  await database.publishLatestSnapshot('a', snapshot([4, 6].map(slaveId => ({ slaveId, packet: fix(`p${slaveId}`, slaveId), fix: fix(`p${slaveId}`, slaveId) }))));
  await database.publishLatestSnapshot('b', snapshot([{ slaveId: 8, packet: fix('b', 8), fix: null }]));
  await database.publishLatestSnapshot('a', snapshot([{ slaveId: 6, packet: fix('p6', 6), fix: fix('p6', 6) }], 3000));
  database = createCloudDatabase(connection); await database.initialize();
  expect((await database.readLatestSnapshot('a')).rows.map(row => row.slave_id)).toEqual([6]);
  await database.publishLatestSnapshot('a', snapshot([], 4000));
  expect(await database.readLatestSnapshot('a')).toEqual({ revision: 3, cutoff: 4000, verified: true, rows: [], packets: [], context: [], seeds: [] });
  expect((await database.readLatestSnapshot('b')).packets.map(row => row.slave_id)).toEqual([8]);
});

test('invalid or stale generation snapshots retain the entire last committed value', async () => {
  await database.publishLatestSnapshot('a', snapshot([{ slaveId: 4, packet: fix('ok'), fix: fix('ok') }]));
  const before = await database.readLatestSnapshot('a');
  await expect(database.publishLatestSnapshot('a', snapshot([
    { slaveId: 4, packet: fix('new'), fix: fix('new') },
    { slaveId: 6, packet: fix('bad', 6), fix: { ...fix('bad', 6), slave_lat: 91 } },
  ]))).rejects.toThrow();
  await expect(database.publishLatestSnapshot('a', snapshot([]), () => false)).rejects.toThrow();
  expect(await database.readLatestSnapshot('a')).toEqual(before);
});


test('upgrade bootstraps the published cache only once, without fresh success or archive completeness', async () => {
  await database.savePage('a', [fix('cached', 4, 1000)]);
  const first = await database.readLatestSnapshot('a');
  expect(first).toMatchObject({ verified: false, revision: 0, cutoff: 1000, rows: [expect.objectContaining({ event_id: 'cached' })] });
  await database.savePage('a', [fix('new-archive', 6, 2000)]);
  expect(await database.readLatestSnapshot('a')).toEqual(first);
  expect(await database.loadSyncState('a', 7)).toBeNull();
  expect(await database.historyDownloadStates('a', [4, 6])).toEqual([]);
  await database.publishLatestSnapshot('a', snapshot([], 3000));
  expect(await database.readLatestSnapshot('a')).toMatchObject({ verified: true, rows: [], packets: [] });
});

test('context must be validated normalized events of the same dog and account', async () => {
  for (const context of [[fix('different-dog', 6)], [{ ...fix('different-owner'), owner_user_id: 'b' }], [{ slave_id: 4 }]]) {
    await expect(database.publishLatestSnapshot('a', snapshot([{ slaveId: 4, packet: fix('ok'), fix: fix('ok'), context }]))).rejects.toThrow();
  }
  await expect(database.publishLatestSnapshot('a', { ...snapshot([{ slaveId: 4, packet: fix('ok'), fix: fix('ok'), context: [{ ...fix('wrong-master'), master_id: 9 }] }]), masterIds: [7] })).rejects.toThrow();
  await expect(database.publishLatestSnapshot('a', snapshot([{ slaveId: 4, packet: { ...fix('wrong-owner'), owner_user_id: 'b' }, fix: null }]))).rejects.toThrow();
});

test('latest refresh and failed context retain known context; a complete context replaces it atomically', async () => {
  const known = [fix('known-house')], seeds = [fix('seed', 4, 500)];
  await database.publishLatestSnapshot('a', snapshot([{ slaveId: 4, packet: fix('old'), fix: fix('old'), context: known, seeds }]));
  await database.publishLatestSnapshot('a', snapshot([{ slaveId: 4, packet: fix('new'), fix: fix('new') }]));
  expect(await database.readLatestSnapshot('a')).toMatchObject({ context: known, seeds });
  await database.publishLatestSnapshot('a', snapshot([{ slaveId: 4, packet: fix('new'), fix: fix('new'), context: [], seeds: [] }]));
  expect(await database.readLatestSnapshot('a')).toMatchObject({ context: [], seeds: [] });
});
