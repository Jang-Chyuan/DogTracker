import React, { useEffect } from 'react';
import Renderer, { act } from 'react-test-renderer';
import { NativeModules, Text } from 'react-native';
import { AuthProvider } from '../src/auth/AuthProvider';
import { AuthGate } from '../App';

function fixture() {
  let restore, notify;
  const client = { auth: {
    getSession: () => new Promise(resolve => { restore = resolve; }),
    onAuthStateChange: callback => {
      notify = callback;
      return { data: { subscription: { unsubscribe: jest.fn() } } };
    },
  } };
  return { factory: () => client,
    restore: session => restore({ data: { session } }),
    notify: session => notify(session ? 'SIGNED_IN' : 'SIGNED_OUT', session),
  };
}

test('startup waits for auth; only login mounts tracking; logout returns to login and cancels native sync', async () => {
  const f = fixture(), mounted = jest.fn(), unmounted = jest.fn();
  const previousCloud = NativeModules.CloudBackgroundSync, previousBle = NativeModules.BleBackground;
  const cloud = { setOwner: jest.fn(async () => {}) };
  const ble = { executeDatabase: jest.fn(async () => '{}') };
  NativeModules.CloudBackgroundSync = cloud; NativeModules.BleBackground = ble;
  function Main() {
    useEffect(() => { mounted(); return unmounted; }, []);
    return <Text>Tracking home</Text>;
  }
  let renderer;
  try {
    await act(async () => { renderer = Renderer.create(<AuthProvider clientFactory={f.factory}>
      <AuthGate><Main /></AuthGate>
    </AuthProvider>); });
    expect(mounted).not.toHaveBeenCalled();
    expect(JSON.stringify(renderer.toJSON())).toContain('正在恢復登入狀態');
    await act(async () => f.restore(null));
    expect(JSON.stringify(renderer.toJSON())).toContain('登入 DogTracker');
    expect(mounted).not.toHaveBeenCalled();
    await act(async () => f.notify({ user: { id: 'a', email: 'a@example.com' } }));
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(renderer.toJSON())).toContain('Tracking home');
    cloud.setOwner.mockClear(); ble.executeDatabase.mockClear();
    await act(async () => f.notify(null));
    expect(unmounted).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(renderer.toJSON())).toContain('登入 DogTracker');
    expect(cloud.setOwner).toHaveBeenCalledWith(null);
    expect(ble.executeDatabase).toHaveBeenCalledWith(expect.stringContaining("key='owner'"), '[]');
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    NativeModules.CloudBackgroundSync = previousCloud; NativeModules.BleBackground = previousBle;
  }
});

test('a restored session enters home without showing the login form', async () => {
  const f = fixture(); let renderer;
  await act(async () => { renderer = Renderer.create(<AuthProvider clientFactory={f.factory}>
    <AuthGate><Text>Tracking home</Text></AuthGate>
  </AuthProvider>); });
  await act(async () => f.restore({ user: { id: 'a' } }));
  expect(JSON.stringify(renderer.toJSON())).toContain('Tracking home');
  expect(JSON.stringify(renderer.toJSON())).not.toContain('登入 DogTracker');
  await act(async () => renderer.unmount());
});
