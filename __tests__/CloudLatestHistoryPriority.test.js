import React, { useEffect, useState } from 'react';
import Renderer, { act } from 'react-test-renderer';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { latestArchiveRest, cloudEvent } from '../__fixtures__/LatestArchiveRest';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { createHistoryDatabase } from '../src/mapHistory/HistoryDatabase';
import { useTrackingSession } from '../src/app/useTrackingSession';
import { createIndependentCloudSync } from '../src/cloud/IndependentCloudSync';
import { useCloudDogs } from '../src/cloud/useCloudDogs';
import { createHistoryCloud } from '../src/mapHistory/HistoryCloud';
import { useHistoryCloud } from '../src/mapHistory/useHistoryCloud';
import { completedMapRevision, latestMapApplied, mapDownloadBusy, mapReadRevision } from '../src/cloud/CloudPublication';

const NOW = Date.parse('2026-10-10T12:00:00Z'), owner = 'invented-owner', clock = () => Date.now();
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };
let latest, connection, tracking, engine, renderer, factory, current, update, dogs, history, cloud, transport, retention, retentionEntered;
function Readers({ ownedRead = false, mapReader = true }) {
  const [state, setState] = useState(current); update = setState;
  dogs = useCloudDogs(tracking.cloudDatabase, state.owner, mapReader, clock, null, {
    active: state.foreground, latestFirst: true, cloudBusy: mapDownloadBusy(state), cloudSuccess: completedMapRevision(state),
    revision: mapReadRevision(state), getMapPublication: () => engine.mapPublication(),
  });
  history = useHistoryCloud({ cloud, slaveId: 6, scope: 'independent-dog-scope', todayKey: '2026-10-10',
    local: ['2026-10-10'], active: state.foreground, cutoff: NOW, publicationRevision: state.publishedRevision });
  useEffect(() => {
    if (ownedRead) tracking.historyDatabase.historyDayRows({ owner, subject: 'dog', slaveId: 6,
      start: NOW - 3600000, end: NOW }).catch(() => {});
  }, [ownedRead]);
  return null;
}
function Harness({ readers = false, ownedRead = false, mapReader = true }) {
  tracking = useTrackingSession(factory);
  return readers ? <Readers ownedRead={ownedRead} mapReader={mapReader} /> : null;
}
beforeEach(async () => {
  jest.useFakeTimers(); jest.setSystemTime(NOW); update = null; dogs = history = null; retentionEntered = false;
  jest.spyOn(console, 'info').mockImplementation(() => {});
  connection = createMemoryConnection(); latest = createMemoryConnection();
  const real = createDogDatabase(connection); await real.initialize();
  const database = createCloudDatabase(connection, { latestConnection: latest }); transport = deferred(); retention = deferred();
  const batch = connection.executeBatchAsync.getMockImplementation();
  connection.executeBatchAsync.mockImplementation(async commands => {
    if (commands.some(command => command.query.startsWith('DELETE FROM supabase_dog_status WHERE id IN'))) {
      retentionEntered = true; await retention.promise;
    }
    return batch(commands);
  });
  const databases = { real, cloud: database, history: createHistoryDatabase(connection), close: jest.fn(),
    settings: { initialize: async () => {}, load: async () => ({ mode: 'real' }), save: async () => {} } };
  factory = () => databases;
  factory.latestStorageIsolated = true;
  await act(async () => { renderer = Renderer.create(<Harness />); });
  const network = latestArchiveRest({ events: [cloudEvent(1, NOW - 1000)], beforeRead: ({ phase }) => {
    if (phase === 'packet') return transport.promise;
  } });
  engine = createIndependentCloudSync({ database: tracking.cloudDatabase, client: network.client,
    downloadContext: async () => { throw new Error('optional context unavailable'); },
    onChange: value => { current = value; update?.(value); } });
  engine.setSession({ user: { id: owner } }); engine.setForeground(true);
  cloud = createHistoryCloud({ database: tracking.cloudDatabase, client: network.client, owner,
    runManual: (...args) => engine.runManual(...args), getPublication: () => engine.historyPublication() });
  jest.spyOn(cloud, 'downloadStates');
});
afterEach(async () => {
  transport.resolve(); retention.resolve();
  await act(async () => { renderer?.unmount(); update = null; await engine?.dispose(); await jest.advanceTimersByTimeAsync(1); });
  connection.close(); latest.close(); jest.restoreAllMocks(); jest.useRealTimers();
});

test.each([false, true])('already mounted history cannot enqueue maintenance before the first committed map ACK (owned day command %s)', async ownedRead => {
  // Auth and the engine exist, but no scheduler timer has run: the initial
  // attempt=0 publication must already guard history proof and SQL readers.
  await act(async () => { renderer.update(<Harness readers ownedRead={ownedRead} />); });
  expect(retentionEntered).toBe(false);
  expect(cloud.downloadStates).not.toHaveBeenCalled();
  await act(async () => jest.advanceTimersByTimeAsync(1));
  expect(retentionEntered).toBe(false);
  expect(history.completenessLoaded).toBe(false);
  await act(async () => { transport.resolve(); await jest.advanceTimersByTimeAsync(1); });
  expect(latestMapApplied({ ...current, getMapPublication: () => engine.mapPublication() }, owner, dogs)).toBe(true);
  expect(retentionEntered).toBe(true);
  expect(current.archiveCutoff).toBeNull();
  expect(history.completenessLoaded).toBe(false);
  retention.resolve(); await act(async () => jest.advanceTimersByTimeAsync(1));
  expect(current.archiveRevision).toBe(1);
});


test('an isolated history reader has a bounded defer and can retry after the global map reader mounts', async () => {
  let outcome;
  const read = tracking.historyDatabase.historyDayRows({ owner, subject: 'dog', slaveId: 6,
    start: NOW - 3600000, end: NOW }).then(() => { outcome = 'done'; }, () => { outcome = 'deferred'; });
  await act(async () => { renderer.update(<Harness readers mapReader={false} />); transport.resolve();
    await jest.advanceTimersByTimeAsync(10001); });
  await read;
  expect(outcome).toBe('deferred');
  expect(retentionEntered).toBe(false);
  expect(current.archiveCutoff).toBeNull();
  expect(history.completenessLoaded).toBe(false);
  await act(async () => { renderer.update(<Harness readers />); await jest.advanceTimersByTimeAsync(1); });
  expect(engine.historyPublication().latestReadReady).toBe(true);
  retention.resolve();
  let retry;
  await act(async () => { retry = await tracking.historyDatabase.historyDayRows({ owner, subject: 'dog', slaveId: 6,
    start: NOW - 3600000, end: NOW }); });
  expect(retry).toMatchObject({ rows: [] });
});

test('manual waiting does not occupy the slot or abort latest; accepted ACK survives the manual yield', async () => {
  await act(async () => { renderer.update(<Harness readers />); await jest.advanceTimersByTimeAsync(1); });
  let worked = false, manual;
  await act(async () => {
    manual = engine.runManual(async () => {
      // Exercise the actual gated session command after auto abort/drain,
      // not only an arbitrary callback that never touches SQLite.
      const proof = await tracking.cloudDatabase.readArchivePublication(owner);
      expect(proof).toBeNull(); worked = true; return 0;
    });
    await jest.advanceTimersByTimeAsync(1);
  });
  expect(worked).toBe(false);
  expect(current).toMatchObject({ mode: 'auto', snapshotPending: false });
  expect(retentionEntered).toBe(false);
  await act(async () => { transport.resolve(); await jest.advanceTimersByTimeAsync(1); });
  expect(current.snapshotPending).toBe(false);
  // The automatic pass has entered actual native maintenance. Manual abort
  // must drain it without retracting an already committed same-attempt map.
  expect(retentionEntered).toBe(true);
  expect(engine.historyPublication().latestReadReady).toBe(true);
  retention.resolve();
  await act(async () => { await manual; });
  expect(worked).toBe(true);
  expect(engine.historyPublication().latestReadReady).toBe(true);
});

test('cached full readiness still guards an owned history command on foreground return', async () => {
  retention.resolve();
  await act(async () => { renderer.update(<Harness readers />); transport.resolve(); await jest.advanceTimersByTimeAsync(1); });
  expect(current.archiveRevision).toBe(1);
  transport = deferred();
  await act(async () => { engine.setForeground(false); engine.setForeground(true); await jest.advanceTimersByTimeAsync(1); });
  let complete = false;
  const read = tracking.historyDatabase.historyDayRows({ owner, subject: 'dog', slaveId: 6,
    start: NOW - 3600000, end: NOW }).then(() => { complete = true; });
  await act(async () => jest.advanceTimersByTimeAsync(1));
  expect(complete).toBe(false);
  expect(engine.historyPublication().latestReadReady).toBe(false);
  await act(async () => { transport.resolve(); await jest.advanceTimersByTimeAsync(1); });
  await read;
  expect(complete).toBe(true);
  expect(latestMapApplied({ ...current, getMapPublication: () => engine.mapPublication() }, owner, dogs)).toBe(true);
});

test('owner replacement cancels queued old owned reads before native maintenance starts', async () => {
  let outcome;
  const read = tracking.historyDatabase.historyDayRows({ owner, subject: 'dog', slaveId: 6,
    start: NOW - 3600000, end: NOW }).then(() => { outcome = 'wrongly-complete'; }, () => { outcome = 'canceled'; });
  await act(async () => jest.advanceTimersByTimeAsync(1));
  await act(async () => { engine.setSession({ user: { id: 'replacement-owner' } }); await jest.advanceTimersByTimeAsync(1); });
  await read;
  expect(outcome).toBe('canceled');
  expect(retentionEntered).toBe(false);
  expect(current.owner).toBe('replacement-owner');
  expect(current.mapSuccessRevision).toBe(0);
});


test('failed latest opens preserved archive cache access without certifying a fresh map', async () => {
  retention.resolve();
  await act(async () => { renderer.update(<Harness readers />); await jest.advanceTimersByTimeAsync(1);
    transport.reject(new Error('network unavailable')); await jest.advanceTimersByTimeAsync(1); });
  expect(current.error).not.toBe('');
  expect(current.mapSuccessRevision).toBe(0);
  expect(engine.historyPublication().latestReadReady).toBe(true);
  let value;
  await act(async () => { value = await tracking.historyDatabase.historyDayRows({ owner, subject: 'dog', slaveId: 6,
    start: NOW - 3600000, end: NOW }); });
  expect(value.rows).toEqual([]);
  expect(latestMapApplied({ ...current, getMapPublication: () => engine.mapPublication() }, owner, dogs)).toBe(false);
});

test('aborting a manual pre-ACK wait cannot enqueue maintenance or cancel latest', async () => {
  await act(async () => jest.advanceTimersByTimeAsync(1));
  const abort = new AbortController(); let outcome;
  const manual = engine.runManual(async () => { throw new Error('must not run'); }, abort)
    .then(() => { outcome = 'wrongly-complete'; }, () => { outcome = 'canceled'; });
  await act(async () => { abort.abort(); await manual; });
  expect(outcome).toBe('canceled');
  expect(retentionEntered).toBe(false);
  expect(current).toMatchObject({ mode: 'auto', snapshotPending: false });
});

test('first real committed ACK logs safe acceptance before maintenance; duplicates and stale ACK do not log', async () => {
  await act(async () => { renderer.update(<Harness readers />); transport.resolve(); await jest.advanceTimersByTimeAsync(1); });
  const token = engine.mapPublication().readback;
  const events = () => console.info.mock.calls.filter(([event]) => event === '[CloudSync] latest-applied');
  expect(events()).toEqual([['[CloudSync] latest-applied', { attempt: 1, elapsedMs: expect.any(Number), revision: 1 }]]);
  expect(retentionEntered).toBe(true);
  expect(current.archiveRevision).toBe(0);
  expect(engine.mapPublication().acknowledgeMapRead(token)).toBe(true);
  expect(events()).toHaveLength(1);
  await act(async () => engine.setForeground(false));
  expect(engine.mapPublication().acknowledgeMapRead(token)).toBe(false);
  expect(events()).toHaveLength(1);
});


test('background cancels a queued full command without starting maintenance', async () => {
  let outcome;
  const read = tracking.cloudDatabase.readArchivePublication(owner)
    .then(() => { outcome = 'wrongly-complete'; }, () => { outcome = 'canceled'; });
  await act(async () => { await jest.advanceTimersByTimeAsync(1); engine.setForeground(false); await read; });
  expect(outcome).toBe('canceled');
  expect(retentionEntered).toBe(false);
  expect(engine.historyPublication().latestReadReady).toBe(false);
});
