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
  expect(await database.readLatestSnapshot('a')).toEqual({ revision: 3, cutoff: 4000, verified: true, rows: [], packets: [], context: [], seeds: [],
    contexts: {}, contextVersions: {}, contextsKnown: 0 });
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


test('metadata-only cache read leaves upgrade context untouched for the full offline reader', async () => {
  await database.savePage('a', [fix('cached-position')]);
  expect(connection.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='cloud_snapshot_state'").all()).toEqual([]);
  const before = [];
  expect(await database.readLatestSnapshot('a', { metadataOnly: true })).toEqual({ revision: 0 });
  expect(connection.sqlite.prepare('SELECT * FROM cloud_snapshot_state').all()).toEqual(before);
  const full = await database.readLatestSnapshot('a');
  expect(full).toMatchObject({ verified: false, revision: 0, packets: [expect.objectContaining({ event_id: 'cached-position' })] });
  expect(full.context).toHaveLength(1);
  expect(await database.readLatestSnapshot('a', { metadataOnly: true })).toEqual({ revision: 0 });
  expect(await database.readLatestSnapshot('a')).toEqual(full);
  await database.publishLatestSnapshot('a', snapshot([], 4000));
  expect(await database.readLatestSnapshot('a', { metadataOnly: true })).toEqual({ revision: 1 });
  expect(await database.readLatestSnapshot('b', { metadataOnly: true })).toEqual({ revision: 0 });
});

test('metadata read never fetches or decodes context JSON but the ordinary offline read still does', async () => {
  await database.publishLatestSnapshot('a', snapshot([{ slaveId: 4, packet: fix('current'), fix: fix('current'), context: [fix('known')] }]));
  await connection.executeAsync("UPDATE cloud_latest_snapshot SET context_json='{synthetic-invalid-context' WHERE owner_user_id='a'");
  connection.executeAsync.mockClear();
  const fullSnapshotReads = () => connection.executeAsync.mock.calls.filter(([query]) => /^\s*SELECT\b[^]*\bcontext_json\b/.test(query)).length;
  expect(await database.readLatestSnapshot('a', { metadataOnly: true })).toEqual({ revision: 1 });
  expect(fullSnapshotReads()).toBe(0);
  await expect(database.readLatestSnapshot('a')).rejects.toThrow(SyntaxError);
  expect(fullSnapshotReads()).toBe(1);
});


test('metadata reads remain owner-bound and cannot run through an in-flight native snapshot transaction', async () => {
  await database.publishLatestSnapshot('a', snapshot([], 2000));
  await database.publishLatestSnapshot('b', snapshot([], 2000));
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const batch = connection.executeBatchAsync.getMockImplementation();
  connection.executeBatchAsync.mockImplementationOnce(async commands => { await pending; return batch(commands); });
  const write = database.publishLatestSnapshot('a', snapshot([], 3000));
  let readFinished = false;
  const read = database.readLatestSnapshot('a', { metadataOnly: true }).then(value => { readFinished = true; return value; });
  try {
    await Promise.resolve(); await Promise.resolve();
    expect(readFinished).toBe(false);
    release(); await write;
    expect(await read).toEqual({ revision: 2 });
    expect(await database.readLatestSnapshot('b', { metadataOnly: true })).toEqual({ revision: 1 });
    expect(await database.readLatestSnapshot('a')).toMatchObject({ revision: 2, verified: true, cutoff: 3000, packets: [] });
  } finally { release(); await Promise.allSettled([write, read]); }
});

test('positions-only reads keep state, packet and last valid fix atomic without decoding optional context or bootstrapping', async () => {
  await database.savePage('a', [fix('cached-position')]);
  expect(await database.readLatestSnapshot('a', { positionsOnly: true })).toBeNull();
  expect(connection.sqlite.prepare('SELECT * FROM cloud_snapshot_state').all()).toEqual([]);
  const current = fix('new-current');
  await database.publishLatestSnapshot('a', snapshot([{ slaveId: 4, packet: current, fix: current }]));
  await connection.executeAsync("UPDATE cloud_latest_snapshot SET context_json='{invalid-context' WHERE owner_user_id='a'");
  const positions = await database.readLatestSnapshot('a', { positionsOnly: true });
  expect(positions).toMatchObject({ revision: 1, verified: true, rows: [expect.objectContaining({ event_id: 'new-current' })],
    packets: [expect.objectContaining({ event_id: 'new-current' })] });
  expect(positions.context).toBeUndefined();
  expect(await database.readLatestSnapshot('b', { positionsOnly: true })).toBeNull();
  await expect(database.readLatestSnapshot('a')).rejects.toThrow(SyntaxError);
  await database.publishLatestSnapshot('a', snapshot([]));
  expect(await database.readLatestSnapshot('a', { positionsOnly: true })).toMatchObject({ revision: 2, verified: true, rows: [], packets: [] });
});

// Audit F8: every 10 s poll read and parsed every dog's half-hour context
// (twice), and each stored context row carried its whole remote JSON.
describe('stored context cost', () => {
  const payload = row => ({ ...row, raw_payload: JSON.stringify({ event_id: row.event_id, payload: { lat: 25000000 } }) });
  const stored = async () => (await connection.executeAsync(
    'SELECT slave_id,packet_json,fix_json,context_json,context_version FROM cloud_latest_snapshot ORDER BY slave_id')).results;

  test('the remote JSON is not stored with the map set; what is read back is unchanged', async () => {
    const context = [payload(fix('c1', 4, 900)), payload(fix('c2', 4, 950))];
    await database.publishLatestSnapshot('a', snapshot([{ slaveId: 4, packet: payload(fix('p')), fix: payload(fix('p')),
      context, seeds: [payload(fix('s1', 4, 100))] }]));
    const [dog] = await stored();
    for (const text of [dog.packet_json, dog.fix_json, dog.context_json]) expect(text).not.toContain('raw_payload');
    const read = await database.readLatestSnapshot('a');
    expect(read.context.map(row => row.event_id)).toEqual(['c1', 'c2']);
    expect(read.seeds.map(row => row.event_id)).toEqual(['s1']);
    expect(read.contexts[4].rows).toEqual(read.context);
    expect(read.packets[0]).toMatchObject({ event_id: 'p', source: 'cloud' });
    expect(read.packets[0].raw_payload).toBeUndefined();
  });

  test('knownContexts: only changed contexts are read and parsed; a token changes with its context only', async () => {
    const dogs = (packet, context6) => [
      { slaveId: 4, packet: fix(`p4-${packet}`), fix: fix(`p4-${packet}`), context: [fix('c4', 4, 900)], seeds: [] },
      { slaveId: 6, packet: fix(`p6-${packet}`, 6), fix: fix(`p6-${packet}`, 6), context: context6, seeds: [] },
    ];
    await database.publishLatestSnapshot('a', snapshot(dogs(1, [fix('c6', 6, 900)])));
    const first = await database.readLatestSnapshot('a');
    expect(Object.keys(first.contexts)).toEqual(['4', '6']);
    expect(first.contextsKnown).toBe(0);
    // New packets for both, a new context for dog 6 only.
    await database.publishLatestSnapshot('a', snapshot(dogs(2, [fix('c6', 6, 900), fix('c6b', 6, 950)]), 3000));
    connection.executeAsync.mockClear();
    const parse = jest.spyOn(JSON, 'parse');
    const second = await database.readLatestSnapshot('a', { knownContexts: first.contextVersions });
    const contextTexts = parse.mock.calls.filter(([text]) => typeof text === 'string' && text.includes('"rows"')).length;
    parse.mockRestore();
    expect(second.contextVersions[4]).toBe(first.contextVersions[4]);
    expect(second.contextVersions[6]).not.toBe(first.contextVersions[6]);
    expect(Object.keys(second.contexts)).toEqual(['6']);
    expect(second.contextsKnown).toBe(1);
    expect(second.context.map(row => row.event_id)).toEqual(['c6', 'c6b']);
    // Parsed once, and dog 4's context never left SQLite.
    expect(contextTexts).toBe(1);
    expect(second.packets.map(row => row.event_id)).toEqual(['p4-2', 'p6-2']);
    // Nothing changed: no context read at all.
    const third = await database.readLatestSnapshot('a', { knownContexts: second.contextVersions });
    expect(third).toMatchObject({ contexts: {}, context: [], seeds: [], contextsKnown: 2 });
  });

  test('a dog removed and added again, or a deleted data set, never matches an old token', async () => {
    await database.publishLatestSnapshot('a', snapshot([{ slaveId: 4, packet: fix('p'), fix: fix('p'), context: [], seeds: [] }]));
    const before = await database.readLatestSnapshot('a');
    await database.publishLatestSnapshot('a', snapshot([], 3000));
    await database.publishLatestSnapshot('a', snapshot([{ slaveId: 4, packet: fix('p'), fix: fix('p'), context: [], seeds: [] }], 4000));
    const after = await database.readLatestSnapshot('a', { knownContexts: before.contextVersions });
    expect(after.contextVersions[4]).not.toBe(before.contextVersions[4]);
    expect(Object.keys(after.contexts)).toEqual(['4']);
  });
});
