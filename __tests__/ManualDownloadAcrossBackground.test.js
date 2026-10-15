// 「下載已取消」 after about two minutes in the background (#192, 2 of 6):
// a manual history download keeps its lease across a leave/return, but its
// SQLite commands went through the session's archive-priority gate, which is
// never ready while the app is in the background. A command issued there
// waited out the gate's 10-second budget (timers run in the background as
// soon as any Headless JS task does) or the return's generation change, and
// failed with c576 although the lease still held. The session object and the
// history adapter are not rebuilt on a leave/return (checked below too).
import React, { useState } from 'react';
import Renderer, { act } from 'react-test-renderer';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { latestArchiveRest, cloudEvent } from '../__fixtures__/LatestArchiveRest';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { useTrackingSession } from '../src/app/useTrackingSession';
import { createCloudSync } from '../src/cloud/CloudSync';
import { useCloudDogs } from '../src/cloud/useCloudDogs';
import { createHistoryCloud, useHistoryCloudSource } from '../src/mapHistory/HistoryCloud';
import { completedMapRevision, mapDownloadBusy, mapReadRevision } from '../src/cloud/CloudPublication';
import { dayBounds } from '../src/history/screen/HistoryScreenDates';
import { t } from '../src/i18n';

const NOW = Date.parse('2026-10-10T12:00:00+08:00'), owner = 'invented-owner', clock = () => Date.now();
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
let archive, latest, tracking, engine, renderer, factory, current, update, cloud, network, hold, held, entered, source;
function Readers() {
  const [state, setState] = useState(current); update = setState;
  useCloudDogs(tracking.cloudDatabase, state.owner, true, clock, null, {
    active: state.foreground, latestFirst: true, cloudBusy: mapDownloadBusy(state), cloudSuccess: completedMapRevision(state),
    revision: mapReadRevision(state), getMapPublication: () => engine.mapPublication(),
  });
  return null;
}
function Harness({ readers = false }) {
  tracking = useTrackingSession(factory);
  source = useHistoryCloudSource({ database: tracking.cloudDatabase, sync: engine, owner,
    clientFactory: network.clientFactory });
  return readers ? <Readers /> : null;
}
beforeEach(async () => {
  jest.useFakeTimers(); jest.setSystemTime(NOW); update = null; hold = false; entered = false;
  jest.spyOn(console, 'info').mockImplementation(() => {});
  archive = createMemoryConnection(); latest = createMemoryConnection();
  const real = createDogDatabase(archive); await real.initialize();
  const database = createCloudDatabase(archive, { latestConnection: latest });
  jest.spyOn(database, 'publishManualScope');
  const databases = { real, cloud: database, close: jest.fn(),
    settings: { initialize: async () => {}, load: async () => ({ mode: 'real' }), save: async () => {} } };
  factory = () => databases; factory.latestStorageIsolated = true;
  held = deferred();
  network = latestArchiveRest({ events: [cloudEvent(1, NOW - 3600000), cloudEvent(2, NOW - 1800000)], beforeRead: async () => {
    if (!hold) return;
    hold = false; entered = true; await held.promise;
  } });
  const client = network.client;
  network.clientFactory = () => client;
  await act(async () => { renderer = Renderer.create(<Harness />); });
  engine = createCloudSync({ database: tracking.cloudDatabase, client,
    downloadContext: async () => { throw new Error('optional context unavailable'); },
    onChange: value => { current = value; update?.(value); } });
  engine.setSession({ user: { id: owner } }); engine.setForeground(true);
  cloud = createHistoryCloud({ database: tracking.cloudDatabase, client, owner,
    runManual: (...args) => engine.runManual(...args), getPublication: () => engine.historyPublication() });
  await act(async () => { renderer.update(<Harness readers />); await jest.advanceTimersByTimeAsync(1); });
});
afterEach(async () => {
  held.resolve();
  await act(async () => { renderer?.unmount(); update = null; await engine?.dispose(); await jest.advanceTimersByTimeAsync(1); });
  archive.close(); latest.close(); jest.restoreAllMocks(); jest.useRealTimers();
});

async function downloadHeldInFlight() {
  expect(current).toMatchObject({ owner, snapshotPending: false });
  const { dayStart, dayEnd } = dayBounds('2026-10-10');
  let outcome;
  hold = true;
  const download = cloud.download({ slaveId: 6, dayStart, dayEnd, cutoff: NOW, serverOffset: 0 })
    .then(count => { outcome = { count }; }, error => { outcome = { error: error.message }; });
  await act(async () => jest.advanceTimersByTimeAsync(1));
  expect(entered).toBe(true);
  return { download, outcome: () => outcome };
}
// Each dog/day the manual download published (publishManualScope).
const published = () => factory().cloud.publishManualScope.mock.calls.length;

test('a page that arrives while the app is in the background is saved and published (no 10-second gate)', async () => {
  const before = { database: tracking.cloudDatabase, cloud: source.cloud };
  const { download, outcome } = await downloadHeldInFlight();
  await act(async () => { engine.setForeground(false); await jest.advanceTimersByTimeAsync(1); });
  await act(async () => { held.resolve(); await jest.advanceTimersByTimeAsync(11000); });
  await act(async () => { await download; });
  expect(outcome()).toEqual({ count: 2 });
  expect(outcome().error).not.toBe(t('c576'));
  expect(published()).toBe(1);
  // Leave/return never swaps the session's database or the history adapter.
  expect(tracking.cloudDatabase).toBe(before.database);
  expect(source.cloud).toBe(before.cloud);
});

test('returning to the app while a background page waits does not cancel the download', async () => {
  const { download, outcome } = await downloadHeldInFlight();
  await act(async () => { engine.setForeground(false); await jest.advanceTimersByTimeAsync(1); });
  await act(async () => { held.resolve(); await jest.advanceTimersByTimeAsync(1); });
  await act(async () => { engine.setForeground(true); await jest.advanceTimersByTimeAsync(1); });
  await act(async () => { await jest.advanceTimersByTimeAsync(1000); await download; });
  expect(outcome()).toEqual({ count: 2 });
  expect(published()).toBe(1);
});

test('an account switch while in the background still ends the download without publishing', async () => {
  const { download, outcome } = await downloadHeldInFlight();
  await act(async () => { engine.setForeground(false); await jest.advanceTimersByTimeAsync(1); });
  await act(async () => { engine.setSession({ user: { id: 'replacement-owner' } }); held.resolve();
    await jest.advanceTimersByTimeAsync(11000); await download; });
  expect(outcome().error).toBe(t('c576'));
  expect(published()).toBe(0);
});
