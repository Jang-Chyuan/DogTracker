// Regression: manual completion publishes only its own complete scope.
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { createCloudSync } from '../src/cloud/CloudSync';
import { createHistoryCloud } from '../src/mapHistory/HistoryCloud';
import { captureActivityRead, capturePageRead } from '../src/cloud/CloudPagePublication';
import { latestArchiveRest, cloudEvent } from '../__fixtures__/LatestArchiveRest';

const NOW = Date.parse('2026-10-09T12:00:00Z');
const owner = 'anonymous-owner';
const row = (id, slave, time) => ({ event_id: id, master_id: 7, slave_id: slave,
  received_at: time, track_at: time, track_time_version: 1,
  slave_lat: 24.9892, slave_lon: 121.3132, activity_valid: 0, battery_valid: 0 });

test('complete manual window is readable while an unrelated partial auto job stays unpublished offline', async () => {
  jest.useFakeTimers(); jest.setSystemTime(NOW);
  const connection = createMemoryConnection();
  let sync;
  try {
    await createDogDatabase(connection).initialize();
    const database = createCloudDatabase(connection);
    await database.initialize();
    await database.savePage(owner, [row('complete-old', 6, NOW - 10000)]);
    await database.beginDownload(owner);
    await database.savePage(owner, [row('auto-partial', 8, NOW)]);
    sync = createCloudSync({ database, client: { from: () => { throw new Error('offline'); } } });
    sync.setForeground(true); sync.setSession({ user: { id: owner } });
    await sync.runManual(async () => {
      await database.savePage(owner, [row('manual-complete', 9, NOW)]);
      await database.setHistoryDownloadState(owner, 9, '2026-10-09', true);
    });
    await jest.advanceTimersByTimeAsync(1); // auto is still offline
    const visible = await database.latestBySlave(owner, 0);
    expect(visible.some(item => item.slave_id === 8)).toBe(false);
    expect(visible.some(item => item.slave_id === 9)).toBe(true);
    expect(await database.historyDownloadStates(owner, 9)).toEqual([
      { slave_id: 9, day: '2026-10-09', complete: 1 },
    ]);
  } finally { await sync?.dispose(); connection.close(); jest.useRealTimers(); }
});

test.each([2000, 10000])('newer manual publication wins over auto repair even when returning old values (%ims)', async offset => {
  const connection = createMemoryConnection();
  try {
    await createDogDatabase(connection).initialize();
    const database = createCloudDatabase(connection);
    await database.initialize();
    await database.savePage(owner, [row('existing', 6, NOW - 10000)]);
    await database.beginDownload(owner);
    await database.repairTrackTimes(owner, [{ event_id: 'existing', received_at: new Date(NOW - 5000).toISOString(),
      upload_source: 'wifi' }], ['existing']);
    await database.beginManualScope(owner, 6, '2026-10-09');
    await database.repairTrackTimes(owner, [{ event_id: 'existing', received_at: new Date(NOW - offset).toISOString(),
      upload_source: 'wifi' }], ['existing']);
    await database.publishManualScope(owner, 6, '2026-10-09');
    expect((await database.latestBySlave(owner, 0))[0].track_at).toBe(NOW - offset);
    await database.publishDownload(owner, 'auto');
    expect((await database.latestBySlave(owner, 0))[0].track_at).toBe(NOW - offset);
  } finally { connection.close(); }
});

test('one completed manual dog stays visible when the next dog fails and auto has partial rows', async () => {
  jest.useFakeTimers(); jest.setSystemTime(NOW);
  const connection = createMemoryConnection();
  let sync;
  try {
    await createDogDatabase(connection).initialize();
    const database = createCloudDatabase(connection);
    await database.initialize();
    await database.savePage(owner, [row('old', 6, NOW - 10000)]);
    await database.beginDownload(owner);
    await database.savePage(owner, [row('auto-partial', 8, NOW)]);
    const { client, calls } = latestArchiveRest({ events: [cloudEvent(9, NOW - 1000, { slave: 9 })],
      beforeRead: async call => {
        if (call.phase === 'archive' && call.params.get('slave_id') === 'eq.10') throw new Error('second dog failed');
      },
    });
    // Start from an already accepted live snapshot. Completing a historical
    // dog must not replace it, expose partial auto rows, or prove all history.
    await database.publishLatestSnapshot(owner, { cutoff: NOW - 5000, dogs: [{ slaveId: 6,
      packet: row('live-only', 6, NOW - 5000), fix: row('live-only', 6, NOW - 5000) }] });
    const snapshot = await database.readLatestSnapshot(owner);
    sync = createCloudSync({ database, client });
    sync.setForeground(true); sync.setSession({ user: { id: owner } });
    const ended = jest.fn();
    const history = createHistoryCloud({ client, database, owner, runManual: (...args) => sync.runManual(...args) });
    await expect(history.download({ slaveId: [9, 10], dayStart: NOW - 3600000, dayEnd: NOW, onDogEnd: ended }))
      .rejects.toMatchObject({ cause: { message: expect.stringContaining('second dog failed') } });
    expect(ended.mock.calls).toEqual([[9, 'done'], [10, 'failed']]);
    expect((await database.latestBySlave(owner, 0)).map(value => value.slave_id)).toEqual([6, 9]);
    expect(await database.historyDownloadStates(owner, [9, 10])).toEqual(expect.arrayContaining([
      expect.objectContaining({ slave_id: 9, complete: 1 }), expect.objectContaining({ slave_id: 10, complete: 0 }),
    ]));
    expect(calls.filter(call => call.phase === 'archive').map(call => call.params.get('slave_id'))).toEqual(['eq.9', 'eq.9', 'eq.10']);
    expect(sync.mapPublication()).toMatchObject({ pending: false, mapSuccessRevision: 0 });
    expect(sync.historyPublication()).toMatchObject({ publishedPending: false, archiveCutoff: null, archiveRevision: 0 });
    expect(capturePageRead(() => sync.historyPublication(), owner, true).open).toBe(true);
    expect(captureActivityRead(() => sync.historyPublication(), owner, true).open).toBe(false);
    expect(await database.readArchivePublication(owner)).toBeNull();
    expect(await database.readLatestSnapshot(owner)).toEqual(snapshot);
    const restarted = createCloudDatabase(connection);
    expect((await restarted.latestBySlave(owner, 0)).map(value => value.slave_id)).toEqual([6, 9]);
    expect(await restarted.readLatestSnapshot(owner)).toEqual(snapshot);
    expect(await restarted.readArchivePublication(owner)).toBeNull();
  } finally { await sync?.dispose(); connection.close(); jest.useRealTimers(); }
});

test('cancelled manual pages never publish and a fresh manual scope cannot inherit them', async () => {
  jest.useFakeTimers(); jest.setSystemTime(NOW);
  const connection = createMemoryConnection();
  let sync;
  try {
    await createDogDatabase(connection).initialize();
    const database = createCloudDatabase(connection);
    await database.initialize();
    await database.savePage(owner, [row('old', 6, NOW - 10000)]);
    sync = createCloudSync({ database, client: {} });
    sync.setForeground(true); sync.setSession({ user: { id: owner } });
    const abort = new AbortController();
    await expect(sync.runManual(async () => {
      await database.savePage(owner, [row('cancelled', 8, NOW)]);
      abort.abort();
    }, abort)).rejects.toThrow('下載已取消');
    expect((await database.latestBySlave(owner, 0)).map(value => value.slave_id)).toEqual([6]);
    await sync.runManual(async () => database.savePage(owner, [row('complete', 9, NOW)]));
    expect((await database.latestBySlave(owner, 0)).map(value => value.slave_id)).toEqual([6, 9]);
  } finally { await sync?.dispose(); connection.close(); jest.useRealTimers(); }
});

test('publication fence changes before commit, after commit and across later manual jobs without auto release', async () => {
  jest.useFakeTimers(); jest.setSystemTime(NOW);
  let finish, began;
  const entered = new Promise(resolve => { began = resolve; });
  const notifications = [];
  const sync = createCloudSync({ client: {}, database: {}, onChange: state => notifications.push(state) });
  sync.setSession({ user: { id: owner } }); sync.setForeground(true);
  try {
    const manual = sync.runManual(async (_lease, publishScoped) => publishScoped(() => {
      began(); return new Promise(resolve => { finish = resolve; });
    }));
    await entered;
    const during = sync.mapPublication();
    expect(during).toMatchObject({ publishedPending: true, publishedRevision: 1, pending: true, mapSuccessRevision: 0 });
    finish(); await manual;
    expect(sync.mapPublication()).toMatchObject({ publishedPending: false, publishedRevision: 2, pending: true, mapSuccessRevision: 0 });
    await sync.runManual(async (_lease, publishScoped) => publishScoped(async () => {}));
    expect(sync.mapPublication()).toMatchObject({ publishedPending: false, publishedRevision: 4, pending: true, mapSuccessRevision: 0 });
    expect(notifications.some(state => state.publishedPending && state.publishedRevision === 3)).toBe(true);
  } finally { await sync.dispose(); jest.useRealTimers(); }
});

test('owner replacement keeps published reads fenced until an already-started native publication settles', async () => {
  jest.useFakeTimers();
  let finish, began;
  const entered = new Promise(resolve => { began = resolve; });
  const sync = createCloudSync({ client: {}, database: {} });
  sync.setSession({ user: { id: owner } }); sync.setForeground(true);
  try {
    const manual = sync.runManual(async (_lease, publishScoped) => publishScoped(() => {
      began(); return new Promise(resolve => { finish = resolve; });
    })).catch(() => {});
    await entered;
    sync.setSession({ user: { id: 'another-anonymous-owner' } });
    expect(sync.mapPublication()).toMatchObject({ owner: 'another-anonymous-owner', publishedPending: true });
    finish();
    await manual;
    expect(sync.mapPublication()).toMatchObject({ owner: 'another-anonymous-owner', publishedPending: false });
    expect(sync.mapPublication().publishedRevision).toBeGreaterThan(0);
  } finally { finish?.(); await Promise.resolve(sync.dispose()).catch(() => {}); jest.useRealTimers(); }
});
