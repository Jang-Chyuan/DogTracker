import { createClient } from '@supabase/supabase-js';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { downloadCloudLatest } from '../src/cloud/CloudLatest';
import { createLatestSnapshotDatabase } from '../src/cloud/CloudLatestSnapshot';
import { mapCloudTelemetry } from '../src/cloud/CloudTelemetry';
import { createIndependentCloudSync } from '../src/cloud/IndependentCloudSync';

const NOW = Date.parse('2026-10-12T02:00:00Z');
const OWNER = 'invented-sdk-retry-owner';
const event = (id, slave, time) => ({
  event_id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
  master_id: 7, slave_id: slave, seq: id, received_at: new Date(time).toISOString(),
  payload: { lat: 25000000, lon: 121000000, satellites: 9, hdop: 1 }, upload_source: 'wifi',
});
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const flush = async () => { for (let index = 0; index < 50; index++) await Promise.resolve(); };
const response = (data, status = 200, retryAfter = null) => ({
  ok: status === 200, status, statusText: status === 200 ? 'OK' : 'Service Unavailable',
  headers: { get: name => name.toLowerCase() === 'retry-after' ? retryAfter : null },
  text: jest.fn(async () => JSON.stringify(data)),
});
const abortError = () => Object.assign(new Error('invented request canceled'), { name: 'AbortError' });

// Real installed SDK, including its DEFAULT retry=true path. No db.retry or
// builder.retry override: only the HTTP transport is independently invented.
function sdk(beforeFetch = async () => null) {
  const calls = [], rows = [event(11, 6, NOW - 1000), event(12, 8, NOW - 1000),
    ...[6, 8].map(slave => ({ ...event(900 + slave, slave, NOW - 1),
      upload_source: 'phone', phone_received_at: new Date(NOW - 86400000).toISOString() }))];
  // Force both actual packet clock GETs in SDK retry tests; the discovery
  // top is a late old phone upload, so the fallback request cannot be hinted.
  const client = createClient('https://example.invalid', 'public-fixture-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (url, options = {}) => {
      const params = new URL(url).searchParams, table = new URL(url).pathname.split('/').at(-1);
      const call = { table, params, signal: options.signal,
        retry: Number(options.headers?.get?.('x-retry-count')
          ?? Object.entries(options.headers || {}).find(([key]) => key.toLowerCase() === 'x-retry-count')?.[1] ?? 0),
        time: Date.now(), returned: false };
      calls.push(call);
      if (options.signal?.aborted) throw abortError();
      const intercepted = await beforeFetch(call);
      if (intercepted) { call.returned = true; return intercepted; }
      // A deliberately held intercepted response may ignore abort. Ordinary
      // fake requests honor the real SDK signal, including abort during sleep.
      if (options.signal?.aborted) throw abortError();
      let data;
      if (table === 'device_members') data = Number(params.get('offset') || 0) ? []
        : [{ gateway_id: 'master_7', slave_id: 6 }, { gateway_id: 'master_7', slave_id: 8 }];
      else if (params.get('order')?.startsWith('slave_id.asc')) {
        const after = Number((params.get('slave_id') || 'gt.0').slice(3));
        const next = rows.filter(row => row.slave_id > after).sort((a, b) => a.slave_id - b.slave_id
          || Date.parse(b.received_at) - Date.parse(a.received_at))[0];
        data = next ? [params.get('select') === 'slave_id' ? { slave_id: next.slave_id } : next] : [];
      } else data = rows.filter(row => `eq.${row.slave_id}` === params.get('slave_id')
        && (params.get('upload_source') === 'eq.phone' ? row.upload_source === 'phone' : row.upload_source !== 'phone'));
      call.returned = true; return response(data);
    } },
  });
  return { client, calls };
}
const dogEight = call => call.table === 'dog_telemetry' && call.params.get('slave_id') === 'eq.8'
  && call.params.get('upload_source') !== 'eq.phone';
let connection, database, engine, cached, pendingDownloads, controllers;
beforeEach(async () => {
  jest.useFakeTimers(); jest.setSystemTime(NOW); pendingDownloads = []; controllers = [];
  connection = createMemoryConnection();
  database = createLatestSnapshotDatabase(connection, async () => {});
  await database.publishLatestSnapshot(OWNER, { cutoff: NOW - 50000, masterIds: [7], dogs: [6, 8].map((slave, index) => {
    const packet = mapCloudTelemetry(event(index + 1, slave, NOW - 60000));
    return { slaveId: slave, packet, fix: packet };
  }) });
  cached = await database.readLatestSnapshot(OWNER, { positionsOnly: true });
});
afterEach(async () => {
  controllers.forEach(controller => controller.abort());
  await Promise.allSettled(pendingDownloads); await flush();
  await engine?.dispose(); engine = null;
  connection.close(); jest.clearAllTimers(); jest.useRealTimers();
});
function download(client, signal) {
  const controller = new AbortController(); controllers.push(controller);
  const task = downloadCloudLatest({ client, masterIds: [7], cutoff: NOW, signal: signal ?? controller.signal });
  task.catch(() => {}); pendingDownloads.push(task); return task;
}
async function unchanged() {
  expect(await database.readLatestSnapshot(OWNER, { positionsOnly: true })).toEqual(cached);
}
function publishWhenComplete(task) {
  const accepted = jest.fn();
  const done = task.then(async value => {
    accepted(value); await database.publishLatestSnapshot(OWNER, { ...value, masterIds: [7] }); return value;
  });
  done.catch(() => {});
  return { done, accepted };
}

test('default SDK network backoff retains the complete old SQL snapshot until both dogs succeed', async () => {
  const network = sdk(call => {
    if (dogEight(call) && call.retry === 0) throw new TypeError('invented network reject');
  });
  const pending = publishWhenComplete(download(network.client));
  await jest.advanceTimersByTimeAsync(0); await flush();
  expect(network.calls.some(call => call.params.get('slave_id') === 'eq.6' && call.returned)).toBe(true);
  expect(network.calls.filter(dogEight).map(call => call.retry)).toEqual([0]);
  expect(pending.accepted).not.toHaveBeenCalled(); await unchanged();
  await jest.advanceTimersByTimeAsync(999);
  expect(network.calls.filter(dogEight)).toHaveLength(1); await unchanged();
  await jest.advanceTimersByTimeAsync(1); await pending.done;
  expect(network.calls.filter(dogEight).map(call => call.retry)).toEqual([0, 1]);
  expect(pending.accepted).toHaveBeenCalledTimes(1);
  expect((await database.readLatestSnapshot(OWNER, { positionsOnly: true })).packets.map(row => row.sequence)).toEqual([11, 12]);
});

test('default SDK honors a 503 Retry-After instead of accepting a partial roster or retrying immediately', async () => {
  const unavailable = response({ message: 'invented schema unavailable' }, 503, '12');
  const network = sdk(call => dogEight(call) && call.retry === 0 ? unavailable : null);
  const pending = publishWhenComplete(download(network.client));
  await jest.advanceTimersByTimeAsync(0); await flush(); expect(unavailable.text).toHaveBeenCalledTimes(1); await unchanged();
  await jest.advanceTimersByTimeAsync(11999);
  expect(network.calls.filter(dogEight)).toHaveLength(1); expect(pending.accepted).not.toHaveBeenCalled(); await unchanged();
  await jest.advanceTimersByTimeAsync(1); await pending.done;
  const attempts = network.calls.filter(dogEight);
  expect(attempts.map(call => call.retry)).toEqual([0, 1]);
  expect(attempts[1].time - attempts[0].time).toBe(12000);
  expect(pending.accepted.mock.calls[0][0].dogs.map(dog => dog.slaveId)).toEqual([6, 8]);
});

test.each(['network reject', '503'])('exhausted default SDK %s retries reject the whole replacement and preserve the old snapshot', async mode => {
  const network = sdk(call => {
    if (!dogEight(call)) return null;
    if (mode === 'network reject') throw new TypeError('invented always unavailable');
    return response({ message: 'invented always unavailable' }, 503, '2');
  });
  const pending = publishWhenComplete(download(network.client));
  await jest.advanceTimersByTimeAsync(0); await flush(); await unchanged();
  await jest.advanceTimersByTimeAsync(mode === '503' ? 6000 : 7000);
  await expect(pending.done).rejects.toThrow();
  expect(network.calls.filter(dogEight).map(call => call.retry)).toEqual([0, 1, 2, 3]);
  expect(pending.accepted).not.toHaveBeenCalled(); await unchanged();
});

test.each(['network reject', '503 Retry-After', 'ignored abort'])('real foreground-to-background cancellation during %s releases the attempt without waiting for SDK backoff or transport', async mode => {
  const held = deferred();
  const network = sdk(call => {
    if (!dogEight(call)) return null;
    if (mode === 'ignored abort') return held.promise;
    if (mode === 'network reject') throw new TypeError('invented disconnected');
    return response({ message: 'invented schema cache wait' }, 503, '90');
  });
  const state = [];
  engine = createIndependentCloudSync({ client: network.client,
    database: { ...database, latestStorageIsolated: true },
    onChange: value => state.push(value) });
  engine.setSession({ user: { id: OWNER } }); engine.setForeground(true);
  await jest.advanceTimersByTimeAsync(0); await flush();
  expect(network.calls.filter(dogEight)).toHaveLength(1);
  expect(state.at(-1)).toMatchObject({ busy: true, snapshotPending: false, mapSuccessRevision: 0 }); await unchanged();
  const before = Date.now(); engine.setForeground(false); await flush();
  let disposed = false; const disposal = engine.dispose().then(() => { disposed = true; });
  await flush();
  // No timer advance: especially not the 90s Retry-After or the 120s deadline.
  expect(Date.now()).toBe(before); expect(disposed).toBe(true); await disposal;
  expect(state.at(-1)).toMatchObject({ foreground: false, busy: false, snapshotPending: false, mapSuccessRevision: 0 });
  expect(network.calls.filter(dogEight).every(call => call.signal.aborted)).toBe(true); await unchanged();
  const issuedAtCancellation = network.calls.length;
  held.resolve(response([event(12, 8, NOW - 1000)])); await flush();
  await jest.advanceTimersByTimeAsync(90001);
  expect(network.calls).toHaveLength(issuedAtCancellation);
  await unchanged();
});
