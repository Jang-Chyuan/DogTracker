import { createCloudSync } from '../src/cloud/CloudSync';
import { captureActivityRead } from '../src/cloud/CloudPagePublication';
import { captureMapRead, completedMapRevision, latestMapApplied, mapReadRevision } from '../src/cloud/CloudPublication';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { accountPage } from '../src/settings/AccountModel';
import { t } from '../src/i18n';

const NOW = Date.parse('2026-10-10T12:00:00Z');
const fix = (event = 'latest', slave = 4) => ({ event_id: event, slave_id: slave, master_id: 7,
  received_at: NOW - 1000, track_at: NOW - 1000, slave_lat: 25, slave_lon: 121,
  activity_valid: 0, battery_valid: 0 });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
let engine, connection;
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(NOW); });
afterEach(async () => { await engine?.dispose(); connection?.close(); engine = connection = null; jest.useRealTimers(); });
const flush = () => jest.advanceTimersByTimeAsync(1);
async function fixture({ downloadContext = async () => { throw new Error('context unavailable'); }, archiveEvents = false } = {}) {
  connection = createMemoryConnection(); await createDogDatabase(connection).initialize();
  const database = createCloudDatabase(connection); await database.initialize();
  const states = []; let cutoffForArchive = NOW;
  const client = { from(table) {
    const query = {}; let range = 0, count = false, cursor = false, history = false;
    for (const method of ['select', 'eq', 'gte', 'lt', 'order', 'range', 'limit', 'or', 'in']) query[method] = (...args) => {
      if (method === 'range') range = args[0];
      if (method === 'select') count = !!args[1]?.head;
      if (method === 'or') cursor = true;
      if (method === 'gte') history = true;
      return query;
    };
    query.abortSignal = async () => count ? { count: 0 } : { data: table === 'device_members' && range === 0
      ? [{ gateway_id: 'master_7', slave_id: 4 }] : archiveEvents && history && !cursor ? [{
        event_id: `00000000-0000-4000-8000-${String(cutoffForArchive % 1e12).padStart(12, '0')}`, master_id: 7, slave_id: 4,
        received_at: new Date(cutoffForArchive - 1).toISOString(), payload: { lat: 25000000, lon: 121000000 },
      }] : [] };
    return query;
  } };
  const downloadLatest = jest.fn(async ({ cutoff }) => {
    cutoffForArchive = cutoff;
    return { cutoff, dogs: [{ slaveId: 4, packet: fix(), fix: fix() }] };
  });
  engine = createCloudSync({ client, database, downloadLatest, downloadContext, onChange: state => {
    states.push(state);
    // Producer-stage tests explicitly apply its real committed SQLite
    // readback. CloudLatestPriority separately proves React effect ACK timing.
    const publication = engine?.mapPublication();
    if (!publication?.pending && !publication?.busy && publication?.readback)
      publication.acknowledgeMapRead(publication.readback);
  } });
  const start = async () => { engine.setForeground(true); engine.setSession({ user: { id: 'a' } }); await flush(); };
  return { client, database, downloadLatest, states, current: () => states.at(-1), start };
}

test('latest is atomically usable while archive is held; archive failure never revokes its map success', async () => {
  const { database, current, start } = await fixture();
  const held = deferred(); const begin = database.beginDownload;
  database.beginDownload = jest.fn(async (...args) => { await held.promise; throw new Error('archive refused'); });
  await start();
  const latest = current(); const readVersion = mapReadRevision(latest);
  expect(latest).toMatchObject({ snapshotPending: false, archivePending: true, busy: true,
    mapSuccessRevision: 1, catchUp: { phase: 'idle' }, error: '' });
  expect(engine.mapPublication()).toMatchObject({ pending: false, busy: false, mapSuccessRevision: 1 });
  expect(engine.historyPublication()).toMatchObject({ mapSuccessRevision: 0, publishedRevision: 0 });
  expect(accountPage({ account: { signedIn: true }, sync: latest }).download).toMatchObject({ detail: t('c1250'), problem: false, retry: false });
  expect((await database.readLatestSnapshot('a')).rows[0].event_id).toBe('latest');
  expect(await database.count('a')).toBe(0);
  held.resolve(); await flush();
  expect(current()).toMatchObject({ busy: false, mapSuccessRevision: 1, error: '', failingSince: null,
    lastSuccess: latest.lastSuccess, archiveRevision: 0 });
  expect(current().archiveError).toBeTruthy();
  expect(accountPage({ account: { signedIn: true }, sync: current() }).download).toMatchObject({ title: t('c217'), detail: t('c1251'), retry: true });
  expect(mapReadRevision(current())).toBe(readVersion);
  database.beginDownload = begin;
});

test('prelatest revision read does not bootstrap optional archive context before fresh HTTP', async () => {
  const context = deferred();
  const { database, downloadLatest, current, start } = await fixture({ downloadContext: () => context.promise });
  await database.savePage('a', [fix('upgrade-cache')]);
  const bootstrap = deferred();
  const execute = connection.executeAsync.getMockImplementation();
  let bootstrapEntered = false;
  connection.executeAsync.mockImplementation(async (query, params) => {
    if (query.includes('WITH RECURSIVE dogs')) {
      bootstrapEntered = true;
      await bootstrap.promise;
    }
    return execute(query, params);
  });
  try {
    await start();
    expect(downloadLatest).toHaveBeenCalledTimes(1);
    expect(bootstrapEntered).toBe(false);
    expect(current()).toMatchObject({ snapshotBaseRevision: 0, mapSuccessRevision: 1, snapshotPending: false });
    expect((await database.readLatestSnapshot('a')).packets[0].event_id).toBe('latest');
  } finally {
    bootstrap.resolve(); context.resolve({ cutoff: NOW, dogs: [] }); await flush();
  }
});

test('archive proof remains a separate acceptance wait and restores only durable coverage', async () => {
  const { database, downloadLatest, current, start } = await fixture();
  await database.beginDownload('a');
  await database.publishDownload('a', 'auto', NOW - 100);
  const proof = deferred();
  const execute = connection.executeAsync.getMockImplementation();
  let proofEntered = false;
  connection.executeAsync.mockImplementation(async (query, params) => {
    if (query.includes('SELECT cutoff,revision FROM cloud_archive_publication')) {
      proofEntered = true;
      await proof.promise;
    }
    return execute(query, params);
  });
  try {
    await start();
    expect(proofEntered).toBe(true);
    expect(downloadLatest).toHaveBeenCalledTimes(1);
    expect(current()).toMatchObject({ archiveRevision: 0, archiveCutoff: null, mapSuccessRevision: 1 });
    proof.resolve(); await flush();
    expect(downloadLatest).toHaveBeenCalledTimes(1);
    expect(current().archiveRevision).toBeGreaterThanOrEqual(1);
  } finally { proof.resolve(); await flush(); }
});

test('slow context cannot starve archive across repeated latest cycles, even if its transport ignores abort', async () => {
  const contexts = [];
  const downloadContext = jest.fn(({ signal }) => { contexts.push(signal); return new Promise(() => {}); });
  const { database, downloadLatest, current, start } = await fixture({ downloadContext, archiveEvents: true });
  await start();
  expect(current()).toMatchObject({ contextPending: true, mapSuccessRevision: 1, archiveRevision: 0 });
  await jest.advanceTimersByTimeAsync(10000);
  expect(contexts[0].aborted).toBe(true);
  expect(await database.count('a')).toBe(1);
  expect(current()).toMatchObject({ contextPending: false, archiveRevision: 1, archiveError: '', error: '' });
  const first = (await database.loadSyncState('a', 7)).through_at;
  await jest.advanceTimersByTimeAsync(20000);
  expect(downloadLatest).toHaveBeenCalledTimes(2);
  await jest.advanceTimersByTimeAsync(10000);
  expect(await database.count('a')).toBe(2);
  expect(current().archiveRevision).toBe(2);
  expect((await database.loadSyncState('a', 7)).through_at).not.toBe(first);
  await jest.advanceTimersByTimeAsync(20000);
  await jest.advanceTimersByTimeAsync(10000);
  expect(downloadLatest).toHaveBeenCalledTimes(3);
  expect(await database.count('a')).toBe(3);
  expect(current()).toMatchObject({ archiveRevision: 3, error: '', mapSuccessRevision: 3 });
});

test('archive 401 reports the refused sign-in without discarding the accepted latest snapshot or claiming a network failure', async () => {
  const { database, current, start } = await fixture();
  database.beginDownload = async () => { throw Object.assign(new Error('private server detail'), { status: 401 }); };
  const log = jest.spyOn(console, 'info').mockImplementation(() => {});
  try {
    await start();
    expect(current()).toMatchObject({ authFailed: true, offline: false, error: '', failingSince: null, mapSuccessRevision: 1 });
    expect((await database.readLatestSnapshot('a')).rows[0].event_id).toBe('latest');
    expect(log).toHaveBeenCalledWith('[CloudSync] failure', { attempt: 1, phase: 'begin', failureKind: 'auth', status: 401 });
    expect(JSON.stringify(log.mock.calls)).not.toContain('private server detail');
  } finally { log.mockRestore(); }
});

test('latest failure keeps the complete previous cache and never starts archive writes', async () => {
  const { database, downloadLatest, current, start } = await fixture();
  await database.savePage('a', [fix('cached')]);
  const before = await database.readLatestSnapshot('a');
  database.beginDownload = jest.fn();
  downloadLatest.mockRejectedValueOnce(new Error('network failed'));
  await start();
  expect(database.beginDownload).not.toHaveBeenCalled();
  expect(current()).toMatchObject({ mapSuccessRevision: 0, lastSuccess: null, snapshotBaseRevision: 0,
    catchUp: { phase: 'failed' } });
  expect(await database.readLatestSnapshot('a')).toEqual(before);
});

test('owner change during an already started native snapshot transaction rejects its old map read', async () => {
  const { database, downloadLatest, current, start } = await fixture();
  const entered = deferred(), release = deferred(), batch = connection.executeBatchAsync;
  connection.executeBatchAsync = async commands => {
    if (commands.some(command => command.query.includes('INSERT OR REPLACE INTO cloud_snapshot_state') && command.params[0] === 'a')) {
      entered.resolve(); await release.promise;
    }
    return batch(commands);
  };
  await start(); await entered.promise;
  const fence = captureMapRead(() => engine.mapPublication(), 'a', completedMapRevision(current()));
  downloadLatest.mockImplementation(async ({ cutoff }) => ({ cutoff, dogs: [{ slaveId: 6, packet: fix('b', 6), fix: fix('b', 6) }] }));
  engine.setSession({ user: { id: 'b' } });
  release.resolve(); await flush();
  expect(fence.valid()).toBe(false);
  expect(current()).toMatchObject({ owner: 'b', mapSuccessRevision: 1, error: '' });
  expect((await database.readLatestSnapshot('a')).rows.map(row => row.slave_id)).toEqual([4]);
  expect((await database.readLatestSnapshot('b')).rows.map(row => row.slave_id)).toEqual([6]);
  expect(engine.mapPublication().owner).toBe('b');
});

test('archive releases the slot at its 30 second boundary and preserves checkpointed work', async () => {
  const { database, downloadLatest, current, start } = await fixture();
  const release = deferred(); const save = database.savePage;
  let held = false;
  database.savePage = async (...args) => {
    await save(...args);
    if (!held) { held = true; await release.promise; }
  };
  await start();
  expect(current().archivePending).toBe(true);
  const saved = await database.loadSyncState('a', 7);
  await jest.advanceTimersByTimeAsync(30000);
  expect(downloadLatest).toHaveBeenCalledTimes(1);
  release.resolve(); await flush();
  expect(downloadLatest).toHaveBeenCalledTimes(2);
  expect(current()).toMatchObject({ mapSuccessRevision: 2, error: '', catchUp: { phase: 'idle' } });
  expect(await database.loadSyncState('a', 7)).not.toBeNull();
  expect(saved.through_at).toBeTruthy();
});

test('a new offline engine can read a prior completed archive without claiming fresh latest positions', async () => {
  const { client, database, start } = await fixture({ archiveEvents: true });
  await start();
  const completed = await database.readArchivePublication('a');
  expect(completed).toMatchObject({ owner: 'a', cutoff: NOW, revision: 1 });
  expect(await database.count('a')).toBe(1);
  await engine.dispose();
  const states = [];
  engine = createCloudSync({ client, database, onChange: state => states.push(state),
    downloadLatest: async () => { throw new Error('network failed'); } });
  engine.setForeground(true); engine.setSession({ user: { id: 'a' } }); await flush();
  expect(states.at(-1)).toMatchObject({ archiveCutoff: NOW, archiveRevision: 1,
    mapSuccessRevision: 0, lastSuccess: null });
  expect(captureActivityRead(() => engine.historyPublication(), 'a', true).open).toBe(true);
  expect(await database.count('a')).toBe(1);
});

test('another owner or a manual archive slice cannot hydrate automatic activity completion', async () => {
  const { database, start } = await fixture();
  await database.beginDownload('b');
  await database.publishDownload('b', 'auto', NOW);
  await database.beginManualScope('a', 4, '2026-10-10');
  await database.publishManualScope('a', 4, '2026-10-10');
  database.beginDownload = async () => { throw new Error('archive failed'); };
  await start();
  expect(engine.historyPublication()).toMatchObject({ owner: 'a', archiveCutoff: null, archiveRevision: 0 });
  expect(captureActivityRead(() => engine.historyPublication(), 'a', true).open).toBe(false);
  expect(await database.readArchivePublication('a')).toBeNull();
});


test('already applied latest remains usable through real deferred context publication and read lag', async () => {
  const context = deferred();
  const { database, current, start } = await fixture({ downloadContext: () => context.promise });
  const contextCommit = deferred();
  const publish = database.publishLatestSnapshot;
  let commits = 0;
  database.publishLatestSnapshot = async (...args) => {
    commits++;
    if (commits === 2) await contextCommit.promise;
    return publish(...args);
  };
  try {
    await start();
    const initial = engine.mapPublication();
    const snapshot = await database.readLatestSnapshot('a');
    const dogs = { loaded: true, rows: snapshot.rows, cloudCommit: initial.mapSuccessRevision,
      cloudPublication: { owner: initial.owner, scope: initial.scope,
        generation: initial.generation, attempt: initial.attempt, revision: initial.mapSuccessRevision } };
    const state = () => ({ ...current(), getMapPublication: () => engine.mapPublication() });
    expect(current()).toMatchObject({ contextPending: true, snapshotPending: false });
    expect(latestMapApplied(state(), 'a', dogs)).toBe(true);
    context.resolve({ cutoff: NOW, dogs: [{ slaveId: 4, packet: fix(), fix: fix(), context: [fix()], seeds: [] }] });
    await flush();
    expect(commits).toBe(2);
    expect(engine.mapPublication()).toMatchObject({ pending: true, busy: false, mapSuccessRevision: 1 });
    expect(latestMapApplied(state(), 'a', dogs)).toBe(true);
    contextCommit.resolve(); await flush();
    expect(engine.mapPublication()).toMatchObject({ pending: false, busy: false, mapSuccessRevision: 2 });
    // The prior applied snapshot remains valid while the new context/hold read
    // catches up. This is not a completion certificate for history readers.
    expect(dogs.cloudCommit).toBe(1);
    expect(latestMapApplied(state(), 'a', dogs)).toBe(true);
    engine.setForeground(false); engine.setForeground(true);
    expect(latestMapApplied(state(), 'a', dogs)).toBe(false);
    engine.setSession({ user: { id: 'b' } });
    expect(latestMapApplied(state(), 'b', dogs)).toBe(false);
  } finally {
    context.resolve({ cutoff: NOW, dogs: [] }); contextCommit.resolve(); await flush();
  }
});


test('a second latest attempt cannot inherit a prior applied map proof during its native-reader lag', async () => {
  const secondContext = deferred();
  let contextCalls = 0;
  const { database, downloadLatest, current, start } = await fixture({ downloadContext: async () => {
    contextCalls++;
    if (contextCalls === 1) throw new Error('optional context unavailable');
    return secondContext.promise;
  } });
  try {
    await start();
    const first = engine.mapPublication();
    const firstSnapshot = await database.readLatestSnapshot('a');
    const dogs = { loaded: true, rows: firstSnapshot.rows, cloudCommit: first.mapSuccessRevision,
      cloudPublication: { owner: first.owner, scope: first.scope, generation: first.generation,
        attempt: first.attempt, revision: first.mapSuccessRevision } };
    const state = () => ({ ...current(), getMapPublication: () => engine.mapPublication() });
    expect(latestMapApplied(state(), 'a', dogs)).toBe(true);
    downloadLatest.mockImplementation(async ({ cutoff }) => ({ cutoff, dogs: [{ slaveId: 4,
      packet: { ...fix('second-latest'), slave_lat: 26 }, fix: { ...fix('second-latest'), slave_lat: 26 } }] }));
    await jest.advanceTimersByTimeAsync(30000);
    const second = engine.mapPublication();
    const secondSnapshot = await database.readLatestSnapshot('a');
    expect(second.generation).toBe(first.generation);
    expect(second.attempt).toBe(first.attempt + 1);
    expect(second.mapSuccessRevision).toBeGreaterThan(first.mapSuccessRevision);
    expect(secondSnapshot.rows[0].slave_lat).toBe(26);
    expect(current()).toMatchObject({ snapshotPending: false, contextPending: true });
    // SQLite has the second complete latest, but the mounted map reader still
    // carries the first attempt's immutable snapshot. Optional context alone
    // may retain a proof; a newly accepted latest attempt may not inherit it.
    expect(latestMapApplied(state(), 'a', dogs)).toBe(false);
    const appliedSecond = { ...dogs, rows: secondSnapshot.rows, cloudCommit: second.mapSuccessRevision,
      cloudPublication: { owner: second.owner, scope: second.scope, generation: second.generation,
        attempt: second.attempt, revision: second.mapSuccessRevision } };
    expect(latestMapApplied(state(), 'a', appliedSecond)).toBe(true);
  } finally {
    secondContext.resolve({ cutoff: NOW + 30000, dogs: [] });
    await flush();
  }
});

test('legacy context timeout logs exactly one context-failed; latest and archive publication are unchanged', async () => {
  const log = jest.spyOn(console, 'info').mockImplementation(() => {});
  const events = name => log.mock.calls.filter(([tag]) => tag === `[CloudSync] ${name}`);
  try {
    const { database, current, start } = await fixture({ downloadContext: () => new Promise(() => {}), archiveEvents: true });
    await start();
    expect(current()).toMatchObject({ contextPending: true, mapSuccessRevision: 1 });
    await jest.advanceTimersByTimeAsync(10000);
    expect(events('context-failed')).toEqual([['[CloudSync] context-failed',
      { attempt: 1, elapsedMs: 10000, failureKind: 'timeout', dogs: 1, completedDogs: 0, requests: 0 }]]);
    expect(events('context-published')).toEqual([]);
    expect(events('failure')).toEqual([]);
    expect(events('latest-published')).toHaveLength(1);
    expect(events('archive-published')).toEqual([['[CloudSync] archive-published', { attempt: 1, elapsedMs: expect.any(Number), revision: 1 }]]);
    expect(current()).toMatchObject({ contextPending: false, archiveRevision: 1, archiveError: '', error: '', mapSuccessRevision: 1 });
    expect((await database.readLatestSnapshot('a')).rows[0].event_id).toBe('latest');
  } finally { log.mockRestore(); }
});

test('legacy context error and success use the fixed context events', async () => {
  const log = jest.spyOn(console, 'info').mockImplementation(() => {});
  const events = name => log.mock.calls.filter(([tag]) => tag === `[CloudSync] ${name}`);
  try {
    let fail = true;
    const downloadContext = async ({ snapshot, progress }) => {
      progress.requests += 2;
      if (fail) throw Object.assign(new Error('private refusal'), { status: 401 });
      return { ...snapshot, dogs: snapshot.dogs.map(dog => ({ ...dog, context: [], seeds: [] })) };
    };
    const { start } = await fixture({ downloadContext });
    await start();
    expect(events('context-failed')).toEqual([['[CloudSync] context-failed',
      { attempt: 1, elapsedMs: 0, failureKind: 'auth', dogs: 1, completedDogs: 0, requests: 2 }]]);
    fail = false;
    await jest.advanceTimersByTimeAsync(30000);
    expect(events('context-failed')).toHaveLength(1);
    expect(events('context-published')).toEqual([['[CloudSync] context-published', { attempt: 2, elapsedMs: 0, dogs: 1 }]]);
    expect(JSON.stringify(log.mock.calls)).not.toContain('private refusal');
  } finally { log.mockRestore(); }
});
