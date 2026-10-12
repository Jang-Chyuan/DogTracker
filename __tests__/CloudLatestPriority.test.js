import React, { useState } from 'react';
import Renderer, { act } from 'react-test-renderer';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { createCloudSync } from '../src/cloud/CloudSync';
import { useCloudDogs } from '../src/cloud/useCloudDogs';
import { completedMapRevision, latestMapApplied, mapDownloadBusy, mapReadRevision } from '../src/cloud/CloudPublication';
import { latestArchiveRest, cloudEvent } from '../__fixtures__/LatestArchiveRest';
const NOW = Date.parse('2026-10-10T12:00:00Z'), clock = () => Date.now();
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
let db, database, engine, screen, update, dogs, current, releases;
function Harness() {
  const [state, setState] = useState({ latestFirst: true }); update = setState;
  dogs = useCloudDogs(database, current?.owner ?? 'invented-owner', true, clock, null,
    { latestFirst: true, active: true, cloudBusy: mapDownloadBusy(state), cloudSuccess: completedMapRevision(state),
      revision: mapReadRevision(state), getMapPublication: () => engine.mapPublication() });
  return null;
}
beforeEach(async () => {
  jest.useFakeTimers(); jest.setSystemTime(NOW); releases = []; update = null; dogs = current = null;
  db = createMemoryConnection(); await createDogDatabase(db).initialize(); database = createCloudDatabase(db);
  db.executeAsync.mockClear();
  jest.spyOn(console, 'info').mockImplementation(() => {});
  const network = latestArchiveRest({ events: [cloudEvent(1, NOW - 1000)] });
  engine = createCloudSync({ client: network.client, database,
    downloadContext: async () => { throw new Error('optional context unavailable'); },
    onChange: value => { current = value; update?.(value); } });
});
afterEach(async () => {
  for (const release of releases) release();
  await act(async () => { screen?.unmount(); update = null; await jest.advanceTimersByTimeAsync(1); await engine.dispose(); });
  db.close(); screen = null; jest.restoreAllMocks(); jest.useRealTimers();
});
async function mount() { await act(async () => { screen = Renderer.create(<Harness />); }); }
async function start() { await act(async () => { engine.setSession({ user: { id: 'invented-owner' } }); engine.setForeground(true); await jest.advanceTimersByTimeAsync(1); }); }
function holdRetention() {
  const gate = deferred(); releases.push(gate.resolve);
  const execute = db.executeBatchAsync.getMockImplementation(); let entered = false;
  db.executeBatchAsync.mockImplementation(async commands => {
    if (commands.some(command => command.query.startsWith('DELETE FROM supabase_dog_status WHERE id IN'))) {
      entered = true; await gate.promise;
    }
    return execute(commands);
  });
  return { gate, entered: () => entered };
}

test('a real React-committed latest snapshot precedes held archive maintenance on a cold database', async () => {
  const retained = holdRetention(); await mount(); await start();
  expect(retained.entered()).toBe(true);
  expect(current).toMatchObject({ mapSuccessRevision: 1, snapshotPending: false, archiveRevision: 0, archiveCutoff: null });
  expect(dogs.rows.map(row => row.event_id)).toEqual([cloudEvent(1, NOW - 1000).event_id]);
  expect(latestMapApplied({ ...current, getMapPublication: () => engine.mapPublication() }, 'invented-owner', dogs)).toBe(true);
  const readback = engine.mapPublication().readback;
  expect(Object.isFrozen(readback)).toBe(true);
  expect(Object.isFrozen(readback.snapshot.rows[0])).toBe(true);
  expect(dogs.acceptedReadback).toBe(readback);
  expect(engine.historyPublication()).toMatchObject({ archiveRevision: 0, archiveCutoff: null });
  retained.gate.resolve(); await act(async () => jest.advanceTimersByTimeAsync(1));
  expect(current.archiveRevision).toBe(1);
});

test('no mounted reader defers archive after the bounded ACK wait without claiming completion', async () => {
  await start(); const old = engine.mapPublication().readback;
  expect(current).toMatchObject({ mapSuccessRevision: 1, busy: true, archiveRevision: 0 });
  expect(db.executeAsync.mock.calls.some(([sql]) => sql === 'PRAGMA table_info(supabase_dog_status)')).toBe(false);
  await act(async () => jest.advanceTimersByTimeAsync(10000));
  expect(current).toMatchObject({ busy: false, error: '', archiveRevision: 0, archiveCutoff: null });
  expect(db.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='cloud_archive_publication'").all()).toEqual([]);
  await mount();
  await act(async () => jest.advanceTimersByTimeAsync(20000));
  expect(current.mapAttempt).toBe(2);
  expect(engine.mapPublication().acknowledgeMapRead(old)).toBe(false);
  expect(current.archiveRevision).toBe(1);
});

test('a successful empty committed set is acknowledged while archive is still held', async () => {
  await engine.dispose();
  const network = latestArchiveRest({ events: [] });
  engine = createCloudSync({ client: network.client, database,
    downloadContext: async () => { throw new Error('optional context unavailable'); },
    onChange: value => { current = value; update?.(value); } });
  const retained = holdRetention(); await mount(); await start();
  expect(retained.entered()).toBe(true);
  expect(dogs).toMatchObject({ loaded: true, rows: [], cloudCommit: 1 });
  expect(latestMapApplied({ ...current, getMapPublication: () => engine.mapPublication() }, 'invented-owner', dogs)).toBe(true);
});

test('background cancels an unacknowledged pass promptly; the next generation rejects the old token', async () => {
  await start(); const old = engine.mapPublication().readback;
  await act(async () => { engine.setForeground(false); await jest.advanceTimersByTimeAsync(1); });
  expect(current.busy).toBe(false);
  expect(db.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='cloud_archive_publication'").all()).toEqual([]);
  await act(async () => { engine.setForeground(true); await jest.advanceTimersByTimeAsync(1); });
  expect(engine.mapPublication().acknowledgeMapRead(old)).toBe(false);
  expect(current.mapAttempt).toBe(2);
  expect(current.archiveRevision).toBe(0);
});

test('a committed readback cannot certify a different SQLite revision and never reaches archive', async () => {
  const execute = db.executeAsync.getMockImplementation(); let corrupted = false;
  db.executeAsync.mockImplementation(async (sql, params) => {
    const result = await execute(sql, params);
    if (!corrupted && sql.includes('s.origin,d.packet_json,d.fix_json') && !sql.includes('d.context_json') && result.results.length) {
      corrupted = true; result.results[0].revision += 1;
    }
    return result;
  });
  await start();
  expect(current).toMatchObject({ mapSuccessRevision: 0, archiveRevision: 0, busy: false });
  expect(current.error).toBeTruthy();
  expect(engine.mapPublication().readback).toBeNull();
});

test('cleanup drains an already-started committed SQL readback and rejects its late publication', async () => {
  const held = deferred(); releases.push(held.resolve);
  const execute = db.executeAsync.getMockImplementation(); let entered = false;
  db.executeAsync.mockImplementation(async (sql, params) => {
    if (sql.includes('s.origin,d.packet_json,d.fix_json') && !sql.includes('d.context_json')) {
      entered = true; await held.promise;
    }
    return execute(sql, params);
  });
  await start(); expect(entered).toBe(true);
  let closed = false; const drain = engine.dispose().then(() => { closed = true; });
  await Promise.resolve(); expect(closed).toBe(false);
  held.resolve(); await act(async () => { await drain; });
  expect(engine.mapPublication().mapSuccessRevision).toBe(0);
  expect(engine.mapPublication().readback).toBeNull();
});


test('a genuinely absent snapshot uses the preserved archive fallback only after a fresh HTTP failure', async () => {
  await engine.dispose();
  // Persisted pre-snapshot archive, independently seeded through real SQL.
  // No full cloud initialize or bootstrap has run in this test.
  db.sqlite.exec('ALTER TABLE supabase_dog_status ADD COLUMN owner_user_id TEXT; ALTER TABLE supabase_dog_status ADD COLUMN event_id TEXT');
  db.sqlite.prepare(`INSERT INTO supabase_dog_status(owner_user_id,event_id,master_id,slave_id,received_at,slave_lat,slave_lon)
    VALUES('invented-owner','legacy-cache',7,6,?,25,121)`).run(NOW - 1000);
  const network = latestArchiveRest({ events: [cloudEvent(1, NOW - 1000)], beforeRead: async ({ phase }) => {
    if (phase === 'packet') throw new TypeError('Network request failed');
  } });
  engine = createCloudSync({ client: network.client, database,
    onChange: value => { current = value; update?.(value); } });
  await mount();
  expect(db.sqlite.prepare('SELECT * FROM cloud_snapshot_state').all()).toEqual([]);
  expect(db.executeAsync.mock.calls.some(([sql]) => sql === 'PRAGMA table_info(supabase_dog_status)')).toBe(false);
  await start(); await act(async () => jest.advanceTimersByTimeAsync(1));
  expect(current.mapSuccessRevision).toBe(0);
  expect(current.error).toBeTruthy();
  expect(dogs).toMatchObject({ cachedBaseline: true, cloudCommit: null, cloudPublication: null,
    rows: [expect.objectContaining({ event_id: 'legacy-cache' })] });
  expect(db.sqlite.prepare('SELECT revision,origin FROM cloud_snapshot_state').get()).toMatchObject({ revision: 0, origin: 'cache' });
  expect(current.archiveRevision).toBe(0);
});


test('an offline fresh failure restores only a prior durable archive proof, not fresh map acceptance', async () => {
  await database.beginDownload('invented-owner');
  await database.publishDownload('invented-owner', 'auto', NOW - 100);
  await engine.dispose();
  const network = latestArchiveRest({ events: [cloudEvent(1, NOW - 1000)], beforeRead: async ({ phase }) => {
    if (phase === 'packet') throw new TypeError('Network request failed');
  } });
  engine = createCloudSync({ client: network.client, database,
    onChange: value => { current = value; update?.(value); } });
  await mount(); await start();
  expect(current).toMatchObject({ archiveCutoff: NOW - 100, archiveRevision: 1,
    mapSuccessRevision: 0, lastSuccess: null, snapshotPending: false, offline: true });
  expect(current.error).toBeTruthy();
  expect(latestMapApplied({ ...current, getMapPublication: () => engine.mapPublication() }, 'invented-owner', dogs)).toBe(false);
  expect(dogs.cloudCommit).toBeNull();
});

test('a durable offline proof that resolves after owner replacement cannot certify the replacement owner', async () => {
  await database.beginDownload('invented-owner');
  await database.publishDownload('invented-owner', 'auto', NOW - 100);
  await engine.dispose();
  const held = deferred(); releases.push(held.resolve);
  const execute = db.executeAsync.getMockImplementation(); let entered = false;
  db.executeAsync.mockImplementation(async (sql, params) => {
    if (sql.includes('SELECT cutoff,revision FROM cloud_archive_publication')) {
      entered = true; await held.promise;
    }
    return execute(sql, params);
  });
  const network = latestArchiveRest({ events: [cloudEvent(1, NOW - 1000)], beforeRead: async ({ phase }) => {
    if (phase === 'packet') throw new TypeError('Network request failed');
  } });
  engine = createCloudSync({ client: network.client, database,
    onChange: value => { current = value; update?.(value); } });
  await start(); expect(entered).toBe(true);
  await act(async () => {
    engine.setForeground(false); engine.setSession({ user: { id: 'replacement-owner' } });
    held.resolve(); await jest.advanceTimersByTimeAsync(1);
  });
  expect(current).toMatchObject({ owner: 'replacement-owner', archiveCutoff: null,
    archiveRevision: 0, mapSuccessRevision: 0 });
});


test('a later context publication does not strand the already committed first ACK target', async () => {
  await engine.dispose();
  const context = deferred(); releases.push(() => context.resolve({ cutoff: NOW, dogs: [] }));
  const network = latestArchiveRest({ events: [cloudEvent(1, NOW - 1000)] });
  engine = createCloudSync({ client: network.client, database, downloadContext: () => context.promise,
    onChange: value => { current = value; update?.(value); } });
  await mount(); await start();
  const first = engine.mapPublication().readback;
  expect(current).toMatchObject({ mapSuccessRevision: 1, contextPending: true, archiveRevision: 0 });
  expect(latestMapApplied({ ...current, getMapPublication: () => engine.mapPublication() }, 'invented-owner', dogs)).toBe(true);
  const packet = first.snapshot.packets[0];
  context.resolve({ cutoff: NOW, dogs: [{ slaveId: packet.slave_id,
    packet, fix: first.snapshot.rows[0], context: [packet], seeds: [] }] });
  await act(async () => jest.advanceTimersByTimeAsync(1));
  expect(current).toMatchObject({ mapSuccessRevision: 2, contextPending: false, archiveRevision: 1, busy: false });
  expect(latestMapApplied({ ...current, getMapPublication: () => engine.mapPublication() }, 'invented-owner', dogs)).toBe(true);
  expect(first.revision).toBe(1);
});


test('a true HTTP deadline retains the prior durable offline proof without accepting its late packet', async () => {
  await database.beginDownload('invented-owner');
  await database.publishDownload('invented-owner', 'auto', NOW - 100);
  await engine.dispose();
  const transport = deferred(); releases.push(transport.resolve);
  const network = latestArchiveRest({ events: [cloudEvent(1, NOW - 1000)], beforeRead: ({ phase }) => {
    if (phase === 'packet') return transport.promise;
  } });
  engine = createCloudSync({ client: network.client, database,
    onChange: value => { current = value; update?.(value); } });
  await mount(); await start();
  expect(current).toMatchObject({ mapSuccessRevision: 0, archiveRevision: 0, snapshotPending: true });
  await act(async () => jest.advanceTimersByTimeAsync(120000));
  expect(current).toMatchObject({ archiveCutoff: NOW - 100, archiveRevision: 1,
    mapSuccessRevision: 0, lastSuccess: null, snapshotPending: false, offline: true, busy: false });
  expect(current.error).toBeTruthy();
  transport.resolve(); await act(async () => jest.advanceTimersByTimeAsync(1));
  expect(current.mapSuccessRevision).toBe(0);
  expect(latestMapApplied({ ...current, getMapPublication: () => engine.mapPublication() }, 'invented-owner', dogs)).toBe(false);
});
