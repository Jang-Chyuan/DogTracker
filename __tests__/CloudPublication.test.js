import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { captureMapRead } from '../src/cloud/CloudPublication';
import { useCloudSync } from '../src/cloud/useCloudSync';

test('sync getter remains stable across initial readiness/account changes and closes on dispose', async () => {
  jest.useFakeTimers();
  let value, renderer, authChanged;
  const database = {};
  const client = { auth: {
    onAuthStateChange: listener => { authChanged = listener; return { data: { subscription: { unsubscribe: jest.fn() } } }; },
    getSession: async () => ({ data: { session: null } }),
    startAutoRefresh: jest.fn(), stopAutoRefresh: jest.fn(),
  } };
  const factory = () => client;
  function Probe({ ready }) { value = useCloudSync(database, ready, factory); return null; }
  try {
    await act(async () => { renderer = Renderer.create(<Probe ready={false} />); });
    const getter = value.getMapPublication;
    expect(getter()).toBeNull();
    await act(async () => { renderer.update(<Probe ready />); });
    expect(value.getMapPublication).toBe(getter);
    expect(getter()).toMatchObject({ owner: null, pending: false, mapSuccessRevision: 0 });
    await act(async () => { authChanged('SIGNED_IN', { user: { id: 'a' } }); });
    const first = getter();
    expect(first.owner).toBe('a');
    await act(async () => { authChanged('SIGNED_IN', { user: { id: 'b' } }); });
    expect(value.getMapPublication).toBe(getter);
    expect(getter()).toMatchObject({ owner: 'b', pending: false, mapSuccessRevision: 0 });
    expect(getter().generation).toBeGreaterThan(first.generation);
    const read = captureMapRead(getter, 'b', null);
    expect(read.valid()).toBe(true);
    await act(async () => { authChanged('SIGNED_OUT', null); });
    expect(getter().owner).toBeNull();
    expect(read.valid()).toBe(false);
    await act(async () => { renderer.unmount(); });
    renderer = null;
    expect(getter()).toBeNull();
  } finally {
    if (renderer) await act(async () => { renderer.unmount(); });
    jest.useRealTimers();
  }
});
