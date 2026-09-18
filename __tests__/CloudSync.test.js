import { createCloudSync } from '../src/cloud/CloudSync';
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
