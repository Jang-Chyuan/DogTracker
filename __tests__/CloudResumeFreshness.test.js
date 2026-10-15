// F2 (2026-10-15): the last successful download survives the app going away.
// After hours in the background with no network, a cloud dog last seen hours
// ago must not be drawn as current while the downloads keep failing; one
// failed attempt (the network waking up) must not turn every dog grey either.
// The real engine and snapshot, an invented network (audit probe B2).
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { latestArchiveRest, cloudEvent } from '../__fixtures__/LatestArchiveRest';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { createCloudSync } from '../src/cloud/CloudSync';
import { CLOUD_FAILING_GRACE_MS, dogFreshness } from '../src/tracking/DogFreshness';
import { dogMarkers } from '../src/map/DogMarkers';

const NOW = Date.parse('2026-10-10T12:00:00Z');
const OWNER = 'invented-owner';
const MINUTE = 60000;
let archive, latest, engine, current;

async function start(network) {
  archive = createMemoryConnection(); latest = createMemoryConnection();
  await createDogDatabase(archive).initialize();
  const database = createCloudDatabase(archive, { latestConnection: latest });
  engine = createCloudSync({ client: network.client, database,
    downloadContext: async () => { throw new Error('optional context unavailable'); },
    onChange: value => { current = value; } });
  engine.setSession({ user: { id: OWNER } });
  engine.setForeground(true);
  await jest.advanceTimersByTimeAsync(5000);
  expect(current.lastDownloadAt).toBeGreaterThan(0);
}

beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(NOW);
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(async () => {
  await engine?.dispose(); engine = null;
  archive?.close(); latest?.close(); archive = latest = null;
  jest.restoreAllMocks(); jest.useRealTimers();
});

// The dog as the last download before the background left it.
const dog = { slaveId: 6, coordinate: { latitude: 24.9, longitude: 121.3 }, fixAt: NOW - MINUTE, fixSource: 'cloud',
  packetAt: NOW - MINUTE, packetSource: 'cloud' };
const judged = at => dogFreshness(dog, { now: at,
  cloud: { lastDownloadAt: current.lastDownloadAt, failingSince: current.failingSince } });

test('back after two hours with no network: the old cloud position turns stale once downloads keep failing', async () => {
  let offline = false;
  await start(latestArchiveRest({ events: [cloudEvent(1, NOW - MINUTE)],
    beforeRead: async () => { if (offline) throw new TypeError('Network request failed'); } }));
  const downloadedAt = current.lastDownloadAt;
  engine.setForeground(false);
  await jest.advanceTimersByTimeAsync(2 * 3600000);
  offline = true;
  const resumedAt = Date.now();
  engine.setForeground(true);
  await jest.advanceTimersByTimeAsync(5000);
  expect(current.failingSince).not.toBeNull();
  expect(current.lastDownloadAt).toBe(downloadedAt);
  // The first failure: not yet (a waking network often fails once).
  expect(judged(resumedAt + 30000).stale).toBe(false);
  // Still failing a minute on: the 2-hour-old position is stale, with its age.
  const later = judged(resumedAt + CLOUD_FAILING_GRACE_MS + 6000);
  expect(later).toMatchObject({ stale: true, source: 'cloud' });
  expect(later.ageMs).toBeGreaterThan(2 * 3600000);
  // 8 minutes after the resume (audit probe B2: was `stale: false`).
  await jest.advanceTimersByTimeAsync(8 * MINUTE);
  const [marker] = dogMarkers([dog], { now: Date.now(),
    cloud: { lastDownloadAt: current.lastDownloadAt, failingSince: current.failingSince } });
  expect(marker).toMatchObject({ stale: true, problem: true });
});

test('back after two hours, one failed attempt then a success: no dog turns grey', async () => {
  let failures = 0;
  const events = [cloudEvent(1, NOW - MINUTE)];
  await start(latestArchiveRest({ events,
    beforeRead: async () => { if (failures > 0) { failures--; throw new TypeError('Network request failed'); } } }));
  engine.setForeground(false);
  await jest.advanceTimersByTimeAsync(2 * 3600000);
  // The dog kept reporting while the app was away.
  const reportedAt = Date.now() - 20000;
  events.push(cloudEvent(2, reportedAt));
  // The first attempt after the resume fails (the network is still waking up).
  failures = 1;
  const resumedAt = Date.now();
  engine.setForeground(true);
  await jest.advanceTimersByTimeAsync(2000);
  expect(current.failingSince).not.toBeNull();
  const before = [];
  while (current.failingSince != null && Date.now() - resumedAt < 2 * MINUTE) {
    before.push(judged(Date.now()).stale);
    await jest.advanceTimersByTimeAsync(5000);
  }
  // The next 30-second tick got through, well inside the grace minute.
  expect(current.failingSince).toBeNull();
  expect(Date.now() - resumedAt).toBeLessThan(CLOUD_FAILING_GRACE_MS);
  expect(current.lastDownloadAt).toBeGreaterThan(resumedAt);
  expect(before.length).toBeGreaterThan(0);
  expect(before.every(stale => stale === false)).toBe(true);
  // And the position it brought is current.
  expect(dogFreshness({ ...dog, fixAt: reportedAt, packetAt: reportedAt }, { now: Date.now(),
    cloud: { lastDownloadAt: current.lastDownloadAt, failingSince: current.failingSince } }).stale).toBe(false);
});

test('a brief hiccup in front keeps judging by the last download', async () => {
  let offline = false;
  await start(latestArchiveRest({ events: [cloudEvent(1, NOW - MINUTE)],
    beforeRead: async () => { if (offline) throw new TypeError('Network request failed'); } }));
  offline = true;
  await jest.advanceTimersByTimeAsync(3 * MINUTE);
  expect(current.failingSince).not.toBeNull();
  // Failing for minutes, but the last download is recent: as before.
  expect(judged(Date.now()).stale).toBe(false);
});
