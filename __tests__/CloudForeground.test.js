import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { AppState, Text } from 'react-native';
import { createCloudSync } from '../src/cloud/CloudSync';
import { useCloudSync } from '../src/cloud/useCloudSync';

jest.mock('../src/cloud/CloudSync', () => ({ createCloudSync: jest.fn() }));

test('the scheduler and the token refresh follow the App being on screen', async () => {
  const engine = { setSession: jest.fn(), setForeground: jest.fn(), dispose: jest.fn() };
  createCloudSync.mockReturnValue(engine);
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
