import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { createCloudSync } from '../src/cloud/CloudSync';
import { completedMapRevision } from '../src/cloud/CloudPublication';
import { useCloudDogs } from '../src/cloud/useCloudDogs';

// Investigation-only regression: the production DB keeps committed pages
// across independent schedulers, while process-local React gates disappear.
const NOW = Date.parse('2026-10-09T12:00:00Z');
const owner = 'anonymous-owner';
const coordinate = { latitude: 24.9892, longitude: 121.3132 };
const record = (id, time, delta = 0) => ({ event_id: id, master_id: 7, slave_id: 6,
  received_at: time, track_at: time, track_time_version: 1, slave_lat: coordinate.latitude + delta,
  slave_lon: coordinate.longitude, satellites: 9, hdop: 1, activity_valid: 0, battery_valid: 0 });
const client = fail => ({ from: () => {
  const query = {};
  for (const method of ['select', 'eq', 'order', 'range']) query[method] = () => query;
  query.abortSignal = async () => { if (fail) throw new Error('offline after restart'); return { data: [] }; };
  return query;
} });

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
      const publication = sync.mapPublication();
      value = useCloudDogs(readerDatabase, owner, true, clock, null, {
        cloudBusy: publication.busy, cloudSuccess: completedMapRevision(publication),
        getMapPublication: () => sync.mapPublication(),
      });
      return null;
    }
    await act(async () => { renderer = Renderer.create(<Harness />); });
    expect(sync.mapPublication()).toMatchObject({ pending: false, mapSuccessRevision: 1 });
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
    await database.savePage(owner, [record('old', NOW - 10000)]);
    await database.beginDownload(owner);
    await database.savePage(owner, [record('new', NOW, 0.001)]);
    sync = createCloudSync({ client: client(false), database: createCloudDatabase(connection) });
    sync.setSession({ user: { id: owner } }); sync.setForeground(true);
    expect((await database.latestBySlave(owner, 0))[0].slave_lat).toBe(coordinate.latitude);
    await jest.advanceTimersByTimeAsync(1);
    expect(sync.mapPublication()).toMatchObject({ pending: false, mapSuccessRevision: 1 });
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
    await expect(database.savePage(owner, [record('page-2', NOW + 1), record('page-3', NOW + 2)])).rejects.toThrow('手機空間不足');
    expect((await connection.executeAsync('SELECT COUNT(*) n FROM cloud_auto_supabase_dog_status')).results[0].n).toBe(1);
    expect((await database.loadSyncState(owner, 7)).event_id).toBe('page-1');
    expect((await connection.executeAsync('SELECT COUNT(*) n FROM supabase_dog_status')).results[0].n).toBe(1);
    await database.publishDownload(owner);
    expect((await connection.executeAsync('SELECT COUNT(*) n FROM supabase_dog_status')).results[0].n).toBe(2);
  } finally { connection.close(); }
});

test.each(['failure', 'cancel'])('actual automatic first page survives %s then restart without publication', async mode => {
  jest.useFakeTimers(); jest.setSystemTime(NOW);
  const connection = createMemoryConnection();
  let sync, renderer, value, fail = true, pages = 0;
  const eventId = '00000000-0000-4000-8000-000000000007';
  try {
    await createDogDatabase(connection).initialize();
    const database = createCloudDatabase(connection);
    await database.initialize();
    await database.savePage(owner, [record('old', NOW - 10000)]);
    const network = { from: table => {
      const query = { offset: 0, count: false };
      for (const method of ['eq', 'gte', 'lt', 'order', 'limit', 'or', 'in']) query[method] = () => query;
      query.select = (_fields, options) => { query.count = !!options?.head; return query; };
      query.range = offset => { query.offset = offset; return query; };
      query.abortSignal = async () => {
        if (table === 'device_members') return { data: query.offset === 0 ? [{ gateway_id: 'master_7', slave_id: 6 }] : [] };
        if (query.count) return { count: 0 };
        if (pages++ === 0) return { data: [{ event_id: eventId, master_id: 7, slave_id: 6,
          received_at: new Date(NOW - 1000).toISOString(), payload: { slaveId: 6, lat: 24990200, lon: 121313200 } }] };
        if (fail) {
          if (mode === 'failure') throw new Error('offline after page');
          sync.setForeground(false);
        }
        return { data: [] };
      };
      return query;
    } };
    sync = createCloudSync({ database, client: network });
    sync.setSession({ user: { id: owner } }); sync.setForeground(true);
    await jest.advanceTimersByTimeAsync(1);
    expect(sync.mapPublication()).toMatchObject({ pending: true, mapSuccessRevision: 0 });
    expect((await database.loadSyncState(owner, 7)).event_id).toBe(eventId);
    expect((await database.latestBySlave(owner, 0))[0].slave_lat).toBe(coordinate.latitude);
    await sync.dispose();
    const restart = createCloudDatabase(connection);
    sync = createCloudSync({ database: restart, client: network });
    sync.setSession({ user: { id: owner } });
    const clock = () => NOW;
    function Harness() {
      value = useCloudDogs(restart, owner, true, clock, null, { getMapPublication: () => sync.mapPublication() });
      return null;
    }
    await act(async () => { renderer = Renderer.create(<Harness />); });
    expect(value.loaded).toBe(true);
    expect(value.rows[0].slave_lat).toBe(coordinate.latitude);
    fail = false;
    sync.setForeground(true);
    await act(async () => { await jest.advanceTimersByTimeAsync(1); });
    expect(sync.mapPublication()).toMatchObject({ pending: false, mapSuccessRevision: 1 });
    expect((await restart.latestBySlave(owner, 0))[0].slave_lat).toBe(coordinate.latitude + 0.001);
  } finally {
    await act(async () => { renderer?.unmount(); });
    await sync?.dispose(); connection.close(); jest.useRealTimers();
  }
});
