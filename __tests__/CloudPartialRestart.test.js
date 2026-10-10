import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { createCloudSync } from '../src/cloud/CloudSync';
import { completedMapRevision } from '../src/cloud/CloudPublication';
import { captureActivityRead, capturePageRead } from '../src/cloud/CloudPagePublication';
import { latestArchiveRest, cloudEvent } from '../__fixtures__/LatestArchiveRest';
import { useCloudDogs } from '../src/cloud/useCloudDogs';

// Investigation-only regression: the production DB keeps committed pages
// across independent schedulers, while process-local React gates disappear.
const NOW = Date.parse('2026-10-09T12:00:00Z');
const owner = 'anonymous-owner';
const coordinate = { latitude: 24.9892, longitude: 121.3132 };
const record = (id, time, delta = 0) => ({ event_id: id, master_id: 7, slave_id: 6,
  received_at: time, track_at: time, track_time_version: 1, slave_lat: coordinate.latitude + delta,
  slave_lon: coordinate.longitude, satellites: 9, hdop: 1, activity_valid: 0, battery_valid: 0 });
const client = fail => latestArchiveRest({ events: [cloudEvent(1, NOW - 10000)],
  beforeRead: async () => { if (fail) throw new Error('offline after restart'); },
}).client;

test.each([false, true])('cold bootstrap must not publish failed prior-process pages (restart download fails: %s)', async fail => {
  jest.useFakeTimers(); jest.setSystemTime(NOW);
  const connection = createMemoryConnection();
  let sync, renderer, value, readerDatabase;
  try {
    await createDogDatabase(connection).initialize();
    const database = createCloudDatabase(connection);
    await database.initialize();
    readerDatabase = database;
    await database.savePage(owner, [record('complete-old', NOW - 10000)]);
    sync = createCloudSync({ client: client(false), database });
    sync.setForeground(true); sync.setSession({ user: { id: owner } });
    await jest.advanceTimersByTimeAsync(1); // completed first automatic pass
    const clock = () => NOW;
    function Harness() {
      // This legacy row reader deliberately exercises the published archive,
      // which now has its own fence independent of the live snapshot.
      const publication = sync.historyPublication();
      value = useCloudDogs(readerDatabase, owner, true, clock, null, {
        cloudBusy: publication.busy, cloudSuccess: completedMapRevision(publication),
        getMapPublication: () => sync.historyPublication(),
      });
      return null;
    }
    await act(async () => { renderer = Renderer.create(<Harness />); });
    expect(sync.mapPublication()).toMatchObject({ pending: false, mapSuccessRevision: 2 });
    expect(sync.historyPublication()).toMatchObject({ archiveRevision: 1, archiveCutoff: NOW });
    expect((await database.readLatestSnapshot(owner)).rows[0].slave_lat).toBe(coordinate.latitude);
    expect(value.rows[0].slave_lat).toBe(coordinate.latitude);
    // One real page transaction commits, then its larger pass is interrupted.
    await expect(sync.runManual(async () => {
      await database.savePage(owner, [record('partial-new', NOW, 0.001)], {
        masterId: 7, throughAt: new Date(NOW).toISOString(), eventId: 'partial-new',
      });
      throw new Error('process interruption after first committed page');
    })).rejects.toThrow('process interruption');
    await act(async () => { renderer.update(<Harness />); });
    expect(value.rows[0].slave_lat).toBe(coordinate.latitude); // same-process gate works
    expect((await database.loadSyncState(owner, 7)).event_id).toBe('partial-new');
    await act(async () => { renderer.unmount(); });
    await sync.dispose();
    // Independent DB wrapper and scheduler, unchanged durable SQLite rows.
    const restartedDatabase = createCloudDatabase(connection);
    readerDatabase = restartedDatabase;
    sync = createCloudSync({ client: client(fail), database: restartedDatabase });
    sync.setForeground(true); sync.setSession({ user: { id: owner } });
    expect(sync.mapPublication()).toMatchObject({ pending: false, mapSuccessRevision: 0 });
    // Match the real bootstrap ordering: owner effects/read microtasks run
    // before the scheduler's wake() zero-delay timer.
    await act(async () => { renderer = Renderer.create(<Harness />); });
    expect(value.loaded).toBe(true);
    if (fail) await act(async () => { await jest.advanceTimersByTimeAsync(1); renderer.update(<Harness />); });
    expect(value.rows[0].slave_lat).toBe(coordinate.latitude);
  } finally {
    await act(async () => { renderer?.unmount(); });
    await sync?.dispose(); connection.close(); jest.useRealTimers();
  }
});

// Positive controls: preserve useful offline completed cache and owner/BLE isolation.
test('clean cold cache stays readable offline without mixing another owner or local BLE', async () => {
  jest.useFakeTimers(); jest.setSystemTime(NOW);
  const connection = createMemoryConnection();
  let renderer, sync, value;
  try {
    await createDogDatabase(connection).initialize();
    const database = createCloudDatabase(connection);
    await database.initialize();
    await database.savePage(owner, [record('complete', NOW)]);
    await database.savePage('another-anonymous-owner', [{ ...record('other', NOW), slave_id: 8 }]);
    await connection.executeAsync(`INSERT INTO dog_status
      (slave_id, master_id, received_at, slave_lat, slave_lon) VALUES (9, 7, ?, ?, ?)`,
    [NOW, coordinate.latitude, coordinate.longitude]);
    const restart = createCloudDatabase(connection);
    sync = createCloudSync({ client: client(true), database: restart });
    sync.setSession({ user: { id: owner } });
    const clock = () => NOW;
    function Harness() {
      value = useCloudDogs(restart, owner, true, clock, null, {
        getMapPublication: () => sync.mapPublication(),
      });
      return null;
    }
    await act(async () => { renderer = Renderer.create(<Harness />); });
    expect(value.loaded).toBe(true);
    expect(value.rows.map(row => row.slave_id)).toEqual([6]);
    expect(value.packets.some(row => row.slave_id === 9 && row.source !== 'cloud')).toBe(true);
    expect(value.packets.some(row => row.slave_id === 8)).toBe(false);
  } finally {
    await act(async () => { renderer?.unmount(); });
    await sync?.dispose(); connection.close(); jest.useRealTimers();
  }
});

test('staged repair, pages and cursors survive wrappers, atomic publication failure, and owner changes', async () => {
  const connection = createMemoryConnection();
  try {
    await createDogDatabase(connection).initialize();
    const database = createCloudDatabase(connection);
    await database.initialize();
    await database.savePage(owner, [record('old', NOW - 10000)]);
    await database.savePage('another-anonymous-owner', [{ ...record('other', NOW), slave_id: 8 }]);
    await database.beginDownload(owner);
    await database.savePage(owner, [record('new', NOW, 0.001)], {
      masterId: 7, throughAt: new Date(NOW).toISOString(), eventId: 'new',
    });
    await database.repairTrackTimes(owner, [{ event_id: 'old', received_at: new Date(NOW - 5000).toISOString(),
      upload_source: 'wifi' }], ['old']);
    expect((await database.latestBySlave(owner, 0))[0].track_at).toBe(NOW - 10000);
    const restart = createCloudDatabase(connection);
    await restart.initialize();
    await restart.beginDownload(owner); // resumes, does not erase committed pages
    expect((await restart.loadSyncState(owner, 7)).event_id).toBe('new');
    expect(await restart.countRange(owner, 7, NOW - 20000, NOW + 1)).toBe(2);
    const execute = connection.executeBatchAsync;
    connection.executeBatchAsync = commands => execute([...commands,
      { query: 'INSERT INTO deliberately_missing_table VALUES (1)', params: [] }]);
    await expect(restart.publishDownload(owner)).rejects.toThrow();
    connection.executeBatchAsync = execute;
    expect((await restart.latestBySlave(owner, 0))[0].track_at).toBe(NOW - 10000);
    expect((await restart.loadSyncState(owner, 7)).event_id).toBe('new');
    await restart.beginDownload('another-anonymous-owner');
    await restart.publishDownload('another-anonymous-owner');
    expect((await restart.latestBySlave(owner, 0))[0].track_at).toBe(NOW - 10000);
    await restart.publishDownload(owner);
    expect((await restart.latestBySlave(owner, 0))[0].slave_lat).toBe(coordinate.latitude + 0.001);
    expect((await restart.latestBySlave('another-anonymous-owner', 0)).map(row => row.slave_id)).toEqual([8]);
    expect((await connection.executeAsync('SELECT track_at FROM supabase_dog_status WHERE owner_user_id=? AND event_id=?',
      [owner, 'old'])).results[0].track_at).toBe(NOW - 5000);
  } finally { connection.close(); }
});

test('next successful automatic pass publishes prior interrupted pages once', async () => {
  jest.useFakeTimers(); jest.setSystemTime(NOW);
  const connection = createMemoryConnection();
  let sync;
  try {
    await createDogDatabase(connection).initialize();
    const database = createCloudDatabase(connection);
    await database.initialize();
    await database.savePage(owner, [record(cloudEvent(1, NOW - 10000).event_id, NOW - 10000)]);
    await database.beginDownload(owner);
    await database.savePage(owner, [record('new', NOW, 0.001)]);
    const restarted = createCloudDatabase(connection);
    const publish = jest.spyOn(restarted, 'publishDownload');
    const snapshots = [];
    sync = createCloudSync({ client: client(false), database: restarted, onChange: state => snapshots.push(state) });
    sync.setSession({ user: { id: owner } }); sync.setForeground(true);
    expect((await database.latestBySlave(owner, 0))[0].slave_lat).toBe(coordinate.latitude);
    await jest.advanceTimersByTimeAsync(1);
    // Latest and complete context each publish, while archive completion is
    // exactly one separate terminal transaction with durable coverage proof.
    expect(snapshots.some(state => state.mapSuccessRevision === 1 && state.contextPending && state.archiveRevision === 0)).toBe(true);
    expect(sync.mapPublication()).toMatchObject({ pending: false, mapSuccessRevision: 2 });
    expect(sync.historyPublication()).toMatchObject({ archiveRevision: 1, archiveCutoff: NOW });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(owner, 'auto', NOW, expect.any(Function));
    expect(await restarted.readArchivePublication(owner)).toEqual({ owner, cutoff: NOW, revision: 1 });
    expect((await restarted.readLatestSnapshot(owner)).rows[0].slave_lat).toBe(coordinate.latitude);
    expect((await database.latestBySlave(owner, 0))[0].slave_lat).toBe(coordinate.latitude + 0.001);
    expect((await connection.executeAsync('SELECT COUNT(*) n FROM supabase_dog_status WHERE owner_user_id=?',
      [owner])).results[0].n).toBe(2);
  } finally { await sync?.dispose(); connection.close(); jest.useRealTimers(); }
});

test('bounded staging retention and a failed page preserve published rows and its resumable cursor', async () => {
  const connection = createMemoryConnection();
  try {
    await createDogDatabase(connection).initialize();
    const database = createCloudDatabase(connection, { maxRows: 3 });
    await database.initialize();
    await database.savePage(owner, [record('old', NOW - 10000)]);
    await database.beginDownload(owner);
    const checkpoint = { masterId: 7, throughAt: new Date(NOW).toISOString(), eventId: 'page-1' };
    await database.savePage(owner, [record('page-1', NOW)], checkpoint);
    await expect(database.savePage(owner, [{ ...record('invalid', NOW), received_at: null }],
      { ...checkpoint, eventId: 'invalid' })).rejects.toThrow();
    expect((await database.loadSyncState(owner, 7)).event_id).toBe('page-1');
    expect((await database.latestBySlave(owner, 0))[0].track_at).toBe(NOW - 10000);
    await expect(database.savePage(owner, [7, 8, 9].map(slave_id => ({ ...record(`protected-${slave_id}`, NOW + 1), slave_id })))).rejects.toThrow('手機空間不足');
    expect((await connection.executeAsync('SELECT COUNT(*) n FROM cloud_auto_supabase_dog_status')).results[0].n).toBe(1);
    expect((await database.loadSyncState(owner, 7)).event_id).toBe('page-1');
    expect((await connection.executeAsync('SELECT COUNT(*) n FROM supabase_dog_status')).results[0].n).toBe(1);
    await database.publishDownload(owner);
    expect((await connection.executeAsync('SELECT COUNT(*) n FROM supabase_dog_status')).results[0].n).toBe(2);
  } finally { connection.close(); }
});

test.each(['failure', 'cancel'])('actual automatic first page survives %s then restart without archive publication', async mode => {
  jest.useFakeTimers(); jest.setSystemTime(NOW);
  const connection = createMemoryConnection();
  let sync, renderer, value, fail = true, releasePage;
  const entered = new Promise(resolve => { releasePage = resolve; });
  let releaseFailure;
  const held = new Promise(resolve => { releaseFailure = resolve; });
  const partial = cloudEvent(7, NOW - 2000, { latitude: coordinate.latitude + 0.001 });
  const fixed = cloudEvent(8, NOW - 1000, { latitude: coordinate.latitude + 0.002 });
  const packet = cloudEvent(9, NOW - 500, { latitude: 0, longitude: 0, upload_source: 'phone', phone_received_at: new Date(NOW - 500).toISOString() });
  const eventId = partial.event_id;
  try {
    await createDogDatabase(connection).initialize();
    const database = createCloudDatabase(connection);
    await database.initialize();
    await database.savePage(owner, [record('old', NOW - 10000)]);
    const network = latestArchiveRest({ events: [partial, fixed, packet], archivePageSize: 1,
      beforeRead: async call => {
        if (call.phase !== 'archive' || !call.params.has('or') || !fail) return;
        releasePage(); await held;
        if (mode === 'failure') throw new Error('offline after archive page');
        sync.setForeground(false);
      },
    });
    sync = createCloudSync({ database, client: network.client });
    sync.setSession({ user: { id: owner } }); sync.setForeground(true);
    await jest.advanceTimersByTimeAsync(1); await entered;
    // The actual archive cursor is durable while the next REST page is held.
    // The no-GPS packet has already obtained its independent latest good fix.
    expect(sync.mapPublication()).toMatchObject({ pending: false, mapSuccessRevision: 2 });
    expect(sync.historyPublication()).toMatchObject({ archiveCutoff: null, archiveRevision: 0 });
    expect(captureActivityRead(() => sync.historyPublication(), owner, true).open).toBe(false);
    const snapshot = await database.readLatestSnapshot(owner);
    expect(snapshot.packets[0].event_id).toBe(packet.event_id);
    expect(snapshot.rows[0].event_id).toBe(fixed.event_id);
    expect(snapshot.context.map(row => row.event_id)).toEqual([partial.event_id, fixed.event_id, packet.event_id]);
    expect(network.calls.some(call => call.phase === 'fix')).toBe(true);
    expect(network.calls.some(call => call.phase === 'keys' && call.params.get('slave_id') === 'gt.6')).toBe(true);
    expect((await database.loadSyncState(owner, 7)).event_id).toBe(eventId);
    expect((await connection.executeAsync('SELECT event_id FROM cloud_auto_supabase_dog_status WHERE owner_user_id=?', [owner])).results)
      .toEqual([{ event_id: eventId }]);
    expect(await database.readArchivePublication(owner)).toBeNull();
    expect((await database.latestBySlave(owner, 0))[0].slave_lat).toBe(coordinate.latitude);
    releaseFailure(); await jest.advanceTimersByTimeAsync(1);
    expect((await database.loadSyncState(owner, 7)).event_id).toBe(eventId);
    expect(await database.readLatestSnapshot(owner)).toEqual(snapshot);
    if (mode === 'failure') expect(sync.historyPublication().archiveError).toBeTruthy();
    await sync.dispose();
    const restart = createCloudDatabase(connection);
    sync = createCloudSync({ database: restart, client: network.client });
    sync.setSession({ user: { id: owner } });
    const clock = () => NOW;
    function Harness() {
      value = useCloudDogs(restart, owner, true, clock, null, { getMapPublication: () => sync.historyPublication() });
      return null;
    }
    await act(async () => { renderer = Renderer.create(<Harness />); });
    expect(value.loaded).toBe(true);
    expect(value.rows[0].slave_lat).toBe(coordinate.latitude);
    expect((await restart.readLatestSnapshot(owner)).rows[0].event_id).toBe(fixed.event_id);
    expect(captureActivityRead(() => sync.historyPublication(), owner, true).open).toBe(false);
    const restartOffset = network.calls.length;
    fail = false;
    sync.setForeground(true);
    await act(async () => { await jest.advanceTimersByTimeAsync(1); });
    const resumed = network.calls.slice(restartOffset).find(call => call.phase === 'archive');
    expect(resumed.params.get('or')).toContain(`event_id.gt.${eventId}`);
    expect(sync.historyPublication()).toMatchObject({ archiveRevision: 1, archiveCutoff: NOW + 2 });
    expect(capturePageRead(() => sync.historyPublication(), owner, true).open).toBe(true);
    expect(await restart.readArchivePublication(owner)).toEqual({ owner, cutoff: NOW + 2, revision: 1 });
    expect((await restart.latestBySlave(owner, 0))[0].slave_lat).toBe(coordinate.latitude + 0.002);
    expect((await restart.readLatestSnapshot(owner)).rows[0].event_id).toBe(fixed.event_id);
    expect(await restart.count(owner)).toBe(4);
  } finally {
    releaseFailure?.();
    await act(async () => { renderer?.unmount(); });
    await sync?.dispose(); connection.close(); jest.useRealTimers();
  }
});

test.each(['packet', 'fix'])('real SDK %s failure cannot start archive or replace a complete cache', async failedPhase => {
  jest.useFakeTimers(); jest.setSystemTime(NOW);
  const connection = createMemoryConnection();
  let sync;
  try {
    await createDogDatabase(connection).initialize();
    const database = createCloudDatabase(connection);
    await database.initialize();
    await database.savePage(owner, [record('cached', NOW - 10000)]);
    const cached = await database.readLatestSnapshot(owner);
    const begin = jest.spyOn(database, 'beginDownload');
    const network = latestArchiveRest({ events: [cloudEvent(1, NOW - 1000),
      cloudEvent(2, NOW - 500, { latitude: 0, longitude: 0 })],
      beforeRead: async call => { if (call.phase === failedPhase) throw new Error('network failed before complete latest'); },
    });
    sync = createCloudSync({ database, client: network.client });
    sync.setSession({ user: { id: owner } }); sync.setForeground(true);
    await jest.advanceTimersByTimeAsync(1);
    expect(network.calls.some(call => call.phase === failedPhase)).toBe(true);
    expect(network.calls.some(call => call.phase === 'archive')).toBe(false);
    expect(begin).not.toHaveBeenCalled();
    expect(sync.mapPublication().mapSuccessRevision).toBe(0);
    expect(await database.readLatestSnapshot(owner)).toEqual(cached);
    expect(await database.count(owner)).toBe(1);
    expect(await database.loadSyncState(owner, 7)).toBeNull();
    expect(await database.readArchivePublication(owner)).toBeNull();
  } finally { await sync?.dispose(); connection.close(); jest.useRealTimers(); }
});
