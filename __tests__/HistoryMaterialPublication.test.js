import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';

const row = (id, time = 1000) => ({ event_id: id, master_id: 7, slave_id: 6,
  received_at: time, track_at: time, track_time_version: 1, activity_valid: 0, battery_valid: 0, slave_lat: 25, slave_lon: 121 });
let connection, db;
beforeEach(async () => {
  connection = createMemoryConnection();
  await createDogDatabase(connection).initialize();
  db = createCloudDatabase(connection, { maxRows: 3 });
  await db.initialize();
});
afterEach(() => connection.close());
const publish = async records => {
  await db.beginDownload('fictional');
  await db.savePage('fictional', records);
  return db.publishDownload('fictional', 'auto', 9999);
};
test('real TX distinguishes inserted history from duplicate pages and cursor-only churn', async () => {
  const first = await publish([row('a')]);
  expect(first).toEqual({ materialChanged: true, dataRevision: expect.any(Number) });
  await db.beginDownload('fictional');
  await db.savePage('fictional', [row('a')], { masterId: 7, throughAt: '2026-01-01T00:00:00Z' });
  expect(await db.publishDownload('fictional', 'auto', 10000)).toEqual({ materialChanged: false, dataRevision: first.dataRevision });
  expect((await db.readArchivePublication('fictional')).cutoff).toBe(10000);
});
test('manual complete-empty changes proof without claiming history data changed', async () => {
  const first = await publish([row('a')]);
  await db.beginManualScope('fictional', 6, '1970-01-02');
  await db.setHistoryDownloadState('fictional', 6, '1970-01-02', true);
  expect(await db.publishManualScope('fictional', 6, '1970-01-02')).toEqual({ materialChanged: false, dataRevision: first.dataRevision });
  expect((await db.historyDownloadStates('fictional', [6]))[0].complete).toBe(1);
});
test('retention and direct repair cannot be hidden behind an empty staged publication', async () => {
  const first = await publish([row('a'), row('b', 2000), row('c', 3000)]);
  await db.savePage('fictional', [row('d', 4000)]);
  await db.beginDownload('fictional');
  const trimmed = await db.publishDownload('fictional');
  expect(trimmed.dataRevision).toBeGreaterThan(first.dataRevision);
  expect(await db.count('fictional')).toBe(3);
  await db.setHistoryDownloadState('fictional', 6, '1970-01-01', true, { range_start: 0, range_end: 5000, received_before: 5000 });
  await db.repairTrackTimes('fictional', [{ event_id: 'b', received_at: '1970-01-02T00:00:00Z' }], ['b']);
  const repaired = await publish([]);
  expect(repaired.dataRevision).toBeGreaterThan(trimmed.dataRevision);
  expect((await db.historyDownloadStates('fictional', [6]))[0].complete).toBe(0);
});
test('native transaction rollback preserves both material token and old rows', async () => {
  const first = await publish([row('a')]);
  await db.beginDownload('fictional'); await db.savePage('fictional', [row('b', 2000)]);
  await connection.executeAsync("CREATE TRIGGER reject_row BEFORE INSERT ON supabase_dog_status WHEN NEW.event_id='b' BEGIN SELECT RAISE(ABORT,'disk refused'); END");
  await expect(db.publishDownload('fictional')).rejects.toThrow('disk refused');
  expect((await connection.executeAsync('SELECT revision FROM cloud_history_material')).results[0].revision).toBe(first.dataRevision);
  expect(await db.count('fictional')).toBe(1);
  await connection.executeAsync('DROP TRIGGER reject_row');
  expect(await db.publishDownload('fictional')).toEqual({ dataRevision: first.dataRevision + 1, materialChanged: true });
});
test('staged metadata time move invalidates both day proofs and advances material token atomically', async () => {
  const first = await publish([row('a')]);
  for (const [day, start, end] of [['1970-01-01', 0, 86400000], ['1970-01-02', 86400000, 172800000]])
    await db.setHistoryDownloadState('fictional', 6, day, true, { range_start: start, range_end: end, received_before: 172800000 });
  await db.beginDownload('fictional');
  await db.repairTrackTimes('fictional', [{ event_id: 'a', received_at: '1970-01-02T00:00:01Z' }], ['a']);
  expect((await connection.executeAsync('SELECT revision FROM cloud_history_material')).results[0].revision).toBe(first.dataRevision);
  expect((await db.historyDownloadStates('fictional', [6])).map(s => s.complete)).toEqual([1, 1]);
  expect(await db.publishDownload('fictional')).toEqual({ dataRevision: first.dataRevision + 1, materialChanged: true });
  expect((await db.historyDownloadStates('fictional', [6])).map(s => s.complete)).toEqual([0, 0]);
});
test('unchanged publish retains cloud hold cursor; direct retention forces it to rebuild', async () => {
  await publish([row('a'), row('b', 2000), row('c', 3000)]);
  const before = await db.holdRows('fictional', 0);
  await publish([row('c', 3000)]);
  const same = await db.holdRows('fictional', 0, before.cursors);
  expect(same.cursors.repairs).toBe(before.cursors.repairs);
  expect(same.reset).toBe(false);
  await db.savePage('fictional', [row('d', 4000)]);
  const changed = await db.holdRows('fictional', 0, same.cursors);
  expect(changed.cursors.repairs).toBeGreaterThan(same.cursors.repairs);
  expect(changed.reset).toBe(true);
});
test('page staging does not add material tracking per packet; promotion tracks bounded chunk writes', async () => {
  await db.beginDownload('fictional'); connection.executeBatchAsync.mockClear();
  await db.savePage('fictional', [row('a'), row('b', 2000), row('c', 3000)]);
  expect(connection.executeBatchAsync.mock.calls.flatMap(([commands]) => commands)
    .some(c => c.query.includes('cloud_history_material'))).toBe(false);
  connection.executeBatchAsync.mockClear();
  await db.publishDownload('fictional');
  const markers = connection.executeBatchAsync.mock.calls.flatMap(([commands]) => commands)
    .filter(c => c.query.includes('cloud_history_material'));
  // Four singleton setup/finish statements, plus insert/update/eviction latches.
  expect(markers).toHaveLength(7);
});
test('postcommit readback failure cannot keep stale hold cursors even though native history committed', async () => {
  await publish([row('a')]);
  const previous = await db.holdRows('fictional', 0);
  await db.beginDownload('fictional'); await db.savePage('fictional', [row('b', 2000)]);
  const execute = connection.executeAsync;
  connection.executeAsync = async (query, ...args) => {
    if (query.startsWith('SELECT revision,changed FROM cloud_history_material')) throw new Error('bridge readback failed');
    return execute(query, ...args);
  };
  await expect(db.publishDownload('fictional')).rejects.toThrow('bridge readback failed');
  connection.executeAsync = execute;
  expect(await db.count('fictional')).toBe(2);
  const current = await db.holdRows('fictional', 0, previous.cursors);
  expect(current.reset).toBe(true);
});
