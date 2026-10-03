/* global Response, TextDecoder, TextEncoder */
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import ts from 'typescript';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { bleUploadPayload } from '../src/cloudUpload/BleUploadPayload';
import { mapCloudTelemetry } from '../src/cloud/CloudTelemetry';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { toDogStatus } from '../src/models/DogStatus';
import { mapDogStatusRow } from '../src/models/TrackingPoint';

const ble = { type: 3, mid: 7, sid: 4, seq: 1, lat: 25, lon: 121,
  speed_kmh: 1, sat: 8, hdop: 1, gps_time: 123, activity: 0.5, activity_valid: 1,
  activity_time: 124, battery_mv: 3900, battery_pct: 80, battery_valid: 1, rssi: -90, snr: 7 };
const id = '00000000-0000-4000-8000-000000000001';
const upload = data => bleUploadPayload({ event_id: id, master_id: 7, received_at: 1000,
  payload_json: JSON.stringify(data) }, id);

function backend(duplicate = null) {
  let handler, saved;
  const admin = { auth: { getUser: async () => ({ data: { user: { id: 'owner' } } }) },
    from: table => {
      const query = { select: () => query, eq: () => query,
        maybeSingle: async () => ({ data: { mode: 'phone', owner_user_id: 'owner', phone_id: id } }),
        limit: async () => ({ data: [{ gateway_id: 'master_7' }] }),
        single: async () => ({ data: duplicate }),
        insert: async record => { saved = record; return duplicate ? { error: { code: '23505' } } : {}; } };
      return query;
    } };
  const source = fs.readFileSync(path.join(__dirname, '../supabase/functions/ingest-phone-telemetry/index.ts'), 'utf8')
    .replace(/^import .*;\r?\n/, '');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { createClient: () => admin, Response, TextDecoder,
    Deno: { env: { get: () => 'test' }, serve: fn => { handler = fn; } } });
  return { send: async body => {
    const bytes = new TextEncoder().encode(JSON.stringify(body));
    let done = false;
    return handler({ method: 'POST', headers: { get: () => 'Bearer test' },
      body: { getReader: () => ({ read: async () => {
        if (done) return { done: true };
        done = true; return { done: false, value: bytes };
      } }) } });
  }, saved: () => saved };
}

test.each([true, false, 1, 0, undefined])('USB %s survives phone upload, backend and downloaded SQLite', async value => {
  const body = upload({ ...ble, usbPresent: value });
  const server = backend();
  expect((await server.send(body)).status).toBe(200);
  const remote = { ...server.saved(), received_at: '2026-10-01T00:00:00Z' };
  const connection = createMemoryConnection();
  try {
    const dog = createDogDatabase(connection), cloud = createCloudDatabase(connection);
    await dog.initialize(); await cloud.initialize();
    await cloud.savePage('owner', [mapCloudTelemetry(remote)]);
    const expected = value == null ? null : Number(value);
    expect((await cloud.listHistory('owner'))[0].usb_present).toBe(expected);
    expect((await cloud.latestStatusRows('owner', 0))[0].usb_present).toBe(expected);
    await dog.saveStatus(toDogStatus({ ...ble, usbPresent: value }));
    expect(mapDogStatusRow(await dog.getLatestStatusRow()).usbPresent).toBe(expected);
  } finally { connection.close(); }
});

test('snake case BLE alias preserves zero and absent values stay omitted', () => {
  expect(upload({ ...ble, usb_present: 0 }).payload.usbPresent).toBe(0);
  expect(upload(ble).payload).not.toHaveProperty('usbPresent');
});

test.each([2, -1, '1', {}])('invalid USB %s is rejected by phone, backend and downloader', async value => {
  expect(() => upload({ ...ble, usbPresent: value })).toThrow('usbPresent');
  const body = upload(ble); body.payload.usbPresent = value;
  expect((await backend().send(body)).status).toBe(400);
  expect(() => mapCloudTelemetry({ ...body, received_at: '2026-10-01T00:00:00Z' })).toThrow('usbPresent');
});

test('upgrades existing BLE and cloud tables without inventing USB status', async () => {
  const connection = createMemoryConnection();
  try {
    const dog = createDogDatabase(connection);
    await dog.initialize();
    for (const table of ['dog_status', 'supabase_dog_status']) {
      connection.sqlite.exec(`ALTER TABLE ${table} DROP COLUMN usb_present`);
      connection.sqlite.exec(`INSERT INTO ${table}(received_at) VALUES (1000)`);
    }
    await dog.initialize(); await dog.initialize();
    await createCloudDatabase(connection).initialize();
    for (const table of ['dog_status', 'supabase_dog_status']) {
      expect(connection.sqlite.prepare(`SELECT usb_present FROM ${table}`).get().usb_present).toBeNull();
    }
  } finally { connection.close(); }
});

test('duplicate retries compare USB values and preserve old events without USB', async () => {
  for (const value of [undefined, 0, 1]) {
    const body = upload({ ...ble, usbPresent: value });
    const server = backend(); await server.send(body);
    expect((await backend(server.saved()).send(body)).status).toBe(200);
    const different = { ...body, payload: { ...body.payload, usbPresent: value === 1 ? 0 : 1 } };
    expect((await backend(server.saved()).send(different)).status).toBe(409);
  }
});
