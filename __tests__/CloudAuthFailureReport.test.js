/* global globalThis */
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { AppState } from 'react-native';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { latestArchiveRest, cloudEvent } from '../__fixtures__/LatestArchiveRest';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { SERVER_BACKOFF_FIRST_MS, SERVER_BACKOFF_MAX_MS } from '../src/cloud/IndependentCloudSync';

const { createCloudSync } = jest.requireActual('../src/cloud/CloudSync');
jest.mock('../src/cloud/CloudSync', () => ({ createCloudSync: jest.fn() }));

const NOW = Date.parse('2026-10-15T02:00:00Z');
const OWNER = 'invented-report-owner';
const MINUTE = 60000;
let archive, latest, database, engine, states, info;

// Every REST read answers with `answer()`; auth is a session that refreshes.
function rest(answer) {
  const base = latestArchiveRest({ events: [cloudEvent(1, NOW - 1000)] });
  const counts = { requests: 0, refreshes: 0 };
  const builder = new Proxy({}, { get: (_target, key) => key === 'then'
    ? (resolve, reject) => { counts.requests++; return Promise.resolve().then(answer).then(resolve, reject); }
    : () => builder });
  const auth = base.client.auth;
  auth.refreshSession = async () => { counts.refreshes++;
    return { data: { session: { access_token: 'invented-access', user: { id: OWNER } } }, error: null }; };
  return { client: { auth, from: () => builder }, counts };
}
const refused = () => ({ data: null, error: { code: 'PGRST303', message: 'JWT expired' }, status: 401 });
const unavailable = () => ({ data: null, error: { code: '', message: 'Service Unavailable' }, status: 503 });
const limited = () => ({ data: null, error: { code: '', message: 'Too Many Requests' }, status: 429 });
const offline = () => ({ data: null, error: { message: 'TypeError: Network request failed' }, status: 0 });

async function start(network) {
  archive = createMemoryConnection(); latest = createMemoryConnection();
  await createDogDatabase(archive).initialize();
  database = createCloudDatabase(archive, { latestConnection: latest });
  states = [];
  engine = createCloudSync({ client: network.client, database,
    downloadContext: async () => { throw new Error('optional context unavailable'); },
    onChange: value => states.push(value) });
  engine.setSession({ user: { id: OWNER } }); engine.setForeground(true);
  await jest.advanceTimersByTimeAsync(1);
}
const rises = () => {
  let count = 0, before = false;
  for (const { authFailed } of states) { if (authFailed && !before) count++; before = !!authFailed; }
  return count;
};
const attempts = () => new Set(states.map(state => state.mapAttempt).filter(Boolean)).size;

beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(NOW);
  info = jest.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(async () => {
  await engine?.dispose(); engine = null;
  archive?.close(); latest?.close(); archive = latest = null;
  info.mockRestore(); jest.useRealTimers();
});

test('a lasting refusal stays one refusal: authFailed is not cleared at every 30 s attempt', async () => {
  const network = rest(refused);
  await start(network);
  await jest.advanceTimersByTimeAsync(3 * MINUTE);
  expect(attempts()).toBeGreaterThanOrEqual(6);
  // Before: authFailed went false→true on every attempt, and useCloudSync
  // asked AuthProvider for another refresh each time (2 refreshes per 30 s).
  expect(rises()).toBe(1);
  expect(states.at(-1)).toMatchObject({ authFailed: true });
  expect(states.every((state, index) => index === 0 || !states[index - 1].authFailed || state.authFailed)).toBe(true);
});

test('a success clears the kept failure (error and authFailed)', async () => {
  let answer = refused;
  const base = rest(() => answer());
  await start(base);
  expect(states.at(-1)).toMatchObject({ authFailed: true });
  expect(states.at(-1).error).not.toBe('');
  // The real fixture network again.
  const working = latestArchiveRest({ events: [cloudEvent(1, NOW - 1000)] });
  answer = null;
  base.client.from = (...args) => working.client.from(...args);
  await jest.advanceTimersByTimeAsync(30000);
  expect(states.at(-1)).toMatchObject({ authFailed: false, error: '', offline: false, failingSince: null });
  expect(states.at(-1).mapSuccessRevision).toBeGreaterThan(0);
});

test.each([['503', unavailable], ['429', limited]])('Supabase answering %s: automatic attempts back off up to 5 minutes', async (_name, answer) => {
  const network = rest(answer);
  await start(network);
  await jest.advanceTimersByTimeAsync(20 * MINUTE);
  // 30 s cadence would be 41 attempts; backing off 1, 2, 4, 5, 5… minutes is 7.
  expect(attempts()).toBeLessThanOrEqual(8);
  expect(attempts()).toBeGreaterThanOrEqual(5);
  expect(SERVER_BACKOFF_FIRST_MS).toBe(MINUTE);
  expect(SERVER_BACKOFF_MAX_MS).toBe(5 * MINUTE);
});

test('no network keeps the 30 s cadence, so the map recovers as soon as it can', async () => {
  const network = rest(offline);
  await start(network);
  await jest.advanceTimersByTimeAsync(10 * MINUTE);
  expect(attempts()).toBeGreaterThanOrEqual(20);
});

test('重試, a return to the app and a success all start the backoff over', async () => {
  const network = rest(unavailable);
  await start(network);
  await jest.advanceTimersByTimeAsync(8 * MINUTE);
  const before = attempts();
  // Deep in the backoff: 重試 runs one attempt at once.
  engine.retry(); await jest.advanceTimersByTimeAsync(1);
  expect(attempts()).toBe(before + 1);
  // A return to the app does too, and the next ones follow 1 minute apart.
  engine.setForeground(false); await jest.advanceTimersByTimeAsync(1);
  engine.setForeground(true); await jest.advanceTimersByTimeAsync(1);
  expect(attempts()).toBe(before + 2);
  await jest.advanceTimersByTimeAsync(MINUTE + 30000);
  expect(attempts()).toBe(before + 3);
});

describe('useCloudSync reports a refusal to AuthProvider', () => {
  const { createCloudSync: mocked } = jest.requireMock('../src/cloud/CloudSync');
  let onChange, reports, renderer;
  beforeEach(async () => {
    reports = jest.fn();
    mocked.mockImplementation(options => { onChange = options.onChange;
      return { setSession: jest.fn(), setForeground: jest.fn(), dispose: jest.fn(), retry: jest.fn() }; });
    AppState.currentState = 'active';
    const auth = { startAutoRefresh: jest.fn(async () => {}), stopAutoRefresh: jest.fn(async () => {}),
      onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
      getSession: jest.fn(async () => ({ data: { session: null }, error: null })) };
    const { useCloudSync } = require('../src/cloud/useCloudSync');
    // Stable inputs, as useAppCloudSync passes them (a new factory restarts the engine).
    const storage = {}, factory = () => ({ auth });
    function Probe() { useCloudSync(storage, true, factory, reports); return null; }
    await act(async () => { renderer = Renderer.create(<Probe />); });
  });
  afterEach(async () => { await act(async () => renderer.unmount()); mocked.mockReset(); });

  test('once per refusal, again if it is still refused 5 minutes later, and again after a recovery', async () => {
    const { AUTH_REPORT_REPEAT_MS } = require('../src/cloud/useCloudSync');
    expect(AUTH_REPORT_REPEAT_MS).toBe(5 * MINUTE);
    await act(async () => { for (let index = 0; index < 10; index++) onChange({ authFailed: true }); });
    expect(reports).toHaveBeenCalledTimes(1);
    jest.setSystemTime(NOW + 4 * MINUTE);
    await act(async () => onChange({ authFailed: true }));
    expect(reports).toHaveBeenCalledTimes(1);
    jest.setSystemTime(NOW + 5 * MINUTE);
    await act(async () => onChange({ authFailed: true }));
    expect(reports).toHaveBeenCalledTimes(2);
    await act(async () => { onChange({ authFailed: false }); onChange({ authFailed: true }); });
    expect(reports).toHaveBeenCalledTimes(3);
  });
});

describe('getCloudClient', () => {
  test('the shared client\'s transport guards the token refresh', async () => {
    jest.resetModules();
    const created = [];
    jest.doMock('@supabase/supabase-js', () => ({ createClient: (...args) => { created.push(args); return {}; } }));
    jest.doMock('../src/cloud/CloudConfig', () => ({ cloudConfig: { url: 'https://invented.supabase.co',
      publishableKey: 'sb_publishable_invented' } }));
    jest.doMock('../src/cloud/CloudSecureStorage', () => ({ createCloudSecureStorage: () => ({}) }));
    const portal = { ok: false, status: 511, headers: { get: () => 'text/html' } };
    const original = globalThis.fetch;
    globalThis.fetch = jest.fn(async () => portal);
    try {
      const { getCloudClient } = require('../src/cloud/CloudClient');
      getCloudClient();
      const fetch = created[0][2].global.fetch;
      await expect(fetch('https://invented.supabase.co/auth/v1/token?grant_type=refresh_token', { method: 'POST' }))
        .rejects.toThrow('Network request failed');
      await expect(fetch('https://invented.supabase.co/rest/v1/device_members')).resolves.toBe(portal);
    } finally {
      globalThis.fetch = original;
      jest.dontMock('@supabase/supabase-js'); jest.dontMock('../src/cloud/CloudConfig');
      jest.dontMock('../src/cloud/CloudSecureStorage');
    }
  });
});
