import { createClient } from '@supabase/supabase-js';
import { guardAuthRefresh, isRefreshRequest, isVerdict } from '../src/cloud/CloudRefreshGuard';
import { isAuthFailure, isNetworkFailure } from '../src/cloud/CloudErrors';

// Resume after the 1 h access token expired, on a network that does not
// answer the token refresh with GoTrue's JSON: a Wi-Fi login page, a proxy,
// Supabase overloaded or failing. The installed SDK deletes the stored sign-in
// for every such answer (only a thrown fetch or 502/503/504 are retryable to
// it), which the app showed as 登入失效 and which stopped BLE relay uploads.
const OWNER = 'invented-guard-owner';
const KEY = 'sb-invented-guard';
const URL = 'https://invented.supabase.co';
const REFRESH = `${URL}/auth/v1/token?grant_type=refresh_token`;

const json = (data, status = 200) => ({
  ok: status >= 200 && status < 300, status, statusText: String(status),
  headers: { get: name => name.toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : null },
  json: async () => data, text: async () => JSON.stringify(data),
});
const html = (status, body = '<html><body>Sign in to the Wi-Fi</body></html>') => ({
  ok: status >= 200 && status < 300, status, statusText: String(status),
  headers: { get: name => name.toLowerCase() === 'content-type' ? 'text/html' : null },
  json: async () => { throw new SyntaxError('Unexpected token <'); }, text: async () => body,
});
const session = (n, expiresAt) => ({ access_token: `invented-access-${n}`, refresh_token: `invented-refresh-${n}`,
  token_type: 'bearer', expires_in: 3600, expires_at: expiresAt, user: { id: OWNER, aud: 'authenticated' } });

const ANSWERS = {
  'captive portal 511 page': () => html(511),
  'captive portal 403 page': () => html(403),
  'proxy 404 page': () => html(404),
  'Supabase 500': () => json({ code: 'unexpected_failure', msg: 'Internal Server Error' }, 500),
  'Supabase 429': () => json({ code: 'over_request_rate_limit', msg: 'Rate limit exceeded' }, 429),
  'gateway 520 page': () => html(520),
  '200 login page instead of a session': () => html(200),
};

function sdk({ guard = true } = {}) {
  const store = new Map();
  const storage = {
    getItem: async key => store.get(key) ?? null,
    setItem: async (key, value) => { store.set(key, value); },
    removeItem: async key => { store.delete(key); },
  };
  const net = { answer: () => json(session(2, Math.floor(Date.now() / 1000) + 3600)), tokenCalls: 0 };
  const transport = jest.fn(async url => {
    if (String(url).includes('/auth/v1/token')) { net.tokenCalls++; return net.answer(); }
    return json([]);
  });
  const client = createClient(URL, 'sb_publishable_invented', {
    auth: { storage, storageKey: KEY, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: guard ? guardAuthRefresh(transport) : transport },
  });
  // Stored an hour ago: the access token has expired, the refresh token is fine.
  store.set(KEY, JSON.stringify(session(1, Math.floor(Date.now() / 1000) - 60)));
  const events = [];
  client.auth.onAuthStateChange(event => events.push(event));
  return { client, store, net, events };
}

beforeEach(() => { jest.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

test('only the refresh-token grant is recognised', () => {
  expect(isRefreshRequest(REFRESH)).toBe(true);
  expect(isRefreshRequest({ url: REFRESH })).toBe(true);
  expect(isRefreshRequest(`${URL}/auth/v1/token?grant_type=password`)).toBe(false);
  expect(isRefreshRequest(`${URL}/rest/v1/dog_telemetry?select=*`)).toBe(false);
  expect(isRefreshRequest(`${URL}/rest/v1/token?grant_type=refresh_token`)).toBe(false);
});

test('GoTrue sessions and refusals are verdicts; everything else is not', () => {
  expect(isVerdict(json({}, 200))).toBe(true);
  for (const status of [400, 401, 403]) expect(isVerdict(json({ code: 'refresh_token_not_found' }, status))).toBe(true);
  for (const status of [404, 408, 429, 500, 502, 503, 511, 520]) expect(isVerdict(json({}, status))).toBe(false);
  expect(isVerdict(html(200))).toBe(false);
  expect(isVerdict(html(403))).toBe(false);
  expect(isVerdict(null)).toBe(false);
});

test('the guard turns a non-verdict refresh answer into a network failure, and leaves other requests alone', async () => {
  const fetch = guardAuthRefresh(async url => (String(url).includes('/token') ? html(511) : json({ code: 'XX000' }, 500)));
  const error = await fetch(REFRESH, { method: 'POST' }).catch(value => value);
  expect(error).toBeInstanceOf(TypeError);
  expect(isNetworkFailure(error)).toBe(true);
  expect(error.message).not.toMatch(/invented/);
  // A PostgREST 500 is the data request's own answer.
  expect((await fetch(`${URL}/rest/v1/device_members`)).status).toBe(500);
  // A refusal reaches the SDK as it is.
  const refused = guardAuthRefresh(async () => json({ code: 'refresh_token_not_found' }, 400));
  expect((await refused(REFRESH)).status).toBe(400);
});

test('root cause: without the guard a captive portal page deletes the expired stored sign-in', async () => {
  const { client, store, net, events } = sdk({ guard: false });
  net.answer = () => html(511);
  const { data, error } = await client.auth.getSession();
  expect(data.session).toBeNull();
  expect(error?.name).toBe('AuthUnknownError');
  expect(isNetworkFailure(error)).toBe(false);
  expect(store.has(KEY)).toBe(false);
  expect(events).toContain('SIGNED_OUT');
});

test.each(Object.keys(ANSWERS))('%s: the sign-in is kept and refreshes once Supabase answers', async name => {
  jest.useFakeTimers();
  const { client, store, net, events } = sdk();
  net.answer = ANSWERS[name];
  // The SDK retries a network failure with its own backoff for ~25 s.
  const pending = client.auth.getSession();
  await jest.advanceTimersByTimeAsync(30000);
  const failed = await pending;
  expect(failed.data.session).toBeNull();
  // A connection problem for CloudSession / AuthProvider, never 登入失效.
  expect(failed.error?.name).toBe('AuthRetryableFetchError');
  expect(isNetworkFailure(failed.error)).toBe(true);
  expect(isAuthFailure(failed.error)).toBe(false);
  expect(store.has(KEY)).toBe(true);
  expect(events).not.toContain('SIGNED_OUT');
  // Back on a working network (after the SDK's 60 s failure cooldown): the
  // same stored sign-in refreshes.
  net.answer = () => json(session(2, Math.floor(Date.now() / 1000) + 3600));
  await jest.advanceTimersByTimeAsync(61000);
  const refreshed = await client.auth.getSession();
  expect(refreshed.error).toBeNull();
  expect(refreshed.data.session.access_token).toBe('invented-access-2');
  expect(events).not.toContain('SIGNED_OUT');
  jest.useRealTimers();
});

test('a refresh token Supabase refuses still ends the sign-in, once', async () => {
  const { client, store, net, events } = sdk();
  net.answer = () => json({ code: 'refresh_token_not_found', error_code: 'refresh_token_not_found',
    msg: 'Invalid Refresh Token: Refresh Token Not Found' }, 400);
  const { error } = await client.auth.getSession();
  expect(error?.status).toBe(400);
  expect(store.has(KEY)).toBe(false);
  expect(events.filter(event => event === 'SIGNED_OUT')).toHaveLength(1);
  expect(net.tokenCalls).toBe(1);
});
