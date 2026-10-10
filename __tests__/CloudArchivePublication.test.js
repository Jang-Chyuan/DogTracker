/* eslint-env node, jest */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase, CLOUD_DATABASE_METHODS } from '../src/cloud/CloudDatabase';

const { DatabaseSync } = require('node:module').createRequire(__filename)('node:sqlite');
const owner = 'archive-owner';
const row = event_id => ({ event_id, master_id: 7, slave_id: 6,
  received_at: 100, track_at: 100, slave_lat: 25, slave_lon: 121,
  activity_valid: 0, battery_valid: 0 });
function open(filename) {
  const sqlite = new DatabaseSync(filename);
  const execute = (sql, params = []) => ({ results: sqlite.prepare(sql).all(...params) });
  return { sqlite, executeAsync: async (sql, params) => execute(sql, params),
    executeBatchAsync: async commands => {
      sqlite.exec('BEGIN EXCLUSIVE');
      try { for (const command of commands) execute(command.query, command.params); sqlite.exec('COMMIT'); }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    }, close: () => sqlite.close() };
}
let directory, filename, connection, database;
beforeEach(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dog-archive-proof-'));
  filename = path.join(directory, 'history.sqlite'); connection = open(filename);
  await createDogDatabase(connection).initialize(); database = createCloudDatabase(connection);
  await database.initialize();
});
afterEach(() => { connection.close(); fs.rmSync(directory, { recursive: true, force: true }); });

test('accepted auto archive proof survives closing and reopening SQLite without network or row-count inference', async () => {
  expect(CLOUD_DATABASE_METHODS).toContain('readArchivePublication');
  expect(await database.readArchivePublication(owner)).toBeNull();
  await database.beginDownload(owner, 'auto');
  await database.savePage(owner, [row('accepted')]);
  await database.publishDownload(owner, 'auto', 200);
  connection.close(); connection = open(filename); database = createCloudDatabase(connection);
  expect(await database.readArchivePublication(owner)).toEqual({ owner, cutoff: 200, revision: 1 });
  await database.beginDownload(owner, 'auto');
  await database.publishDownload(owner, 'auto', 300);
  expect(await database.readArchivePublication(owner)).toEqual({ owner, cutoff: 300, revision: 2 });
});

test('manual, legacy, partial staged work and another owner never claim an accepted auto archive', async () => {
  await database.savePage(owner, [row('local-only')]);
  expect(await database.readArchivePublication(owner)).toBeNull();
  await database.beginDownload(owner, 'manual');
  await database.publishDownload(owner, 'manual', 200);
  expect(await database.readArchivePublication(owner)).toBeNull();
  await database.beginDownload(owner, 'auto'); await database.publishDownload(owner);
  expect(await database.readArchivePublication(owner)).toBeNull();
  await database.beginDownload(owner, 'auto'); await database.savePage(owner, [row('unfinished')]);
  connection.close(); connection = open(filename); database = createCloudDatabase(connection);
  expect(await database.readArchivePublication(owner)).toBeNull();
  expect(await database.readArchivePublication('other-owner')).toBeNull();
  await expect(database.readArchivePublication(null)).rejects.toThrow();
});

test('a late transaction failure rolls back the archive proof, rows and prior revision together', async () => {
  await database.beginDownload(owner, 'auto'); await database.publishDownload(owner, 'auto', 200);
  await database.beginDownload(owner, 'auto'); await database.savePage(owner, [row('new')]);
  await connection.executeAsync(`CREATE TRIGGER fail_proof BEFORE INSERT ON cloud_archive_publication
    WHEN NEW.cutoff=300 BEGIN SELECT RAISE(ABORT,'proof refused'); END`);
  await expect(database.publishDownload(owner, 'auto', 300)).rejects.toThrow('proof refused');
  expect(await database.readArchivePublication(owner)).toEqual({ owner, cutoff: 200, revision: 1 });
  expect((await connection.executeAsync('SELECT event_id FROM supabase_dog_status')).results).toEqual([]);
  expect((await connection.executeAsync('SELECT event_id FROM cloud_auto_supabase_dog_status')).results).toEqual([{ event_id: 'new' }]);
  await connection.executeAsync('DROP TRIGGER fail_proof'); await database.publishDownload(owner, 'auto', 300);
  expect(await database.readArchivePublication(owner)).toEqual({ owner, cutoff: 300, revision: 2 });
  expect(await database.readArchivePublication('other-owner')).toBeNull();
});

test('no job and invalid auto cutoff cannot create proof; latest snapshots never advance archive metadata', async () => {
  await database.publishDownload(owner, 'auto', 200);
  expect(await database.readArchivePublication(owner)).toBeNull();
  await database.beginDownload(owner, 'auto');
  for (const cutoff of [NaN, Infinity, -1]) await expect(database.publishDownload(owner, 'auto', cutoff)).rejects.toThrow();
  await database.publishLatestSnapshot(owner, { cutoff: 200, dogs: [] });
  expect(await database.readArchivePublication(owner)).toBeNull();
});

test('manual completion and an abandoned auto job retain only the previous owner proof', async () => {
  await database.beginDownload(owner, 'auto'); await database.publishDownload(owner, 'auto', 200);
  await database.beginDownload(owner, 'manual'); await database.savePage(owner, [row('manual')]);
  await database.publishDownload(owner, 'manual', 400);
  expect(await database.readArchivePublication(owner)).toEqual({ owner, cutoff: 200, revision: 1 });
  await database.beginDownload(owner, 'auto'); await database.savePage(owner, [row('cancelled-page')]);
  // Cancellation never invokes the terminal publish. A replacement owner
  // cannot publish another owner's staged job or inherit its completion proof.
  await database.publishDownload('other-owner', 'auto', 500);
  connection.close(); connection = open(filename); database = createCloudDatabase(connection);
  expect(await database.readArchivePublication(owner)).toEqual({ owner, cutoff: 200, revision: 1 });
  expect(await database.readArchivePublication('other-owner')).toBeNull();
  expect((await connection.executeAsync('SELECT event_id FROM cloud_auto_supabase_dog_status')).results)
    .toEqual([{ event_id: 'cancelled-page' }]);
});

test('owner or generation changing during awaited preparation cannot publish rows or proof', async () => {
  await database.beginDownload(owner, 'auto'); await database.savePage(owner, [row('stale')]);
  let current = true;
  const execute = connection.executeAsync;
  connection.executeAsync = async (sql, params) => {
    const result = await execute(sql, params);
    if (sql.startsWith('SELECT COUNT(*) n FROM cloud_auto_')) current = false;
    return result;
  };
  await expect(database.publishDownload(owner, 'auto', 200, () => current)).rejects.toThrow();
  expect(await database.readArchivePublication(owner)).toBeNull();
  expect((await connection.executeAsync('SELECT event_id FROM supabase_dog_status')).results).toEqual([]);
  expect((await connection.executeAsync('SELECT event_id FROM cloud_auto_supabase_dog_status')).results)
    .toEqual([{ event_id: 'stale' }]);
});
