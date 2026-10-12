import React, { useState } from 'react';
import Renderer, { act } from 'react-test-renderer';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { latestArchiveRest, cloudEvent } from '../__fixtures__/LatestArchiveRest';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { createCloudSync } from '../src/cloud/CloudSync';
import { useCloudDogs } from '../src/cloud/useCloudDogs';
import { completedMapRevision, latestMapApplied, mapDownloadBusy, mapReadRevision } from '../src/cloud/CloudPublication';
const NOW = Date.parse('2026-10-10T12:00:00Z');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
let archive, latest, database, engine, screen, update, dogs, current, events, members, info, release, network;
function Harness() {
  const [state, setState] = useState({ latestFirst: true }); update = setState;
  dogs = useCloudDogs(database, current?.owner ?? 'invented-owner', true, Date.now, null,
    { latestFirst: true, active: current?.foreground ?? true, cloudBusy: mapDownloadBusy(state),
      cloudSuccess: completedMapRevision(state), revision: mapReadRevision(state), getMapPublication: () => engine.mapPublication() });
  return null;
}
beforeEach(async () => {
  jest.useFakeTimers(); jest.setSystemTime(NOW); update = dogs = current = screen = null;
  archive = createMemoryConnection(); latest = createMemoryConnection(); await createDogDatabase(archive).initialize();
  archive.executeAsync.mockClear();
  database = createCloudDatabase(archive, { latestConnection: latest }); events = [cloudEvent(1, NOW - 1000)];
  members = [{ gateway_id: 'master_7', slave_id: 6 }]; info = jest.spyOn(console, 'info').mockImplementation(() => {});
  network = latestArchiveRest({ events, members });
  engine = createCloudSync({ client: network.client, database,
    downloadContext: async () => { throw new Error('optional context unavailable'); },
    onChange: value => { current = value; update?.(value); } });
});
afterEach(async () => {
  release?.(); release = null;
  await act(async () => { screen?.unmount(); update = null; await jest.advanceTimersByTimeAsync(1); await engine.dispose(); });
  archive.close(); latest.close(); info.mockRestore(); jest.useRealTimers();
});
const flush = async () => { await act(async () => jest.advanceTimersByTimeAsync(1)); };
async function start(mount = true) {
  if (mount) await act(async () => { screen = Renderer.create(<Harness />); });
  await act(async () => { engine.setSession({ user: { id: 'invented-owner' } }); engine.setForeground(true); await jest.advanceTimersByTimeAsync(1); });
}
function holdNativeRetention() {
  const held = deferred(); release = held.resolve;
  const original = archive.executeBatchAsync.getMockImplementation(); let entered = false;
  archive.executeBatchAsync.mockImplementation(async commands => {
    if (!entered && commands.some(command => command.query.startsWith('DELETE FROM supabase_dog_status WHERE id IN'))) {
      entered = true; archive.sqlite.exec('BEGIN EXCLUSIVE TRANSACTION');
      try {
        await held.promise;
        for (const command of commands) archive.sqlite.prepare(command.query).all(...(command.params ?? []));
        archive.sqlite.exec('COMMIT');
      } catch (error) { archive.sqlite.exec('ROLLBACK'); throw error; }
    } else return original(commands);
  });
  return { held, entered: () => entered };
}
const applied = () => info.mock.calls.filter(([tag]) => tag === '[CloudSync] latest-applied');

test('30s unchanged real context pass still downloads and consumer ACKs while avoiding repeated latest dog row writes', async () => {
  await engine.dispose();
  engine = createCloudSync({ client: network.client, database, onChange: value => { current = value; update?.(value); } });
  await start();
  const before = await database.readLatestSnapshot('invented-owner');
  expect(before.context.length).toBeGreaterThan(0); expect(applied()).toHaveLength(1);
  latest.sqlite.exec(`CREATE TABLE latest_row_writes(kind TEXT);
    CREATE TRIGGER track_latest_insert AFTER INSERT ON cloud_latest_snapshot BEGIN INSERT INTO latest_row_writes VALUES('insert'); END;
    CREATE TRIGGER track_latest_delete AFTER DELETE ON cloud_latest_snapshot BEGIN INSERT INTO latest_row_writes VALUES('delete'); END`);
  const requests = network.calls.length;
  await act(async () => jest.advanceTimersByTimeAsync(30000));
  const after = await database.readLatestSnapshot('invented-owner');
  expect(network.calls.length).toBeGreaterThan(requests); // No unsafe context HTTP skip.
  expect(applied()).toHaveLength(2); expect(current.snapshotPending).toBe(false);
  expect(after.revision).toBe(before.revision + 2); expect(after.cutoff).toBeGreaterThan(before.cutoff);
  expect(after.context).toEqual(before.context); expect(after.seeds).toEqual(before.seeds);
  expect(latest.sqlite.prepare('SELECT * FROM latest_row_writes').all()).toEqual([]);
  expect(latestMapApplied({ ...current, getMapPublication: () => engine.mapPublication() }, 'invented-owner', dogs)).toBe(true);
});

test('same-process quick resume commits and React ACKs new latest while prior archive native transaction is still executing', async () => {
  const retained = holdNativeRetention(); await start();
  expect(retained.entered()).toBe(true); expect(archive.sqlite.isTransaction).toBe(true);
  expect(applied()).toHaveLength(1); expect(current.archiveCutoff).toBeNull();
  const oldReadback = engine.mapPublication().readback;
  await act(async () => { engine.setForeground(false); await jest.advanceTimersByTimeAsync(1000); });
  events.push(cloudEvent(2, Date.now() - 100));
  await act(async () => { engine.setForeground(true); await jest.advanceTimersByTimeAsync(1); });
  expect(archive.sqlite.isTransaction).toBe(true);
  expect(current).toMatchObject({ mapAttempt: 2, snapshotPending: false, mapSuccessRevision: 2, archiveCutoff: null });
  expect(applied()).toHaveLength(2);
  expect(dogs.rows[0].event_id).toBe(events[1].event_id);
  expect(engine.mapPublication().acknowledgeMapRead(oldReadback)).toBe(false);
  expect(latestMapApplied({ ...current, getMapPublication: () => engine.mapPublication() }, 'invented-owner', dogs)).toBe(true);
  retained.held.resolve(); await flush();
  expect(current.archiveRevision).toBe(1); expect(current.archiveCutoff).toBeGreaterThan(NOW);
});

test('ordinary latest poll also bypasses a held archive transaction, then truthful archive publication drains in order', async () => {
  const retained = holdNativeRetention(); await start();
  events.push(cloudEvent(2, NOW + 29000));
  await act(async () => jest.advanceTimersByTimeAsync(30000));
  expect(archive.sqlite.isTransaction).toBe(true); expect(applied()).toHaveLength(2);
  expect(current).toMatchObject({ mapAttempt: 2, mapSuccessRevision: 2, archiveCutoff: null });
  expect(dogs.rows[0].event_id).toBe(events[1].event_id);
  retained.held.resolve(); await flush();
  expect(current.archiveCutoff).toBeGreaterThanOrEqual(NOW + 30000);
});

test('new authorized master set invalidates a held older archive pass without blocking the new empty latest ACK', async () => {
  const retained = holdNativeRetention(); await start(); members.splice(0);
  await act(async () => jest.advanceTimersByTimeAsync(30000));
  expect(archive.sqlite.isTransaction).toBe(true); expect(applied()).toHaveLength(2);
  expect(dogs).toMatchObject({ loaded: true, packets: [], rows: [] });
  retained.held.resolve(); await flush();
  const published = info.mock.calls.filter(([tag]) => tag === '[CloudSync] archive-published');
  expect(published).toHaveLength(1); expect(published[0][1].attempt).toBe(2);
  expect(current.archiveCutoff).toBeGreaterThanOrEqual(NOW + 30000);
});

test('owner replacement and empty new membership cannot receive late old archive proof or old cached dogs', async () => {
  const retained = holdNativeRetention(); await start();
  members.splice(0);
  await act(async () => { engine.setSession({ user: { id: 'replacement-owner' } }); await jest.advanceTimersByTimeAsync(1); });
  expect(archive.sqlite.isTransaction).toBe(true); expect(applied()).toHaveLength(2);
  expect(current).toMatchObject({ owner: 'replacement-owner', mapAttempt: 1, mapSuccessRevision: 1, archiveCutoff: null });
  expect(dogs).toMatchObject({ loaded: true, rows: [], packets: [] });
  retained.held.resolve(); await flush();
  expect(current.archiveCutoff).toBeGreaterThanOrEqual(NOW);
  expect((await database.readLatestSnapshot('replacement-owner', { positionsOnly: true })).packets).toEqual([]);
});

test('no committed reader still defers archive and releases the latest slot without claiming readiness or history', async () => {
  await start(false); expect(applied()).toEqual([]);
  expect(current).toMatchObject({ mapSuccessRevision: 1, busy: true, archiveCutoff: null });
  await act(async () => jest.advanceTimersByTimeAsync(10000));
  expect(current).toMatchObject({ busy: false, archiveCutoff: null });
  expect(archive.executeAsync.mock.calls.some(([query]) => query === 'PRAGMA table_info(supabase_dog_status)')).toBe(false);
});

test('manual archive operation remains physically serialized while latest foreground polling continues independently', async () => {
  await start(); const held = deferred(); release = held.resolve;
  let entered = false, manual;
  await act(async () => { manual = engine.runManual(async check => { entered = true; await held.promise; check(); return 7; });
    await jest.advanceTimersByTimeAsync(1); });
  expect(entered).toBe(true); events.push(cloudEvent(2, NOW + 29000));
  await act(async () => jest.advanceTimersByTimeAsync(30000));
  expect(applied()).toHaveLength(2); expect(current.mapAttempt).toBe(2); expect(current.mode).toBe('manual');
  expect(dogs.rows[0].event_id).toBe(events[1].event_id);
  held.resolve(); await act(async () => { expect(await manual).toBe(7); await jest.advanceTimersByTimeAsync(1); });
  expect(current.mode).toBeNull();
});
