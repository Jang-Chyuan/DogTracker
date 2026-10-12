import { createClient } from '@supabase/supabase-js';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createLatestSnapshotDatabase } from '../src/cloud/CloudLatestSnapshot';
import { createCloudSecureStorage } from '../src/cloud/CloudSecureStorage';
import { createCloudSync } from '../src/cloud/CloudSync';

// Resume after the 1 h access token expired in the background (device log:
// attempt 24 `failure { phase: 'masters', failureKind: 'auth', status: 401 }`,
// 更新失敗, then attempt 25 recovered ~10 s later). Real installed SDK, real
// secure-storage adapter and SQL snapshot; only the network is invented.
const NOW = Date.parse('2026-10-12T11:00:00Z');
const OWNER = 'invented-resume-owner';
const KEY = 'sb-invented-auth-token';
const PUBLISHABLE = 'sb_publishable_invented';
const HOUR = 3600 * 1000;
const flush = async () => { for (let index = 0; index < 50; index++) await Promise.resolve(); };
const response = (data, status = 200) => ({
  ok: status >= 200 && status < 300, status, statusText: String(status),
  headers: { get: name => name.toLowerCase() === 'content-type' ? 'application/json' : null },
  json: async () => data, text: async () => JSON.stringify(data),
});
const event = (id, slave, time) => ({
  event_id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
  master_id: 7, slave_id: slave, seq: id, received_at: new Date(time).toISOString(),
  payload: { lat: 25000000, lon: 121000000, satellites: 9, hdop: 1 }, upload_source: 'wifi',
});

function server() {
  const vaultValues = new Map();
  const vault = {
    ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only' },
    getGenericPassword: jest.fn(async ({ service }) => vaultValues.has(service) ? { password: vaultValues.get(service) } : false),
    setGenericPassword: jest.fn(async (_, value, { service }) => { vaultValues.set(service, value); return { service }; }),
    resetGenericPassword: jest.fn(async ({ service }) => { vaultValues.delete(service); return true; }),
  };
  let issued = 0;
  const net = { refresh: 'ok', live: new Map(), rejectOnce: new Set(), tokenCalls: 0, rest: [] };
  const issue = () => {
    issued++;
    const session = { access_token: `invented-access-${issued}`, refresh_token: `invented-refresh-${issued}`,
      token_type: 'bearer', expires_in: 3600, user: { id: OWNER, aud: 'authenticated' } };
    net.live.set(session.access_token, Date.now() + HOUR);
    return session;
  };
  const first = issue();
  vaultValues.set(`com.dogtracker.supabase.${KEY}`, JSON.stringify({ ...first,
    expires_at: Math.floor((Date.now() + HOUR) / 1000) }));
  const fetch = jest.fn(async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/token')) {
      net.tokenCalls++;
      if (net.refresh === 'offline') throw new TypeError('Network request failed');
      if (net.refresh === 'revoked') return response({ code: 'refresh_token_not_found',
        error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' }, 400);
      return response(issue());
    }
    const bearer = new Headers(options.headers).get('Authorization')?.replace(/^Bearer /, '');
    const table = parsed.pathname.split('/').at(-1), params = parsed.searchParams;
    net.rest.push({ table, bearer });
    if (options.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    // Supabase: anonymous (publishable key as Bearer) has no grant here, and an
    // expired or rejected JWT is PGRST303. Both are HTTP 401.
    if (bearer === PUBLISHABLE) return response({ code: '42501', message: 'permission denied for table device_members' }, 401);
    if (net.rejectOnce.delete(bearer) || !(net.live.get(bearer) > Date.now()))
      return response({ code: 'PGRST303', message: 'JWT expired' }, 401);
    const rows = [event(11, 6, Date.now() - 1000), event(12, 8, Date.now() - 1000)];
    let data;
    if (table === 'device_members') data = Number(params.get('offset') || 0) ? [] : [{ gateway_id: 'master_7', slave_id: 6 }, { gateway_id: 'master_7', slave_id: 8 }];
    else if (params.get('order')?.startsWith('slave_id.asc')) {
      const after = Number((params.get('slave_id') || 'gt.0').slice(3));
      const next = rows.filter(row => row.slave_id > after).sort((a, b) => a.slave_id - b.slave_id)[0];
      data = next ? [params.get('select') === 'slave_id' ? { slave_id: next.slave_id } : next] : [];
    } else data = rows.filter(row => `eq.${row.slave_id}` === params.get('slave_id') && params.get('upload_source') !== 'eq.phone');
    return response(data);
  });
  const client = createClient('https://invented.supabase.co', PUBLISHABLE, {
    auth: { storage: createCloudSecureStorage(vault), storageKey: KEY, persistSession: true,
      autoRefreshToken: true, detectSessionInUrl: false },
    global: { fetch },
  });
  return { client, net, first };
}

let connection, database, engine, cloud, states, events, subscription;
beforeEach(async () => {
  jest.useFakeTimers(); jest.setSystemTime(NOW);
  connection = createMemoryConnection();
  database = createLatestSnapshotDatabase(connection, async () => {});
  cloud = server(); states = []; events = [];
  await cloud.client.auth.initialize(); cloud.client.auth.stopAutoRefresh();
  engine = createCloudSync({ client: cloud.client, database: { ...database, latestStorageIsolated: true },
    onChange: value => states.push(value) });
  // As useCloudSync: auth events drive the engine's owner.
  subscription = cloud.client.auth.onAuthStateChange((event, session) => {
    events.push(event); engine.setSession(session);
  }).data.subscription;
  await jest.advanceTimersByTimeAsync(0); await flush();
  // An ordinary foreground pass while the token is fresh, then 2 h away.
  cloud.client.auth.startAutoRefresh(); engine.setForeground(true);
  await jest.advanceTimersByTimeAsync(0); await flush();
  expect(states.at(-1)).toMatchObject({ owner: OWNER, mapSuccessRevision: 1, error: '' });
  engine.setForeground(false); cloud.client.auth.stopAutoRefresh();
  await flush();
  // Suspended process: the clock moves, no timer runs.
  jest.setSystemTime(NOW + 2 * HOUR);
  states.length = 0; cloud.net.rest.length = 0; cloud.net.tokenCalls = 0;
});
afterEach(async () => {
  subscription?.unsubscribe();
  cloud.client.auth.stopAutoRefresh();
  await engine?.dispose(); engine = null;
  await jest.advanceTimersByTimeAsync(31000); await flush();
  connection.close(); jest.clearAllTimers(); jest.useRealTimers();
});
const resume = async () => {
  cloud.client.auth.startAutoRefresh(); engine.setForeground(true);
  await jest.advanceTimersByTimeAsync(0); await flush();
};
const shownFailure = () => states.filter(state => state.authFailed || state.error || state.catchUp?.phase === 'failed');
// While the app was away a refresh (BLE relay upload / WorkManager) found no
// network: the SDK retries ~25 s, then caches the failure for 60 s.
async function backgroundRefreshFailure() {
  cloud.net.refresh = 'offline';
  const background = cloud.client.auth.getSession();
  await jest.advanceTimersByTimeAsync(30000);
  expect((await background).error?.name).toBe('AuthRetryableFetchError');
  cloud.net.refresh = 'ok';
}

test('root cause: during the SDK refresh cooldown a REST call goes out with the publishable key and gets 401', async () => {
  await backgroundRefreshFailure();
  const calls = cloud.net.tokenCalls;
  const { status } = await cloud.client.from('device_members').select('gateway_id');
  expect(status).toBe(401);
  expect(cloud.net.rest.at(-1)).toEqual({ table: 'device_members', bearer: PUBLISHABLE });
  expect(cloud.net.tokenCalls).toBe(calls);
});

test('resume inside the refresh cooldown waits for the session instead of showing 更新失敗', async () => {
  await backgroundRefreshFailure();
  await jest.advanceTimersByTimeAsync(48000);
  await resume();
  // No anonymous request, no failure: still 正在更新.
  expect(cloud.net.rest).toEqual([]);
  expect(shownFailure()).toEqual([]);
  expect(states.at(-1)).toMatchObject({ snapshotPending: true, catchUp: { phase: 'catching-up' } });
  await jest.advanceTimersByTimeAsync(14000); await flush();
  expect(states.at(-1)).toMatchObject({ mapSuccessRevision: 2, error: '', authFailed: false, offline: false,
    catchUp: { phase: 'idle' } });
  expect(shownFailure()).toEqual([]);
  expect(cloud.net.rest.length).toBeGreaterThan(0);
  expect(cloud.net.rest.every(call => call.bearer !== PUBLISHABLE && call.bearer !== cloud.first.access_token)).toBe(true);
  expect(events.filter(event => event === 'SIGNED_OUT')).toEqual([]);
});

test('resume with an expired token and a working network refreshes before the first request', async () => {
  await resume(); await flush();
  expect(states.at(-1)).toMatchObject({ mapSuccessRevision: 2, error: '', authFailed: false });
  expect(cloud.net.tokenCalls).toBe(1);
  expect(cloud.net.rest.every(call => call.bearer === 'invented-access-2')).toBe(true);
  expect(shownFailure()).toEqual([]);
});

test('a 401 on a token the SDK still trusts gets one forced refresh and the same attempt succeeds', async () => {
  // Fresh token on the phone, refused by the server (rotation, clock skew).
  jest.setSystemTime(NOW + 10 * 60 * 1000);
  const { data } = await cloud.client.auth.getSession();
  cloud.net.rejectOnce.add(data.session.access_token);
  await resume(); await flush();
  expect(cloud.net.tokenCalls).toBe(1);
  expect(cloud.net.rest.filter(call => call.table === 'device_members').map(call => call.bearer))
    .toEqual([data.session.access_token, 'invented-access-2']);
  expect(states.at(-1)).toMatchObject({ mapSuccessRevision: 2, mapAttempt: 2, error: '', authFailed: false });
  expect(shownFailure()).toEqual([]);
});

test('a revoked refresh token still ends the sign-in once, with no anonymous request and no retry loop', async () => {
  cloud.net.refresh = 'revoked';
  await resume(); await flush();
  expect(cloud.net.tokenCalls).toBe(1);
  expect(events.filter(event => event === 'SIGNED_OUT')).toHaveLength(1);
  expect(states.at(-1)).toMatchObject({ owner: null, busy: false, offline: false });
  await jest.advanceTimersByTimeAsync(120000); await flush();
  expect(cloud.net.tokenCalls).toBe(1);
  expect(cloud.net.rest).toEqual([]);
  expect(events.filter(event => event === 'SIGNED_OUT')).toHaveLength(1);
});

test('a server-refused token whose refresh is also refused reports auth once per attempt without retrying', async () => {
  jest.setSystemTime(NOW + 10 * 60 * 1000);
  const { data } = await cloud.client.auth.getSession();
  cloud.net.rejectOnce.add(data.session.access_token);
  cloud.net.refresh = 'revoked';
  await resume(); await flush();
  expect(cloud.net.tokenCalls).toBe(1);
  expect(cloud.net.rest.filter(call => call.table === 'device_members')).toHaveLength(1);
  expect(states.at(-1)).toMatchObject({ owner: OWNER, authFailed: true, offline: false, mapSuccessRevision: 1 });
});

test('going back to the background during the session wait releases the attempt at once', async () => {
  await backgroundRefreshFailure();
  await resume();
  expect(states.at(-1)).toMatchObject({ busy: true, snapshotPending: true });
  const before = Date.now();
  engine.setForeground(false); cloud.client.auth.stopAutoRefresh(); await flush();
  expect(Date.now()).toBe(before);
  expect(states.at(-1)).toMatchObject({ busy: false, snapshotPending: false });
  await jest.advanceTimersByTimeAsync(70000); await flush();
  expect(cloud.net.rest).toEqual([]);
  expect(shownFailure()).toEqual([]);
});
