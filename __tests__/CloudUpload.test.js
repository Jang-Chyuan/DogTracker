import fs from 'fs';
import path from 'path';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { bleUploadPayload } from '../src/cloudUpload/BleUploadPayload';
import { createUploadDatabase } from '../src/cloudUpload/UploadDatabase';
import { createUploadService } from '../src/cloudUpload/UploadService';

const payload = { type: 3, mid: 7, sid: 4, seq: 1, lat: 25.012345, lon: 121.123456,
  speed_kmh: 5.67, sat: 8, hdop: 1.23, gps_time: 123, activity: 0.456, activity_valid: 1,
  activity_time: 124, battery_mv: 3900, battery_pct: 80, battery_valid: 1, rssi: -90.1, snr: 7.2 };
function setup() {
  const connection = createMemoryConnection();
  // Exercise the actual schema created by the Android receiver, not a second schema.
  const native = fs.readFileSync(path.join(__dirname, '../android/app/src/main/java/com/dogtracker/BleUploadQueue.kt'), 'utf8');
  for (const sql of native.matchAll(/db\.execSQL\("(CREATE [^"]+)"\)/g)) connection.sqlite.exec(sql[1]);
  connection.sqlite.exec("INSERT INTO ble_upload_meta VALUES('phone_id','a661dc2b-7978-4303-a519-a70a8834e445')");
  return { connection, database: createUploadDatabase(connection) };
}
function insert(connection, event, owner = 'alice', master = 7, data = payload) {
  connection.sqlite.prepare('INSERT INTO ble_upload_queue(event_id,owner_user_id,master_id,received_at,payload_json,fingerprint,slave_id) VALUES(?,?,?,?,?,?,?)')
    .run(event, owner, master, 1000, JSON.stringify(data), event, data.sid);
}
test('Master 5 defaults to persisted phone relay without overriding manual routes on resume or login', async () => {
  const { connection, database } = setup();
  try {
    await database.owner('alice');
    expect(await database.settings('alice')).toEqual([
      { owner_user_id: 'alice', master_id: 5, mode: 'phone' },
    ]);
    insert(connection, 'five', 'alice', 5);
    insert(connection, 'seven', 'alice', 7);
    expect((await database.pending('alice', Date.now())).map(r => r.master_id)).toEqual([5]);
    await database.setMode('alice', 5, 'wifi');
    await database.owner(null);
    await createUploadDatabase(connection).owner('alice');
    expect((await database.settings('alice'))[0].mode).toBe('wifi');
    await database.owner('bob');
    expect((await database.settings('bob'))[0].mode).toBe('phone');
    expect((await database.settings('alice'))[0].mode).toBe('wifi');
  } finally { connection.close(); }
});
test('BLE units reconstruct the Wi-Fi wire payload without substituting display coordinates', () => {
  const result = bleUploadPayload({ event_id: 'a', master_id: 7, received_at: 1000, payload_json: JSON.stringify(payload) }, 'phone');
  expect(result.payload).toEqual({ lat: 25012345, lon: 121123456, speed: 567, satellites: 8, hdop: 123,
    gpsTimestamp: 123, activityScore: 456, activityValid: 1, activityTimestamp: 124,
    batteryMillivolts: 3900, batteryPercentage: 80, batteryValid: 1, slaveId: 4 });
  expect(result.rssi).toBe(-90.1);
  for (const change of [{ gps_time: undefined }, { lat: 200 }, { seq: 1.5 }, { type: 2 }, { mid: 5 }, { sat: null }]) {
    expect(() => bleUploadPayload({ master_id: 7, received_at: 1000, payload_json: JSON.stringify({ ...payload, ...change }) }, 'phone')).toThrow();
  }
});
test('queue survives new adapter, route disable and account switch; lost response retries same UUID', async () => {
  const { connection, database } = setup();
  try {
    await database.setMode('alice', 7, 'phone');
    insert(connection, 'event-a'); insert(connection, 'event-b', 'bob');
    const client = { auth: { getSession: jest.fn(async () => ({ data: { session: { user: { id: 'alice' }, access_token: 'token' } } })) },
      functions: { invoke: jest.fn().mockResolvedValueOnce({ error: new Error('lost response') })
        .mockResolvedValue({ data: { ok: true, event_id: 'event-a' } }) } };
    await createUploadService({ database, client }).run('alice');
    expect((await database.pending('alice', Date.now()))).toHaveLength(0);
    connection.sqlite.exec('UPDATE ble_upload_queue SET next_retry_at=0');
    const reopened = createUploadDatabase(connection);
    await createUploadService({ database: reopened, client }).run('alice');
    expect(client.functions.invoke.mock.calls.map(c => c[1].body.event_id)).toEqual(['event-a', 'event-a']);
    expect(connection.sqlite.prepare('SELECT status FROM ble_upload_queue WHERE event_id=?').get('event-a').status).toBe('sent');
    expect(connection.sqlite.prepare('SELECT status FROM ble_upload_queue WHERE event_id=?').get('event-b').status).toBe('pending');
    await createUploadService({ database, client }).run('bob');
    expect(client.functions.invoke).toHaveBeenCalledTimes(2);
  } finally { connection.close(); }
});
test('enabling starts a new upload period without changing local history or other Masters', async () => {
  const { connection, database } = setup();
  try {
    connection.sqlite.exec('CREATE TABLE dog_status (id INTEGER PRIMARY KEY, lat REAL)');
    connection.sqlite.exec('INSERT INTO dog_status VALUES(1,25)');
    insert(connection, 'old'); insert(connection, 'other-owner', 'bob');
    insert(connection, 'other-master', 'alice', 5);
    await database.setMode('alice', 7, 'phone');
    expect(await database.pending('alice', Date.now())).toEqual([]);
    insert(connection, 'new');
    const fetched = (await database.pending('alice', Date.now()))[0];
    expect(await database.isPending(fetched)).toBe(true);
    // Saving unchanged settings is not a new start; offline retries remain valid.
    await database.setMode('alice', 7, 'phone');
    expect(await database.isPending(fetched)).toBe(true);
    await database.setMode('alice', 7, 'wifi');
    expect(await database.isPending(fetched)).toBe(false);
    await database.setMode('alice', 7, 'phone');
    await database.retry('alice');
    expect(await database.isPending(fetched)).toBe(false);
    expect(await database.pending('alice', Date.now())).toEqual([]);
    expect(connection.sqlite.prepare('SELECT COUNT(*) n FROM dog_status').get().n).toBe(1);
    expect(connection.sqlite.prepare('SELECT event_id FROM ble_upload_queue ORDER BY event_id').all()
      .map(r => r.event_id)).toEqual(['other-master', 'other-owner']);
  } finally { connection.close(); }
});

test('each dog latest location precedes old backlog and retry keeps unsent data', async () => {
  const { connection, database } = setup();
  try {
    await database.setMode('alice', 7, 'phone');
    for (let n = 0; n < 25; n++) insert(connection, `old-${n}`);
    insert(connection, 'latest-4');
    insert(connection, 'latest-6', 'alice', 7, { ...payload, sid: 6 });
    const batch = await database.pending('alice', Date.now());
    expect(batch.slice(0, 2).map(r => r.event_id)).toEqual(['latest-4', 'latest-6']);
    expect(batch[2].event_id).toBe('old-0');
    await database.failed(batch[0], 'offline', false, Date.now());
    expect(connection.sqlite.prepare("SELECT status FROM ble_upload_queue WHERE event_id='latest-4'").get().status).toBe('pending');
    expect(connection.sqlite.prepare('SELECT COUNT(*) n FROM ble_upload_queue').get().n).toBe(27);
  } finally { connection.close(); }
});

test('invalid payload and revoked authorization block rather than silently succeeding', async () => {
  const { connection, database } = setup();
  try {
    await database.setMode('alice', 7, 'phone');
    insert(connection, 'invalid', 'alice', 7, { ...payload, gps_time: undefined });
    insert(connection, 'denied');
    const client = { auth: { getSession: async () => ({ data: { session: { user: { id: 'alice' } } } }) },
      functions: { invoke: jest.fn(async () => ({ error: { message: 'forbidden', context: { status: 403 } } })) } };
    await createUploadService({ database, client }).run('alice');
    expect(client.functions.invoke).toHaveBeenCalledTimes(1);
    expect(connection.sqlite.prepare("SELECT COUNT(*) n FROM ble_upload_queue WHERE status='blocked'").get().n).toBe(2);
    await database.retry('alice');
    expect(await database.pending('alice', Date.now())).toHaveLength(2);
  } finally { connection.close(); }
});
test('overlapping scheduler calls send only one request and disposal stops the next event', async () => {
  const { connection, database } = setup();
  try {
    await database.setMode('alice', 7, 'phone'); insert(connection, 'one'); insert(connection, 'two');
    let alive = true;
    const client = { auth: { getSession: async () => ({ data: { session: { user: { id: 'alice' } } } }) },
      functions: { invoke: jest.fn(async () => { alive = false; return { data: { ok: true, event_id: 'one' } }; }) } };
    const engine = createUploadService({ database, client });
    await Promise.all([engine.run('alice', () => alive), engine.run('alice', () => alive)]);
    expect(client.functions.invoke).toHaveBeenCalledTimes(1);
    expect(connection.sqlite.prepare("SELECT status FROM ble_upload_queue WHERE event_id='two'").get().status).toBe('pending');
  } finally { connection.close(); }
});
