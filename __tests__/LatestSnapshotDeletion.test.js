import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { createDogDataStore, UnsentRowsError } from '../src/database/DogDataStore';
import { t } from '../src/i18n';
import { withCloudSyncSlot } from '../src/cloud/CloudSyncSlot';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const packet = { slave_id: 6, master_id: 7, event_id: 'invented-current', received_at: 1000,
  track_at: 1000, slave_lat: 25, slave_lon: 121 };
const snapshot = { cutoff: 2000, masterIds: [7], dogs: [{ slaveId: 6, packet, fix: packet }] };
let archive, latest, database;
beforeEach(async () => {
  archive = createMemoryConnection(); latest = createMemoryConnection(); await createDogDatabase(archive).initialize();
  database = createCloudDatabase(archive, { latestConnection: latest });
  await database.publishLatestSnapshot('a', snapshot);
});
afterEach(() => { archive.close(); latest.close(); });
const marker = () => latest.sqlite.prepare('SELECT epoch,deletion_pending FROM cloud_latest_lifecycle WHERE id=1').get();
const reopen = () => createCloudDatabase(archive, { latestConnection: {
  executeAsync: latest.executeAsync, executeBatchAsync: latest.executeBatchAsync,
  // A fresh lifecycle registry simulates a new JS runtime reading this durable
  // SQLite file. Tests must not infer pending state from old wrapper memory.
  lockKey: {},
} });

test('all-account latest cache and dog archive clear, while phone history/names/settings remain', async () => {
  await database.publishLatestSnapshot('b', { cutoff: 3000, dogs: [] });
  archive.sqlite.exec(`INSERT INTO dog_status(received_at,slave_id) VALUES(1000,6);
    INSERT INTO supabase_dog_status(received_at,slave_id) VALUES(1000,6);
    CREATE TABLE myLocationTracker(id INTEGER); INSERT INTO myLocationTracker VALUES(7);
    CREATE TABLE map_history_settings(name TEXT); INSERT INTO map_history_settings VALUES('invented-dog');
    CREATE TABLE app_settings(key TEXT,value TEXT); INSERT INTO app_settings VALUES('recording','on')`);
  const beforeDelete = jest.fn();
  await createDogDataStore(archive, database).deleteAll({ beforeDelete });
  expect(beforeDelete).toHaveBeenCalledTimes(1); expect(marker()).toMatchObject({ epoch: 1, deletion_pending: 0 });
  expect(await database.readLatestSnapshot('a', { positionsOnly: true })).toBeNull();
  expect(await database.readLatestSnapshot('b', { positionsOnly: true })).toBeNull();
  expect(archive.sqlite.prepare('SELECT * FROM dog_status').all()).toEqual([]);
  expect(archive.sqlite.prepare('SELECT * FROM supabase_dog_status').all()).toEqual([]);
  expect(archive.sqlite.prepare('SELECT * FROM myLocationTracker').all()).toEqual([{ id: 7 }]);
  expect(archive.sqlite.prepare('SELECT * FROM map_history_settings').all()).toEqual([{ name: 'invented-dog' }]);
  expect(archive.sqlite.prepare('SELECT * FROM app_settings').all()).toEqual([{ key: 'recording', value: 'on' }]);
});

test('a long archive clear stays pending and fences new writers/readers; it does not report cross-file atomic completion early', async () => {
  const held = deferred(), entered = deferred(); let complete = false;
  const deletion = database.clearLatestAndRun(async () => { entered.resolve(); await held.promise; }).then(() => { complete = true; });
  await entered.promise;
  try {
    expect(complete).toBe(false); expect(marker()).toMatchObject({ epoch: 1, deletion_pending: 1 });
    await expect(database.readLatestSnapshot('a', { positionsOnly: true })).rejects.toThrow(t('c1275'));
    await expect(database.publishLatestSnapshot('a', snapshot)).rejects.toThrow(t('c1275'));
    held.resolve(); await deletion;
    expect(complete).toBe(true); expect(marker().deletion_pending).toBe(0);
    await database.publishLatestSnapshot('a', snapshot);
    expect(await database.readLatestSnapshot('a', { positionsOnly: true })).toMatchObject({ verified: true, revision: 1 });
  } finally { held.resolve(); await deletion; }
});

test('archive failure leaves durable pending state that a fresh runtime reads before any offline bootstrap or remote write', async () => {
  const failure = new Error('invented archive failure');
  await expect(database.clearLatestAndRun(async () => { throw failure; })).rejects.toBe(failure);
  expect(marker()).toMatchObject({ epoch: 1, deletion_pending: 1 });
  const replacement = reopen();
  await expect(replacement.readLatestSnapshot('a')).rejects.toThrow(t('c1275'));
  await expect(replacement.publishLatestSnapshot('a', snapshot)).rejects.toThrow(t('c1275'));
  expect(archive.executeAsync.mock.calls.some(([sql]) => sql.startsWith('SELECT slave_id, master_id'))).toBe(false);
  await replacement.clearLatestAndRun(async () => {});
  expect(marker()).toMatchObject({ epoch: 2, deletion_pending: 0 });
  await replacement.publishLatestSnapshot('a', snapshot);
  expect(await replacement.readLatestSnapshot('a', { positionsOnly: true })).toMatchObject({ verified: true });
});

test('fresh runtime after successful deletion can use the persisted epoch without a spurious failed first download', async () => {
  await database.clearLatestAndRun(async () => {}); const replacement = reopen();
  await replacement.publishLatestSnapshot('a', snapshot);
  expect(await replacement.readLatestSnapshot('a', { positionsOnly: true })).toMatchObject({ verified: true, revision: 1 });
});

test('already begun latest native commit drains, then deletion wins and late producer cannot claim its readback', async () => {
  const entered = deferred(), held = deferred(), original = latest.executeBatchAsync.getMockImplementation(); let once = true;
  latest.executeBatchAsync.mockImplementation(async commands => {
    if (once && commands.some(command => command.query.startsWith('INSERT OR REPLACE INTO cloud_snapshot_state'))) {
      once = false; latest.sqlite.exec('BEGIN EXCLUSIVE TRANSACTION'); entered.resolve(); await held.promise;
      for (const command of commands) latest.sqlite.prepare(command.query).all(...command.params);
      latest.sqlite.exec('COMMIT');
    } else return original(commands);
  });
  const writing = database.publishLatestSnapshot('a', { ...snapshot, cutoff: 4000 });
  const outcome = writing.then(() => 'unexpected success', error => error);
  await entered.promise;
  const deletion = database.clearLatestAndRun(async () => {});
  held.resolve(); expect(await outcome).toBeInstanceOf(Error); await deletion;
  expect(await database.readLatestSnapshot('a', { positionsOnly: true })).toBeNull();
  expect(marker()).toMatchObject({ epoch: 1, deletion_pending: 0 });
});

test('unsent refusal performs no latest fence, deletion, or caller invalidation', async () => {
  archive.sqlite.exec("CREATE TABLE ble_upload_queue(status TEXT); INSERT INTO ble_upload_queue VALUES('pending')");
  const beforeDelete = jest.fn();
  await expect(createDogDataStore(archive, database).deleteAll({ beforeDelete })).rejects.toBeInstanceOf(UnsentRowsError);
  expect(beforeDelete).not.toHaveBeenCalled(); expect(marker()).toMatchObject({ epoch: 0, deletion_pending: 0 });
  expect(await database.readLatestSnapshot('a', { positionsOnly: true })).toMatchObject({ verified: true, revision: 1 });
});


test('deletion discards unpublished auto/manual pages and proof, preserves sync progress and advances material revision', async () => {
  await database.initialize();
  const row = event_id => ({ ...packet, event_id, activity_valid: 0, battery_valid: 0 });
  await database.beginDownload('a', 'auto'); await database.savePage('a', [row('accepted')]);
  await database.publishDownload('a', 'auto', 2000);
  await database.beginDownload('a', 'auto'); await database.savePage('a', [row('unfinished-auto')]);
  await database.beginDownload('b', 'manual'); await database.savePage('b', [row('unfinished-manual')]);
  archive.sqlite.exec("INSERT INTO cloud_sync_state(owner_user_id,master_id,through_at,updated_at) VALUES('a',7,'2026-10-07T00:00:00Z',1000)");
  const revision = archive.sqlite.prepare('SELECT revision FROM cloud_history_material').get().revision;
  expect(await database.readArchivePublication('a')).toMatchObject({ cutoff: 2000 });
  await createDogDataStore(archive, database).deleteAll();
  for (const table of ['supabase_dog_status', 'cloud_auto_supabase_dog_status',
    'cloud_manual_supabase_dog_status', 'cloud_download_jobs', 'cloud_archive_publication'])
    expect(archive.sqlite.prepare(`SELECT * FROM ${table}`).all()).toEqual([]);
  expect(archive.sqlite.prepare('SELECT owner_user_id,master_id FROM cloud_sync_state').all())
    .toEqual([{ owner_user_id: 'a', master_id: 7 }]);
  expect(archive.sqlite.prepare('SELECT revision FROM cloud_history_material').get().revision).toBe(revision + 1);
  // An old job can no longer commit deleted staged records or its cutoff.
  await database.publishDownload('a', 'auto', 4000); await database.publishDownload('b', 'manual');
  expect(await database.readArchivePublication('a')).toBeNull();
  expect(archive.sqlite.prepare('SELECT * FROM supabase_dog_status').all()).toEqual([]);
});


test('schemas created by an earlier draining archive job are discovered inside the deletion slot', async () => {
  const entered = deferred(), held = deferred(), fenced = deferred();
  const oldArchive = withCloudSyncSlot(async () => {
    entered.resolve(); await held.promise;
    archive.sqlite.exec(`CREATE TABLE cloud_download_jobs(owner TEXT,kind TEXT,scope TEXT);
      INSERT INTO cloud_download_jobs VALUES('a','auto','old');
      CREATE TABLE cloud_auto_supabase_dog_status(id INTEGER);
      INSERT INTO cloud_auto_supabase_dog_status VALUES(1);
      CREATE TABLE cloud_archive_publication(owner TEXT,cutoff INTEGER,revision INTEGER);
      INSERT INTO cloud_archive_publication VALUES('a',1000,1)`);
  });
  await entered.promise;
  const deletion = createDogDataStore(archive, database).deleteAll({ beforeDelete: () => fenced.resolve() });
  try {
    await fenced.promise; held.resolve(); await oldArchive; await deletion;
    for (const table of ['cloud_download_jobs','cloud_auto_supabase_dog_status','cloud_archive_publication'])
      expect(archive.sqlite.prepare(`SELECT * FROM ${table}`).all()).toEqual([]);
    expect(marker()).toMatchObject({ epoch: 1, deletion_pending: 0 });
  } finally { held.resolve(); await oldArchive; await deletion; }
});
