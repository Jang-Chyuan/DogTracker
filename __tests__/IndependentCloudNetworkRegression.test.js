import MapScreen from '../src/screens/MapScreen';
import TrackingMap from '../src/map/TrackingMap';
import { trackingPoint } from '../__fixtures__/TrackingPointFixtures';
import { emptyLiveRoute } from '../src/tracking/LiveRouteWindow';
import { DEFAULT_TRACKING_PREFERENCES } from '../src/tracking/TrackingPreferences';
import { GOOGLE_MAP_PROVIDER } from '../src/map/GoogleMapProvider';
import React, { useState } from 'react';
import Renderer, { act } from 'react-test-renderer';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { latestArchiveRest, cloudEvent } from '../__fixtures__/LatestArchiveRest';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { createIndependentCloudSync } from '../src/cloud/IndependentCloudSync';
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
let showMap;
const tracking = { mode: 'real', point: { ...trackingPoint, id: null, slaveId: null, slaveLat: null, slaveLon: null },
  route: emptyLiveRoute(), positionSamples: [], ready: { real: true }, errors: {},
  initialSnapshotReady: true, foreground: true,
  preferences: { ready: true, busy: false, value: DEFAULT_TRACKING_PREFERENCES } };
let archive, latest, database, engine, tree, update, state, dogs, info, releases, observed;
function Consumer() {
  const [sync, setSync] = useState({ latestFirst: true }); update = setSync;
  dogs = useCloudDogs(database, OWNER, true, Date.now, null, { active: state?.foreground ?? true,
    contextEnabled: false, latestFirst: true, cloudBusy: mapDownloadBusy(sync),
    cloudSuccess: completedMapRevision(sync), revision: mapReadRevision(sync),
    getMapPublication: () => engine.mapPublication() });
  observed.push(dogs);
  return showMap ? <MapScreen tracking={tracking} phone={{ enabled: true }} cloudOwner={OWNER} cloudDogs={dogs}
    cloudSync={{ ...sync, retry: () => engine.retry(), getMapPublication: () => engine.mapPublication() }}
    mapProvider={GOOGLE_MAP_PROVIDER} /> : null;
}
const advance = async ms => { await act(async () => jest.advanceTimersByTimeAsync(ms)); };
const applied = () => info.mock.calls.filter(([tag]) => tag === '[CloudSync] latest-applied');
const read = () => database.readLatestSnapshot(OWNER, { positionsOnly: true });
beforeEach(async () => {
  jest.useFakeTimers(); jest.setSystemTime(NOW); releases = []; observed = [];
  tree = update = state = dogs = engine = null; showMap = false;
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
  engine = createIndependentCloudSync({ client: network.client, database,
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
  expect(state).toMatchObject({ mapAttempt: 1, busy: true, snapshotPending: false, mapSuccessRevision: 0 });
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
  // Waiting on the network is not a pending snapshot (the map keeps its dogs live).
  expect(state).toMatchObject({ busy: true, snapshotPending: false });
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

// Ported from the retired map-from-archive engine: exercise the actual map
// indicator through HTTP failure, retry, native snapshot commit and readback.
test.each(['explicit', 'automatic'])('%s initial recovery stays visible until the independent SQLite readback reaches the map', async recovery => {
  showMap = true;
  let fail = true;
  const network = latestArchiveRest({ events: [cloudEvent(1, NOW - 1000, { latitude: 25 })],
    beforeRead: ({ phase }) => { if (fail && phase === 'packet') throw new TypeError('Network request failed'); } });
  await start(network);
  const shown = () => JSON.stringify(tree.toJSON());
  expect(state.catchUp.phase).toBe('failed');
  expect(shown()).toContain('更新失敗');
  fail = false;
  const commit = deferred(), readback = deferred(); releases.push(commit.resolve, readback.resolve);
  const batch = latest.executeBatchAsync.getMockImplementation(), execute = latest.executeAsync.getMockImplementation();
  let committed = false, reading = false;
  latest.executeBatchAsync.mockImplementation(async commands => {
    if (commands.some(command => command.query.includes('INSERT OR REPLACE INTO cloud_snapshot_state'))) {
      await commit.promise; committed = true;
    }
    return batch(commands);
  });
  latest.executeAsync.mockImplementation(async (sql, params) => {
    if (committed && sql.includes('s.origin,d.packet_json,d.fix_json') && !sql.includes('d.context_json')) {
      reading = true; await readback.promise;
    }
    return execute(sql, params);
  });
  if (recovery === 'explicit') {
    const button = tree.root.findAllByProps({ testID: 'map-catch-up-retry' }).find(node => node.props.onPress);
    await act(async () => { button.props.onPress(); await jest.advanceTimersByTimeAsync(1); });
  } else await advance(30000);
  const text = recovery === 'explicit' ? '正在更新狗的位置' : '更新失敗';
  expect(shown()).toContain(text);
  expect(state).toMatchObject({ snapshotPending: true, mapSuccessRevision: 0 });
  commit.resolve(); await advance(1);
  expect(reading).toBe(true);
  expect(shown()).toContain(text);
  expect(dogs.cloudCommit == null).toBe(true);
  readback.resolve(); await advance(1);
  expect(dogs.cloudCommit).toBe(1);
  expect(tree.root.findAllByProps({ testID: 'map-catch-up' })).toHaveLength(0);
  expect(tree.root.findByType(TrackingMap).props.presentation.dogMarkers
    .find(dog => dog.slaveId === 6).coordinate.latitude).toBe(25);
});

test.each(['error', 'abort'])('failed manual %s cannot replace the accepted map when React skips busy renders', async failure => {
  const network = latestArchiveRest({ events: [cloudEvent(1, NOW - 1000)] });
  await start(network);
  const accepted = await read(), previous = dogs.rows;
  const notify = update; update = null;
  const abort = new AbortController();
  await expect(engine.runManual(async () => {
    await database.savePage(OWNER, [mapCloudTelemetry(cloudEvent(2, NOW, { latitude: 26 }))]);
    if (failure === 'abort') abort.abort();
    throw new Error('incomplete manual scope');
  }, abort)).rejects.toThrow('incomplete manual scope');
  update = notify;
  await act(async () => { update({ ...state }); });
  expect(await read()).toEqual(accepted);
  expect(dogs.rows).toEqual(previous);
  expect(dogs.rows[0].slave_lat).toBe(24.9892);
  expect(engine.historyPublication().publishedPending).toBe(false);
});
