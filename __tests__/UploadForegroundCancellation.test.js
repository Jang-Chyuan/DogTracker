import fs from 'fs';
import path from 'path';
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { NativeModules, Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { openTrackingDatabase } from '../src/database/TrackingDatabaseConnection';
import { getCloudClient } from '../src/cloud/CloudClient';
import { useCloudUpload } from '../src/cloudUpload/useCloudUpload';

jest.mock('../src/database/TrackingDatabaseConnection', () => ({ openTrackingDatabase: jest.fn() }));
jest.mock('../src/cloud/CloudClient', () => ({ getCloudClient: jest.fn() }));

// The hook, UploadService, native queue schema, SQLite adapter and SDK are real.
// Only HTTP responses and the native connection boundary are supplied here.
const payload = { type: 3, mid: 7, sid: 4, seq: 1, lat: 25.012345, lon: 121.123456,
  speed_kmh: 5.67, sat: 8, hdop: 1.23, gps_time: 123, activity: 0.456, activity_valid: 1,
  activity_time: 124, battery_mv: 3900, battery_pct: 80, battery_valid: 1, rssi: -90.1, snr: 7.2 };
const response = body => ({ ok: true, status: 200, statusText: 'OK',
  headers: { get: name => name.toLowerCase() === 'content-type' ? 'application/json' : null },
  text: async () => JSON.stringify(body), json: async () => body });
const held = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
let connection, client, tree, upload, calls, finish, oldOS, oldBle, oldCloud;
function Probe({ owner = 'alice', foreground = true }) {
  upload = useCloudUpload(true, owner, foreground);
  return null;
}
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const move = async props => { await act(async () => { tree.update(<Probe {...props} />); await settle(); }); };
const queued = () => connection.sqlite.prepare('SELECT event_id,status,attempts,next_retry_at,sent_at FROM ble_upload_queue ORDER BY id').all();
beforeEach(() => {
  jest.useFakeTimers(); calls = []; finish = []; tree = null;
  oldOS = Platform.OS; oldBle = NativeModules.BleBackground; oldCloud = NativeModules.CloudBackgroundSync;
  Platform.OS = 'android'; NativeModules.BleBackground = { executeDatabase: jest.fn() };
  NativeModules.CloudBackgroundSync = { configureSearch: jest.fn(async () => {}) };
  connection = createMemoryConnection(); openTrackingDatabase.mockReturnValue(connection);
  const native = fs.readFileSync(path.join(__dirname, '../android/app/src/main/java/com/dogtracker/BleUploadQueue.kt'), 'utf8');
  for (const sql of native.matchAll(/db\.execSQL\("(CREATE [^"]+)"\)/g)) connection.sqlite.exec(sql[1]);
  connection.sqlite.exec("INSERT INTO ble_upload_meta VALUES('phone_id','a661dc2b-7978-4303-a519-a70a8834e445')");
});
afterEach(async () => {
  await act(async () => { tree?.unmount(); finish.forEach(resolve => resolve()); await settle(); });
  connection.close(); Platform.OS = oldOS;
  NativeModules.BleBackground = oldBle; NativeModules.CloudBackgroundSync = oldCloud;
  jest.useRealTimers();
});
function event(id, owner = 'alice') {
  connection.sqlite.prepare('INSERT INTO ble_upload_queue(event_id,owner_user_id,master_id,received_at,payload_json,fingerprint,slave_id) VALUES(?,?,?,?,?,?,?)')
    .run(id, owner, 7, 1000, JSON.stringify(payload), id, payload.sid);
}
function network(transport) {
  client = createClient('https://example.invalid', 'fixture-public-key', { auth: {
    persistSession: false, autoRefreshToken: false, detectSessionInUrl: false,
  }, global: { fetch: async (url, options) => {
    const query = new URL(url);
    const call = { kind: query.pathname.includes('/functions/') ? 'upload' : 'membership',
      owner: query.searchParams.get('user_id')?.slice(3), signal: options.signal, body: options.body };
    calls.push(call);
    return transport(call);
  } } });
  client.auth.getSession = jest.fn(async () => ({ data: { session: { user: { id: 'alice' }, access_token: 'fixture-token' } } }));
  getCloudClient.mockReturnValue(client);
}
async function mount() {
  await act(async () => { tree = Renderer.create(<Probe />); await settle(); });
}

test('background abort reaches both real SDK HTTP requests; ignored late upload ACK leaves the same UUID queued for resume', async () => {
  event('event-a'); const wait = held(); finish.push(() => wait.resolve());
  let hold = true;
  network(async call => {
    if (hold) await wait.promise; // Deliberately ignore transport abort.
    return response(call.kind === 'upload' ? { ok: true, event_id: JSON.parse(call.body).event_id }
      : [{ gateway_id: 'master_7' }]);
  });
  await mount();
  const initial = queued();
  expect(calls.map(call => call.kind).sort()).toEqual(['membership', 'upload']);
  await move({ foreground: false });
  expect(calls.every(call => call.signal?.aborted)).toBe(true);
  expect(upload.masters).toEqual([]);
  expect(queued()).toEqual(initial);
  hold = false;
  await act(async () => { wait.resolve(); await settle(); });
  expect(queued()).toEqual(initial);
  expect(upload.masters).toEqual([]);
  await move({ foreground: true });
  expect(calls.filter(call => call.kind === 'upload').map(call => JSON.parse(call.body).event_id)).toEqual(['event-a', 'event-a']);
  expect(queued()[0].status).toBe('sent');
  expect(upload.masters).toEqual([7]);
});

test('account switch aborts old HTTP; late membership and upload errors cannot publish or mark another account queue', async () => {
  event('event-a'); event('event-b', 'bob');
  const wait = held(); finish.push(() => wait.resolve());
  network(async call => {
    if (call.kind === 'upload' || call.owner === 'alice') {
      await wait.promise;
      if (call.kind === 'upload') throw new Error('late offline response');
    }
    return response([{ gateway_id: call.owner === 'alice' ? 'master_7' : 'master_9' }]);
  });
  await mount(); const initial = queued(); const previous = [...calls];
  await move({ owner: 'bob' });
  expect(previous.every(call => call.signal?.aborted)).toBe(true);
  expect(upload.owner).toBe('bob'); expect(upload.masters).toEqual([9]);
  await act(async () => { wait.resolve(); await settle(); });
  expect(upload.masters).toEqual([9]); expect(upload.error).toBe('');
  expect(queued()).toEqual(initial);
});

test('membership has a 15s logical deadline even if HTTP ignores abort; late result and cleanup do not restart it', async () => {
  const schedule = jest.spyOn(global, 'setTimeout'), clear = jest.spyOn(global, 'clearTimeout');
  const wait = held(); finish.push(() => wait.resolve());
  network(async () => { await wait.promise; return response([{ gateway_id: 'master_7' }]); });
  await mount(); expect(calls).toHaveLength(1);
  const deadlineIndex = schedule.mock.calls.findIndex(([, ms]) => ms === 15000);
  expect(deadlineIndex).toBeGreaterThanOrEqual(0);
  const deadline = schedule.mock.results[deadlineIndex].value;
  await act(async () => { await jest.advanceTimersByTimeAsync(14999); });
  expect(calls[0].signal.aborted).toBe(false); expect(upload.error).toBe('');
  await act(async () => { await jest.advanceTimersByTimeAsync(1); });
  expect(calls[0].signal.aborted).toBe(true);
  expect(upload.error).toMatch(/無法取得 Master 授權/); expect(upload.masters).toEqual([]);
  const timeoutError = upload.error;
  await act(async () => { wait.resolve(); await settle(); });
  expect(upload.masters).toEqual([]); expect(upload.error).toBe(timeoutError);
  await act(async () => { tree.unmount(); tree = null; await settle(); });
  expect(clear).toHaveBeenCalledWith(deadline);
  schedule.mockRestore(); clear.mockRestore();
});

test('cancel during auth wait prevents a delayed session from sending queued telemetry; membership signal remains aborted', async () => {
  event('event-a'); const auth = held(); finish.push(() => auth.resolve());
  network(async call => response(call.kind === 'upload' ? { ok: true, event_id: 'event-a' } : []));
  client.auth.getSession.mockImplementation(async () => { await auth.promise;
    return { data: { session: { user: { id: 'alice' }, access_token: 'fixture-token' } } }; });
  await mount(); const initial = queued(); expect(calls).toHaveLength(0);
  await move({ foreground: false });
  await act(async () => { auth.resolve(); await settle(); });
  expect(calls.filter(call => call.kind === 'upload')).toHaveLength(0);
  expect(calls.every(call => call.signal?.aborted)).toBe(true);
  expect(queued()).toEqual(initial); expect(upload.masters).toEqual([]);
});
