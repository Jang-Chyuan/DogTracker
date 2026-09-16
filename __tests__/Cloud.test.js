import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { mapCloudTelemetry, taiwanDateRange } from '../src/cloud/CloudTelemetry';
import { downloadCloudHistory } from '../src/cloud/CloudDownload';

const event = (suffix = '001', time = '2026-09-16T01:02:03.123456+00:00') => ({
  event_id: `00000000-0000-4000-8000-000000000${suffix}`,
  master_id: 7, slave_id: 4, seq: 12, received_at: time, rssi: -90, snr: 8,
  payload: { lat: 25012345, lon: 121123456, speed: 1234, hdop: 125,
    satellites: 9, activityScore: 678, activityValid: 1, gpsTimestamp: 123,
    activityTimestamp: 456, batteryMillivolts: 3900, batteryPercentage: 80,
    batteryValid: 1, slaveId: 4 },
});

test('converts wire units and preserves the full envelope and microsecond timestamp', () => {
  expect(mapCloudTelemetry(event())).toMatchObject({
    slave_lat: 25.012345, slave_lon: 121.123456, speed_kmh: 12.34, hdop: 1.25,
    activity: 0.678, battery_percentage: 80, gps_time: '123',
    remote_received_at: '2026-09-16T01:02:03.123456+00:00',
    raw_payload: JSON.stringify(event()),
  });
  expect(() => mapCloudTelemetry({ ...event(), event_id: 'bad)' })).toThrow();
  expect(() => mapCloudTelemetry({ ...event(), slave_id: 8 })).toThrow();
  expect(() => mapCloudTelemetry({ ...event(), payload: { ...event().payload, lat: '25' } })).toThrow();
});

test('date range uses Taiwan days and rejects normalized invalid dates', () => {
  expect(taiwanDateRange('2026-09-15', '2026-09-15', Date.parse('2026-09-16T00:00:00Z')))
    .toEqual({ startAt: '2026-09-14T16:00:00.000Z', endBefore: '2026-09-15T16:00:00.000Z' });
  expect(() => taiwanDateRange('2026-02-30', '2026-03-01')).toThrow();
  expect(() => taiwanDateRange('2026-09-16', '2026-09-15')).toThrow();
});

test('migration, batch deduplication, account isolation, and BLE clearing use real SQLite', async () => {
  const connection = createMemoryConnection();
  const real = createDogDatabase(connection);
  const cloud = createCloudDatabase(connection);
  try {
    await real.initialize();
    await connection.executeAsync('INSERT INTO supabase_dog_status(received_at) VALUES (1)');
    await cloud.initialize();
    const record = mapCloudTelemetry(event());
    await cloud.savePage('account-a', [record, record]);
    await cloud.savePage('account-b', [record]);
    await cloud.initialize();
    await cloud.savePage('account-a', [record]);
    expect(await cloud.count('account-a')).toBe(1);
    expect(await cloud.count('account-b')).toBe(1);
    expect(await cloud.count('account-c')).toBe(0);
    await expect(cloud.listHistory(null)).rejects.toThrow();
    await real.deleteAll();
    expect(await cloud.listHistory('account-a')).toEqual([
      expect.objectContaining({ owner_user_id: 'account-a', event_id: record.event_id }),
    ]);
    // A later invalid record must roll back earlier writes in the same page.
    await expect(cloud.savePage('account-a', [mapCloudTelemetry(event('002')),
      { ...record, event_id: event('003').event_id, received_at: null },
    ])).rejects.toThrow();
    expect(await cloud.count('account-a')).toBe(1);
  } finally { connection.close(); }
});

function fakeClient(pages) {
  const queries = [];
  return { queries, from: jest.fn(() => {
    const query = {};
    for (const name of ['select', 'gte', 'lt', 'order', 'limit', 'eq', 'or']) {
      query[name] = jest.fn(() => query);
    }
    query.abortSignal = jest.fn(async () => pages.shift());
    queries.push(query);
    return query;
  }) };
}
const options = () => ({ owner: 'account-a', startAt: '2026-09-15T00:00:00Z',
  endBefore: '2026-09-17T00:00:00Z', signal: new AbortController().signal });

test('downloads beyond short pages using timestamp + event UUID, without losing submilliseconds', async () => {
  const client = fakeClient([
    { data: [event('001')] }, { data: [event('002')] }, { data: [] },
  ]);
  const database = { savePage: jest.fn(async () => {}) };
  expect(await downloadCloudHistory({ ...options(), client, database, masterId: 7 })).toBe(2);
  expect(database.savePage).toHaveBeenCalledTimes(2);
  expect(client.queries[1].or).toHaveBeenCalledWith(expect.stringContaining('.123456+00:00'));
  expect(client.queries[1].or).toHaveBeenCalledWith(expect.stringContaining(event().event_id));
  expect(client.queries[0].eq).toHaveBeenCalledWith('master_id', 7);
});

test('session changes and cancellation prevent late network results from being written', async () => {
  const client = fakeClient([{ data: [event()] }]);
  const database = { savePage: jest.fn() };
  let checks = 0;
  await expect(downloadCloudHistory({ ...options(), client, database,
    isCurrent: () => ++checks === 1,
  })).rejects.toThrow('取消');
  expect(database.savePage).not.toHaveBeenCalled();
  const abort = new AbortController(); abort.abort();
  await expect(downloadCloudHistory({ ...options(), client, database, signal: abort.signal }))
    .rejects.toThrow('取消');
});

test('a failed network page preserves completed pages and reports failure', async () => {
  const client = fakeClient([{ data: [event()] }, { error: { code: '42501' } }]);
  const database = { savePage: jest.fn(async () => {}) };
  await expect(downloadCloudHistory({ ...options(), client, database })).rejects.toThrow('42501');
  expect(database.savePage).toHaveBeenCalledTimes(1);
});
