import React, { useState } from 'react';
import Renderer, { act } from 'react-test-renderer';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { latestArchiveRest, cloudEvent } from '../__fixtures__/LatestArchiveRest';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { createIndependentCloudSync } from '../src/cloud/IndependentCloudSync';
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
  engine = createIndependentCloudSync({ client: network.client, database,
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
  engine = createIndependentCloudSync({ client: network.client, database, onChange: value => { current = value; update?.(value); } });
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
  // The held transaction is the first archive page's (the start no longer
  // trims inside initialize, 2026-10-16): it and the resume's pass both publish.
  expect(current.archiveRevision).toBe(2); expect(current.archiveCutoff).toBeGreaterThan(NOW);
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

test('manual publication re-checks its owner inside the native publish, after an account switch', async () => {
  await start();
  const calls = [];
  const original = database.publishDownload;
  database.publishDownload = async (...args) => { calls.push(args); return original(...args); };
  try {
    let manual;
    await act(async () => { manual = engine.runManual(async () => 1); await jest.advanceTimersByTimeAsync(1); });
    expect(await manual).toBe(1);
    const [owner, kind, , isCurrent] = calls.find(([, value]) => value === 'manual');
    expect([owner, kind, typeof isCurrent]).toEqual(['invented-owner', 'manual', 'function']);
    expect(isCurrent()).toBe(true);
    await act(async () => engine.setSession({ user: { id: 'replacement-owner' } }));
    // The same closure a waiting native publish consults now refuses.
    expect(isCurrent()).toBe(false);
  } finally { database.publishDownload = original; }
});

test('a routine 30s latest attempt keeps archive priority open for this foreground after the first map ACK', async () => {
  // Archive/manual cloud commands and dog history reads wait on this gate with
  // a 10 s budget. Re-closing it on every refresh made them stall and fail
  // whenever a routine latest attempt was slow.
  await engine.dispose();
  let gate = null;
  const gated = { ...database, installLatestReadinessGate: value => { gate = value; return () => {}; } };
  engine = createIndependentCloudSync({ client: network.client, database: gated,
    downloadContext: async () => { throw new Error('optional context unavailable'); },
    onChange: value => { current = value; update?.(value); } });
  await start();
  expect(applied()).toHaveLength(1); expect(gate.ready()).toBe(true);
  const held = deferred(); release = held.resolve;
  const publishLatest = gated.publishLatestSnapshot;
  gated.publishLatestSnapshot = async (...args) => { await held.promise; return publishLatest(...args); };
  await act(async () => jest.advanceTimersByTimeAsync(30000));
  expect(current.mapAttempt).toBe(2); expect(current.snapshotPending).toBe(true);
  expect(gate.ready()).toBe(true);
  expect(engine.historyPublication().latestReadReady).toBe(true);
  await expect(gate.wait(new AbortController().signal, 'invented-owner')).resolves.toBe(true);
  held.resolve(); await flush();
  expect(applied()).toHaveLength(2); expect(gate.ready()).toBe(true);
  // A new foreground generation still waits for its own first ACK.
  await act(async () => { engine.setForeground(false); engine.setForeground(true); });
  expect(gate.ready()).toBe(false);
  await act(async () => jest.advanceTimersByTimeAsync(1));
  expect(applied()).toHaveLength(3); expect(gate.ready()).toBe(true);
});

const contextEvents = name => info.mock.calls.filter(([tag]) => tag === `[CloudSync] ${name}`);

test('real context success logs one fixed context-published per accepted pass', async () => {
  await engine.dispose();
  engine = createIndependentCloudSync({ client: network.client, database, onChange: value => { current = value; update?.(value); } });
  await start();
  expect(contextEvents('context-published')).toEqual([['[CloudSync] context-published', { attempt: 1, elapsedMs: expect.any(Number), dogs: 1 }]]);
  expect(contextEvents('context-failed')).toEqual([]);
});

test('production context timeout logs exactly one context-failed without disturbing latest-applied or archive', async () => {
  await engine.dispose();
  events.push(cloudEvent(2, NOW - 900, { slave: 5 }));
  let contextReads = 0;
  // Dog 1 completes all four stop-context requests; dog 2's first one stalls
  // past the 10 s budget with a transport that ignores AbortSignal.
  const stalled = latestArchiveRest({ events, members, beforeRead: async call => {
    if (['context', 'seeds'].includes(call.phase) && ++contextReads === 5) await new Promise(() => {});
  } });
  engine = createIndependentCloudSync({ client: stalled.client, database, onChange: value => { current = value; update?.(value); } });
  await start();
  expect(current).toMatchObject({ contextPending: true, mapSuccessRevision: 1 });
  expect(applied()).toHaveLength(1);
  await act(async () => jest.advanceTimersByTimeAsync(10000));
  expect(contextEvents('context-failed')).toEqual([['[CloudSync] context-failed',
    { attempt: 1, elapsedMs: 10000, failureKind: 'timeout', dogs: 2, completedDogs: 1, requests: 5 }]]);
  expect(contextEvents('context-published')).toEqual([]);
  expect(contextEvents('failure')).toEqual([]);
  expect(applied()).toHaveLength(1);
  expect(contextEvents('archive-published')).toEqual([['[CloudSync] archive-published', { attempt: 1, elapsedMs: expect.any(Number), revision: 1 }]]);
  expect(current).toMatchObject({ contextPending: false, archiveRevision: 1, archiveError: '', error: '', mapSuccessRevision: 1 });
  expect((await database.readLatestSnapshot('invented-owner', { positionsOnly: true })).packets).toHaveLength(2);
});

test('a context canceled by leaving the foreground is not reported as context-failed', async () => {
  await engine.dispose();
  const stalled = latestArchiveRest({ events, members, beforeRead: async call => {
    if (call.phase === 'context') await new Promise(() => {});
  } });
  engine = createIndependentCloudSync({ client: stalled.client, database, onChange: value => { current = value; update?.(value); } });
  await start();
  expect(current.contextPending).toBe(true);
  await act(async () => { engine.setForeground(false); await jest.advanceTimersByTimeAsync(10000); });
  expect(contextEvents('context-failed')).toEqual([]);
  expect(contextEvents('context-published')).toEqual([]);
});

test('history lineage survives a foreground leave/return but not an account switch', async () => {
  await start(false);
  const before = engine.historyPublication();
  expect(Number.isSafeInteger(before.lineage)).toBe(true);
  await act(async () => { engine.setForeground(false); engine.setForeground(true); await jest.advanceTimersByTimeAsync(1); });
  const resumed = engine.historyPublication();
  expect(resumed.generation).not.toBe(before.generation);
  expect(resumed.lineage).toBe(before.lineage);
  await act(async () => { engine.setSession({ user: { id: 'another-owner' } }); await jest.advanceTimersByTimeAsync(1); });
  expect(engine.historyPublication().lineage).not.toBe(before.lineage);
});
