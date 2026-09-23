import { runBackgroundCloudSync } from '../src/cloud/CloudBackgroundSync';
import { withCloudSyncSlot, cancelBackgroundSync } from '../src/cloud/CloudSyncSlot';

const NOW = Date.parse('2026-09-23T12:00:00Z');
const row = n => ({
  event_id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  master_id: 5, slave_id: 4, seq: n, received_at: '2026-09-23T11:59:00.123456Z',
  upload_source: 'phone', phone_received_at: '2026-09-23T10:00:00Z',
  payload: { lat: 25000000, lon: 121000000, speed: 0, satellites: 10, hdop: 100,
    gpsTimestamp: 100000, activityScore: 0, activityValid: 1, activityTimestamp: 100000,
    batteryMillivolts: 3900, batteryPercentage: 80, batteryValid: 1, slaveId: 4 },
});

function fixture(telemetry = async () => ({ data: [] })) {
  let appListener, authListener;
  const appState = { currentState: 'background', addEventListener: jest.fn((_, listener) => {
    appListener = listener; return { remove: jest.fn() };
  }) };
  const auth = { stopAutoRefresh: jest.fn(),
    getSession: jest.fn(async () => ({ data: { session: { user: { id: 'a' } } } })),
    onAuthStateChange: jest.fn(listener => {
      authListener = listener; return { data: { subscription: { unsubscribe: jest.fn() } } };
    }),
  };
  const queries = [];
  const client = { auth, from: table => {
    const query = { filters: {} };
    for (const method of ['select', 'eq', 'gte', 'lt', 'order', 'range', 'limit', 'or']) {
      query[method] = (...args) => { query.filters[method] = args; return query; };
    }
    query.abortSignal = signal => {
      if (table === 'device_members') return Promise.resolve({
        data: query.filters.range[0] === 0 ? [{ gateway_id: 'master_5' }] : [],
      });
      queries.push(query);
      return telemetry(signal, query);
    };
    return query;
  } };
  const database = { initialize: jest.fn(async () => {}), close: jest.fn(),
    loadSyncState: jest.fn(async () => ({ through_at: '2026-09-23T11:00:00Z', event_id: null })),
    savePage: jest.fn(async () => {}),
  };
  const native = { isCurrent: jest.fn(async () => true), complete: jest.fn(async () => {}),
    cancelAccount: jest.fn(async () => {}),
  };
  const deps = { native, appState, clientFactory: () => client, databaseFactory: () => database };
  return { native, auth, database, queries,
    run: () => runBackgroundCloudSync({ runId: 'run', owner: 'a' }, deps),
    foreground: () => { appState.currentState = 'active'; appListener('active'); },
    logout: () => authListener('SIGNED_OUT', null),
  };
}

beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(NOW); });
afterEach(() => { jest.useRealTimers(); });
const flush = () => jest.advanceTimersByTimeAsync(1);

test('bounded background pages preserve row cursors and original phone history time', async () => {
  let n = 0;
  const f = fixture(async () => ({ data: [row(++n)] }));
  await f.run();
  expect(f.queries).toHaveLength(4);
  expect(f.database.savePage).toHaveBeenLastCalledWith('a', [expect.objectContaining({
    track_at: Date.parse('2026-09-23T10:00:00Z'), received_at: Date.parse(row(4).received_at),
  })], { masterId: 5, throughAt: row(4).received_at, eventId: row(4).event_id });
  expect(f.native.complete).toHaveBeenCalledWith('run', 'success');
  expect(f.database.close).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

test('network failure retains checkpoint and asks WorkManager to retry', async () => {
  const f = fixture(async () => ({ error: { code: 'NETWORK' } }));
  await f.run();
  expect(f.database.savePage).not.toHaveBeenCalled();
  expect(f.native.complete).toHaveBeenCalledWith('run', 'retry');
});

test.each(['foreground', 'logout'])('%s discards a late network response', async action => {
  let respond;
  const f = fixture(() => new Promise(resolve => { respond = resolve; }));
  const task = f.run(); await flush();
  f[action]();
  respond({ data: [row(1)] }); await task;
  expect(f.database.savePage).not.toHaveBeenCalled();
  expect(f.native.complete).toHaveBeenCalledWith('run', 'cancelled');
  if (action === 'logout') expect(f.native.cancelAccount).toHaveBeenCalledWith('run');
});

test('native cancellation after losing network aborts the request and stops the polling timer', async () => {
  let signal;
  const f = fixture(s => new Promise(resolve => {
    signal = s; s.addEventListener('abort', () => resolve({ error: {} }), { once: true });
  }));
  const task = f.run(); await flush();
  f.native.isCurrent.mockResolvedValue(false);
  await jest.advanceTimersByTimeAsync(2000); await task;
  expect(signal.aborted).toBe(true);
  expect(f.database.savePage).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});

test('account mismatch never downloads another account and cancels only this worker generation', async () => {
  const f = fixture();
  f.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'b' } } } });
  await f.run();
  expect(f.database.initialize).not.toHaveBeenCalled();
  expect(f.native.cancelAccount).toHaveBeenCalledWith('run');
});

test('90-second budget also bounds session restoration', async () => {
  const f = fixture();
  f.auth.getSession.mockReturnValue(new Promise(() => {}));
  const task = f.run(); await flush();
  await jest.advanceTimersByTimeAsync(90000); await task;
  expect(f.native.complete).toHaveBeenCalledWith('run', 'retry');
  expect(jest.getTimerCount()).toBe(0);
});

test('foreground handoff aborts background and waits for its pending work before taking the slot', async () => {
  let respond;
  const f = fixture(() => new Promise(resolve => { respond = resolve; }));
  const background = f.run(); await flush();
  cancelBackgroundSync();
  const work = jest.fn();
  const foreground = withCloudSyncSlot(work);
  await flush(); expect(work).not.toHaveBeenCalled();
  respond({ data: [row(1)] }); await background; await foreground;
  expect(work).toHaveBeenCalledTimes(1);
  expect(f.database.savePage).not.toHaveBeenCalled();
});
