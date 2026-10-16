import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { latestArchiveRest, cloudEvent } from '../__fixtures__/LatestArchiveRest';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { createIndependentCloudSyncWithCommittedMapReader as createIndependentCloudSync } from '../__fixtures__/CommittedCloudMapReader';
import { downloadCloudHistory } from '../src/cloud/CloudDownload';
import { runBackgroundCloudSync } from '../src/cloud/CloudBackgroundSync';

const NOW = Date.parse('2026-10-10T12:00:00Z');
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };
const flush = () => jest.advanceTimersByTimeAsync(1);
let engine, connection, latest;
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(NOW); });
afterEach(async () => {
  await engine?.dispose(); connection?.close(); latest?.close(); engine = connection = null; jest.useRealTimers();
});
async function storage() {
  connection = createMemoryConnection(); latest = createMemoryConnection(); await createDogDatabase(connection).initialize();
  const database = createCloudDatabase(connection, { latestConnection: latest }); await database.initialize(); return database;
}
const history = (client, database, signal) => downloadCloudHistory({ client, database, signal,
  owner: 'invented-owner', masterId: 7, startAt: new Date(NOW - 60000).toISOString(),
  endBefore: new Date(NOW + 1000).toISOString() });

test('resume can replace the prior archive HTTP attempt even when its transport ignores abort', async () => {
  connection = createMemoryConnection(); latest = createMemoryConnection(); await createDogDatabase(connection).initialize();
  const database = createCloudDatabase(connection, { latestConnection: latest }); await database.initialize();
  const archive = deferred(); let first = true, heldSignal;
  const events = [cloudEvent(1, NOW - 1000)];
  const network = latestArchiveRest({ events, beforeRead: async call => {
    if (call.phase === 'archive' && first) {
      first = false; heldSignal = call.signal; await archive.promise;
    }
  } });
  engine = createIndependentCloudSync({ client: network.client, database,
    downloadContext: async () => { throw new Error('synthetic optional context unavailable'); } });
  try {
    engine.setSession({ user: { id: 'invented-owner' } }); engine.setForeground(true); await flush();
    expect(engine.mapPublication()).toMatchObject({ attempt: 1, mapSuccessRevision: 1, busy: false });
    expect(heldSignal).toBeDefined();
    events.push(cloudEvent(2, NOW));
    engine.setForeground(false); engine.setForeground(true); await flush();
    expect(heldSignal.aborted).toBe(true);
    expect(engine.mapPublication()).toMatchObject({ attempt: 2, mapSuccessRevision: 2, busy: false });
    const accepted = await database.readLatestSnapshot('invented-owner', { positionsOnly: true });
    expect(accepted.packets[0].event_id).toBe(events[1].event_id);
    archive.resolve(); await flush();
    expect(engine.mapPublication().attempt).toBe(2);
    expect((await database.readLatestSnapshot('invented-owner', { positionsOnly: true })).packets[0].event_id)
      .toBe(events[1].event_id);
  } finally { archive.resolve(); await flush(); }
});

test('an already aborted archive read never dispatches the SDK query or writes rows', async () => {
  const database = await storage(), abort = new AbortController(); abort.abort();
  const network = latestArchiveRest({ events: [cloudEvent(1, NOW)] });
  const save = jest.spyOn(database, 'savePage');
  await expect(history(network.client, database, abort.signal)).rejects.toThrow();
  expect(network.calls).toEqual([]); expect(save).not.toHaveBeenCalled();
});

test.each([false, true])('archive response listener is removed after ordinary response, refused=%s', async refused => {
  const database = await storage(), abort = new AbortController();
  const network = latestArchiveRest({ beforeRead: async () => { if (refused) throw new Error('synthetic read refusal'); } });
  const add = jest.spyOn(abort.signal, 'addEventListener'), remove = jest.spyOn(abort.signal, 'removeEventListener');
  if (refused) await expect(history(network.client, database, abort.signal)).rejects.toThrow();
  else await expect(history(network.client, database, abort.signal)).resolves.toBe(0);
  const added = add.mock.calls.filter(([name]) => name === 'abort').map(([, callback]) => callback);
  const removed = remove.mock.calls.filter(([name]) => name === 'abort').map(([, callback]) => callback);
  expect(added).toHaveLength(1); expect(removed).toEqual(added);
});

test('an ignored-abort archive transport may reject late without an unhandled rejection or page write', async () => {
  const database = await storage(), abort = new AbortController(), blocked = deferred();
  const network = latestArchiveRest({ events: [cloudEvent(1, NOW)], beforeRead: () => blocked.promise });
  const save = jest.spyOn(database, 'savePage'), unhandled = jest.fn();
  process.on('unhandledRejection', unhandled);
  const task = history(network.client, database, abort.signal);
  const refused = (async () => { await expect(task).rejects.toThrow(); })();
  try {
    await flush(); expect(network.calls).toHaveLength(1);
    abort.abort(); await refused;
    blocked.reject(new Error('synthetic late transport refusal')); await flush();
    expect(save).not.toHaveBeenCalled(); expect(unhandled).not.toHaveBeenCalled();
  } finally { blocked.resolve(); process.removeListener('unhandledRejection', unhandled); }
});

test('resume replaces latest while a started native archive page transaction drains', async () => {
  const database = await storage(), native = deferred(); let first = true, entered = false;
  const batch = connection.executeBatchAsync.getMockImplementation();
  connection.executeBatchAsync.mockImplementation(async commands => {
    if (first && commands.some(command => command.query.startsWith('INSERT INTO cloud_auto_supabase_dog_status'))) {
      first = false; entered = true; await native.promise;
    }
    return batch(commands);
  });
  const events = [cloudEvent(1, NOW - 1000)], network = latestArchiveRest({ events });
  engine = createIndependentCloudSync({ client: network.client, database,
    downloadContext: async () => { throw new Error('synthetic optional context unavailable'); } });
  try {
    engine.setSession({ user: { id: 'invented-owner' } }); engine.setForeground(true); await flush();
    expect(entered).toBe(true);
    events.push(cloudEvent(2, NOW));
    engine.setForeground(false); engine.setForeground(true); await flush();
    expect(engine.mapPublication().attempt).toBe(2);
    native.resolve(); await flush();
    expect(engine.mapPublication()).toMatchObject({ attempt: 2, mapSuccessRevision: 2 });
    expect((await database.readLatestSnapshot('invented-owner', { positionsOnly: true })).packets[0].event_id)
      .toBe(events[1].event_id);
  } finally { native.resolve(); await flush(); }
});

test('owner replacement cannot publish the canceled archive response into either owner', async () => {
  const database = await storage(), held = deferred(); let first = true;
  const events = [cloudEvent(1, NOW - 1000)], network = latestArchiveRest({ events, beforeRead: async call => {
    if (call.phase === 'archive' && first) { first = false; await held.promise; }
  } });
  engine = createIndependentCloudSync({ client: network.client, database,
    downloadContext: async () => { throw new Error('synthetic optional context unavailable'); } });
  try {
    engine.setSession({ user: { id: 'invented-owner' } }); engine.setForeground(true); await flush();
    events.push(cloudEvent(2, NOW));
    engine.setSession({ user: { id: 'invented-new-owner' } }); await flush();
    expect(engine.mapPublication()).toMatchObject({ owner: 'invented-new-owner', attempt: 1, mapSuccessRevision: 1 });
    expect(await database.count('invented-owner')).toBe(0);
    held.resolve(); await flush();
    expect(await database.count('invented-owner')).toBe(0);
    expect((await database.readLatestSnapshot('invented-new-owner', { positionsOnly: true })).packets[0].event_id)
      .toBe(events[1].event_id);
  } finally { held.resolve(); await flush(); }
});

test('thirty-second latest polling bypasses ignored-abort archive HTTP', async () => {
  const database = await storage(), held = deferred(); let first = true, signal;
  const network = latestArchiveRest({ events: [cloudEvent(1, NOW - 1000)], beforeRead: async call => {
    if (call.phase === 'archive' && first) { first = false; signal = call.signal; await held.promise; }
  } });
  engine = createIndependentCloudSync({ client: network.client, database,
    downloadContext: async () => { throw new Error('synthetic optional context unavailable'); } });
  try {
    engine.setSession({ user: { id: 'invented-owner' } }); engine.setForeground(true); await flush();
    await jest.advanceTimersByTimeAsync(30000);
    expect(signal.aborted).toBe(false);
    expect(engine.mapPublication().attempt).toBeGreaterThanOrEqual(2);
  } finally { held.resolve(); await flush(); }
});

test.each(['foreground', 'deadline'])('headless archive %s cancellation releases the shared slot for a foreground latest reader', async reason => {
  const database = await storage(), held = deferred(); let first = true, appListener;
  const network = latestArchiveRest({ events: [cloudEvent(1, NOW - 1000)], beforeRead: async call => {
    if (call.phase === 'archive' && first) { first = false; await held.promise; }
  } });
  jest.spyOn(network.client.auth, 'getSession').mockResolvedValue({ data: { session: { user: { id: 'invented-owner' } } } });
  // Authentication is an invented boundary; all REST queries and SQLite writes
  // remain real. The SDK's empty in-memory INITIAL_SESSION must not log it out.
  jest.spyOn(network.client.auth, 'onAuthStateChange').mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
  const appState = { currentState: 'background', addEventListener: (_name, listener) => {
    appListener = listener; return { remove: jest.fn() };
  } };
  const native = { isCurrent: async () => true, complete: jest.fn(async () => {}), cancelAccount: jest.fn(async () => {}) };
  const background = runBackgroundCloudSync({ runId: 'invented-run', owner: 'invented-owner' }, {
    native, appState, clientFactory: () => network.client,
    databaseFactory: () => ({ ...database, close: jest.fn(),
      uploadDatabase: { identity: async () => 'invented-phone', pending: async () => [] } }),
  });
  try {
    await flush(); expect(first).toBe(false);
    if (reason === 'deadline') {
      await jest.advanceTimersByTimeAsync(90000); await background;
      expect(native.complete).toHaveBeenCalledWith('invented-run', 'retry');
      expect(await database.readArchivePublication('invented-owner')).toBeNull();
    }
    engine = createIndependentCloudSync({ client: network.client, database,
      downloadContext: async () => { throw new Error('synthetic optional context unavailable'); } });
    engine.setSession({ user: { id: 'invented-owner' } });
    appState.currentState = 'active'; appListener('active'); engine.setForeground(true); await flush();
    await background;
    expect(native.complete).toHaveBeenCalledWith('invented-run', reason === 'deadline' ? 'retry' : 'cancelled');
    expect(engine.mapPublication()).toMatchObject({ attempt: 1, mapSuccessRevision: 1 });
    held.resolve(); await flush();
    expect(engine.mapPublication().mapSuccessRevision).toBe(1);
  } finally { held.resolve(); await background; await flush(); }
});
