import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { latestArchiveRest, cloudEvent } from '../__fixtures__/LatestArchiveRest';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { createCloudSync } from '../src/cloud/CloudSync';

const NOW = Date.parse('2026-10-10T12:00:00Z');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = () => jest.advanceTimersByTimeAsync(1);
let engine, db, info;
beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(NOW);
  info = jest.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(async () => {
  await engine?.dispose(); db?.close(); engine = db = null;
  info.mockRestore(); jest.useRealTimers();
});
async function fixture({ beforeRead, downloadLatest, events = [cloudEvent(1, NOW - 1000)], members, now } = {}) {
  db = createMemoryConnection(); await createDogDatabase(db).initialize();
  const database = createCloudDatabase(db);
  const network = latestArchiveRest({ events, beforeRead, ...(members ? { members } : {}) });
  const states = [];
  engine = createCloudSync({ client: network.client, database,
    ...(downloadLatest ? { downloadLatest } : {}),
    ...(now ? { now } : {}),
    downloadContext: async () => { throw new Error('optional context unavailable'); },
    onChange: state => {
      states.push(state);
      // Apply the real producer readback for these network/readiness stages;
      // actual committed React timing is guarded in CloudLatestPriority.
      const publication = engine?.mapPublication();
      if (!publication?.pending && !publication?.busy && publication?.readback)
        publication.acknowledgeMapRead(publication.readback);
    } });
  const start = async () => {
    engine.setSession({ user: { id: 'invented-owner' } }); engine.setForeground(true); await flush();
  };
  return { database, network, start, current: () => states.at(-1) };
}
function holdSql(predicate) {
  const gate = deferred(), entered = deferred();
  const execute = db.executeAsync.getMockImplementation(); let first = true;
  db.executeAsync.mockImplementation(async (query, params) => {
    if (first && predicate(query)) { first = false; entered.resolve(); await gate.promise; }
    return execute(query, params);
  });
  return { gate, entered };
}
const acceptedEvents = () => info.mock.calls.filter(([name]) => name === '[CloudSync] latest-published');

test('real SDK latest requests overlap real SQLite initialization but do not publish before native readiness', async () => {
  const f = await fixture(), held = holdSql(query => query.startsWith('CREATE TABLE IF NOT EXISTS cloud_latest_snapshot'));
  try {
    await f.start(); await held.entered.promise;
    expect(f.network.calls.some(call => call.phase === 'masters')).toBe(true);
    expect(f.network.calls.some(call => call.phase === 'packet')).toBe(true);
    expect(f.current()).toMatchObject({ snapshotPending: true, mapSuccessRevision: 0, archiveCutoff: null });
    expect(db.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='cloud_snapshot_state'").all()).toEqual([]);
    expect(acceptedEvents()).toEqual([]);
    held.gate.resolve(); await flush();
    expect((await f.database.readLatestSnapshot('invented-owner')).packets[0].event_id).toBe(cloudEvent(1, NOW - 1000).event_id);
    expect(f.current().mapSuccessRevision).toBe(1);
    expect(acceptedEvents()).toHaveLength(1);
  } finally { held.gate.resolve(); await flush(); }
});

test('legacy archive sync still waits for real SQLite initialization before requesting masters', async () => {
  const f = await fixture(); delete f.database.publishLatestSnapshot;
  // Capability is fixed when the scheduler is created, as in an older adapter.
  await engine.dispose();
  engine = createCloudSync({ client: f.network.client, database: f.database });
  const held = holdSql(query => query === 'PRAGMA table_info(supabase_dog_status)');
  try {
    await f.start(); await held.entered.promise;
    expect(f.network.calls).toEqual([]);
    held.gate.resolve(); await flush();
    expect(f.network.calls.some(call => call.phase === 'masters')).toBe(true);
    expect(acceptedEvents()).toEqual([]);
    expect(engine.mapPublication().mapSuccessRevision).toBe(1);
  } finally { held.gate.resolve(); await flush(); }
});

test('a completed prefetch cannot replace a newer server packet after a long native initialization wait', async () => {
  const events = [cloudEvent(1, NOW - 1000)], f = await fixture({ events });
  const held = holdSql(query => query.startsWith('CREATE TABLE IF NOT EXISTS cloud_latest_snapshot'));
  try {
    await f.start(); await held.entered.promise;
    await jest.advanceTimersByTimeAsync(35000);
    events.push(cloudEvent(2, NOW + 34000));
    held.gate.resolve(); await flush();
    expect((await f.database.readLatestSnapshot('invented-owner')).packets[0].event_id)
      .toBe(events[1].event_id);
  } finally { held.gate.resolve(); await flush(); }
});

test('expired prefetch repeats membership as well as latest and discovers a newly authorized master and dog', async () => {
  const members = [{ gateway_id: 'master_7', slave_id: 6 }], events = [cloudEvent(1, NOW - 1000)];
  const f = await fixture({ members, events });
  const held = holdSql(query => query.startsWith('CREATE TABLE IF NOT EXISTS cloud_latest_snapshot'));
  try {
    await f.start(); await held.entered.promise;
    await jest.advanceTimersByTimeAsync(35000);
    members.push({ gateway_id: 'master_17', slave_id: 8 });
    events.push(cloudEvent(2, NOW + 34000, { master: 17, slave: 8 }));
    held.gate.resolve(); await flush();
    const snapshot = await f.database.readLatestSnapshot('invented-owner');
    expect(snapshot.packets.map(packet => [packet.master_id, packet.slave_id])).toEqual([[7,6],[17,8]]);
    expect(acceptedEvents()).toHaveLength(1);
  } finally { held.gate.resolve(); await flush(); }
});

test('a refused replacement rejects the attempt instead of accepting the stale prefetched snapshot', async () => {
  const failure = Object.assign(new Error('synthetic refused replacement'), { status: 401 });
  const downloadLatest = jest.fn(async ({ cutoff }) => ({ cutoff, dogs: [] }))
    .mockImplementationOnce(async ({ cutoff }) => ({ cutoff, dogs: [] }))
    .mockImplementationOnce(async () => { throw failure; });
  const f = await fixture({ downloadLatest });
  const held = holdSql(query => query.startsWith('CREATE TABLE IF NOT EXISTS cloud_latest_snapshot'));
  try {
    await f.start(); await jest.advanceTimersByTimeAsync(35000);
    held.gate.resolve(); await flush();
    expect(downloadLatest).toHaveBeenCalledTimes(2);
    expect(acceptedEvents()).toEqual([]);
    expect(f.current()).toMatchObject({ authFailed: true, mapSuccessRevision: 0 });
    expect(info.mock.calls).toContainEqual(['[CloudSync] failure', {
      attempt: 1, phase: 'download', failureKind: 'auth', status: 401,
    }]);
  } finally { held.gate.resolve(); await flush(); }
});

test('the replacement remains within the original global deadline and cannot publish its ignored-abort result', async () => {
  const replacement = deferred(); let signal;
  const downloadLatest = jest.fn(async ({ cutoff }) => ({ cutoff, dogs: [] }))
    .mockImplementationOnce(async ({ cutoff }) => ({ cutoff, dogs: [] }))
    .mockImplementationOnce(async ({ cutoff, signal: current }) => {
      signal = current; await replacement.promise; return { cutoff, dogs: [] };
    });
  const f = await fixture({ downloadLatest });
  const held = holdSql(query => query.startsWith('CREATE TABLE IF NOT EXISTS cloud_latest_snapshot'));
  try {
    await f.start(); await jest.advanceTimersByTimeAsync(110000);
    held.gate.resolve(); await flush();
    expect(downloadLatest).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(10000);
    expect(signal.aborted).toBe(true);
    expect(f.current()).toMatchObject({ busy: false, mapSuccessRevision: 0 });
    expect(acceptedEvents()).toEqual([]);
    expect(info.mock.calls).toContainEqual(['[CloudSync] failure', {
      attempt: 1, phase: 'download', failureKind: 'timeout', status: null,
    }]);
    replacement.resolve(); await flush(); expect(acceptedEvents()).toEqual([]);
  } finally { held.gate.resolve(); replacement.resolve(); await flush(); }
});

test('phase diagnostics include both request groups while overlapping native durations remain separate', async () => {
  let clock = NOW, membershipCall = 0;
  const masters1 = deferred(), masters2 = deferred(), latest1 = deferred(), latest2 = deferred();
  const downloadLatest = jest.fn()
    .mockImplementationOnce(async ({ cutoff }) => { await latest1.promise; return { cutoff, dogs: [] }; })
    .mockImplementationOnce(async ({ cutoff }) => { await latest2.promise; return { cutoff, dogs: [] }; });
  const f = await fixture({ now: () => clock, downloadLatest, beforeRead: async call => {
    if (call.phase === 'masters') {
      membershipCall++;
      if (membershipCall === 1) await masters1.promise;
      // One short membership page per group: the second group starts at call 2.
      if (membershipCall === 2) await masters2.promise;
    }
  } });
  const held = holdSql(query => query.startsWith('CREATE TABLE IF NOT EXISTS cloud_latest_snapshot'));
  try {
    await f.start();
    clock = NOW + 5; masters1.resolve(); await flush();
    clock = NOW + 12; latest1.resolve(); await flush();
    clock = NOW + 35000; held.gate.resolve(); await flush();
    clock = NOW + 35011; masters2.resolve(); await flush();
    clock = NOW + 35024; latest2.resolve(); await flush();
    expect(downloadLatest).toHaveBeenCalledTimes(2);
    expect(acceptedEvents()).toEqual([['[CloudSync] latest-published', {
      attempt: 1, elapsedMs: 35024, revision: 1,
      slotWaitMs: 0, initializeMs: 35000, archiveProofMs: 0, latestCacheReadMs: 0,
      mastersMs: 16, latestHTTPMs: 20, snapshotCommitMs: 0,
    }]]);
  } finally {
    held.gate.resolve(); masters1.resolve(); masters2.resolve(); latest1.resolve(); latest2.resolve(); await flush();
  }
});

test('a slow replacement does not start a third request group or reuse the first group', async () => {
  const replacement = deferred();
  const downloadLatest = jest.fn(async ({ cutoff }) => ({ cutoff, dogs: [] }))
    .mockImplementationOnce(async ({ cutoff }) => ({ cutoff, dogs: [] }))
    .mockImplementationOnce(async ({ cutoff }) => { await replacement.promise; return { cutoff, dogs: [] }; });
  const f = await fixture({ downloadLatest });
  const held = holdSql(query => query.startsWith('CREATE TABLE IF NOT EXISTS cloud_latest_snapshot'));
  try {
    await f.start(); await jest.advanceTimersByTimeAsync(35000);
    held.gate.resolve(); await flush();
    const secondCutoff = downloadLatest.mock.calls[1][0].cutoff;
    await jest.advanceTimersByTimeAsync(35000);
    replacement.resolve(); await flush();
    expect(downloadLatest).toHaveBeenCalledTimes(2);
    expect(f.current().snapshotCutoff).toBe(secondCutoff);
    expect(acceptedEvents()).toHaveLength(1);
  } finally { held.gate.resolve(); replacement.resolve(); await flush(); }
});

test.each(['archive proof', 'snapshot metadata'])('real %s retains its own readiness boundary after HTTP completes', async stage => {
  const f = await fixture(); await f.database.initialize();
  const held = holdSql(query => stage === 'archive proof'
    ? query.includes('SELECT cutoff,revision FROM cloud_archive_publication')
    : query.includes('SELECT revision FROM cloud_snapshot_state'));
  try {
    await f.start(); await held.entered.promise;
    expect(f.network.calls.some(call => call.phase === 'packet')).toBe(true);
    expect(f.current().mapSuccessRevision).toBe(stage === 'archive proof' ? 1 : 0);
    expect(acceptedEvents()).toHaveLength(stage === 'archive proof' ? 1 : 0);
    expect(f.current().archiveCutoff).toBeNull();
    held.gate.resolve(); await flush();
    expect(acceptedEvents()).toHaveLength(1);
    expect(f.current().mapSuccessRevision).toBe(1);
  } finally { held.gate.resolve(); await flush(); }
});

test('a real initialization failure aborts a held network sibling and retries storage without late publication', async () => {
  const transport = deferred(); let signal;
  const f = await fixture({ beforeRead: async call => {
    if (call.phase === 'packet') { signal = call.signal; await transport.promise; }
  } });
  const execute = db.executeAsync.getMockImplementation(), held = deferred(); let first = true;
  db.executeAsync.mockImplementation(async (query, params) => {
    if (first && query.startsWith('CREATE TABLE IF NOT EXISTS cloud_latest_snapshot')) {
      first = false; await held.promise; throw new Error('synthetic storage failure');
    }
    return execute(query, params);
  });
  try {
    await f.start(); expect(signal).toBeDefined();
    held.resolve(); await flush();
    expect(signal.aborted).toBe(true);
    expect(acceptedEvents()).toEqual([]);
    expect(info.mock.calls).toContainEqual(['[CloudSync] failure', {
      attempt: 1, phase: 'initialize', failureKind: 'storage', status: null,
    }]);
    transport.resolve(); await flush(); expect(acceptedEvents()).toEqual([]);
    engine.retry(); await flush();
    expect(f.current().mapSuccessRevision).toBe(1);
  } finally { held.resolve(); transport.resolve(); await flush(); }
});

test('early network rejection is handled while native work drains and reports its real download phase', async () => {
  const failure = Object.assign(new Error('synthetic refused snapshot'), { status: 401 });
  const downloadLatest = jest.fn(async () => { throw failure; });
  const f = await fixture({ downloadLatest });
  const held = holdSql(query => query.startsWith('CREATE TABLE IF NOT EXISTS cloud_latest_snapshot'));
  try {
    await f.start(); expect(downloadLatest).toHaveBeenCalledTimes(1);
    expect(acceptedEvents()).toEqual([]);
    held.gate.resolve(); await flush();
    expect(f.current()).toMatchObject({ authFailed: true, mapSuccessRevision: 0, busy: false });
    expect(info.mock.calls).toContainEqual(['[CloudSync] failure', {
      attempt: 1, phase: 'download', failureKind: 'auth', status: 401,
    }]);
  } finally { held.gate.resolve(); await flush(); }
});

test.each(['owner replacement', 'background'])('prefetched data cannot publish after %s while real native initialization drains', async action => {
  const f = await fixture(), held = holdSql(query => query.startsWith('CREATE TABLE IF NOT EXISTS cloud_latest_snapshot'));
  try {
    await f.start(); expect(f.network.calls.some(call => call.phase === 'packet')).toBe(true);
    if (action === 'owner replacement') engine.setSession({ user: { id: 'other-invented-owner' } });
    engine.setForeground(false);
    held.gate.resolve(); await flush();
    expect(acceptedEvents()).toEqual([]);
    expect(engine.mapPublication().mapSuccessRevision).toBe(0);
    expect(await f.database.readLatestSnapshot('invented-owner', { positionsOnly: true })).toBeNull();
  } finally { held.gate.resolve(); await flush(); }
});

test('background cancellation settles a latest transport that ignores abort without accepting its late result', async () => {
  const transport = deferred();
  const f = await fixture({ beforeRead: call => call.phase === 'packet' ? transport.promise : undefined });
  try {
    await f.start(); expect(f.network.calls.some(call => call.phase === 'packet')).toBe(true);
    engine.setForeground(false); await flush();
    await engine.dispose();
    expect(acceptedEvents()).toEqual([]);
    transport.resolve(); await flush();
    expect(acceptedEvents()).toEqual([]);
    expect(await f.database.readLatestSnapshot('invented-owner', { positionsOnly: true })).toBeNull();
  } finally { transport.resolve(); await flush(); }
});
