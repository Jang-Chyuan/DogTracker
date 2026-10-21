import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { mapCloudTelemetry } from '../src/cloud/CloudTelemetry';
import { downloadCloudHistory } from '../src/cloud/CloudDownload';
import { downloadMasterIncremental } from '../src/cloud/CloudIncremental';
import { downloadCloudLatest, downloadCloudLatestContext } from '../src/cloud/CloudLatest';
import { createHistoryCloud } from '../src/mapHistory/HistoryCloud';
import { createMalformedFields } from '../src/models/MalformedFields';

// 2026-10-21: one cloud row carried `usbPresent: 136` (0x88, a garbled
// packet). The strict USB parser threw inside mapCloudTelemetry, which runs
// over a whole page, so the archive pass stopped on that page every 30 s and
// the history/A4 day download failed. Fictional data only.
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const event = (n, time, payload = {}, extra = {}) => ({
  event_id: id(n), master_id: 7, slave_id: 4, seq: n, received_at: time, rssi: -90, snr: 8,
  payload: { lat: 24989200, lon: 121313800, speed: 120, hdop: 110, satellites: 9, activityScore: 300,
    activityValid: 1, gpsTimestamp: 100 + n, activityTimestamp: 200 + n, batteryMillivolts: 3900,
    batteryPercentage: 80, batteryValid: 1, usbPresent: 0, slaveId: 4, ...payload },
  ...extra,
});
const batch = () => [
  event(1, '2026-10-19T12:01:00.000001+00:00'),
  event(2, '2026-10-19T12:01:01.000002+00:00', { usbPresent: 136 }),
  event(3, '2026-10-19T12:01:02.000003+00:00', { usbPresent: 1 }),
];

function fakeClient(pages) {
  const queries = [];
  return { queries, from: jest.fn(() => {
    const query = {};
    for (const name of ['select', 'gte', 'lt', 'order', 'limit', 'eq', 'or', 'in']) query[name] = jest.fn(() => query);
    query.abortSignal = jest.fn(async () => pages.shift() ?? { data: [] });
    queries.push(query);
    return query;
  }) };
}

async function withCloud(run) {
  const connection = createMemoryConnection();
  try {
    await createDogDatabase(connection).initialize();
    const cloud = createCloudDatabase(connection);
    await cloud.initialize();
    await run(cloud, connection);
  } finally { connection.close(); }
}

let warn;
beforeEach(() => { warn = jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => warn.mockRestore());
const malformedLogs = () => warn.mock.calls.filter(([tag]) => tag === '[CloudTelemetry] malformed');

test('a page with one usbPresent 136 row is saved whole; that row is unknown (not charging), the rest unchanged', async () => {
  await withCloud(async cloud => {
    const client = fakeClient([{ data: batch() }, { data: [] }]);
    const count = await downloadCloudHistory({ client, database: cloud, owner: 'account-a', masterId: 7,
      startAt: '2026-10-19T12:00:00Z', endBefore: '2026-10-19T13:00:00Z', signal: new AbortController().signal,
      source: 'history' });
    expect(count).toBe(3);
    const rows = (await cloud.listHistory('account-a')).sort((a, b) => a.sequence - b.sequence);
    expect(rows.map(row => row.usb_present)).toEqual([0, null, 1]);
    // The rest of the garbled row is kept as it came (each passed its own check).
    expect(rows[1]).toMatchObject({ slave_lat: 24.9892, slave_lon: 121.3138, battery_percentage: 80,
      battery_valid: 1, activity_valid: 1, satellites: 9 });
    // One line for the batch, with a count, and no id, time or coordinate.
    expect(malformedLogs()).toEqual([['[CloudTelemetry] malformed',
      { source: 'history', rows: 1, fields: [{ field: 'usbPresent', type: 'number', value: 136, count: 1 }] }]]);
    expect(JSON.stringify(malformedLogs())).not.toMatch(/0000-4000|2026-|24\.98|121\.31|24989200/);
  });
});

test('the archive pass moves past the row it stopped on: a cursor parked before it (an older build) reaches the cutoff', async () => {
  await withCloud(async cloud => {
    // What an older build left: the last row of the page before, mid-window.
    await cloud.savePage('account-a', [mapCloudTelemetry(event(1, '2026-10-19T12:01:00.000001+00:00'))],
      { masterId: 7, throughAt: '2026-10-19T12:01:00.000001+00:00', eventId: id(1) });
    const client = fakeClient([{ data: batch().slice(1) }, { data: [] }]);
    const cutoff = Date.parse('2026-10-19T13:00:00Z');
    await downloadMasterIncremental({ client, database: cloud, owner: 'account-a', masterId: 7, cutoff, check: () => {} });
    // Resumed from the parked cursor, exactly.
    expect(client.queries[0].or).toHaveBeenCalledWith(expect.stringContaining(id(1)));
    expect(await cloud.count('account-a')).toBe(3);
    expect(await cloud.loadSyncState('account-a', 7)).toMatchObject({ through_at: new Date(cutoff).toISOString(), event_id: null });
    expect(malformedLogs()).toHaveLength(1);
    expect(malformedLogs()[0][1]).toMatchObject({ source: 'archive', rows: 1 });
  });
});

test('the history / A4 day download completes with the row and proves the day (a day that failed before)', async () => {
  const day = '2026-10-21';
  const states = [];
  await withCloud(async cloud => {
    const database = { ...cloud, readArchivePublication: undefined,
      historyDownloadStates: async () => [{ slave_id: 4, day, complete: 0 }],
      setHistoryDownloadState: async (owner, slave, key, complete) => { states.push(complete); } };
    const dayStart = new Date(2026, 9, 21).getTime();
    const rows = [event(11, new Date(dayStart + 60000).toISOString()),
      event(12, new Date(dayStart + 61000).toISOString(), { usbPresent: 136 }),
      event(13, new Date(dayStart + 62000).toISOString())];
    const history = createHistoryCloud({ client: fakeClient([{ data: rows }]), database, owner: 'account-a' });
    await expect(history.download({ slaveId: 4, dayStart, dayEnd: dayStart + 86400000,
      cutoff: dayStart + 86400000 + 4 * 3600000 })).resolves.toBe(3);
    expect(states).toEqual([false, true]);
    const saved = (await cloud.listHistory('account-a')).sort((a, b) => a.sequence - b.sequence);
    expect(saved.map(row => row.usb_present)).toEqual([0, null, 0]);
  });
});

test('the live snapshot and its context keep a dog whose newest packet is the garbled one', async () => {
  const row = event(21, '2026-10-21T03:00:00Z', { usbPresent: 136 });
  const client = { from: () => {
    const filters = [];
    const query = {};
    for (const name of ['select', 'in', 'eq', 'gt', 'lt', 'gte', 'lte', 'not', 'or', 'order', 'limit'])
      query[name] = (...args) => { filters.push([name, ...args]); return query; };
    query.abortSignal = async () => {
      const phone = filters.some(([name, key, value]) => name === 'eq' && key === 'upload_source' && value === 'phone');
      const nextKey = filters.some(([name, key]) => name === 'gt' && key === 'slave_id');
      const seed = filters.some(([name, key]) => name === 'gte' && key === 'payload->satellites');
      return { data: phone || nextKey || seed ? [] : [row] };
    };
    return query;
  } };
  const cutoff = Date.parse('2026-10-21T03:05:00Z');
  const snapshot = await downloadCloudLatest({ client, masterIds: [7], cutoff, serverOffset: 0 });
  expect(snapshot.dogs).toHaveLength(1);
  expect(snapshot.dogs[0].packet).toMatchObject({ slave_id: 4, usb_present: null, slave_lat: 24.9892 });
  const context = await downloadCloudLatestContext({ client, masterIds: [7], snapshot });
  expect(context.dogs[0].context.map(item => item.usb_present)).toEqual([null]);
  expect(malformedLogs().map(([, fields]) => fields.source)).toEqual(['latest', 'context']);
});

test('the live snapshot does not fail on a newest fix the reader cannot believe: that stream just has no fix from it', async () => {
  const packet = event(25, '2026-10-21T03:00:00Z', { lat: 0, lon: 0 });
  // Passes the server's nonzero, in-range filter, but is 0,0 once divided.
  const fix = event(24, '2026-10-21T02:00:00Z', { lat: 1e-320, lon: 0 });
  const client = { from: () => {
    const filters = [];
    const query = {};
    for (const name of ['select', 'in', 'eq', 'gt', 'lt', 'gte', 'lte', 'not', 'or', 'order', 'limit'])
      query[name] = (...args) => { filters.push([name, ...args]); return query; };
    query.abortSignal = async () => {
      const has = (method, key) => filters.some(([name, field]) => name === method && field === key);
      if (has('eq', 'upload_source') || has('gt', 'slave_id')) return { data: [] };
      return { data: [has('gte', 'payload->lat') ? fix : packet] };
    };
    return query;
  } };
  const snapshot = await downloadCloudLatest({ client, masterIds: [7], cutoff: Date.parse('2026-10-21T03:05:00Z'), serverOffset: 0 });
  expect(snapshot.dogs[0]).toMatchObject({ slaveId: 4, packet: { slave_lat: 0 }, fix: null });
  expect(malformedLogs()[0][1]).toMatchObject({ source: 'latest', fields: [{ field: 'lat', type: 'number', count: 1 }] });
});

test('every payload flag and measurement is robust: unknown value, never a thrown batch', () => {
  const malformed = createMalformedFields();
  const mapped = mapCloudTelemetry(event(31, '2026-10-21T03:00:00Z', {
    usbPresent: '1', activityValid: true, batteryValid: 300, speed: 'fast', batteryPercentage: {},
    gpsTimestamp: 'later',
  }, { seq: 'x', rssi: '-90' }), malformed);
  expect(mapped).toMatchObject({ slave_id: 4, usb_present: null, activity_valid: 1, battery_valid: 0,
    speed_kmh: null, battery_percentage: null, gps_time: null, activity_time: '231', sequence: null, rssi: null,
    slave_lat: 24.9892, slave_lon: 121.3138, satellites: 9, battery_mv: 3900 });
  expect(malformed.entries()).toEqual(expect.arrayContaining([
    { field: 'usbPresent', type: 'string', count: 1 },
    { field: 'batteryValid', type: 'number', value: 300, count: 1 },
    { field: 'speed', type: 'string', count: 1 }, { field: 'batteryPercentage', type: 'object', count: 1 },
    { field: 'gpsTimestamp', type: 'string', count: 1 },
    { field: 'seq', type: 'string', count: 1 }, { field: 'rssi', type: 'string', count: 1 },
  ]));
  // A boolean validity flag is read as 1/0 (not malformed); a fraction is not a byte.
  expect(malformed.entries().some(entry => entry.field === 'activityValid')).toBe(false);
  expect(mapCloudTelemetry(event(36, '2026-10-21T03:00:00Z', { activityValid: 0.5 })).activity_valid).toBe(0);
  // The server-owned envelope still refuses: the cursor and the dog come from it.
  expect(() => mapCloudTelemetry({ ...event(33, '2026-10-21T03:00:00Z'), event_id: 'bad)' })).toThrow();
  expect(() => mapCloudTelemetry({ ...event(34, 'yesterday') })).toThrow();
  expect(() => mapCloudTelemetry({ ...event(35, '2026-10-21T03:00:00Z'), slave_id: '4' })).toThrow();
});

test('a fix is believed only whole and in range; a payload for another dog or not an object gives no readings', () => {
  const malformed = createMalformedFields();
  const at = '2026-10-21T03:00:00Z';
  const fix = payload => mapCloudTelemetry(event(51, at, payload), malformed);
  expect(fix({ lat: '24.9892' })).toMatchObject({ slave_lat: null, slave_lon: null });
  expect(fix({ lon: null })).toMatchObject({ slave_lat: null, slave_lon: null });
  expect(fix({ lat: 91000000 })).toMatchObject({ slave_lat: null, slave_lon: null });
  expect(fix({ lat: 1e-320, lon: 0 })).toMatchObject({ slave_lat: null, slave_lon: null });
  // Unreadable quality is unknown, as when a packet leaves it out; the fix stays.
  expect(fix({ hdop: [1] })).toMatchObject({ slave_lat: 24.9892, hdop: null, satellites: 9 });
  expect(fix({ satellites: 'many' })).toMatchObject({ slave_lat: 24.9892, satellites: null });
  // No fix (0, 0) and an absent quality stay as before.
  expect(fix({ lat: 0, lon: 0 })).toMatchObject({ slave_lat: 0, slave_lon: 0 });
  expect(fix({ hdop: undefined })).toMatchObject({ slave_lat: 24.9892, hdop: null });
  const other = fix({ slaveId: 9, usbPresent: 1 });
  expect(other).toMatchObject({ slave_id: 4, slave_lat: null, slave_lon: null, usb_present: null,
    battery_percentage: null, battery_valid: 0, activity_valid: 0 });
  const text = mapCloudTelemetry({ ...event(52, at), payload: 'garbled' }, malformed);
  expect(text).toMatchObject({ slave_id: 4, slave_lat: null, usb_present: null, battery_valid: 0, sequence: 52 });
  // Coordinates and the other dog's id are never logged, only their type.
  const entries = malformed.entries();
  expect(entries).toEqual(expect.arrayContaining([{ field: 'lat', type: 'string', count: 1 },
    { field: 'lat', type: 'number', count: 2 }, { field: 'slaveId', type: 'number', count: 1 },
    { field: 'payload', type: 'string', count: 1 }]));
  expect(JSON.stringify(entries)).not.toMatch(/24\.98|91000000/);
});

test('the release log line is rebuilt: only known fields, byte or boolean flag values, never text', () => {
  const { malformedTelemetryDiagnostic } = require('../src/logger');
  malformedTelemetryDiagnostic({ source: 'archive', rows: 2, fields: [
    { field: 'usbPresent', type: 'string', value: 'secret-token', count: 1 },
    { field: 'usbPresent', type: 'number', value: 24989200, count: 1 },
    { field: 'batteryValid', type: 'boolean', value: true, count: 1 },
    { field: 'lat', type: 'number', value: 24.9892, count: 1 },
    { field: 'owner', type: 'string', value: 'x', count: 1 }] });
  malformedTelemetryDiagnostic({ source: 'https://private.invalid', rows: 1, fields: [{ field: 'lat', type: 'string', count: 1 }] });
  expect(malformedLogs()).toEqual([['[CloudTelemetry] malformed', { source: 'archive', rows: 2, fields: [
    { field: 'usbPresent', type: 'string', count: 1 }, { field: 'usbPresent', type: 'number', count: 1 },
    { field: 'batteryValid', type: 'boolean', value: true, count: 1 }, { field: 'lat', type: 'number', count: 1 }] }]]);
  // A refused sink never fails the batch.
  warn.mockImplementation(() => { throw new Error('sink refused'); });
  const malformed = createMalformedFields();
  malformed.note('usbPresent', 136);
  expect(() => malformed.report('archive')).not.toThrow();
});

test('the same value seen many times in one batch is one log entry with its count', async () => {
  await withCloud(async cloud => {
    const rows = Array.from({ length: 5 }, (_, n) => event(41 + n, `2026-10-19T12:0${n}:00Z`, { usbPresent: 136 }));
    await downloadCloudHistory({ client: fakeClient([{ data: rows }, { data: [] }]), database: cloud, owner: 'account-a',
      startAt: '2026-10-19T12:00:00Z', endBefore: '2026-10-19T13:00:00Z', source: 'archive' });
    expect(malformedLogs()).toEqual([['[CloudTelemetry] malformed',
      { source: 'archive', rows: 5, fields: [{ field: 'usbPresent', type: 'number', value: 136, count: 5 }] }]]);
  });
});

test('phone upload: a garbled USB flag is left out and the packet still goes; a row an older build refused for it is sent again', async () => {
  const fs = require('fs'), path = require('path');
  const { createUploadDatabase, OLD_USB_ERROR } = require('../src/cloudUpload/UploadDatabase');
  const { createUploadService } = require('../src/cloudUpload/UploadService');
  const connection = createMemoryConnection();
  try {
    const native = fs.readFileSync(path.join(__dirname, '../android/app/src/main/java/com/dogtracker/BleUploadQueue.kt'), 'utf8');
    for (const sql of native.matchAll(/db\.execSQL\("(CREATE [^"]+)"\)/g)) connection.sqlite.exec(sql[1]);
    connection.sqlite.exec("INSERT INTO ble_upload_meta VALUES('phone_id','00000000-0000-4000-8000-0000000000aa')");
    const database = createUploadDatabase(connection);
    await database.setMode('alice', 7, 'phone');
    const packet = { type: 3, mid: 7, sid: 4, seq: 1, lat: 24.9892, lon: 121.3138, speed_kmh: 1, sat: 8, hdop: 1,
      gps_time: 123, activity: 0.5, activity_valid: 1, activity_time: 124, battery_mv: 3900, battery_pct: 80,
      battery_valid: 1, rssi: -90, snr: 7, usbPresent: 136 };
    const insert = (eventId, status = 'pending', error = '') => connection.sqlite.prepare(`INSERT INTO ble_upload_queue
      (event_id,owner_user_id,master_id,received_at,payload_json,fingerprint,slave_id,status,last_error)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(eventId, 'alice', 7, Date.now() - 1000, JSON.stringify(packet), eventId, 4, status, error);
    insert(id(61));
    // What an older build left: refused for the USB flag alone (and one refused for something else).
    insert(id(62), 'blocked', OLD_USB_ERROR);
    insert(id(63), 'blocked', 'Invalid telemetry');
    const sent = [];
    const client = { auth: { getSession: async () => ({ data: { session: { user: { id: 'alice' }, access_token: 'test' } } }) },
      functions: { invoke: jest.fn(async (name, { body }) => { sent.push(body); return { data: { ok: true, event_id: body.event_id } }; }) } };
    await createUploadService({ database, client }).run('alice');
    expect(sent.map(body => body.event_id).sort()).toEqual([id(61), id(62)]);
    expect(sent.every(body => !('usbPresent' in body.payload) && body.payload.lat === 24989200)).toBe(true);
    const status = eventId => connection.sqlite.prepare('SELECT status FROM ble_upload_queue WHERE event_id=?').get(eventId).status;
    expect([status(id(61)), status(id(62)), status(id(63))]).toEqual(['sent', 'sent', 'blocked']);
    expect(malformedLogs()).toEqual([['[CloudTelemetry] malformed',
      { source: 'upload', rows: 2, fields: [{ field: 'usbPresent', type: 'number', value: 136, count: 2 }] }]]);
  } finally { connection.close(); }
});
