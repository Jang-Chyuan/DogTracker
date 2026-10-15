/* eslint-env node, jest */
// The Android upload queue's own SQL (BleUploadQueue.kt), executed on the
// test SQLite: the schema it creates, its constant statements and the order
// BleUploadQueue.enqueue runs them in. The decisions themselves are also
// covered by the JVM test (BleUploadQueueTest.kt).
import fs from 'fs';
import path from 'path';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';

const source = fs.readFileSync(path.join(__dirname,
  '../android/app/src/main/java/com/dogtracker/BleUploadQueue.kt'), 'utf8');

export function nativeSql(name) {
  const found = source.match(new RegExp(`const val ${name} = "([^"]+)"`));
  if (!found) throw new Error(`BleUploadQueue.${name} not found`);
  return found[1];
}
export const nativeNumber = name => Number(source.match(new RegExp(`const val ${name} = ([\\d_]+)`))[1].replace(/_/g, ''));

let untilCheck = 0;
export function createQueueConnection() {
  untilCheck = 0;
  const connection = createMemoryConnection();
  for (const sql of source.matchAll(/db\.execSQL\("(CREATE [^"]+)"\)/g)) connection.sqlite.exec(sql[1]);
  connection.sqlite.exec("INSERT INTO ble_upload_meta VALUES('phone_id','a661dc2b-7978-4303-a519-a70a8834e445')");
  return connection;
}

let events = 0;
/**
 * BleUploadQueue.enqueue after its account/route/duplicate checks: the cap,
 * then the insert. → 'queued' | 'refused'.
 */
export function nativeEnqueue(sqlite, { owner = 'alice', master = 7, slave = 4, receivedAt, payload }) {
  if (sqlite.prepare(nativeSql('REFUSED_SQL')).get(owner, master)) return 'refused';
  if (untilCheck <= 0) {
    untilCheck = nativeNumber('CHECK_EVERY');
    const pending = Object.values(sqlite.prepare(nativeSql('PENDING_COUNT_SQL')).get())[0];
    if (pending >= nativeNumber('CAP')) {
      if (sqlite.prepare(nativeSql('THIN_SQL')).run().changes === 0) sqlite.prepare(nativeSql('DROP_SQL')).run();
      sqlite.prepare(nativeSql('THINNED_SQL')).run(String(receivedAt));
    }
  }
  untilCheck -= 1;
  events += 1;
  const id = `00000000-0000-4000-8000-${String(events).padStart(12, '0')}`;
  sqlite.prepare(`INSERT INTO ble_upload_queue(event_id,owner_user_id,master_id,received_at,payload_json,fingerprint,slave_id)
    VALUES(?,?,?,?,?,?,?)`).run(id, owner, master, receivedAt, JSON.stringify(payload), id, slave);
  return 'queued';
}

export const telemetry = (overrides = {}) => ({ type: 3, mid: 7, sid: 4, seq: 1, lat: 25.01, lon: 121.12,
  speed_kmh: 5.6, sat: 8, hdop: 1.2, gps_time: 123, activity: 0.4, activity_valid: 1, activity_time: 124,
  battery_mv: 3900, battery_pct: 80, battery_valid: 1, rssi: -90, snr: 7, ...overrides });

/** A signed-in Supabase client whose ingest function answers `answer(body)`. */
export function fakeClient(answer = body => ({ data: { ok: true, event_id: body.event_id } }), owner = 'alice') {
  let inFlight = 0;
  const client = {
    maxInFlight: 0,
    auth: { getSession: async () => ({ data: { session: { user: { id: owner }, access_token: 't' } } }) },
    functions: { invoke: jest.fn(async (_name, { body }) => {
      inFlight += 1; client.maxInFlight = Math.max(client.maxInFlight, inFlight);
      await new Promise(resolve => setImmediate(resolve));
      inFlight -= 1;
      return answer(body);
    }) },
  };
  return client;
}
