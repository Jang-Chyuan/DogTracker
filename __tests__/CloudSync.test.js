import { createCloudSync } from '../src/cloud/CloudSync';
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { useCloudDogs } from '../src/cloud/useCloudDogs';
import { completedMapRevision } from '../src/cloud/CloudPublication';
import MapScreen from '../src/screens/MapScreen';
import TrackingMap from '../src/map/TrackingMap';
import { GOOGLE_MAP_PROVIDER } from '../src/map/GoogleMapProvider';
import { trackingPoint } from '../__fixtures__/TrackingPointFixtures';
import { emptyLiveRoute } from '../src/tracking/LiveRouteWindow';
import { DEFAULT_TRACKING_PREFERENCES } from '../src/tracking/TrackingPreferences';
import { createCloudSecureStorage } from '../src/cloud/CloudSecureStorage';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';

const NOW = Date.parse('2026-09-17T12:00:00Z');
const account = id => ({ user: { id } });
let engine;
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(NOW); });
afterEach(async () => { engine?.dispose(); engine = null; jest.useRealTimers(); });

// Hourly count checks share the telemetry table; they are head requests.
const isCount = query => !!query.filters.select?.[1]?.head;
const downloads = queries => queries.filter(q => q.table === 'dog_telemetry' && !isCount(q));
const counts = queries => queries.filter(q => q.table === 'dog_telemetry' && isCount(q));

function fixture(cloudCounts = {}) {
  const queries = [];
  const states = new Map();
  const buckets = new Map();
  const database = {
    initialize: jest.fn(async () => {}),
    loadSyncState: jest.fn(async (owner, master) => states.get(`${owner}:${master}`) || null),
    savePage: jest.fn(async (owner, _rows, checkpoint) => {
      if (checkpoint) states.set(`${owner}:${checkpoint.masterId}`, { through_at: checkpoint.throughAt });
    }),
    loadBuckets: jest.fn(async (owner, master) => buckets.get(`${owner}:${master}`) || []),
    saveBucket: jest.fn(async (owner, master, start, count) => {
      const key = `${owner}:${master}`;
      buckets.set(key, [...(buckets.get(key) || []).filter(b => b.bucket_start !== start),
        { bucket_start: start, cloud_count: count }]);
    }),
    countRange: jest.fn(async () => 0),
  };
  const client = { from: jest.fn(table => {
    const query = { table, filters: {} };
    for (const method of ['select', 'eq', 'gte', 'lt', 'order', 'range', 'limit', 'or']) {
      query[method] = jest.fn((...args) => { query.filters[method] = args; return query; });
    }
    query.abortSignal = jest.fn(async () => {
      if (isCount(query)) return { count: cloudCounts[Date.parse(query.filters.gte[1])] ?? 0 };
      return { data: table === 'device_members' && query.filters.range[0] === 0
        ? [{ gateway_id: 'master_7', slave_id: 4 }, { gateway_id: 'master_7', slave_id: 1 },
          { gateway_id: 'master_5', slave_id: 4 }] : [] };
    });
    queries.push(query);
    return query;
  }) };
  const changed = jest.fn();
  engine = createCloudSync({ client, database, onChange: changed });
  return { client, database, changed, queries, states, buckets, cloudCounts };
}
const flush = () => jest.advanceTimersByTimeAsync(1);

test('immediate first-day sync, 30-second cadence, and restart catch-up per account/master', async () => {
  const { queries, states, client, database } = fixture();
  engine.setForeground(true); engine.setSession(account('a'));
  await flush();
  const first = downloads(queries);
  expect(first).toHaveLength(2);
  expect(first[0].filters.gte).toEqual(['received_at', '2026-09-16T12:00:00.000Z']);
  expect(states.get('a:7').through_at).toBe('2026-09-17T12:00:00.000Z');
  await jest.advanceTimersByTimeAsync(30000);
  expect(downloads(queries)).toHaveLength(4);
  expect(downloads(queries)[2].filters.gte[1]).toBe('2026-09-17T11:55:00.000Z');
  await engine.dispose();
  jest.setSystemTime(NOW + 3 * 86400000);
  engine = createCloudSync({ client, database });
  engine.setForeground(true); engine.setSession(account('a'));
  await flush();
  expect(downloads(queries)[4].filters.gte[1]).toBe('2026-09-17T11:55:30.000Z');
});

test('background and logout stop schedules; foreground resumes immediately', async () => {
  const { queries } = fixture();
  engine.setForeground(true); engine.setSession(account('a')); await flush();
  engine.setForeground(false);
  const length = queries.length;
  await jest.advanceTimersByTimeAsync(90000);
  expect(queries).toHaveLength(length);
  engine.setForeground(true); await flush();
  expect(queries.length).toBeGreaterThan(length);
  engine.setSession(null);
  const loggedOut = queries.length;
  await jest.advanceTimersByTimeAsync(60000);
  expect(queries).toHaveLength(loggedOut);
});

test('one automatic request at a time, and stale account responses do not write checkpoints', async () => {
  const { client, database } = fixture();
  let resolve;
  client.from.mockImplementationOnce(() => {
    const query = {};
    for (const name of ['select', 'eq', 'order', 'range']) query[name] = () => query;
    query.abortSignal = () => new Promise(done => { resolve = done; });
    return query;
  });
  engine.setForeground(true); engine.setSession(account('a')); await flush();
  await jest.advanceTimersByTimeAsync(60000);
  expect(client.from).toHaveBeenCalledTimes(1);
  engine.setSession(account('b'));
  resolve({ data: [{ gateway_id: 'master_7', slave_id: 4 }] });
  await flush(); await flush();
  expect(database.savePage.mock.calls.every(([owner]) => owner === 'b')).toBe(true);
});

test('manual download waits for automatic cancellation, blocks ticks, and leaves auto progress alone', async () => {
  const { client, queries, states } = fixture();
  let cancel;
  client.from.mockImplementationOnce(() => {
    const query = {};
    for (const name of ['select', 'eq', 'order', 'range']) query[name] = () => query;
    query.abortSignal = signal => new Promise(resolve => {
      cancel = () => resolve({ error: { message: 'aborted' } });
      signal.addEventListener('abort', cancel, { once: true });
    });
    return query;
  });
  engine.setForeground(true); engine.setSession(account('a')); await flush();
  let finish;
  const work = jest.fn(() => new Promise(resolve => { finish = resolve; }));
  const manual = engine.runManual(work);
  await flush();
  expect(work).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(60000);
  expect(queries).toHaveLength(0);
  expect(states.size).toBe(0);
  finish(3); await expect(manual).resolves.toBe(3);
  await flush();
  expect(states.size).toBe(2);
});

test('page failure leaves the saved checkpoint and retries on the next tick', async () => {
  const { database, states, changed } = fixture();
  states.set('a:7', { through_at: '2026-09-16T12:00:00Z' });
  database.savePage.mockRejectedValueOnce(new Error('disk full'));
  engine.setForeground(true); engine.setSession(account('a')); await flush();
  expect(states.get('a:7').through_at).toBe('2026-09-16T12:00:00Z');
  expect(changed.mock.calls.some(([state]) => state.error === 'disk full')).toBe(true);
  await jest.advanceTimersByTimeAsync(30000);
  expect(states.get('a:7').through_at).toBe('2026-09-17T12:00:30.000Z');
});

test('SQLite progress commits with rows, survives reopen, and manual writes do not advance it', async () => {
  const connection = createMemoryConnection();
  try {
    await createDogDatabase(connection).initialize();
    let database = createCloudDatabase(connection);
    await database.initialize();
    const checkpoint = { masterId: 7, throughAt: '2026-09-17T12:00:00Z', eventId: 'event-one' };
    const row = { event_id: 'event-one', received_at: NOW, master_id: 7,
      activity_valid: 0, battery_valid: 0 };
    await database.savePage('a', [row], checkpoint);
    await expect(database.savePage('a', [{ ...row, event_id: 'invalid', received_at: null }],
      { ...checkpoint, throughAt: '2026-09-18T00:00:00Z' })).rejects.toThrow();
    database = createCloudDatabase(connection); await database.initialize();
    expect(await database.loadSyncState('a', 7)).toMatchObject({ through_at: checkpoint.throughAt, event_id: 'event-one' });
    await database.savePage('a', [{ ...row, event_id: 'manual-old', received_at: 1 }]);
    expect(await database.loadSyncState('a', 7)).toMatchObject({ through_at: checkpoint.throughAt });
    expect(await database.loadSyncState('b', 7)).toBeNull();
    expect(await database.loadSyncState('a', 5)).toBeNull();
    // If the checkpoint write itself fails, the telemetry insert rolls back too.
    await connection.executeAsync("CREATE TRIGGER reject_sync BEFORE INSERT ON cloud_sync_state BEGIN SELECT RAISE(ABORT, 'failed'); END");
    await expect(database.savePage('a', [{ ...row, event_id: 'rolled-back' }], checkpoint)).rejects.toThrow();
    expect(await database.count('a')).toBe(2);
  } finally { connection.close(); }
});

test('secure sessions survive adapter recreation and logout removes them', async () => {
  const values = new Map();
  const vault = {
    ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only' },
    getGenericPassword: jest.fn(async ({ service }) => values.get(service) || false),
    setGenericPassword: jest.fn(async (username, password, { service }) => {
      values.set(service, { username, password }); return { service };
    }),
    resetGenericPassword: jest.fn(async ({ service }) => values.delete(service)),
  };
  await createCloudSecureStorage(vault).setItem('project-auth-token', '{"refresh_token":"test"}');
  const reopened = createCloudSecureStorage(vault);
  expect(await reopened.getItem('project-auth-token')).toBe('{"refresh_token":"test"}');
  expect(await reopened.getItem('other-project')).toBeNull();
  await reopened.removeItem('project-auth-token');
  expect(await reopened.getItem('project-auth-token')).toBeNull();
  vault.setGenericPassword.mockResolvedValueOnce(false);
  await expect(reopened.setItem('project-auth-token', 'data')).rejects.toThrow('安全保存');
});

test('the hourly count check runs every ten minutes and only fetches what changed', async () => {
  const hour = Date.parse('2026-09-17T11:00:00Z');
  const { queries, states, buckets, cloudCounts } = fixture({ [hour]: 2 });
  engine.setForeground(true); engine.setSession(account('a')); await flush();
  // 24 closed hours per Master. The incremental pass has just walked them, so
  // the first sweep records the counts instead of downloading the day again.
  expect(counts(queries)).toHaveLength(48);
  expect(downloads(queries).filter(q => q.filters.gte[1] === '2026-09-17T11:00:00.000Z')).toHaveLength(0);
  expect(buckets.get('a:7')).toContainEqual({ bucket_start: hour, cloud_count: 2 });
  const swept = counts(queries).length;
  await jest.advanceTimersByTimeAsync(9 * 60000);
  expect(counts(queries)).toHaveLength(swept);
  // A Master uploads two more rows into that hour: now the count differs from
  // the verified one, so that hour - and only that hour - is fetched again.
  cloudCounts[hour] = 4;
  await jest.advanceTimersByTimeAsync(60000);
  expect(counts(queries).length).toBeGreaterThan(swept);
  expect(downloads(queries).filter(q => q.filters.gte[1] === '2026-09-17T11:00:00.000Z')).toHaveLength(2);
  expect(buckets.get('a:7')).toContainEqual({ bucket_start: hour, cloud_count: 4 });
  // The sweep must never move the incremental checkpoint: its pages carry no
  // checkpoint at all, so progress only follows the 30-second pass (which by
  // now has reached 12:10, ten minutes of ticks later).
  // A sweep checkpoint would have written an hour boundary; progress instead
  // follows the 30-second pass, which by now has reached 12:10.
  expect(states.get('a:7').through_at).toBe('2026-09-17T12:10:00.000Z');
});

test('cloud dogs\' clock: when the last download started, and since when downloads keep failing', async () => {
  const { database, changed } = fixture();
  database.savePage.mockRejectedValue(new Error('offline'));
  engine.setForeground(true); engine.setSession(account('a')); await flush();
  const last = () => changed.mock.calls.at(-1)[0];
  expect(last()).toMatchObject({ error: 'offline', lastDownloadAt: null, failingSince: NOW });
  // A second failure keeps the time of the first.
  await jest.advanceTimersByTimeAsync(30000);
  expect(last()).toMatchObject({ failingSince: NOW });
  database.savePage.mockImplementation(async () => {});
  await jest.advanceTimersByTimeAsync(30000);
  expect(last()).toMatchObject({ error: '', lastDownloadAt: NOW + 60000, failingSince: null });
  // Another account starts over.
  engine.setSession(account('b'));
  expect(changed.mock.calls.find(([state]) => state.owner === 'b')[0])
    .toMatchObject({ lastDownloadAt: null, failingSince: null });
});

test('resumed cloud download stays visible after local work finishes, then clears on actual success', async () => {
  const { database, changed } = fixture();
  engine.setForeground(true); engine.setSession(account('a')); await flush();
  expect(changed.mock.calls.at(-1)[0].catchUp.phase).toBe('idle');
  engine.setForeground(false);
  let finish;
  database.initialize.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  engine.setForeground(true); await flush();
  expect(changed.mock.calls.at(-1)[0].catchUp.phase).toBe('catching-up');
  finish(); await flush();
  expect(changed.mock.calls.at(-1)[0].catchUp.phase).toBe('idle');
  // Normal 30s polling does not become a resume indicator.
  changed.mockClear(); await jest.advanceTimersByTimeAsync(30000);
  expect(changed.mock.calls.every(([value]) => value.catchUp.phase === 'idle')).toBe(true);
});

test('slow resumed cloud work stays updating past 20s and clears only on complete success', async () => {
  const { database, changed } = fixture();
  engine.setForeground(true); engine.setSession(account('a')); await flush();
  engine.setForeground(false);
  let finish;
  database.initialize.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  engine.setForeground(true); await flush();
  changed.mockClear();
  await jest.advanceTimersByTimeAsync(60000);
  expect(changed.mock.calls.some(([state]) => state.catchUp.phase === 'failed')).toBe(false);
  finish(); await flush();
  expect(changed.mock.calls.at(-1)[0]).toMatchObject({ busy: false, error: '', catchUp: { phase: 'idle' } });
});

test('cloud resume timeout retries a fresh generation and late old response cannot end it', async () => {
  const { database, changed } = fixture();
  engine.setForeground(true); engine.setSession(account('a')); await flush();
  engine.setForeground(false);
  let oldFinish, newFinish;
  database.initialize.mockImplementationOnce(() => new Promise(resolve => { oldFinish = resolve; }))
    .mockImplementationOnce(() => new Promise(resolve => { newFinish = resolve; }));
  engine.setForeground(true); await flush();
  await jest.advanceTimersByTimeAsync(21000);
  expect(changed.mock.calls.at(-1)[0].catchUp.phase).toBe('catching-up');
  await jest.advanceTimersByTimeAsync(99000);
  expect(changed.mock.calls.at(-1)[0].catchUp.phase).toBe('failed');
  engine.retry(); await flush();
  expect(changed.mock.calls.at(-1)[0].catchUp.phase).toBe('catching-up');
  oldFinish(); await flush();
  expect(newFinish).toBeDefined();
  expect(changed.mock.calls.at(-1)[0].catchUp.phase).toBe('catching-up');
  newFinish(); await flush();
  expect(changed.mock.calls.at(-1)[0].catchUp.phase).toBe('idle');
});

test('cloud failure exposes resume retry and leaving or changing account removes stale failure', async () => {
  const { database, changed } = fixture();
  engine.setForeground(true); engine.setSession(account('a')); await flush();
  engine.setForeground(false);
  database.initialize.mockRejectedValueOnce(new Error('Network request failed'));
  engine.setForeground(true); await flush();
  expect(changed.mock.calls.at(-1)[0].catchUp.phase).toBe('failed');
  engine.setForeground(false);
  expect(changed.mock.calls.at(-1)[0].catchUp.phase).toBe('idle');
  engine.setSession(account('b'));
  engine.setForeground(true); await flush();
  expect(changed.mock.calls.at(-1)[0].catchUp.phase).toBe('idle');
});

test('a failed initial download still reports catch-up on the next foreground return', async () => {
  const { database, changed } = fixture();
  database.initialize.mockRejectedValueOnce(new Error('Network request failed'));
  engine.setForeground(true); engine.setSession(account('a')); await flush();
  expect(changed.mock.calls.at(-1)[0].catchUp.phase).toBe('idle');
  engine.setForeground(false);
  let finish;
  database.initialize.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  engine.setForeground(true); await flush();
  expect(changed.mock.calls.at(-1)[0].catchUp.phase).toBe('catching-up');
  finish(); await flush();
  expect(changed.mock.calls.at(-1)[0].catchUp.phase).toBe('idle');
});

test('backgrounding an unfinished initial download still shows the next return attempt', async () => {
  const { database, changed } = fixture();
  let oldFinish, currentFinish;
  database.initialize.mockImplementationOnce(() => new Promise(resolve => { oldFinish = resolve; }))
    .mockImplementationOnce(() => new Promise(resolve => { currentFinish = resolve; }));
  engine.setForeground(true); engine.setSession(account('a')); await flush();
  expect(changed.mock.calls.at(-1)[0].catchUp.phase).toBe('idle');
  engine.setForeground(false); engine.setForeground(true); await flush();
  expect(changed.mock.calls.at(-1)[0].catchUp.phase).toBe('catching-up');
  oldFinish(); await flush();
  expect(currentFinish).toBeDefined();
  expect(changed.mock.calls.at(-1)[0].catchUp.phase).toBe('catching-up');
  currentFinish(); await flush();
  expect(changed.mock.calls.at(-1)[0].catchUp.phase).toBe('idle');
});

test('manual history work during resume cannot claim that the live cloud download is caught up', async () => {
  const { database, changed } = fixture();
  engine.setForeground(true); engine.setSession(account('a')); await flush();
  engine.setForeground(false);
  let oldFinish, liveFinish;
  database.initialize.mockImplementationOnce(() => new Promise(resolve => { oldFinish = resolve; }))
    .mockImplementationOnce(() => new Promise(resolve => { liveFinish = resolve; }));
  engine.setForeground(true); await flush();
  const manual = engine.runManual(async () => 'history window only');
  oldFinish(); await flush(); await manual; await flush();
  expect(liveFinish).toBeDefined();
  expect(changed.mock.calls.at(-1)[0].catchUp.phase).toBe('catching-up');
  liveFinish(); await flush();
  expect(changed.mock.calls.at(-1)[0].catchUp.phase).toBe('idle');
});

test('live map publication advances only on complete automatic work and resets on account switch', async () => {
  const { changed } = fixture();
  const current = () => changed.mock.calls.at(-1)[0];
  engine.setForeground(true); engine.setSession(account('a')); await flush();
  expect(current().mapSuccessRevision).toBe(1);
  await expect(engine.runManual(async () => { throw new Error('partial page failed'); })).rejects.toThrow('partial page failed');
  expect(current().mapSuccessRevision).toBe(1);
  await expect(engine.runManual(async () => 'complete window')).resolves.toBe('complete window');
  expect(current().mapSuccessRevision).toBe(1);
  let finish;
  const late = engine.runManual(() => new Promise(resolve => { finish = resolve; }));
  await Promise.resolve(); await Promise.resolve();
  engine.setSession(account('b'));
  expect(current().mapSuccessRevision).toBe(0);
  finish('obsolete account'); await expect(late).rejects.toThrow('下載已取消');
  expect(current().mapSuccessRevision).toBe(0);
});

test('automatic failure cannot publish a complete map generation; retry success can', async () => {
  const { database, changed } = fixture();
  database.initialize.mockRejectedValueOnce(new Error('download failed'));
  engine.setForeground(true); engine.setSession(account('a')); await flush();
  expect(changed.mock.calls.at(-1)[0]).toMatchObject({ mapSuccessRevision: 0, error: 'download failed' });
  engine.retry(); await flush();
  expect(changed.mock.calls.at(-1)[0]).toMatchObject({ mapSuccessRevision: 1, error: '' });
});


test('manual window completion cannot publish canceled auto pages; the next complete auto updates the real Map', async () => {
  const { database, changed } = fixture();
  const latest = () => changed.mock.calls.at(-1)?.[0] ?? { busy: false, mapSuccessRevision: 0 };
  let position = 25, state, renderer;
  database.latestBySlave = jest.fn(async () => [{ slave_id: 8, master_id: 7,
    received_at: NOW, slave_lat: position, slave_lon: 121 }]);
  const clock = () => NOW;
  const tracking = { mode: 'real', point: { ...trackingPoint, id: null, slaveId: null, slaveLat: null, slaveLon: null },
    route: emptyLiveRoute(), positionSamples: [], ready: { real: true }, errors: {},
    initialSnapshotReady: true, foreground: true,
    preferences: { ready: true, busy: false, value: DEFAULT_TRACKING_PREFERENCES } };
  function Harness() {
    const sync = latest();
    state = useCloudDogs(database, 'a', true, clock, null, {
      revision: sync.revision ?? 0,
      cloudBusy: sync.busy || sync.catchUp?.phase === 'catching-up',
      cloudSuccess: completedMapRevision(sync),
      getMapPublication: engine.mapPublication,
    });
    return <MapScreen tracking={tracking} phone={{ enabled: true }} cloudOwner="a" cloudDogs={state}
      cloudSync={sync} mapProvider={GOOGLE_MAP_PROVIDER} />;
  }
  const drawnLatitude = () => renderer.root.findByType(TrackingMap).props.presentation.dogMarkers
    .find(dog => dog.slaveId === 8).coordinate.latitude;
  try {
    await act(async () => { renderer = Renderer.create(<Harness />); });
    changed.mockImplementation(() => { renderer.update(<Harness />); });
    await act(async () => { engine.setForeground(true); engine.setSession(account('a')); await flush(); });
    expect(latest().mapSuccessRevision).toBe(1);
    expect(drawnLatitude()).toBe(25);
    let failPage;
    database.savePage.mockImplementationOnce(() => new Promise((resolve, reject) => { failPage = reject; }));
    await act(async () => { await jest.advanceTimersByTimeAsync(30000); });
    expect(latest()).toMatchObject({ busy: true, mode: 'auto', mapSuccessRevision: 1, catchUp: { phase: 'idle' } });
    // Persist a partial page only after the busy render, before the failing
    // continuation. The manual window is for another historical dog/day.
    position = 26;
    await act(async () => {
      const manual = engine.runManual(async () => 'different history window complete');
      failPage(new Error('cancelled automatic continuation'));
      await expect(manual).resolves.toBe('different history window complete');
    });
    expect(latest()).toMatchObject({ busy: false, mapSuccessRevision: 1, catchUp: { phase: 'idle' } });
    expect(state.cloudCommit).toBe(1);
    expect(state.rows[0].slave_lat).toBe(25);
    expect(drawnLatitude()).toBe(25);
    await act(async () => { await flush(); }); // scheduled complete automatic pass
    expect(latest().mapSuccessRevision).toBe(2);
    expect(state.cloudCommit).toBe(2);
    expect(drawnLatitude()).toBe(26);
  } finally {
    changed.mockImplementation(() => {});
    await act(async () => { renderer?.unmount(); });
  }
});

test.each(['error', 'abort'])('synchronous publication fence rejects %s pages when React skips every busy render', async failure => {
  const { database, changed } = fixture();
  const latest = () => changed.mock.calls.at(-1)?.[0] ?? { busy: false, mapSuccessRevision: 0 };
  let position = 25, state, renderer;
  database.latestBySlave = async () => [{ slave_id: 8, master_id: 7, received_at: NOW,
    slave_lat: position, slave_lon: 121 }];
  const clock = () => NOW;
  const tracking = { mode: 'real', point: { ...trackingPoint, id: null, slaveId: null, slaveLat: null, slaveLon: null },
    route: emptyLiveRoute(), positionSamples: [], ready: { real: true }, errors: {}, initialSnapshotReady: true,
    foreground: true, preferences: { ready: true, busy: false, value: DEFAULT_TRACKING_PREFERENCES } };
  const getMapPublication = () => engine.mapPublication?.();
  function Harness() {
    const sync = latest();
    state = useCloudDogs(database, 'a', true, clock, null, {
      revision: sync.revision ?? 0, cloudBusy: sync.busy,
      cloudSuccess: completedMapRevision(sync), getMapPublication,
    });
    return <MapScreen tracking={tracking} phone={{ enabled: true }} cloudOwner="a" cloudDogs={state}
      cloudSync={{ ...sync, getMapPublication }} mapProvider={GOOGLE_MAP_PROVIDER} />;
  }
  const latitude = () => renderer.root.findByType(TrackingMap).props.presentation.dogMarkers
    .find(dog => dog.slaveId === 8).coordinate.latitude;
  try {
    await act(async () => { renderer = Renderer.create(<Harness />); });
    changed.mockImplementation(() => { renderer.update(<Harness />); });
    await act(async () => { engine.setForeground(true); engine.setSession(account('a')); await flush(); });
    expect(latitude()).toBe(25);
    // Coalesce all scheduler changes into one final render. The fence reads
    // the actual engine while React never sees busy=true for this operation.
    changed.mockImplementation(() => {});
    if (failure === 'error') {
      database.savePage.mockImplementationOnce(async () => { position = 26; throw new Error('partial page failed'); });
      engine.retry(); await flush();
    } else {
      const abort = new AbortController();
      await expect(engine.runManual(async () => {
        position = 26; abort.abort(); throw new Error('cancelled download');
      }, abort)).rejects.toThrow('cancelled download');
    }
    expect(latest().busy).toBe(false);
    await act(async () => { renderer.update(<Harness />); });
    if (failure === 'error') await act(async () => { await jest.advanceTimersByTimeAsync(10000); });
    expect(state.rows[0].slave_lat).toBe(25);
    expect(latitude()).toBe(25);
  } finally {
    changed.mockImplementation(() => {});
    await act(async () => { renderer?.unmount(); });
  }
});
