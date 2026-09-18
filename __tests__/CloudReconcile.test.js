import { BUCKET, closedBuckets, reconcileCloudWindow } from '../src/cloud/CloudReconcile';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { CLOUD_DATABASE_METHODS, createCloudDatabase } from '../src/cloud/CloudDatabase';

const NOW = Date.parse('2026-09-18T12:30:00Z');
const HOUR_11 = Date.parse('2026-09-18T11:00:00Z');
const row = (id, at) => ({
  event_id: id, master_id: 7, slave_id: 4, seq: 1, received_at: at,
  payload: { slaveId: 4, lat: 25012345, lon: 121123456 }, rssi: -80, snr: 5,
});

// counts: bucket start -> cloud row count. pages: bucket start -> rows returned.
function fakeClient(counts, pages = {}) {
  const requests = [];
  return { requests, from: jest.fn(() => {
    const query = { filters: {} };
    for (const name of ['select', 'eq', 'gte', 'lt', 'order', 'limit', 'or']) {
      query[name] = jest.fn((...args) => { query.filters[name] = args; return query; });
    }
    query.abortSignal = jest.fn(async () => {
      const start = Date.parse(query.filters.gte[1]);
      const head = query.filters.select[1]?.head;
      requests.push({ start, head: !!head, cursor: !!query.filters.or });
      if (head) return { count: counts[start] ?? 0 };
      // One page per bucket, then an empty page ends the scan.
      return { data: query.filters.or ? [] : (pages[start] || []) };
    });
    return query;
  }) };
}

function fakeDatabase(saved = [], local = {}) {
  return {
    loadBuckets: jest.fn(async () => saved),
    countRange: jest.fn(async (owner, master, from) => local[from] ?? 0),
    saveBucket: jest.fn(async () => {}),
    savePage: jest.fn(async () => {}),
  };
}
const run = (client, database, extra = {}) => reconcileCloudWindow({
  client, database, owner: 'account-a', masterId: 7, now: NOW, ...extra,
});

test('closed hours only: the hour still receiving rows is left to the incremental pass', () => {
  const buckets = closedBuckets(NOW, 24);
  expect(buckets).toHaveLength(24);
  expect(buckets[23]).toBe(HOUR_11);
  expect(buckets.includes(Date.parse('2026-09-18T12:00:00Z'))).toBe(false);
  expect(buckets[0]).toBe(HOUR_11 - 23 * BUCKET);
});

test('a late upload repairs only its own hour and never moves the sync checkpoint', async () => {
  const late = row('11111111-1111-4111-8111-111111111111', '2026-09-18T11:05:00.123456+00:00');
  const client = fakeClient({ [HOUR_11]: 1 }, { [HOUR_11]: [late] });
  const database = fakeDatabase();
  expect(await run(client, database)).toBe(1);
  const scans = client.requests.filter(request => !request.head);
  expect(scans.every(request => request.start === HOUR_11)).toBe(true);
  expect(database.savePage).toHaveBeenCalledTimes(1);
  // No checkpoint argument: the incremental progress belongs to CloudSync.
  expect(database.savePage).toHaveBeenCalledWith('account-a',
    [expect.objectContaining({ event_id: late.event_id, master_id: 7 })]);
  expect(database.saveBucket).toHaveBeenCalledWith('account-a', 7, HOUR_11, 1);
  expect(database.saveBucket).toHaveBeenCalledTimes(24);
});

test('hours whose verified count still matches are skipped without reading local rows', async () => {
  const saved = closedBuckets(NOW).map(start => ({ bucket_start: start, cloud_count: 0 }));
  const client = fakeClient({});
  const database = fakeDatabase(saved);
  expect(await run(client, database)).toBe(0);
  expect(client.requests.every(request => request.head)).toBe(true);
  expect(database.countRange).not.toHaveBeenCalled();
  expect(database.saveBucket).not.toHaveBeenCalled();
});

test('rows trimmed by local retention are not downloaded again on every sweep', async () => {
  // The hour was verified as 5 rows; retention has since removed them locally.
  const saved = [{ bucket_start: HOUR_11, cloud_count: 5 }];
  const client = fakeClient({ [HOUR_11]: 5 }, { [HOUR_11]: [row('a', '2026-09-18T11:00:01Z')] });
  const database = fakeDatabase(saved, { [HOUR_11]: 0 });
  expect(await run(client, database)).toBe(0);
  expect(client.requests.filter(request => !request.head)).toHaveLength(0);
  expect(database.savePage).not.toHaveBeenCalled();
});

test('a failed count check stops the sweep and keeps earlier hours verified', async () => {
  const client = fakeClient({});
  client.from.mockImplementationOnce(() => {
    const query = {};
    for (const name of ['select', 'eq', 'gte', 'lt']) query[name] = () => query;
    query.abortSignal = async () => ({ error: { message: 'network' } });
    return query;
  });
  const database = fakeDatabase();
  await expect(run(client, database)).rejects.toThrow('無法核對雲端筆數');
  expect(database.saveBucket).not.toHaveBeenCalled();
});

test('cancellation stops the sweep before the next hour is recorded', async () => {
  const abort = new AbortController();
  const client = fakeClient({});
  const database = fakeDatabase();
  database.saveBucket.mockImplementation(async () => { abort.abort(); });
  await expect(run(client, database, { signal: abort.signal })).rejects.toThrow('核對已取消');
  expect(database.saveBucket).toHaveBeenCalledTimes(1);
});

test('SQLite keeps verified counts per account and Master, and expires old hours', async () => {
  const connection = createMemoryConnection();
  try {
    await createDogDatabase(connection).initialize();
    const database = createCloudDatabase(connection);
    await database.initialize();
    await database.savePage('account-a', [{
      event_id: 'kept', received_at: HOUR_11 + 1000, master_id: 7, slave_id: 4,
      activity_valid: 0, battery_valid: 0,
    }]);
    expect(await database.countRange('account-a', 7, HOUR_11, HOUR_11 + BUCKET)).toBe(1);
    expect(await database.countRange('account-a', 5, HOUR_11, HOUR_11 + BUCKET)).toBe(0);
    expect(await database.countRange('account-b', 7, HOUR_11, HOUR_11 + BUCKET)).toBe(0);

    await database.saveBucket('account-a', 7, HOUR_11 - 72 * BUCKET, 3);
    await database.saveBucket('account-a', 7, HOUR_11, 9);
    await database.saveBucket('account-a', 5, HOUR_11, 4);
    await database.saveBucket('account-b', 7, HOUR_11, 7);
    expect(await database.loadBuckets('account-a', 7, HOUR_11 - 23 * BUCKET))
      .toEqual([{ bucket_start: HOUR_11, cloud_count: 9 }]);
    expect(await database.loadBuckets('account-b', 7, HOUR_11 - 23 * BUCKET))
      .toEqual([{ bucket_start: HOUR_11, cloud_count: 7 }]);
    await expect(database.saveBucket('account-a', 7, HOUR_11, 1.5)).rejects.toThrow('格式不正確');
    await expect(database.loadBuckets('', 7, 0)).rejects.toThrow('請先登入');
  } finally { connection.close(); }
});

test('the tracking session forwards every cloud database method', () => {
  // useTrackingSession builds its adapter from this list; a method missing there
  // only fails at runtime, when the sweep calls it on a real phone.
  const connection = createMemoryConnection();
  try {
    expect([...CLOUD_DATABASE_METHODS].sort())
      .toEqual(Object.keys(createCloudDatabase(connection)).sort());
  } finally { connection.close(); }
});
