// Regression tests for cloud history completeness and staging integrity.
// All rows, owners and coordinates below are fictional.
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { createHistoryCloud } from '../src/mapHistory/HistoryCloud';
import { dayKey } from '../src/history/screen/HistoryScreenDates';

const owner = 'fictional-owner';
const HOUR = 3600000, DAY = 86400000;
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const iso = time => new Date(time).toISOString();

// A small in-memory stand-in for the Supabase REST filters used by downloads.
function remote(rows) {
  const calls = [];
  const time = value => Date.parse(value);
  const from = () => {
    const filters = [];
    const log = [];
    calls.push(log);
    let limit = Infinity;
    const query = {
      select: () => query,
      eq: (column, value) => { log.push(['eq', column, value]); filters.push(row => row[column] === value); return query; },
      in: (column, values) => { filters.push(row => values.includes(row[column])); return query; },
      gte: (column, value) => { log.push(['gte', column, value]); filters.push(row => row[column] != null && time(row[column]) >= time(value)); return query; },
      lt: (column, value) => { log.push(['lt', column, value]); filters.push(row => row[column] != null && time(row[column]) < time(value)); return query; },
      order: () => query,
      limit: value => { limit = value; return query; },
      or: expression => {
        const [, at, id] = /^received_at\.gt\.([^,]+),and\(received_at\.eq\.[^,]+,event_id\.gt\.([^)]+)\)$/.exec(expression);
        filters.push(row => time(row.received_at) > time(at) || (time(row.received_at) === time(at) && row.event_id > id));
        return query;
      },
      abortSignal: async () => ({ data: rows.filter(row => filters.every(test => test(row)))
        .sort((a, b) => time(a.received_at) - time(b.received_at) || a.event_id.localeCompare(b.event_id))
        .slice(0, limit), error: null }),
    };
    return query;
  };
  return { calls, from };
}
const telemetry = (n, receivedAt, { slave = 6, phoneAt = null } = {}) => ({
  event_id: uuid(n), master_id: 7, slave_id: slave, seq: n, received_at: iso(receivedAt),
  payload: { lat: 24989200, lon: 121313200, satellites: 9 }, rssi: -80, snr: 7,
  upload_source: phoneAt == null ? 'wifi' : 'phone', phone_received_at: phoneAt == null ? null : iso(phoneAt),
});
const local = (event_id, time, slave_id = 6, fix = true) => ({ event_id,
  master_id: 7, slave_id, received_at: time, track_at: time, track_time_version: 1,
  slave_lat: fix ? 24.9892 : 0, slave_lon: fix ? 121.3132 : 0, activity_valid: 0, battery_valid: 0 });
const ids = async (connection, table = 'supabase_dog_status') =>
  (await connection.executeAsync(`SELECT event_id FROM ${table} ORDER BY event_id`)).results.map(row => row.event_id);

async function setup(options = {}) {
  const connection = createMemoryConnection();
  await createDogDatabase(connection).initialize();
  const database = createCloudDatabase(connection, options);
  await database.initialize();
  return { connection, database };
}

describe('manual day download proof', () => {
  const dayStart = new Date(2026, 9, 3).getTime(), dayEnd = dayStart + DAY;

  test('a phone packet of the day uploaded hours after the day is downloaded before the day is complete', async () => {
    const { connection, database } = await setup();
    try {
      const rows = [
        telemetry(1, dayStart + HOUR),
        // Recorded on the phone during the day, ingested by the cloud 6 h after it.
        telemetry(2, dayEnd + 6 * HOUR, { phoneAt: dayStart + 2 * HOUR }),
        // Another day's late packet stays outside this day's query.
        telemetry(3, dayEnd + 6 * HOUR, { phoneAt: dayEnd + 5 * HOUR }),
      ];
      const client = remote(rows);
      const cloud = createHistoryCloud({ client, database, owner });
      await cloud.download({ slaveId: 6, dayStart, dayEnd, cutoff: dayEnd + 3 * DAY });
      expect(await ids(connection)).toEqual([uuid(1), uuid(2)]);
      const [proof] = await database.historyDownloadStates(owner, [6]);
      expect(proof).toMatchObject({ day: dayKey(new Date(dayStart)), complete: 1 });
      // The late pass is bounded to phone rows of this day received after the main window.
      expect(client.calls.some(log => log.some(([, column]) => column === 'phone_received_at'))).toBe(true);
    } finally { connection.close(); }
  });

  test('a still-running day downloads no extra phone-time pass', async () => {
    const { connection, database } = await setup();
    try {
      const client = remote([telemetry(1, dayStart + HOUR)]);
      const cloud = createHistoryCloud({ client, database, owner });
      await cloud.download({ slaveId: 6, dayStart, dayEnd, cutoff: dayStart + 10 * HOUR });
      expect(client.calls.some(log => log.some(([, column]) => column === 'phone_received_at'))).toBe(false);
    } finally { connection.close(); }
  });

  test('today tail overlaps the previous proof so a late-visible row is not skipped', async () => {
    const { connection, database } = await setup();
    try {
      const first = dayStart + 10 * HOUR;
      const rows = [telemetry(1, dayStart + 5 * HOUR)];
      const cloud = createHistoryCloud({ client: remote(rows), database, owner });
      await cloud.download({ slaveId: 6, dayStart, dayEnd, cutoff: first });
      // Committed before the first cutoff but not yet visible to that query.
      rows.push(telemetry(2, first - 60000));
      const client = remote(rows);
      const again = createHistoryCloud({ client, database, owner });
      await again.download({ slaveId: 6, dayStart, dayEnd, cutoff: first + 10 * 60000 });
      expect(await ids(connection)).toEqual([uuid(1), uuid(2)]);
      // Still a tail, not a full day download.
      expect(client.calls).toEqual(expect.arrayContaining([expect.arrayContaining([['gte', 'received_at', iso(first - 5 * 60000)]])]));
      expect(client.calls.some(log => log.some(([op, column, value]) => op === 'gte' && column === 'received_at'
        && value === iso(dayStart - 30 * 60000)))).toBe(false);
    } finally { connection.close(); }
  });
});

// The day's rows start half an hour before midnight and its hold pass is
// seeded with the good fixes before that: a stay carried over from the night
// before needs what was received then, which the archive may not have yet
// (device 0.3.179: 「01:21 出發」 instead of 「00:00 接續前一天」 on first open).
describe('the night before a day download', () => {
  const dayStart = new Date(2026, 9, 3).getTime(), dayEnd = dayStart + DAY;
  const windowStart = dayStart - 30 * 60000;
  const night = n => telemetry(n, dayStart - 3 * HOUR);
  const carryCalls = client => client.calls.filter(log => log.some(([op, column, value]) => op === 'lt'
    && column === 'received_at' && value === iso(windowStart)));

  test('an archive that has not reached the window: the night before is fetched once, before the window', async () => {
    const { connection, database } = await setup();
    try {
      await database.beginDownload(owner);
      await database.publishDownload(owner, 'auto', dayStart - 6 * HOUR);
      const client = remote([night(1), telemetry(2, dayStart + HOUR)]);
      const cloud = createHistoryCloud({ client, database, owner });
      await cloud.download({ slaveId: 6, dayStart, dayEnd, cutoff: dayStart + 2 * HOUR });
      expect(await ids(connection)).toEqual([uuid(1), uuid(2)]);
      // From the archive's cutoff (less the overlap), not a whole day back.
      expect(carryCalls(client)[0]).toEqual(expect.arrayContaining([['gte', 'received_at', iso(dayStart - 6 * HOUR - 5 * 60000)]]));
      const before = carryCalls(client).length;
      await cloud.download({ slaveId: 6, dayStart, dayEnd, cutoff: dayStart + 3 * HOUR });
      expect(carryCalls(client).length).toBe(before);
    } finally { connection.close(); }
  });

  test('an archive published past the window start: no extra request', async () => {
    const { connection, database } = await setup();
    try {
      await database.beginDownload(owner);
      await database.publishDownload(owner, 'auto', dayStart + HOUR);
      const client = remote([night(1), telemetry(2, dayStart + HOUR)]);
      await createHistoryCloud({ client, database, owner }).download({ slaveId: 6, dayStart, dayEnd, cutoff: dayStart + 2 * HOUR });
      expect(carryCalls(client)).toEqual([]);
      expect(await ids(connection)).toEqual([uuid(2)]);
    } finally { connection.close(); }
  });

  test('no archive publication yet: at most CARRY_OVER_MS before the window', async () => {
    const { connection, database } = await setup();
    try {
      const client = remote([telemetry(1, windowStart - 25 * HOUR), night(2)]);
      await createHistoryCloud({ client, database, owner }).download({ slaveId: 6, dayStart, dayEnd, cutoff: dayStart + 2 * HOUR });
      expect(carryCalls(client)[0]).toEqual(expect.arrayContaining([['gte', 'received_at', iso(windowStart - DAY)]]));
      expect(await ids(connection)).toEqual([uuid(2)]);
    } finally { connection.close(); }
  });
});

describe('staging capacity', () => {
  test('a long automatic pass into a full cache publishes every downloaded page without a gap', async () => {
    const { connection, database } = await setup({ maxRows: 16 });
    try {
      await database.savePage(owner, Array.from({ length: 16 }, (_, i) => local(`old-${String(i).padStart(2, '0')}`, i + 1)));
      await database.beginDownload(owner);
      for (let i = 0; i < 10; i++) await database.savePage(owner, [local(`new-${i}`, 100 + i)],
        { masterId: 7, throughAt: iso(100 + i), eventId: `new-${i}` });
      expect((await database.loadSyncState(owner, 7)).event_id).toBe('new-9');
      await database.publishDownload(owner);
      const published = await ids(connection);
      expect(published).toHaveLength(16);
      // Every page behind the published checkpoint is present; the oldest published rows were evicted.
      expect(published).toEqual(expect.arrayContaining(Array.from({ length: 10 }, (_, i) => `new-${i}`)));
      expect(published).not.toContain('old-00');
    } finally { connection.close(); }
  });

  test('a manual download cannot delete rows a paused automatic job already checkpointed', async () => {
    const { connection, database } = await setup({ maxRows: 16 });
    try {
      await database.savePage(owner, Array.from({ length: 16 }, (_, i) => local(`old-${String(i).padStart(2, '0')}`, i + 1)));
      await database.beginDownload(owner);
      await database.savePage(owner, [local('auto-0', 100), local('auto-1', 101)],
        { masterId: 7, throughAt: iso(101), eventId: 'auto-1' });
      await database.beginManualScope(owner, 6, '1970-01-01');
      await database.savePage(owner, [local('manual-0', 50)]);
      expect(await ids(connection, 'cloud_auto_supabase_dog_status')).toEqual(['auto-0', 'auto-1']);
    } finally { connection.close(); }
  });

  test('only staged rows already beyond the cap are reclaimed early, and covered proof is withdrawn', async () => {
    const { connection, database } = await setup({ maxRows: 4 });
    try {
      await database.setHistoryDownloadState(owner, 6, '1970-01-01', true,
        { range_start: 50, range_end: 103, received_before: 103 });
      await database.beginDownload(owner);
      await database.savePage(owner, Array.from({ length: 10 }, (_, i) => local(`new-${i}`, 100 + i)),
        { masterId: 7, throughAt: iso(109), eventId: 'new-9' });
      expect(await ids(connection, 'cloud_auto_supabase_dog_status')).toEqual(['new-6', 'new-7', 'new-8', 'new-9']);
      expect((await database.historyDownloadStates(owner, [6]))[0].complete).toBe(0);
      await database.publishDownload(owner);
      expect(await ids(connection)).toEqual(['new-6', 'new-7', 'new-8', 'new-9']);
    } finally { connection.close(); }
  });
});

describe('publication side effects', () => {
  test('a cloud publication does not restart the BLE-only hold cursor', async () => {
    const { connection, database } = await setup();
    try {
      const insert = time => connection.executeAsync(`INSERT INTO dog_status(master_id,slave_id,
        received_at,slave_lat,slave_lon,satellites,hdop) VALUES(7,4,?,25,121,9,0.9)`, [time]);
      await insert(2000000);
      const first = await database.holdRows(null, 1000000, null);
      expect(first.rows.map(row => row.time)).toEqual([2000000]);
      await database.beginDownload(owner);
      await database.savePage(owner, [local('cloud-a', 1500000)]);
      expect((await database.publishDownload(owner)).materialChanged).toBe(true);
      const next = await database.holdRows(null, 1000000, first.cursors);
      expect(next.reset).toBe(false);
      expect(next.rows).toEqual([]);
      // With the cloud side read, a material publication still rebuilds both.
      const owned = await database.holdRows(owner, 1000000, null);
      await database.beginDownload(owner);
      await database.savePage(owner, [local('cloud-b', 1600000)]);
      await database.publishDownload(owner);
      expect((await database.holdRows(owner, 1000000, owned.cursors)).reset).toBe(true);
    } finally { connection.close(); }
  });

  test('published verification buckets older than two days are trimmed by publication', async () => {
    const { connection, database } = await setup();
    try {
      const start = 1000 * HOUR;
      await database.saveBucket(owner, 7, start, 5);
      await database.beginDownload(owner);
      await database.saveBucket(owner, 7, start + 72 * HOUR, 3);
      await database.publishDownload(owner);
      expect((await connection.executeAsync('SELECT bucket_start FROM cloud_sync_buckets ORDER BY bucket_start'))
        .results.map(row => row.bucket_start)).toEqual([start + 72 * HOUR]);
    } finally { connection.close(); }
  });

  test('a manual scope publication honours the caller generation', async () => {
    const { connection, database } = await setup();
    try {
      await database.beginManualScope(owner, 6, '1970-01-01');
      await database.savePage(owner, [local('manual-a', 1000)]);
      await expect(database.publishManualScope(owner, 6, '1970-01-01', () => false)).rejects.toThrow('下載已取消');
      expect(await ids(connection)).toEqual([]);
      await database.publishManualScope(owner, 6, '1970-01-01', () => true);
      expect(await ids(connection)).toEqual(['manual-a']);
    } finally { connection.close(); }
  });
});

test('a staging table cloned before a published column was added gains that column', async () => {
  const { connection, database } = await setup();
  try {
    await database.beginDownload(owner);
    // An older install cloned staging before this column existed in published.
    await connection.executeAsync('ALTER TABLE cloud_auto_supabase_dog_status DROP COLUMN usb_present');
    await connection.executeAsync('DELETE FROM cloud_download_jobs');
    const upgraded = createCloudDatabase({ ...connection });
    await upgraded.initialize();
    await upgraded.beginDownload(owner);
    await upgraded.savePage(owner, [{ ...local('upgrade-a', 1000), usb_present: 1 }]);
    await upgraded.publishDownload(owner);
    expect((await connection.executeAsync("SELECT usb_present FROM supabase_dog_status WHERE event_id='upgrade-a'"))
      .results[0].usb_present).toBe(1);
  } finally { connection.close(); }
});
