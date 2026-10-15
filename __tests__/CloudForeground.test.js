import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { AppState, NativeModules, Text } from 'react-native';
import { createIndependentCloudSync } from '../src/cloud/IndependentCloudSync';
import { useCloudSync } from '../src/cloud/useCloudSync';

jest.mock('../src/cloud/IndependentCloudSync', () => ({ createIndependentCloudSync: jest.fn() }));

test('the scheduler and the token refresh follow the App being on screen', async () => {
  const engine = { setSession: jest.fn(), setForeground: jest.fn(), dispose: jest.fn() };
  createIndependentCloudSync.mockReturnValue(engine);
  const auth = {
    startAutoRefresh: jest.fn(),
    stopAutoRefresh: jest.fn(),
    onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
    getSession: jest.fn(async () => ({ data: { session: null } })),
  };
  const listeners = [];
  // On a phone the App mounts in the foreground; the mock starts elsewhere.
  AppState.currentState = 'active';
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    listeners.push(listener);
    return { remove: jest.fn() };
  });
  function Probe() {
    useCloudSync({}, true, () => ({ auth }));
    return <Text>probe</Text>;
  }
  let renderer;
  await act(async () => { renderer = Renderer.create(<Probe />); });
  expect(engine.setForeground).toHaveBeenLastCalledWith(true);
  // Leaving the App stops the 30 second scheduler. Keeping it running with the
  // screen off needed a headless task, and that task's wake lock never let the
  // phone sleep: one night in the background emptied the battery.
  await act(async () => listeners[0]('background'));
  expect(engine.setForeground).toHaveBeenLastCalledWith(false);
  expect(auth.stopAutoRefresh).toHaveBeenCalled();
  await act(async () => listeners[0]('active'));
  expect(engine.setForeground).toHaveBeenLastCalledWith(true);
  expect(auth.startAutoRefresh).toHaveBeenCalledTimes(2);
  await act(async () => renderer.unmount());
  expect(engine.dispose).toHaveBeenCalled();
});

test('login schedules durable work; logout cancels it; unmount does not cancel it', async () => {
  const engine = { setSession: jest.fn(), setForeground: jest.fn(), dispose: jest.fn() };
  createIndependentCloudSync.mockReturnValue(engine);
  const native = { setOwner: jest.fn(async () => {}) };
  NativeModules.CloudBackgroundSync = native;
  let notify;
  const auth = {
    startAutoRefresh: jest.fn(), stopAutoRefresh: jest.fn(),
    onAuthStateChange: callback => {
      notify = callback; return { data: { subscription: { unsubscribe: jest.fn() } } };
    },
    getSession: async () => ({ data: { session: { user: { id: 'account-a' } } } }),
  };
  const database = {};
  const factory = () => ({ auth });
  function Probe() { useCloudSync(database, true, factory); return null; }
  let renderer;
  try {
    await act(async () => { renderer = Renderer.create(<Probe />); });
    expect(native.setOwner).toHaveBeenLastCalledWith('account-a');
    await act(async () => notify('SIGNED_OUT', null));
    expect(native.setOwner).toHaveBeenLastCalledWith(null);
    await act(async () => notify('SIGNED_IN', { user: { id: 'account-b' } }));
    const calls = native.setOwner.mock.calls.length;
    await act(async () => renderer.unmount());
    expect(native.setOwner).toHaveBeenCalledTimes(calls);
    expect(native.setOwner).toHaveBeenLastCalledWith('account-b');
  } finally { delete NativeModules.CloudBackgroundSync; }
});

describe('a sign-in still stored while its refresh waits for the network', () => {
  const stored = JSON.stringify({ access_token: 'old', refresh_token: 'refresh', expires_at: 1,
    user: { id: 'account-a', email: 'a@example.test' } });
  async function start({ value = stored, session = null, error = null } = {}) {
    const engine = { setSession: jest.fn(), setForeground: jest.fn(), dispose: jest.fn() };
    createIndependentCloudSync.mockReturnValue(engine);
    let notify;
    const auth = {
      storageKey: 'sb-test-auth-token',
      storage: { getItem: jest.fn(async key => (key === 'sb-test-auth-token' ? value : null)) },
      startAutoRefresh: jest.fn(), stopAutoRefresh: jest.fn(),
      onAuthStateChange: callback => {
        notify = callback; return { data: { subscription: { unsubscribe: jest.fn() } } };
      },
      // Offline after the access token expired: no session, a network error.
      getSession: jest.fn(async () => ({ data: { session }, error })),
    };
    const owners = [];
    const database = {};
    const factory = () => ({ auth });
    function Probe() { owners.push(useCloudSync(database, true, factory).ownerId); return null; }
    let renderer;
    await act(async () => { renderer = Renderer.create(<Probe />); });
    return { engine, owners, send: (...args) => notify(...args),
      notify: (...args) => act(async () => notify(...args)),
      unmount: () => act(async () => renderer.unmount()) };
  }

  test('a cold start offline with an expired token keeps the stored account (its downloaded dogs)', async () => {
    const run = await start();
    await run.notify('INITIAL_SESSION', null);
    expect(run.owners.at(-1)).toBe('account-a');
    // The engine learns only the account, never the stored tokens.
    expect(run.engine.setSession).toHaveBeenLastCalledWith({ user: { id: 'account-a' } });
    // The SDK's refresh, once online, reports the same owner: nothing restarts.
    await run.notify('TOKEN_REFRESHED', { user: { id: 'account-a' } });
    expect(run.owners.at(-1)).toBe('account-a');
    await run.unmount();
  });

  test('the stored account is followed at once, before the SDK finishes its offline refresh retries', async () => {
    const engine = { setSession: jest.fn(), setForeground: jest.fn(), dispose: jest.fn() };
    createIndependentCloudSync.mockReturnValue(engine);
    let notify;
    const auth = {
      storageKey: 'sb-test-auth-token',
      storage: { getItem: async () => stored },
      startAutoRefresh: jest.fn(), stopAutoRefresh: jest.fn(),
      onAuthStateChange: callback => {
        notify = callback; return { data: { subscription: { unsubscribe: jest.fn() } } };
      },
      // Still retrying the refresh: no answer yet.
      getSession: () => new Promise(() => {}),
    };
    const owners = [];
    const database = {};
    const factory = () => ({ auth });
    function Probe() { owners.push(useCloudSync(database, true, factory).ownerId); return null; }
    let renderer;
    await act(async () => { renderer = Renderer.create(<Probe />); });
    expect(owners.at(-1)).toBe('account-a');
    // The refresh is finally refused: the SDK removed the session, signed out.
    await act(async () => notify('SIGNED_OUT', null));
    expect(owners.at(-1)).toBeNull();
    await act(async () => renderer.unmount());
  });

  test('getSession failing for the network before any event also keeps the stored account', async () => {
    const run = await start({ error: { name: 'AuthRetryableFetchError', status: 0 } });
    expect(run.owners.at(-1)).toBe('account-a');
    await run.unmount();
  });

  test('a sign-out (the SDK removed the stored session) or nothing stored is still signed out', async () => {
    const run = await start();
    await run.notify('INITIAL_SESSION', null);
    expect(run.owners.at(-1)).toBe('account-a');
    await run.notify('SIGNED_OUT', null);
    expect(run.owners.at(-1)).toBeNull();
    expect(run.engine.setSession).toHaveBeenLastCalledWith(null);
    await run.unmount();
    for (const value of [null, '{"user":{"id":"account-a"}}', 'not json']) {
      const empty = await start({ value });
      await empty.notify('INITIAL_SESSION', null);
      expect(empty.owners.at(-1)).toBeNull();
      await empty.unmount();
    }
  });

  test('a newer sign-in wins over a stored-session read still on its way', async () => {
    const run = await start();
    await act(async () => {
      run.send('INITIAL_SESSION', null);
      run.send('SIGNED_IN', { user: { id: 'account-b' } });
    });
    expect(run.owners.at(-1)).toBe('account-b');
    await run.unmount();
  });
});
