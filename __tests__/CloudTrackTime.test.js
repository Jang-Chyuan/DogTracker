import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { mapCloudTelemetry } from '../src/cloud/CloudTelemetry';
import { cloudTrackTime, repairCloudTrackTimes } from '../src/cloud/CloudTrackTime';
import { createHistoryDatabase, HISTORY_DAY_AFTER_MS, HISTORY_DAY_CONTEXT_MS } from '../src/mapHistory/HistoryDatabase';
import { downloadCloudHistory } from '../src/cloud/CloudDownload';

const base = Date.parse('2026-09-23T03:00:00Z');
const iso = seconds => new Date(base + seconds * 1000).toISOString();
const event = (id, arrival, capture, latitude = 25) => ({
  event_id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
  received_at: iso(arrival), phone_received_at: capture == null ? null : iso(capture),
  upload_source: capture == null ? 'wifi' : 'phone', master_id: 5, slave_id: 8, seq: id,
  payload: { lat: latitude * 1000000, lon: 121000000, speed: 0, slaveId: 8 },
});
// A day read whose rows cover [since, until) exactly (historyDayRows reads
// HISTORY_DAY_CONTEXT_MS before and HISTORY_DAY_AFTER_MS after the day).
const window = (since, until) => ({ slaveId: 8, owner: 'a',
  start: since + HISTORY_DAY_CONTEXT_MS, end: until - HISTORY_DAY_AFTER_MS });

test.each([false, true])('the day read places cloud rows by track time with numeric comparisons (Android string bindings: %s)', async androidBindings => {
  const db = createMemoryConnection();
  if (androidBindings) {
    const execute = db.executeAsync;
    db.executeAsync = (sql, params = []) => execute(sql,
      /^(SELECT|WITH|PRAGMA|EXPLAIN)\b/i.test(sql.trim())
        ? params.map(value => value == null ? null : String(value)) : params);
  }
  try {
    await createDogDatabase(db).initialize();
    const cloud = createCloudDatabase(db); await cloud.initialize();
    const events = [event(1, 1200, 20, 25.006), event(2, 1201, 0, 25), event(3, 1202, 10, 25.003)];
    const responses = [{ data: events }, { data: [] }];
    const query = {};
    for (const method of ['select', 'gte', 'lt', 'order', 'limit', 'eq', 'or']) query[method] = jest.fn(() => query);
    query.abortSignal = jest.fn(async () => responses.shift());
    await downloadCloudHistory({ client: { from: () => query }, database: cloud, owner: 'a',
      startAt: iso(1199), endBefore: iso(1300), masterId: 5, checkpoint: true });
    expect(query.or).toHaveBeenCalledWith(expect.stringContaining(iso(1202)));
    expect((await cloud.loadSyncState('a', 5)).through_at).toBe(iso(1300));
    const history = createHistoryDatabase(db);
    // Moved from the retired range read (064, audit D06/T06).
    const day = await history.historyDayRows(window(base, base + 30000));
    expect(day.rows.map(row => row.time).sort((x, y) => x - y)).toEqual([base, base + 10000, base + 20000]);
    expect(day.rows.find(row => row.time === base + 20000).latitude).toBeCloseTo(25.006, 8); // the raw fix
    expect((await history.historyDayRows(window(base + 1199000, base + 1300000))).rows).toHaveLength(0);
    expect((await cloud.listHistory('a'))[0].received_at).toBe(base + 1202000);
    await cloud.savePage('a', [mapCloudTelemetry(event(4, 25, null, 25.009))]);
    const mixed = await history.historyDayRows(window(base, base + 30000));
    expect(mixed.rows.map(row => row.time).sort((x, y) => x - y)).toEqual([base, base + 10000, base + 20000, base + 25000]);
  } finally { db.close(); }
});

test('legacy metadata repair preserves raw rows/checkpoints, isolates owners, invalidates smoothing and survives restart', async () => {
  const db = createMemoryConnection();
  try {
    await createDogDatabase(db).initialize();
    const cloud = createCloudDatabase(db); await cloud.initialize();
    const original = mapCloudTelemetry(event(1, 1200, 20));
    await cloud.savePage('a', [original], { masterId: 5, throughAt: iso(1300) });
    await cloud.savePage('b', [original]);
    await db.executeAsync(`UPDATE supabase_dog_status SET track_at=NULL, track_time_version=NULL,
      upload_source=NULL, phone_received_at=NULL, display_version=1, display_latitude=99`);
    await createCloudDatabase({ ...db }).initialize();
    expect((await cloud.pendingTrackTimes('a')).map(r => r.event_id)).toEqual([original.event_id]);
    const before = (await cloud.listHistory('a'))[0];
    const query = { select: jest.fn(() => query), in: jest.fn(() => query),
      abortSignal: jest.fn(async () => ({ data: [event(1, 1200, 20)] })) };
    await repairCloudTrackTimes({ client: { from: () => query }, database: cloud,
      owner: 'a', check: () => {}, onChange: jest.fn() });
    const after = (await cloud.listHistory('a'))[0];
    expect(after).toMatchObject({ track_at: base + 20000, display_version: null,
      raw_payload: before.raw_payload, received_at: before.received_at, slave_lat: before.slave_lat });
    expect((await cloud.loadSyncState('a', 5)).through_at).toBe(iso(1300));
    expect(await cloud.pendingTrackTimes('a')).toHaveLength(0);
    expect(await cloud.pendingTrackTimes('b')).toHaveLength(1);
    await createCloudDatabase(db).initialize();
    expect((await cloud.listHistory('a'))[0].track_at).toBe(base + 20000);
  } finally { db.close(); }
});

test('missing or invalid phone timestamps safely retain cloud time; Wi-Fi ignores phone timestamp', () => {
  for (const phone_received_at of [null, 'bad', 100])
    expect(cloudTrackTime({ received_at: iso(20), upload_source: 'phone', phone_received_at }).track_at).toBe(base + 20000);
  expect(cloudTrackTime({ received_at: iso(20), upload_source: 'wifi', phone_received_at: iso(0) }).track_at).toBe(base + 20000);
});
