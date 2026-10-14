import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { latestArchiveRest, cloudEvent } from '../__fixtures__/LatestArchiveRest';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { createCloudSync } from '../src/cloud/CloudSync';
import { mapDownloadBusy } from '../src/cloud/CloudPublication';
import { createAtomicDogSnapshot } from '../src/map/AtomicDogSnapshot';

// A download on a slow or dead network: each attempt runs up to its 120 s
// timeout, or waits up to 65 s for the sign-in when the access token expired
// while offline. The map used to hold every dog for the whole attempt
// (snapshotPending was set when the attempt started): this phone's own BLE
// dog, its card and its alerts stopped for most of the time.
const NOW = Date.parse('2026-10-15T03:00:00Z');
const OWNER = 'invented-slow-owner';
const MINUTE = 60000;
let archive, latest, engine, timeline, info;

async function start(network) {
  archive = createMemoryConnection(); latest = createMemoryConnection();
  await createDogDatabase(archive).initialize();
  const database = createCloudDatabase(archive, { latestConnection: latest });
  timeline = [];
  engine = createCloudSync({ client: network.client, database,
    downloadContext: async () => { throw new Error('optional context unavailable'); },
    onChange: value => timeline.push({ at: Date.now(), ...value }) });
  engine.setSession({ user: { id: OWNER } }); engine.setForeground(true);
}
// How long the map would hold its dogs (snapshotPending) in [from, to).
function heldMs(from, to) {
  let total = 0, since = null;
  for (const { at, snapshotPending } of timeline) {
    if (snapshotPending && since == null) since = at;
    if (!snapshotPending && since != null) { total += Math.min(at, to) - Math.max(since, from); since = null; }
  }
  return since == null ? total : total + to - Math.max(since, from);
}
const attempts = () => new Set(timeline.map(state => state.mapAttempt).filter(Boolean)).size;

beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(NOW);
  info = jest.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(async () => {
  await engine?.dispose(); engine = null;
  archive?.close(); latest?.close(); archive = latest = null;
  info.mockRestore(); jest.useRealTimers();
});

test('requests that never answer: attempts run and time out, the map never holds its dogs for them', async () => {
  const network = latestArchiveRest({ events: [cloudEvent(1, NOW - 1000)], beforeRead: () => new Promise(() => {}) });
  await start(network);
  await jest.advanceTimersByTimeAsync(10 * MINUTE);
  expect(attempts()).toBeGreaterThanOrEqual(4);
  expect(timeline.some(state => state.busy)).toBe(true);
  // Before: held 480 s of these 600 s.
  expect(heldMs(NOW, NOW + 10 * MINUTE)).toBe(0);
  expect(timeline.at(-1)).toMatchObject({ offline: true, mapSuccessRevision: 0 });
});

test('offline with an expired access token: the 65 s sign-in waits do not hold the map', async () => {
  const network = latestArchiveRest({ events: [cloudEvent(1, NOW - 1000)] });
  network.client.auth.getSession = async () => ({ data: { session: null },
    error: Object.assign(new Error('Network request failed'), { name: 'AuthRetryableFetchError', status: 0 }) });
  await start(network);
  await jest.advanceTimersByTimeAsync(10 * MINUTE);
  expect(network.calls).toHaveLength(0);
  expect(attempts()).toBeGreaterThanOrEqual(4);
  // Before: held 450 s of these 600 s.
  expect(heldMs(NOW, NOW + 10 * MINUTE)).toBe(0);
});

test('a working network holds the map only while the snapshot is published', async () => {
  const network = latestArchiveRest({ events: [cloudEvent(1, NOW - 1000)],
    // Every request takes 2 s: an attempt is several seconds of HTTP.
    beforeRead: () => new Promise(resolve => setTimeout(resolve, 2000)) });
  await start(network);
  await jest.advanceTimersByTimeAsync(5 * MINUTE);
  const successes = timeline.at(-1).mapSuccessRevision;
  expect(successes).toBeGreaterThanOrEqual(5);
  // The publish is local SQLite (no fake time passes), the HTTP is not held.
  expect(heldMs(NOW, NOW + 5 * MINUTE)).toBe(0);
  const pending = timeline.filter(state => state.snapshotPending);
  expect(pending.length).toBeGreaterThan(0);
  expect(timeline.filter(state => state.busy && !state.snapshotPending).length).toBeGreaterThan(pending.length);
});

test('while an attempt waits on the network the BLE dog keeps updating', async () => {
  const network = latestArchiveRest({ events: [cloudEvent(1, NOW - 1000)], beforeRead: () => new Promise(() => {}) });
  await start(network);
  await jest.advanceTimersByTimeAsync(1000);
  const state = { ...timeline.at(-1), latestFirst: true };
  expect(state.busy).toBe(true);
  const gate = createAtomicDogSnapshot();
  const bleRow = time => ({ slave_id: 4, source: 'ble', received_at: time, slave_lat: 24.99, slave_lon: 121.31 });
  const first = gate.select({ owner: OWNER, cloudDogs: { rows: [], packets: [bleRow(NOW)], loaded: true },
    busy: mapDownloadBusy(state) }).cloudDogs;
  const later = gate.select({ owner: OWNER, cloudDogs: { rows: [], packets: [bleRow(NOW + 1000)], loaded: true },
    busy: mapDownloadBusy(state) }).cloudDogs;
  expect(first.packets[0].received_at).toBe(NOW);
  expect(later.packets[0].received_at).toBe(NOW + 1000);
});
