import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { latestArchiveRest, cloudEvent } from '../__fixtures__/LatestArchiveRest';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { createCloudSyncWithCommittedMapReader as createCloudSync } from '../__fixtures__/CommittedCloudMapReader';
import { mapCloudTelemetry } from '../src/cloud/CloudTelemetry';
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { createHistoryDatabase } from '../src/mapHistory/HistoryDatabase';
import { useHistoryDayRows } from '../src/mapHistory/useHistoryScreen';
import { dayBounds, dayKey } from '../src/history/screen/HistoryScreenDates';
const NOW = Date.parse('2026-01-02T12:00:00Z');
let sync, connection, log;
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(NOW); log = jest.spyOn(console, 'info').mockImplementation(() => {}); });
afterEach(async () => { await sync?.dispose(); connection?.close(); log.mockRestore(); sync = connection = null; jest.useRealTimers(); });
async function database() { connection = createMemoryConnection(); await createDogDatabase(connection).initialize(); const db = createCloudDatabase(connection); await db.initialize(); return db; }
const start = async () => { sync.setSession({ user: { id: 'a' } }); sync.setForeground(true); await jest.advanceTimersByTimeAsync(1); };
test('real SDK overlap advances physical/archive proof but retains the material token until an actual new event', async () => {
  const db = await database();
  const events = [cloudEvent(1, NOW - 1000)];
  sync = createCloudSync({ database: db, client: latestArchiveRest({ events }).client });
  await start();
  const first = sync.historyPublication();
  expect(first.dataRevision).toEqual(expect.any(Number));
  await jest.advanceTimersByTimeAsync(30000);
  const unchanged = sync.historyPublication();
  expect(unchanged.publishedRevision).toBeGreaterThan(first.publishedRevision);
  expect(unchanged.archiveCutoff).toBeGreaterThan(first.archiveCutoff);
  expect(unchanged.dataRevision).toBe(first.dataRevision);
  events.push(cloudEvent(2, NOW + 40000));
  await jest.advanceTimersByTimeAsync(30000);
  expect(sync.historyPublication().dataRevision).toBeGreaterThan(first.dataRevision);
});
test('real SDK/SQLite fresh event in another day rechecks selected rows but retains its exact input and hold pass', async () => {
  const db = await database(), history = createHistoryDatabase(connection);
  const past = dayBounds(dayKey(new Date(NOW - 86400000)));
  const events = [cloudEvent(1, past.dayStart + 3600000), cloudEvent(2, NOW - 1000)];
  await db.savePage('a', [mapCloudTelemetry(events[0])]);
  sync = createCloudSync({ database: db, client: latestArchiveRest({ events }).client }); await start();
  const getter = () => sync.historyPublication(), read = jest.fn(args => history.historyDayRows(args));
  let renderer, state;
  function Probe() { state = useHistoryDayRows({ read, subject: 'dog', slaveId: 6, day: past.dayStart, owner: 'a',
    clock: () => NOW, getPublication: getter, publishedReads: true, publicationRevision: getter().publishedRevision, requireFresh: true }); return null; }
  try {
    await act(async () => { renderer = Renderer.create(<Probe />); });
    const accepted = state.rows, replay = state.replayHolds, revision = getter().dataRevision;
    expect(accepted.length).toBe(1);
    events.push(cloudEvent(3, NOW + 40000));
    await act(async () => { await jest.advanceTimersByTimeAsync(60000); renderer.update(<Probe />); });
    expect(getter().dataRevision).toBeGreaterThan(revision);
    expect(read.mock.calls.length).toBeGreaterThan(1);
    expect(state.loaded).toBe(true); expect(state.rows).toBe(accepted); expect(state.replayHolds).toBe(replay);
  } finally { if (renderer) await act(async () => renderer.unmount()); }
});
test('legacy undefined publish result keeps material revision unknown rather than certifying no change', async () => {
  const db = await database();
  const publish = db.publishDownload;
  db.publishDownload = async (...args) => { await publish(...args); };
  sync = createCloudSync({ database: db, client: latestArchiveRest({ events: [cloudEvent(1, NOW - 1000)] }).client });
  await start();
  expect(sync.historyPublication()).toMatchObject({ dataRevision: null, publishedPending: false, archiveRevision: 1 });
});
test('old owner committing physically cannot publish a known material token into replacement session', async () => {
  const db = await database();
  let enter, release;
  const entered = new Promise(r => { enter = r; }), held = new Promise(r => { release = r; });
  const batch = connection.executeBatchAsync;
  connection.executeBatchAsync = async commands => {
    if (commands.some(c => c.query.includes('INSERT OR REPLACE INTO cloud_archive_publication'))) { enter(); await held; }
    return batch(commands);
  };
  sync = createCloudSync({ database: db, client: latestArchiveRest({ events: [cloudEvent(1, NOW - 1000)] }).client });
  await start(); await entered;
  sync.setSession({ user: { id: 'b' } }); sync.setForeground(false);
  expect(sync.historyPublication()).toMatchObject({ owner: 'b', dataRevision: null, publishedPending: true });
  release(); await jest.advanceTimersByTimeAsync(1);
  expect(sync.historyPublication()).toMatchObject({ owner: 'b', dataRevision: null, publishedPending: false, archiveRevision: 0 });
});
