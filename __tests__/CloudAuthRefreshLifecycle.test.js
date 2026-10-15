import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { AppState, NativeModules } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import { createIndependentCloudSync } from '../src/cloud/IndependentCloudSync';
import { useCloudSync } from '../src/cloud/useCloudSync';

jest.mock('../src/cloud/IndependentCloudSync', () => ({ createIndependentCloudSync: jest.fn() }));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
let tree, client, listeners, engine, oldAppState, oldNative, intervals;
beforeEach(() => {
  jest.useFakeTimers(); intervals = new Set(); listeners = []; tree = client = null;
  oldAppState = AppState.currentState; oldNative = NativeModules.CloudBackgroundSync;
  AppState.currentState = 'active'; NativeModules.CloudBackgroundSync = { setOwner: jest.fn(async () => {}) };
  engine = { setSession: jest.fn(), setForeground: jest.fn(), dispose: jest.fn() };
  createIndependentCloudSync.mockReturnValue(engine);
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_, callback) => {
    listeners.push(callback); return { remove: () => { listeners = listeners.filter(fn => fn !== callback); } };
  });
  const interval = global.setInterval, clear = global.clearInterval;
  jest.spyOn(global, 'setInterval').mockImplementation((fn, ms, ...args) => {
    const id = interval(fn, ms, ...args); if (ms === 30000) intervals.add(id); return id;
  });
  jest.spyOn(global, 'clearInterval').mockImplementation(id => { intervals.delete(id); return clear(id); });
});
afterEach(async () => {
  await act(async () => { tree?.unmount(); await settle(); await client?.auth.dispose(); });
  for (const id of intervals) clearInterval(id);
  jest.restoreAllMocks(); AppState.currentState = oldAppState; NativeModules.CloudBackgroundSync = oldNative;
  jest.useRealTimers();
});
function sdk(storage, fetch) {
  client = createClient('https://example.supabase.co', 'fixture-public-key', { auth: {
    storage, persistSession: !!storage, autoRefreshToken: true, detectSessionInUrl: false,
  }, global: { fetch: fetch || jest.fn(async () => { throw new Error('no session: HTTP must not be requested'); }) } });
  return client;
}
async function mount(current) {
  const database = {}, factory = () => current;
  function Probe() { useCloudSync(database, true, factory); return null; }
  await act(async () => { tree = Renderer.create(<Probe />); await settle(); });
  return Probe;
}

test('real installed SDK duplicate active events keep exactly one ticker, and background/unmount leave none', async () => {
  const current = sdk(); await current.auth.initialize(); await settle();
  await mount(current); expect(intervals.size).toBe(1);
  await act(async () => { listeners[0]('active'); listeners[0]('active'); await settle(); });
  expect(intervals.size).toBe(1);
  await act(async () => { listeners[0]('background'); await settle(); });
  expect(intervals.size).toBe(0);
  await act(async () => { listeners[0]('active'); await settle(); tree.unmount(); tree = null; await settle(); });
  expect(intervals.size).toBe(0);
});

test('real SDK late initial auto-start cannot leave a ticker after initial background or unmount; sync admission is immediate', async () => {
  const read = deferred();
  const current = sdk({ getItem: () => read.promise, setItem: jest.fn(), removeItem: jest.fn() });
  AppState.currentState = 'background'; await mount(current);
  expect(engine.setForeground).toHaveBeenLastCalledWith(false);
  await act(async () => { tree.unmount(); tree = null; await settle(); });
  await act(async () => { read.resolve(null); await current.auth.initialize(); await settle(); });
  expect(intervals.size).toBe(0);
});

test('real SDK signup/logout events do not create extra tickers or leave one after background and cleanup', async () => {
  const body = { access_token: 'fixture-access', refresh_token: 'fixture-refresh', token_type: 'bearer',
    expires_in: 3600, user: { id: 'fictional-owner' } };
  const current = sdk(null, jest.fn(async url => ({ ok: true, status: 200,
    headers: { get: () => 'application/json' }, json: async () => url.includes('/logout') ? {} : body })));
  await current.auth.initialize(); await mount(current);
  expect(intervals.size).toBe(1);
  await act(async () => {
    const result = await current.auth.signUp({ email: 'fixture@example.invalid', password: 'fixture-only' });
    expect(result.error).toBeNull(); await settle();
  });
  expect(engine.setSession).toHaveBeenLastCalledWith(expect.objectContaining({ user: { id: 'fictional-owner' } }));
  expect(intervals.size).toBe(1);
  await act(async () => { await current.auth.signOut({ scope: 'local' }); await settle(); });
  expect(engine.setSession).toHaveBeenLastCalledWith(null);
  expect(NativeModules.CloudBackgroundSync.setOwner).toHaveBeenLastCalledWith(null);
  // Preserve the SDK's existing foreground policy even while signed out;
  // changing auth events must not spawn another lifecycle/ticker.
  expect(intervals.size).toBe(1);
  await act(async () => { listeners[0]('background'); await settle(); });
  expect(intervals.size).toBe(0);
  await act(async () => { tree.unmount(); tree = null; await settle(); });
  expect(intervals.size).toBe(0);
});

test('cleanup waits for an already-started refresh transition to finish and then stops its ticker without delaying sync', async () => {
  const start = deferred(); let ticking = false;
  const auth = { initialize: async () => {}, getSession: async () => ({ data: { session: null } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: jest.fn() } } }),
    startAutoRefresh: jest.fn(async () => { await start.promise; ticking = true; }),
    stopAutoRefresh: jest.fn(async () => { ticking = false; }) };
  await mount({ auth }); expect(auth.startAutoRefresh).toHaveBeenCalledTimes(1);
  expect(engine.setForeground).toHaveBeenLastCalledWith(true);
  await act(async () => { tree.unmount(); tree = null; await settle(); });
  await act(async () => { start.resolve(); await settle(); });
  expect(ticking).toBe(false); expect(auth.stopAutoRefresh).toHaveBeenCalledTimes(1);
});

test('rapid transitions discard queued obsolete starts and remount cleanup cannot stop the new foreground owner', async () => {
  const start = deferred(); let ticking = false, concurrent = 0, maxConcurrent = 0;
  const auth = { initialize: async () => {}, getSession: async () => ({ data: { session: null } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: jest.fn() } } }),
    startAutoRefresh: jest.fn(async () => {
      maxConcurrent = Math.max(maxConcurrent, ++concurrent); await start.promise; ticking = true; concurrent--;
    }), stopAutoRefresh: jest.fn(async () => {
      maxConcurrent = Math.max(maxConcurrent, ++concurrent); ticking = false; concurrent--;
    }) };
  await mount({ auth });
  await act(async () => {
    listeners[0]('background'); listeners[0]('active'); listeners[0]('active');
    tree.unmount(); tree = null; await settle();
  });
  await mount({ auth });
  await act(async () => { start.resolve(); await settle(); });
  expect(maxConcurrent).toBe(1); expect(ticking).toBe(true);
  expect(auth.startAutoRefresh).toHaveBeenCalledTimes(2);
  await act(async () => { tree.unmount(); tree = null; await settle(); });
  expect(ticking).toBe(false);
});
