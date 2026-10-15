/* eslint-env node, jest */
// An outage and its recovery, on the real queue SQL (BleUploadQueue.kt) and
// the real upload service, with a simulated clock: two dogs every 2 s (one
// packet a second), eight hours without a network, then passes as the
// receiver relay runs them (a pass, then 10 s until the next) against an
// ingest function answering in 0.5 s.
import { createUploadDatabase } from '../src/cloudUpload/UploadDatabase';
import { createUploadService, PASS_REQUESTS } from '../src/cloudUpload/UploadService';
import { createQueueConnection, fakeClient, nativeEnqueue, nativeNumber, telemetry } from '../test-support/NativeUploadQueue';

const SECOND = 1000, MINUTE = 60 * SECOND, HOUR = 60 * MINUTE;
const T0 = Date.UTC(2026, 9, 1, 0, 0, 0);
const OUTAGE = 8 * HOUR, REQUEST_MS = 500, COOLDOWN_MS = 10 * SECOND, PRODUCE_EVERY = 2 * SECOND;

test('an eight-hour outage: nothing new is refused, the oldest are thinned, and the backlog clears', async () => {
  const connection = createQueueConnection();
  const { sqlite } = connection;
  let produced = T0;
  // The receiver service's packets up to `until`: dogs 1 and 2 every 2 s.
  const produce = until => {
    for (; produced < until; produced += PRODUCE_EVERY) {
      for (const slave of [1, 2]) {
        expect(nativeEnqueue(sqlite, { slave, receivedAt: produced, payload: telemetry({ sid: slave, seq: (produced / 1000) % 65536 }) }))
          .toBe('queued');
      }
    }
  };
  produce(T0 + OUTAGE);
  const cap = nativeNumber('CAP');
  const pending = () => sqlite.prepare("SELECT COUNT(*) n FROM ble_upload_queue WHERE status='pending'").get().n;
  expect(pending()).toBeLessThanOrEqual(cap + nativeNumber('CHECK_EVERY'));
  // The newest hour is whole; every minute still has each dog.
  const perMinute = sqlite.prepare(`SELECT COUNT(DISTINCT received_at/60000) n FROM ble_upload_queue WHERE slave_id=?`);
  expect(perMinute.get(1).n).toBe(OUTAGE / MINUTE);
  expect(sqlite.prepare('SELECT COUNT(*) n FROM ble_upload_queue WHERE received_at>=?').get(T0 + OUTAGE - HOUR).n).toBe(2 * HOUR / PRODUCE_EVERY);

  // Back online.
  let clock = T0 + OUTAGE;
  const sent = new Set(), delivered = new Set();
  const client = fakeClient(body => {
    // Each event once: no row is sent twice.
    expect(sent.has(body.event_id)).toBe(false);
    sent.add(body.event_id);
    delivered.add(`${body.slave_id}:${Math.floor(Date.parse(body.phone_received_at) / MINUTE)}`);
    return { data: { ok: true, event_id: body.event_id } };
  });
  const service = createUploadService({ database: createUploadDatabase(connection), client, now: () => clock });
  const start = pending();
  while (clock < T0 + OUTAGE + 6 * HOUR) {
    const before = client.functions.invoke.mock.calls.length;
    await service.run('alice');
    const requests = client.functions.invoke.mock.calls.length - before;
    clock += Math.ceil(requests / PASS_REQUESTS) * REQUEST_MS + COOLDOWN_MS;
    produce(clock);
    // Cleared: what is left is the fresh packets of about one pass.
    if (pending() <= 40) break;
  }
  const recovery = clock - T0 - OUTAGE;
  // The drain clearly beats production (5+ events/s against 1/s).
  expect(pending()).toBeLessThanOrEqual(40);
  expect(recovery).toBeLessThan(90 * MINUTE);
  // Every minute of the outage reached the cloud for both dogs.
  for (const slave of [1, 2]) {
    for (let minute = T0 / MINUTE; minute < (T0 + OUTAGE) / MINUTE; minute += 1) {
      expect(delivered.has(`${slave}:${minute}`)).toBe(true);
    }
  }
  // (Today: a backlog of about 18,800 clears in about an hour. With the old
  // 20-event passes the drain was about production, so it never cleared.)
  expect(start).toBeGreaterThan(cap - nativeNumber('THIN_BATCH') - 100);
}, 180000);
