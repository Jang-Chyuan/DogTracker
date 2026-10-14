/* eslint-env node, jest */
import { t } from '../src/i18n';
import { createUploadDatabase, BLOCKED_KEEP_MS, BLOCKED_KEEP_ROWS } from '../src/cloudUpload/UploadDatabase';
import { createUploadService, PASS_ROWS, PASS_REQUESTS, PASS_BUDGET_MS } from '../src/cloudUpload/UploadService';
import { phoneUploadProblem } from '../src/cloudUpload/UploadSuccess';
import { createQueueConnection, fakeClient, nativeEnqueue, nativeNumber, nativeSql, telemetry } from '../test-support/NativeUploadQueue';

const MINUTE = 60000;
const T0 = Date.UTC(2026, 9, 1, 0, 0, 0);
const count = (sqlite, where = '1') => sqlite.prepare(`SELECT COUNT(*) n FROM ble_upload_queue WHERE ${where}`).get().n;

function fill(sqlite, { from = T0, minutes, everyMs = 2000, slaves = [1, 2] }) {
  for (let time = from; time < from + minutes * MINUTE; time += everyMs) {
    for (const slave of slaves) nativeEnqueue(sqlite, { slave, receivedAt: time, payload: telemetry({ sid: slave }) });
  }
}

describe('native cap (BleUploadQueue.kt)', () => {
  test('refused (blocked) rows do not count toward the cap', () => {
    const { sqlite } = createQueueConnection();
    nativeEnqueue(sqlite, { receivedAt: T0, payload: telemetry() });
    nativeEnqueue(sqlite, { receivedAt: T0 + 1, payload: telemetry() });
    sqlite.exec("UPDATE ble_upload_queue SET status='blocked' WHERE id=1");
    expect(Object.values(sqlite.prepare(nativeSql('PENDING_COUNT_SQL')).get())[0]).toBe(1);
  });

  test('thinning keeps the first row of every dog in every minute, oldest rows first', () => {
    const { sqlite } = createQueueConnection();
    fill(sqlite, { minutes: 120 }); // 2 dogs every 2 s: 7200 rows
    const removed = sqlite.prepare(nativeSql('THIN_SQL')).run().changes;
    expect(removed).toBe(nativeNumber('THIN_BATCH'));
    // The oldest minutes are down to one row per dog; the newest are untouched.
    const perMinute = sqlite.prepare(`SELECT slave_id, received_at/60000 minute, COUNT(*) n FROM ble_upload_queue
      GROUP BY slave_id, minute ORDER BY minute`).all();
    const oldest = perMinute.filter(row => row.minute === Math.floor(T0 / MINUTE));
    expect(oldest.map(row => row.n)).toEqual([1, 1]);
    expect(perMinute.at(-1).n).toBe(30);
    // Every dog keeps at least one position in every minute.
    expect(perMinute).toHaveLength(2 * 120);
    // The kept row is the minute's first.
    expect(sqlite.prepare('SELECT MIN(received_at) t FROM ble_upload_queue WHERE slave_id=1').get().t).toBe(T0);
  });

  test('with nothing left to thin, the oldest rows go; the newest packet is always queued', () => {
    const { sqlite } = createQueueConnection();
    // One row per dog per minute already: nothing to thin.
    fill(sqlite, { minutes: 3, everyMs: MINUTE, slaves: [1] });
    expect(sqlite.prepare(nativeSql('THIN_SQL')).run().changes).toBe(0);
    expect(sqlite.prepare(nativeSql('DROP_SQL')).run().changes).toBe(3); // fewer than DROP_BATCH here
    expect(nativeNumber('DROP_BATCH')).toBe(500);
  });

  test('a full queue thins instead of refusing new packets', () => {
    const { sqlite } = createQueueConnection();
    const cap = nativeNumber('CAP');
    // Half a day offline: 2 dogs every 2 s = 43,200 packets.
    fill(sqlite, { minutes: 12 * 60 });
    expect(count(sqlite, "status='pending'")).toBeLessThanOrEqual(cap + nativeNumber('CHECK_EVERY'));
    // The newest packet of each dog is there, and every minute still has each dog.
    const newest = T0 + 12 * 60 * MINUTE - 2000;
    expect(count(sqlite, `received_at=${newest}`)).toBe(2);
    const minutes = sqlite.prepare('SELECT COUNT(DISTINCT received_at/60000) n FROM ble_upload_queue WHERE slave_id=1').get().n;
    expect(minutes).toBe(12 * 60);
    expect(sqlite.prepare("SELECT value FROM ble_upload_meta WHERE key='queue_thinned_at'").get().value).toBeTruthy();
  });

  test('the thinning is said while rows from before it still wait', async () => {
    const connection = createQueueConnection();
    const database = createUploadDatabase(connection);
    nativeEnqueue(connection.sqlite, { receivedAt: T0, payload: telemetry() });
    connection.sqlite.prepare(nativeSql('THINNED_SQL')).run(String(T0 + MINUTE));
    expect((await database.summary('alice')).error).toBe(t('c1361'));
    connection.sqlite.exec("UPDATE ble_upload_queue SET status='sent'");
    nativeEnqueue(connection.sqlite, { receivedAt: T0 + 2 * MINUTE, payload: telemetry() });
    expect((await database.summary('alice')).error).toBe('');
  });
});

describe('upload passes', () => {
  test('a pass sends up to PASS_ROWS events, PASS_REQUESTS at a time', async () => {
    const connection = createQueueConnection();
    fill(connection.sqlite, { minutes: 10 }); // 600 rows
    const client = fakeClient();
    const database = createUploadDatabase(connection);
    expect(await createUploadService({ database, client }).run('alice')).toBe('success');
    expect(client.functions.invoke).toHaveBeenCalledTimes(PASS_ROWS);
    expect(client.maxInFlight).toBe(PASS_REQUESTS);
    expect(count(connection.sqlite, "status='sent'")).toBe(PASS_ROWS);
  });

  test('no new request after the pass budget', async () => {
    const connection = createQueueConnection();
    fill(connection.sqlite, { minutes: 10 });
    let clock = T0;
    // Every request takes 3 s of the (fake) clock.
    const client = fakeClient(body => { clock += 3000; return { data: { ok: true, event_id: body.event_id } }; });
    await createUploadService({ database: createUploadDatabase(connection), client, now: () => clock }).run('alice');
    const calls = client.functions.invoke.mock.calls.length;
    expect(calls).toBeLessThan(PASS_ROWS);
    expect(calls).toBeLessThanOrEqual(Math.ceil(PASS_BUDGET_MS / 3000) + PASS_REQUESTS);
  });

  test('a 401 is not charged to the row', async () => {
    const connection = createQueueConnection();
    nativeEnqueue(connection.sqlite, { receivedAt: T0, payload: telemetry() });
    const error = Object.assign(new Error('expired'), { context: { status: 401 } });
    const client = fakeClient(() => ({ error }));
    expect(await createUploadService({ database: createUploadDatabase(connection), client }).run('alice')).toBe('unauthorized');
    expect(connection.sqlite.prepare('SELECT status, attempts, next_retry_at, last_error FROM ble_upload_queue').get())
      .toEqual({ status: 'pending', attempts: 0, next_retry_at: 0, last_error: '' });
  });

  test('a network failure still backs the row off and ends the pass', async () => {
    const connection = createQueueConnection();
    fill(connection.sqlite, { minutes: 1, slaves: [1] });
    const client = fakeClient(() => { throw new Error('Network request failed'); });
    expect(await createUploadService({ database: createUploadDatabase(connection), client }).run('alice')).toBe('retry');
    // The requests already out finish; no new one starts.
    expect(client.functions.invoke.mock.calls.length).toBeLessThanOrEqual(PASS_REQUESTS);
    expect(count(connection.sqlite, 'attempts>0')).toBe(client.functions.invoke.mock.calls.length);
  });
});

describe('route refused (403)', () => {
  const refused = Object.assign(new Error('Phone not assigned to Master'), { context: { status: 403 } });

  test('stops queueing and sending for that receiver, shows it, and 重試 resumes', async () => {
    const connection = createQueueConnection();
    const { sqlite } = connection;
    fill(sqlite, { minutes: 1, slaves: [1] }); // 30 rows of Master 7
    nativeEnqueue(sqlite, { master: 5, slave: 2, receivedAt: T0, payload: telemetry({ mid: 5, sid: 2 }) });
    const database = createUploadDatabase(connection);
    const client = fakeClient(body => (body.master_id === 7 ? { error: refused } : { data: { ok: true, event_id: body.event_id } }));
    expect(await createUploadService({ database, client }).run('alice')).toBe('success');
    // Only the requests already out for Master 7 were refused; the rest wait.
    const sevens = client.functions.invoke.mock.calls.filter(call => call[1].body.master_id === 7).length;
    expect(sevens).toBeLessThanOrEqual(PASS_REQUESTS);
    expect(count(sqlite, "master_id=7 AND status='blocked'")).toBe(sevens);
    expect(count(sqlite, "master_id=7 AND status='pending'")).toBe(30 - sevens);
    expect(count(sqlite, "master_id=5 AND status='sent'")).toBe(1);
    // The receiver service queues nothing more for it, the relay is not kept awake for it.
    expect(nativeEnqueue(sqlite, { receivedAt: T0 + MINUTE, payload: telemetry() })).toBe('refused');
    expect(Object.values(sqlite.prepare(nativeSql('NEXT_RETRY_SQL')).get('alice', 'alice'))[0]).toBeNull();
    expect(await database.pending('alice', Date.now(), 200)).toEqual([]);
    const summary = await database.summary('alice');
    expect(summary.refusedMasters).toEqual([7]);
    expect(summary.error).toContain('7');
    expect(phoneUploadProblem({ ...summary, settingsReady: true }, 7).detail).toContain('7');
    // 重試 tries the receiver again.
    await database.retry('alice');
    expect((await database.summary('alice')).refusedMasters).toEqual([]);
    expect(nativeEnqueue(sqlite, { receivedAt: T0 + 2 * MINUTE, payload: telemetry() })).toBe('queued');
    expect(Object.values(sqlite.prepare(nativeSql('NEXT_RETRY_SQL')).get('alice', 'alice'))[0]).toBe(0);
  });

  test('choosing the route again or a successful send also lifts it', async () => {
    const connection = createQueueConnection();
    const database = createUploadDatabase(connection);
    const row = { owner_user_id: 'alice', master_id: 7, event_id: 'x' };
    await database.refuse(row, 'no', T0);
    await database.setMode('alice', 7, 'phone');
    expect((await database.summary('alice')).refusedMasters).toEqual([]);
    await database.refuse(row, 'no', T0);
    await database.sent(row);
    expect((await database.summary('alice')).refusedMasters).toEqual([]);
  });
});

test('refused rows expire after BLOCKED_KEEP_MS and are bounded to BLOCKED_KEEP_ROWS', async () => {
  const connection = createQueueConnection();
  const { sqlite } = connection;
  const now = T0 + 30 * 24 * 60 * MINUTE;
  nativeEnqueue(sqlite, { receivedAt: now - BLOCKED_KEEP_MS - 1, payload: telemetry() });
  for (let i = 0; i < BLOCKED_KEEP_ROWS + 5; i += 1) nativeEnqueue(sqlite, { receivedAt: now - i, payload: telemetry({ seq: i }) });
  sqlite.exec("UPDATE ble_upload_queue SET status='blocked'");
  nativeEnqueue(sqlite, { receivedAt: now - BLOCKED_KEEP_MS - 1, payload: telemetry() }); // old but waiting: kept
  await createUploadDatabase(connection).prune(now);
  expect(count(sqlite, "status='blocked'")).toBe(BLOCKED_KEEP_ROWS);
  expect(count(sqlite, `status='blocked' AND received_at<${now - BLOCKED_KEEP_MS}`)).toBe(0);
  expect(count(sqlite, "status='pending'")).toBe(1);
});
