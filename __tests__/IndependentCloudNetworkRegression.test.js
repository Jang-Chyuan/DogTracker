import React, { useState } from 'react';
import Renderer, { act } from 'react-test-renderer';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { latestArchiveRest, cloudEvent } from '../__fixtures__/LatestArchiveRest';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { createCloudSync } from '../src/cloud/CloudSync';
import { mapCloudTelemetry } from '../src/cloud/CloudTelemetry';
import { useCloudDogs } from '../src/cloud/useCloudDogs';
import { completedMapRevision, latestMapApplied, mapDownloadBusy, mapReadRevision } from '../src/cloud/CloudPublication';

// Pure engine/React + two real SQLite files and real SDK query builders.
// Ignored HTTP aborts below are transport counterexamples, not native timing.
const NOW = Date.parse('2026-10-10T12:00:00Z'), OWNER = 'invented-owner';
const deferred = () => {
  let resolve, settled = false;
  const promise = new Promise(done => { resolve = () => { settled = true; done(); }; });
  return { promise, resolve, settled: () => settled };
};
let archive, latest, database, engine, tree, update, state, dogs, info, releases, observed;
function Consumer() {
  const [sync, setSync] = useState({ latestFirst: true }); update = setSync;
  dogs = useCloudDogs(database, OWNER, true, Date.now, null, { active: state?.foreground ?? true,
    contextEnabled: false, latestFirst: true, cloudBusy: mapDownloadBusy(sync),
    cloudSuccess: completedMapRevision(sync), revision: mapReadRevision(sync),
    getMapPublication: () => engine.mapPublication() });
  observed.push(dogs);
  return null;
}
const advance = async ms => { await act(async () => jest.advanceTimersByTimeAsync(ms)); };
const applied = () => info.mock.calls.filter(([tag]) => tag === '[CloudSync] latest-applied');
const read = () => database.readLatestSnapshot(OWNER, { positionsOnly: true });
beforeEach(async () => {
  jest.useFakeTimers(); jest.setSystemTime(NOW); releases = []; observed = [];
  tree = update = state = dogs = engine = null;
  info = jest.spyOn(console, 'info').mockImplementation(() => {});
  archive = createMemoryConnection(); latest = createMemoryConnection();
  await createDogDatabase(archive).initialize();
  database = createCloudDatabase(archive, { latestConnection: latest });
  expect(database.latestStorageIsolated).toBe(true);
});
afterEach(async () => {
  releases.forEach(release => release());
  await act(async () => {
    tree?.unmount(); update = null;
    await jest.advanceTimersByTimeAsync(1);
    await engine?.dispose();
  });
  archive.close(); latest.close(); info.mockRestore(); jest.useRealTimers();
});
async function seed(events) {
  const dogsInCache = events.map(row => {
    const packet = mapCloudTelemetry(row);
    return { slaveId: packet.slave_id, packet, fix: packet, context: [], seeds: [] };
  });
  await database.publishLatestSnapshot(OWNER, { cutoff: NOW - 100, dogs: dogsInCache });
  return read();
}
async function start(network) {
  engine = createCloudSync({ client: network.client, database,
    downloadContext: async () => { throw new Error('optional context unavailable'); },
    onChange: value => { state = value; update?.(value); } });
  await act(async () => { tree = Renderer.create(<Consumer />); });
  await act(async () => { engine.setSession({ user: { id: OWNER } }); engine.setForeground(true); await jest.advanceTimersByTimeAsync(1); });
}

test('ignored-abort membership HTTP yields the independent latest slot on background; resume ACK does not wait for its late result', async () => {
  const transport = deferred(); releases.push(transport.resolve);
  const events = [cloudEvent(1, NOW - 1000)];
  let first = true, heldCall;
  const network = latestArchiveRest({ events, beforeRead: call => {
    if (call.phase === 'masters' && first) { first = false; heldCall = call; return transport.promise; }
    return undefined;
  } });
  await start(network);
  expect(state).toMatchObject({ mapAttempt: 1, snapshotPending: true, mapSuccessRevision: 0 });
  expect(applied()).toHaveLength(0);
  await act(async () => { engine.setForeground(false); await jest.advanceTimersByTimeAsync(1000); });
  expect(heldCall.signal.aborted).toBe(true);
  expect(transport.settled()).toBe(false);
  events.push(cloudEvent(2, Date.now() - 100));
  await act(async () => { engine.setForeground(true); await jest.advanceTimersByTimeAsync(1); });
  expect(transport.settled()).toBe(false);
  expect(state).toMatchObject({ mapAttempt: 2, snapshotPending: false, mapSuccessRevision: 1, error: '' });
  expect(applied()).toHaveLength(1);
  expect(dogs.rows.map(row => row.event_id)).toEqual([events[1].event_id]);
  expect(latestMapApplied({ ...state, getMapPublication: () => engine.mapPublication() }, OWNER, dogs)).toBe(true);
  const committed = await read();
  transport.resolve(); await advance(1);
  expect(await read()).toEqual(committed);
  expect(state.mapSuccessRevision).toBe(1);
  expect(applied()).toHaveLength(1);
});

test('120s HTTP deadline preserves the prior durable latest set; retry recovers before the ignored old HTTP completes', async () => {
  const events = [cloudEvent(1, NOW - 1000)];
  const prior = await seed(events);
  const transport = deferred(); releases.push(transport.resolve);
  let hold = true;
  const network = latestArchiveRest({ events, beforeRead: call => hold && call.phase === 'packet' ? transport.promise : undefined });
  await start(network);
  expect(state.snapshotPending).toBe(true);
  await advance(120000);
  expect(state).toMatchObject({ mapAttempt: 1, snapshotPending: false, mapSuccessRevision: 0, offline: true });
  expect(state.error).toBeTruthy();
  expect(state.failingSince).not.toBeNull();
  expect(transport.settled()).toBe(false);
  expect(await read()).toEqual(prior);
  expect(applied()).toHaveLength(0);
  expect(latestMapApplied({ ...state, getMapPublication: () => engine.mapPublication() }, OWNER, dogs)).toBe(false);
  const heldCalls = network.calls.filter(call => call.phase === 'packet');
  expect(heldCalls.length).toBeGreaterThan(0);
  expect(heldCalls.every(call => call.signal.aborted)).toBe(true);
  hold = false; events.push(cloudEvent(2, Date.now() - 100));
  await act(async () => { engine.retry(); await jest.advanceTimersByTimeAsync(1); });
  expect(transport.settled()).toBe(false);
  expect(state).toMatchObject({ mapAttempt: 2, snapshotPending: false, mapSuccessRevision: 1, offline: false, error: '', failingSince: null });
  expect(applied()).toHaveLength(1);
  expect(dogs.rows.map(row => row.event_id)).toEqual([events[1].event_id]);
  const recovered = await read();
  expect(recovered.revision).toBe(prior.revision + 1);
  transport.resolve(); await advance(1);
  expect(await read()).toEqual(recovered);
  expect(applied()).toHaveLength(1);
});

test('one offline dog with a valid requested sibling cannot publish a partial set; retry atomically replaces both dogs', async () => {
  const old = [cloudEvent(1, NOW - 2000), cloudEvent(2, NOW - 2000, { slave: 8 })];
  const prior = await seed(old);
  const events = [...old, cloudEvent(3, NOW - 1000, { latitude: 25 }), cloudEvent(4, NOW - 1000, { slave: 8, latitude: 25.01 })];
  let fail = true, siblingRequested = false;
  const network = latestArchiveRest({ events, members: [{ gateway_id: 'master_7', slave_id: 6 }, { gateway_id: 'master_7', slave_id: 8 }],
    beforeRead: call => {
      if (call.phase === 'packet' && call.params.get('slave_id') === 'eq.6') siblingRequested = true;
      if (fail && call.phase === 'packet' && call.params.get('slave_id') === 'eq.8') throw new TypeError('Network request failed');
    } });
  await start(network);
  expect(siblingRequested).toBe(true);
  expect(state).toMatchObject({ snapshotPending: false, mapSuccessRevision: 0, offline: true });
  expect(state.error).toBeTruthy();
  expect(applied()).toHaveLength(0);
  expect(await read()).toEqual(prior);
  expect(observed.some(value => value.rows.some(row => [events[2].event_id, events[3].event_id].includes(row.event_id)))).toBe(false);
  fail = false;
  await act(async () => { engine.retry(); await jest.advanceTimersByTimeAsync(1); });
  expect(state).toMatchObject({ snapshotPending: false, mapSuccessRevision: 1, offline: false, error: '' });
  expect(applied()).toHaveLength(1);
  expect(dogs.rows.map(row => row.event_id)).toEqual([events[2].event_id, events[3].event_id]);
  const recovered = await read();
  expect(recovered.revision).toBe(prior.revision + 1);
  expect(recovered.rows.map(row => row.event_id)).toEqual([events[2].event_id, events[3].event_id]);
});
