import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { captureMapRead, latestMapApplied } from '../src/cloud/CloudPublication';
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


test('latest-map completion requires the current applied atomic proof, not network completion or archive progress', () => {
  const scope = {};
  const publication = { owner: 'a', scope, generation: 3, attempt: 1, pending: false, busy: false, mapSuccessRevision: 2 };
  const sync = { latestFirst: true, busy: true, archivePending: true, publishedPending: true,
    mapSuccessRevision: 2, getMapPublication: () => publication };
  const dogs = { loaded: true, cloudCommit: 2,
    cloudPublication: { owner: 'a', scope, generation: 3, attempt: 1, revision: 2 } };
  expect(latestMapApplied(sync, 'a', dogs)).toBe(true);
  expect(latestMapApplied({ ...sync, getMapPublication: () => ({ ...publication, pending: true }) }, 'a', dogs)).toBe(true);
  for (const delta of [{ owner: 'b' }, { scope: {} }, { generation: 4 },
    { busy: true }, { mapSuccessRevision: 3 }, { attempt: 2 }, { attempt: 0 }, { attempt: undefined }, { attempt: 1.5 }])
    expect(latestMapApplied({ ...sync, getMapPublication: () => ({ ...publication, ...delta }) }, 'a', dogs)).toBe(false);
  for (const delta of [{ cloudCommit: 1 }, { loaded: false }, { cloudPublication: null },
    { cloudPublication: { ...dogs.cloudPublication, revision: 0 }, cloudCommit: 0 },
    { cloudPublication: { ...dogs.cloudPublication, attempt: 2 } },
    { cloudPublication: { ...dogs.cloudPublication, attempt: undefined } }, { error: 'read failed' }])
    expect(latestMapApplied(sync, 'a', { ...dogs, ...delta })).toBe(false);
  for (const delta of [{ latestFirst: false }, { snapshotPending: true }, { mapSuccessRevision: 0 },
    { error: 'latest failed' }, { authFailed: true }, { getMapPublication: () => null },
    { getMapPublication: () => { throw new Error('closed'); } }])
    expect(latestMapApplied({ ...sync, ...delta }, 'a', dogs)).toBe(false);
  expect(latestMapApplied(sync, null, dogs)).toBe(false);
});
