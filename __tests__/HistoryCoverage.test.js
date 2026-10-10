import { coversHistory, historyCoverage } from '../src/cloud/HistoryCoverage';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';

const start = new Date(2026, 9, 3).getTime(), end = start + 86400000;
const row = (id, time, dog = 6) => ({ event_id: id, slave_id: dog, master_id: 7,
  received_at: time, track_at: time, slave_lat: 24.9, slave_lon: 121.3, activity_valid: 0, battery_valid: 0 });
async function setup(cap) {
  const connection = createMemoryConnection();
  await createDogDatabase(connection).initialize();
  const database = createCloudDatabase(connection, { maxRows: cap });
  await database.initialize();
  return { connection, database };
}
test('coverage requires a bounded completed query, including empty days and today tail', () => {
  const morning = historyCoverage(start, end, start + 3600000);
  expect(coversHistory({ complete: 1 }, morning)).toBe(false);
  expect(coversHistory({ complete: 1, ...morning }, morning)).toBe(true);
  expect(coversHistory({ complete: 1, ...morning }, historyCoverage(start, end, start + 7200000))).toBe(false);
  expect(coversHistory({ complete: 1, ...morning }, historyCoverage(start, end, end + 7200000))).toBe(false);
});
test('retention invalidates only evicted owner/dog/day coverage; complete empty day stays complete', async () => {
  const { connection, database } = await setup(2);
  try {
    const proof = historyCoverage(start, end, end + 7200000);
    await database.savePage('a', [row('old', start + 1000), row('other', start + 2000, 4)]);
    await database.setHistoryDownloadState('a', 6, '2026-10-03', true, proof);
    await database.setHistoryDownloadState('a', 4, '2026-10-03', true, proof);
    await database.setHistoryDownloadState('b', 6, '2026-10-03', true, proof);
    await database.setHistoryDownloadState('a', 6, '2026-10-02', true, historyCoverage(start - 86400000, start, start + 7200000));
    await database.savePage('a', [row('new', end + 5000)]);
    const states = await database.historyDownloadStates('a', [4, 6]);
    expect(states.find(s => s.slave_id === 6 && s.day === '2026-10-03').complete).toBe(0);
    expect(states.find(s => s.slave_id === 4).complete).toBe(1);
    // Old packet was within the previous day's upload context too, so that
    // proof legitimately invalidates. Truly empty owner b remains covered.
    expect((await database.historyDownloadStates('b', 6))[0].complete).toBe(1);
  } finally { connection.close(); }
});
test('manual capacity failure cannot publish a truncated day or false completed marker', async () => {
  const { connection, database } = await setup(2);
  try {
    await database.setHistoryDownloadState('a', 6, '2026-10-03', false);
    await database.beginManualScope('a', 6, '2026-10-03');
    await expect(database.savePage('a', [row('one', start + 1000), row('two', start + 2000), row('three', start + 3000), row('four', start + 4000)])).rejects.toThrow('手機空間不足');
    expect((await database.historyDownloadStates('a', 6))[0].complete).toBe(0);
    expect((await connection.executeAsync('SELECT COUNT(*) n FROM supabase_dog_status')).results[0].n).toBe(0);
  } finally { connection.close(); }
});
test('manual publish protects a requested old day and evicts other nonrequired history', async () => {
  const { connection, database } = await setup(2);
  try {
    await database.savePage('a', [row('newer-one', end + 3 * 3600000), row('newer-two', end + 3 * 3600000 + 1000)]);
    await database.setHistoryDownloadState('a', 6, '2026-10-04', true, historyCoverage(end, end + 86400000, end + 86400000 + 7200000));
    await database.setHistoryDownloadState('a', 6, '2026-10-03', false);
    await database.beginManualScope('a', 6, '2026-10-03');
    await database.savePage('a', [row('old-day', start + 1000)]);
    await database.setHistoryDownloadState('a', 6, '2026-10-03', true, historyCoverage(start, end, end + 7200000));
    await expect(database.publishManualScope('a', 6, '2026-10-03')).resolves.toBeUndefined();
    const states = await database.historyDownloadStates('a', 6);
    expect(states.find(s => s.day === '2026-10-03').complete).toBe(1);
    expect(states.find(s => s.day === '2026-10-04').complete).toBe(0);
    expect((await connection.executeAsync("SELECT event_id FROM supabase_dog_status ORDER BY event_id")).results.map(r => r.event_id)).toEqual(['newer-two', 'old-day']);
  } finally { connection.close(); }
});

test('legacy coverage and both staging tables migrate without promoting old boolean markers to proof', async () => {
  const connection = createMemoryConnection();
  try {
    await createDogDatabase(connection).initialize();
    for (const table of ['history_download_state', 'cloud_auto_history_download_state', 'cloud_manual_history_download_state'])
      await connection.executeAsync(`CREATE TABLE ${table} (owner TEXT,slave_id INTEGER,day TEXT,complete INTEGER NOT NULL,PRIMARY KEY(owner,slave_id,day))`);
    await connection.executeAsync("INSERT INTO history_download_state VALUES('a',6,'2026-10-03',1)");
    const database = createCloudDatabase(connection);
    await database.initialize();
    const needed = historyCoverage(start, end, end + 7200000);
    expect(coversHistory((await database.historyDownloadStates('a', 6))[0], needed)).toBe(false);
    await database.setHistoryDownloadState('a', 6, '2026-10-03', false);
    await database.beginManualScope('a', 6, '2026-10-03');
    await database.setHistoryDownloadState('a', 6, '2026-10-03', true, needed);
    await database.publishManualScope('a', 6, '2026-10-03');
    expect(coversHistory((await database.historyDownloadStates('a', 6))[0], needed)).toBe(true);
  } finally { connection.close(); }
});

test('manual required history plus irreducible current anchors over cap still rolls back', async () => {
  const { connection, database } = await setup(2);
  try {
    await database.savePage('a', [row('anchor-six', end + 3 * 3600000), row('anchor-nine', end + 3 * 3600000, 9)]);
    await database.setHistoryDownloadState('a', 6, '2026-10-03', false);
    await database.beginManualScope('a', 6, '2026-10-03');
    await database.savePage('a', [row('required-old', start + 1000)]);
    await database.setHistoryDownloadState('a', 6, '2026-10-03', true, historyCoverage(start, end, end + 7200000));
    await expect(database.publishManualScope('a', 6, '2026-10-03')).rejects.toThrow('手機空間不足');
    expect((await database.historyDownloadStates('a', 6))[0].complete).toBe(0);
    expect((await connection.executeAsync('SELECT COUNT(*) n FROM supabase_dog_status')).results[0].n).toBe(2);
  } finally { connection.close(); }
});
test.each([false, true])('cross-day metadata repair invalidates both day proofs atomically (staged=%s)', async staged => {
  const { connection, database } = await setup(16);
  try {
    await database.savePage('a', [row('moved', start + 3600000)]);
    await database.setHistoryDownloadState('a', 6, '2026-10-03', true, historyCoverage(start, end, end + 7200000));
    await database.setHistoryDownloadState('a', 6, '2026-10-04', true, historyCoverage(end, end + 86400000, end + 86400000 + 7200000));
    if (staged) await database.beginDownload('a');
    await database.repairTrackTimes('a', [{ event_id: 'moved', received_at: new Date(start + 3600000).toISOString(),
      upload_source: 'phone', phone_received_at: new Date(end + 3600000).toISOString() }], ['moved']);
    if (staged) {
      expect((await database.historyDownloadStates('a', 6)).every(s => s.complete === 1)).toBe(true);
      await database.publishDownload('a');
    }
    expect((await database.historyDownloadStates('a', 6)).map(s => s.complete)).toEqual([0, 0]);
    expect((await connection.executeAsync("SELECT track_at FROM supabase_dog_status WHERE event_id='moved'")).results[0].track_at).toBe(end + 3600000);
  } finally { connection.close(); }
});

test.each([false, true])('repair failure rolls back geometry and both completeness invalidations (staged=%s)', async staged => {
  const { connection, database } = await setup(16);
  try {
    const oldTime = start + 3600000, newTime = end + 3600000;
    await database.savePage('a', [row('rollback', oldTime)]);
    for (const [day, at] of [['2026-10-03', start], ['2026-10-04', end]])
      await database.setHistoryDownloadState('a', 6, day, true, historyCoverage(at, at + 86400000, at + 86400000 + 7200000));
    if (staged) await database.beginDownload('a');
    const metadata = [{ event_id: 'rollback', received_at: new Date(oldTime).toISOString(), upload_source: 'phone', phone_received_at: new Date(newTime).toISOString() }];
    if (staged) await database.repairTrackTimes('a', metadata, ['rollback']);
    await connection.executeAsync("CREATE TRIGGER deny_repair BEFORE UPDATE OF track_at ON supabase_dog_status BEGIN SELECT RAISE(ABORT,'repair failure'); END");
    await expect(staged ? database.publishDownload('a') : database.repairTrackTimes('a', metadata, ['rollback'])).rejects.toThrow('repair failure');
    expect((await database.historyDownloadStates('a', 6)).every(s => s.complete === 1)).toBe(true);
    expect((await connection.executeAsync("SELECT track_at FROM supabase_dog_status WHERE event_id='rollback'")).results[0].track_at).toBe(oldTime);
  } finally { connection.close(); }
});
test('a stale copy-on-write repair cannot invalidate newer completed coverage', async () => {
  const { connection, database } = await setup(16);
  try {
    await database.savePage('a', [row('stale-cow', start + 3600000)]);
    await database.beginDownload('a');
    await database.repairTrackTimes('a', [{ event_id: 'stale-cow', received_at: new Date(start + 3600000).toISOString(),
      upload_source: 'phone', phone_received_at: new Date(end + 3600000).toISOString() }], ['stale-cow']);
    // A later accepted publication changed the captured row. This simulates
    // the exact native version fence, independently of the stale auto stage.
    await connection.executeAsync("UPDATE supabase_dog_status SET track_at=?,publication_version=publication_version+1 WHERE event_id='stale-cow'", [end + 2 * 86400000]);
    for (const [day, at] of [['2026-10-03', start], ['2026-10-04', end]])
      await connection.executeAsync('INSERT OR REPLACE INTO history_download_state(owner,slave_id,day,complete,range_start,range_end,received_before) VALUES(?,?,?,1,?,?,?)', ['a', 6, day, at, at + 86400000, at + 86400000 + 7200000]);
    await database.publishDownload('a');
    expect((await database.historyDownloadStates('a', 6)).every(s => s.complete === 1)).toBe(true);
    expect((await connection.executeAsync("SELECT track_at FROM supabase_dog_status WHERE event_id='stale-cow'")).results[0].track_at).toBe(end + 2 * 86400000);
  } finally { connection.close(); }
});
