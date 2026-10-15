import { createClient } from '@supabase/supabase-js';
import { cloudEvent } from '../__fixtures__/LatestArchiveRest';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const advance = async ms => { await jest.advanceTimersByTimeAsync(ms); };
let diagnostics;
beforeEach(() => { jest.useFakeTimers(); jest.resetModules(); diagnostics = require('../src/diagnostics/CloudAttemptDiagnostics'); });
afterEach(() => { delete global.__DOGTRACKER_PRIVATE_CLOUD_ATTEMPT__; jest.useRealTimers(); });
const fixture = () => {
  let now = 0, enabled = true;
  const output = [], instance = diagnostics.createCloudAttemptDiagnostics({ enabled: () => enabled,
    clock: () => now, sink: fields => output.push(fields) });
  return { instance, output, time: value => { now = value; }, enable: value => { enabled = value; } };
};

test('default-off observer creates no counters/timers/header reads and returns the exact original transport promise', async () => {
  const f = fixture(); f.enable(false);
  const promise = Promise.resolve({ status: 200 }), transport = jest.fn(() => promise);
  const headers = { get: jest.fn(() => { throw new Error('must not read'); }) };
  const fn = diagnostics.cloudDiagnosticFetch(transport, f.instance), signal = new AbortController().signal;
  expect(f.instance.begin(1)).toBeNull();
  expect(fn('private-url', { headers, signal })).toBe(promise);
  expect(headers.get).not.toHaveBeenCalled(); expect(f.output).toEqual([]);
  expect(jest.getTimerCount()).toBe(0);
});

test('aggregate tracks old shared-client drain separately from the current latest logical/fetch counters', () => {
  const f = fixture(), signal = new AbortController().signal;
  const old = f.instance.transport(undefined, 0), oldStorage = f.instance.storage('get');
  const a = f.instance.begin(1); a.bind(signal);
  const logical = f.instance.logical(signal, 'keys'), fetch = f.instance.transport(signal, 2);
  f.time(15); old(200); oldStorage(); fetch(503); logical();
  const heldFetch = f.instance.transport(signal, 3), heldStorage = f.instance.storage('get');
  a.finish(1, 'download', 'timeout', true);
  const first = f.output[0];
  expect(first).toMatchObject({ keysStarted: 1, keysDone: 1, keysPending: 0, fetchStarted: 2,
    fetchDone: 1, fetchPending: 1, retryMax: 3, retry503: 1,
    allFetchPendingAtStart: 1, allFetchStartedDelta: 2, allFetchDoneDelta: 2, allFetchPending: 1,
    storagegetPending: 1, allStoragegetPendingAtStart: 1, allStoragegetPending: 1 });
  const b = f.instance.begin(2);
  f.time(20); heldFetch(200); heldStorage();
  b.finish(0, 'publish', '', true);
  expect(f.output[1]).toMatchObject({ fetchStarted: 0, fetchDone: 0, allFetchPendingAtStart: 1,
    allFetchDoneDelta: 1, allFetchPending: 0, allStoragegetPendingAtStart: 1, allStoragegetPending: 0 });
  expect(f.output[0]).toEqual(first); // immutable closed attempt, no late overwrite
  expect(Object.values(first).every(value => Number.isInteger(value))).toBe(true);
  f.instance.close();
});

test('three summaries and one 240s deadline bound diagnostics without cancelling the application signal', async () => {
  const f = fixture();
  for (let i = 1; i <= 3; i++) f.instance.begin(i).finish(2, 'download', '', false);
  expect(f.instance.begin(4)).toBeNull(); expect(f.output).toHaveLength(3);
  f.instance.close();
  const g = fixture(), controller = new AbortController();
  g.instance.begin(1).bind(controller.signal);
  g.time(240000); await advance(240000);
  expect(g.output[0]).toMatchObject({ terminal: 3, elapsedMs: 240000 });
  expect(controller.signal.aborted).toBe(false); expect(g.instance.begin(2)).toBeNull();
  expect(jest.getTimerCount()).toBe(0);
});

test('invalid clock/activation, unknown stages, duplicate completions and refused sinks do not alter requests', () => {
  const output = jest.fn();
  const invalid = diagnostics.createCloudAttemptDiagnostics({ enabled: () => true, clock: () => NaN, sink: output });
  expect(invalid.begin(1)).toBeNull(); expect(output).not.toHaveBeenCalled();
  const f = fixture(), controller = new AbortController(), a = f.instance.begin(1); a.bind(controller.signal);
  expect(f.instance.logical(controller.signal, 'owner-secret')).toBeNull();
  const finish = f.instance.logical(controller.signal, 'packet'); finish(); finish();
  a.finish(1, 'download', 'network', true); a.finish(1, 'download', 'network', true);
  expect(f.output).toHaveLength(1); expect(f.output[0].packetDone).toBe(1);
  expect(JSON.stringify(f.output)).not.toContain('owner-secret');
  f.instance.close();
  const refused = diagnostics.createCloudAttemptDiagnostics({ enabled: () => true, clock: () => 1, sink: () => { throw new Error('private sink'); } });
  expect(() => refused.begin(1).finish(1, 'download', 'timeout', true)).not.toThrow(); refused.close();
});

test('counter cap is explicit, and a failed transport observer preserves response/error identity', async () => {
  const f = fixture(), controller = new AbortController(), a = f.instance.begin(1); a.bind(controller.signal);
  for (let i = 0; i < 4096; i++) f.instance.logical(controller.signal, 'keys')();
  expect(f.instance.logical(controller.signal, 'keys')).toBeNull();
  a.finish(1, 'download', 'timeout', true);
  expect(f.output[0]).toMatchObject({ keysStarted: 4096, keysDone: 4096, capped: 1 }); f.instance.close();
  const failed = { observing: () => true, transport: () => () => { throw new Error('sink refused'); } };
  const response = { status: 200 }, error = new Error('same transport failure');
  const fn = diagnostics.cloudDiagnosticFetch(jest.fn().mockResolvedValueOnce(response).mockRejectedValueOnce(error), failed);
  await expect(fn('not-recorded', {})).resolves.toBe(response);
  await expect(fn('not-recorded', {})).rejects.toBe(error);
});

test('real SDK retry and pre-fetch auth wait are distinguishable; query/response semantics remain identical when opted out', async () => {
  const NOW = Date.parse('2026-10-10T12:00:00Z'), held = deferred(), calls = [], summaries = [];
  const spy = jest.spyOn(console, 'info').mockImplementation((tag, text) => { if (tag === 'DOGTRACKER_PRIVATE_CLOUD_ATTEMPT') summaries.push(JSON.parse(text)); });
  const packet = cloudEvent(2, NOW - 1000, { latitude: 0, longitude: 0 }), fix = cloudEvent(1, NOW - 2000);
  let retry = true;
  const fetch = jest.fn(async (url, options) => {
    calls.push(String(url));
    const p = new URL(url).searchParams;
    let data;
    if (retry) { retry = false; return { status: 503, ok: false, headers: { get: () => null }, text: async () => '{}' }; }
    if (p.get('order')?.startsWith('slave_id.asc')) data = p.has('slave_id') ? [] : [packet];
    else if (p.get('upload_source') === 'eq.phone') data = [];
    else data = [p.has('payload->lat') ? fix : packet];
    return { status: 200, ok: true, headers: { get: () => null }, text: async () => JSON.stringify(data) };
  });
  try {
    global.__DOGTRACKER_PRIVATE_CLOUD_ATTEMPT__ = true;
    const { downloadCloudLatest } = require('../src/cloud/CloudLatest');
    const observation = diagnostics.beginCloudAttemptDiagnostic(1), controller = new AbortController(); observation.bind(controller.signal);
    const client = createClient('https://example.invalid', 'public-fixture-key', { auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: diagnostics.cloudDiagnosticFetch(fetch) } }); // production default retry remains ON
    client.auth.getSession = jest.fn(async () => {
      const done = diagnostics.beginCloudStorageDiagnostic('get');
      try { await held.promise; return { data: { session: { access_token: 'never-log-this-token' } } }; }
      finally { done?.(); }
    });
    let result;
    const task = downloadCloudLatest({ client, masterIds: [7], cutoff: NOW, signal: controller.signal }).then(value => { result = value; });
    await advance(5);
    expect(fetch).not.toHaveBeenCalled(); // logical keys started, actual transport not yet invoked
    held.resolve(); await advance(1001); await task;
    expect(result.dogs[0]).toMatchObject({ slaveId: 6, packet: { event_id: packet.event_id }, fix: { event_id: fix.event_id } });
    observation.finish(0, 'publish', '', true);
    expect(summaries[0]).toMatchObject({ keysStarted: 2, keysDone: 2, packetStarted: 1, packetDone: 1,
      fixStarted: 2, fixDone: 2, fetchStarted: 6, fetchDone: 6, retryMax: 1, retry503: 1, storageAggregate: 1 });
    expect(summaries[0].storagegetMs).toBeGreaterThanOrEqual(5);
    expect(Object.values(summaries[0]).every(value => Number.isInteger(value))).toBe(true);
    expect(JSON.stringify(summaries)).not.toMatch(/never-log|example|event_id|master_7|latitude|longitude/);
    const measuredCalls = calls.slice(1); // exclude only SDK retry, same logical request parameters
    calls.length = 0; global.__DOGTRACKER_PRIVATE_CLOUD_ATTEMPT__ = false;
    const plain = await downloadCloudLatest({ client, masterIds: [7], cutoff: NOW, signal: new AbortController().signal });
    expect(plain).toEqual(result); expect(calls).toEqual(measuredCalls);
    expect(summaries).toHaveLength(1);
  } finally { held.resolve(); spy.mockRestore(); }
});

test('real independent engine timeout emits one fixed numeric snapshot before query finalizers and ignored transport drain', async () => {
  const { createMemoryConnection } = require('../__fixtures__/SQLiteConnection');
  const { createDogDatabase } = require('../src/database/DogDatabase');
  const { createCloudDatabase } = require('../src/cloud/CloudDatabase');
  const { createIndependentCloudSync } = require('../src/cloud/IndependentCloudSync');
  const archive = createMemoryConnection(), latest = createMemoryConnection(), held = deferred(), summaries = [];
  let engine, state;
  const spy = jest.spyOn(console, 'info').mockImplementation((tag, text) => {
    if (tag === 'DOGTRACKER_PRIVATE_CLOUD_ATTEMPT') summaries.push(JSON.parse(text));
  });
  try {
    global.__DOGTRACKER_PRIVATE_CLOUD_ATTEMPT__ = true;
    await createDogDatabase(archive).initialize();
    const database = createCloudDatabase(archive, { latestConnection: latest });
    const fetch = async url => {
      const parsed = new URL(url), p = parsed.searchParams;
      let data;
      if (parsed.pathname.endsWith('device_members')) data = p.get('offset') === '0' ? [{ gateway_id: 'master_7', slave_id: 6 }] : [];
      else if (p.get('order')?.startsWith('slave_id.asc')) data = p.has('slave_id') ? []
        : [cloudEvent(900, Date.now() - 1, { upload_source: 'phone', phone_received_at: new Date(Date.now() - 86400000).toISOString() })];
      else { await held.promise; data = []; } // ignores abort; never a fake native SQL delay
      return { status: 200, ok: true, headers: { get: () => null }, text: async () => JSON.stringify(data) };
    };
    const client = createClient('https://example.invalid', 'public-fixture-key', { auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: diagnostics.cloudDiagnosticFetch(fetch) } });
    engine = createIndependentCloudSync({ client, database, onChange: value => { state = value; } });
    engine.setSession({ user: { id: 'do-not-log-owner' } }); engine.setForeground(true);
    await advance(1); expect(state).toMatchObject({ busy: true, snapshotPending: false });
    await advance(120000);
    expect(state).toMatchObject({ snapshotPending: false, mapSuccessRevision: 0, offline: true });
    expect(summaries).toHaveLength(1);
    // One short membership page ends the list: no terminal empty request.
    expect(summaries[0]).toMatchObject({ attempt: 1, terminal: 1, phase: 3, failureKind: 0, foreground: 1,
      mastersStarted: 1, mastersDone: 1, keysStarted: 2, keysDone: 2,
      packetStarted: 2, packetDone: 0, packetPending: 2, fetchStarted: 5, fetchDone: 3, fetchPending: 2,
      allFetchPending: 2, clockValid: 1 });
    expect(await database.readLatestSnapshot('do-not-log-owner', { positionsOnly: true })).toBeNull();
    expect(Object.values(summaries[0]).every(value => Number.isInteger(value))).toBe(true);
    expect(JSON.stringify(summaries)).not.toMatch(/do-not-log|example|master_7|payload|latitude/);
    held.resolve(); await advance(1);
    expect(summaries).toHaveLength(1); expect(summaries[0].fetchPending).toBe(2);
  } finally {
    held.resolve(); await engine?.dispose(); archive.close(); latest.close(); spy.mockRestore();
  }
});
