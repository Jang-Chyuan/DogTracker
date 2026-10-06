import { createHoldTracker, applyHistoryHolds, fixQuality, distanceMeters, HOLD_CONFIG }
  from '../src/placement/IndoorHold';
import { createHoldStore } from '../src/placement/HoldStore';
import { mergeDogMarkers, describeDogSource, heldLabel, heldSentence } from '../src/map/DogMerge';
import { historyGeometry, createHistoryDatabase, HISTORY_DEFAULTS } from '../src/mapHistory/HistoryDatabase';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { offset } from '../__fixtures__/IndoorScenarios';

const HOME = { latitude: 25, longitude: 121 };
// No environment model in these tests unless one is asked for: the rules must
// hold on fix quality alone.
const silent = () => null;
const good = (time, point = HOME) => ({ time, latitude: point.latitude, longitude: point.longitude,
  satellites: 9, hdop: 0.9, master_id: 7, slave_id: 4 });
const weak = (time, point) => ({ time, latitude: point.latitude, longitude: point.longitude,
  satellites: 4, hdop: 4, master_id: 7, slave_id: 4 });
const none = time => ({ time, latitude: 0, longitude: 0, satellites: 0, hdop: 655.35, master_id: 7, slave_id: 4 });

function run(rows, classify = silent) {
  const tracker = createHoldTracker(HOLD_CONFIG, { classify });
  const events = rows.map(row => tracker.push(row)).filter(Boolean);
  return { tracker, events };
}

test('fix quality: 0,0 has none, legacy rows without quality stay as they were', () => {
  expect(fixQuality(none(1))).toBe('none');
  expect(fixQuality(good(1))).toBe('good');
  expect(fixQuality(weak(1, HOME))).toBe('weak');
  expect(fixQuality({ latitude: 25, longitude: 121 })).toBe('good');
  expect(fixQuality({ ...good(1), hdop: 655.35 })).toBe('good');
  // A raw ×100 HDOP from a collar reads the same as the divided one.
  expect(fixQuality({ ...good(1), hdop: 140 })).toBe('good');
  expect(fixQuality({ ...good(1), hdop: 400 })).toBe('weak');
  expect(fixQuality({ ...good(1), hdop: 65535 })).toBe('good');
});

test('losing the fix holds the dog where its good fixes were, then lets go when it walks off', () => {
  const rows = [];
  for (let second = 0; second <= 60; second += 5) rows.push(good(second * 1000, offset(HOME, second / 10, 0)));
  for (let second = 65; second <= 300; second += 5) rows.push(none(second * 1000));
  const { tracker, events } = run(rows);
  expect(events[0]).toMatchObject({ type: 'start', reason: 'GPS 沒有定位', since: 60000 });
  expect(distanceMeters(tracker.current().coordinate, offset(HOME, 6, 0))).toBeLessThan(5);
  // Walking away: fixes that agree with each other, most rows good.
  const away = [];
  for (let second = 305; second <= 360; second += 5) away.push(good(second * 1000, offset(HOME, 80 + second / 5, 0)));
  const after = away.map(row => tracker.push(row)).filter(Boolean);
  expect(after[0]).toMatchObject({ type: 'end' });
  expect(tracker.current()).toBeNull();
});

test('one good-looking fix through a window neither moves nor releases the hold', () => {
  const rows = [good(0), good(5000), good(10000)];
  for (let second = 15; second <= 200; second += 5) rows.push(none(second * 1000));
  rows.push(good(205000, offset(HOME, 60, 0)));
  for (let second = 210; second <= 400; second += 5) rows.push(none(second * 1000));
  const { tracker, events } = run(rows);
  expect(events.map(event => event.type)).toEqual(['start']);
  expect(distanceMeters(tracker.current().coordinate, HOME)).toBeLessThan(1);
});

test('a collar charging in a moving car is not held: its good fixes keep moving', () => {
  const rows = [];
  for (let second = 0; second <= 600; second += 5) {
    rows.push({ ...good(second * 1000, offset(HOME, second * 15, 0)), usb_present: 1 });
  }
  expect(run(rows).events).toEqual([]);
});

test('weak fixes alone hold only when they stay in one place, so a walk under trees goes on', () => {
  const still = [good(0), good(5000)];
  const walk = [good(0), good(5000)];
  for (let second = 10; second <= 400; second += 5) {
    // Indoors the weak fixes wander around the room; under trees they follow the dog.
    still.push(weak(second * 1000, offset(HOME, 30 * Math.sin(second / 20), 30 * Math.cos(second / 33))));
    walk.push(weak(second * 1000, offset(HOME, second * 1.2, 0)));
  }
  expect(run(still).events[0]).toMatchObject({ type: 'start', reason: 'GPS 訊號弱' });
  expect(run(walk).events).toEqual([]);
});

test('the environment model starts an indoor hold sooner and names it', () => {
  const indoor = () => ({ environment: 'indoor', observedAt: 0 });
  const rows = [good(0), good(5000)];
  for (let second = 10; second <= 60; second += 5) rows.push(none(second * 1000));
  const tracker = createHoldTracker(HOLD_CONFIG, { classify: rows2 => ({ ...indoor(),
    observedAt: Math.max(...rows2.map(row => row.track_at)) }) });
  // The first two-minute window has to finish before the model answers.
  const started = [...rows, none(125000), none(130000), none(150000)]
    .map(row => tracker.push(row)).find(Boolean);
  expect(started).toMatchObject({ type: 'start' });
  expect(tracker.current().reason).toBe('室內');
});

test('history moves the drift between the last good fix and the hold onto the anchor', () => {
  const points = [good(0), good(5000), good(10000)];
  for (let second = 15; second <= 300; second += 5) {
    points.push(weak(second * 1000, offset(HOME, 40 + (second % 3) * 20, 25)));
  }
  const withRaw = points.map(point => ({ ...point, raw_latitude: point.latitude, raw_longitude: point.longitude }));
  const output = applyHistoryHolds(withRaw, { classify: () => ({ environment: 'indoor', observedAt: 1e12 }) });
  const drift = output.filter(point => point.time > 10000);
  expect(drift.length).toBeGreaterThan(0);
  expect(drift.every(point => point.heldReason && distanceMeters(point, HOME) < 1)).toBe(true);
  expect(output[0].heldReason).toBeUndefined();
});

test('history seeds from good fixes before the window, so a night indoors stays put', () => {
  const night = [];
  for (let minute = 600; minute <= 660; minute += 1) night.push(none(minute * 60000));
  const output = applyHistoryHolds(night, { seed: [good(500 * 60000), good(500 * 60000 + 5000)] });
  const drawn = output.filter(point => point.heldReason);
  expect(drawn.length).toBeGreaterThan(50);
  expect(distanceMeters(drawn[drawn.length - 1], HOME)).toBeLessThan(1);
});

test('the store merges a dog heard over BLE and from the cloud, and counts a packet once', () => {
  const store = createHoldStore(HOLD_CONFIG, { classify: silent });
  const rows = [good(0), good(5000)];
  for (let second = 10; second <= 120; second += 5) rows.push(none(second * 1000));
  store.ingest({ rows: [...rows, ...rows.map(row => ({ ...row }))] });
  expect(store.holds(120000)[4]).toMatchObject({ reason: 'GPS 沒有定位' });
  expect(store.holds(120000)[5]).toBeUndefined();
});

describe('the map draws a held dog', () => {
  const NOW = 1_800_000_000_000;
  const hold = { coordinate: { latitude: 25.001, longitude: 121.002 }, reason: '室內', since: NOW - 600000,
    anchorAt: NOW - 600000, source: 'good' };
  const packet = { slave_id: 4, master_id: 7, received_at: NOW, slave_lat: 25.2, slave_lon: 121.3,
    speed_kmh: 3, battery_percentage: 80, battery_valid: 1, source: 'ble', usb_present: 0 };

  test('at its anchor while packets arrive, with the reason and no speed', () => {
    const dog = mergeDogMarkers({ packetRows: [packet], holds: { 4: hold }, now: NOW, windowMs: 180000 })[0];
    expect(dog).toMatchObject({ coordinate: hold.coordinate, heldReason: '室內', heldSince: NOW - 600000,
      lastPositionAt: NOW - 600000, stale: false, speedKmh: null, retained: false });
    expect(heldLabel(dog)).toBe('室內');
    expect(heldSentence(dog, () => '10:12')).toBe('室內・10:12 起');
    expect(describeDogSource(dog)).toContain('室內');
  });

  test('a charging collar keeps its place after packets stop; an unplugged one goes stale', () => {
    const charging = { ...packet, usb_present: 1 };
    const later = NOW + 600000;
    expect(mergeDogMarkers({ packetRows: [charging], holds: { 4: hold }, now: later, windowMs: 180000 })[0])
      .toMatchObject({ coordinate: hold.coordinate, stale: false });
    expect(mergeDogMarkers({ packetRows: [packet], holds: { 4: hold }, now: later, windowMs: 180000 })[0])
      .toMatchObject({ stale: true });
  });

  test('without a hold the dog is drawn as before', () => {
    const dog = mergeDogMarkers({ packetRows: [packet], now: NOW, windowMs: 180000 })[0];
    expect(dog.coordinate).toEqual({ latitude: 25.2, longitude: 121.3 });
    expect(dog.heldReason).toBeUndefined();
  });
});

test('history segments break where a hold starts and ends', () => {
  const points = [{ time: 1000, latitude: 26, longitude: 122 },
    { time: 2000, latitude: 25, longitude: 121, heldReason: '室內', heldSince: 1500 },
    { time: 3000, latitude: 25, longitude: 121, heldReason: '室內', heldSince: 1500 },
    { time: 4000, latitude: 26, longitude: 122 }];
  expect(historyGeometry(points).segments.map(part => part.length)).toEqual([1, 2, 1]);
});

test('SQLite history holds a dog indoors since before the window and leaves stored GPS alone', async () => {
  const db = createMemoryConnection();
  try {
    await createDogDatabase(db).initialize();
    const insert = (time, lat, lon, sats, hdop) => db.executeAsync(`INSERT INTO dog_status(master_id,slave_id,
      received_at,slave_lat,slave_lon,satellites,hdop) VALUES(7,4,?,?,?,?,?)`, [time, lat, lon, sats, hdop]);
    // Good fixes at home an hour before the window, then drifting weak fixes.
    await insert(3600000, 25, 121, 9, 0.9);
    await insert(3605000, 25, 121, 9, 0.9);
    for (let time = 4200000; time < 7200000; time += 30000) await insert(time, 25.0006, 121.0004, 4, 5);
    const preferences = { ...HISTORY_DEFAULTS, phone: false, masters: [7], slaves: [4] };
    const history = createHistoryDatabase(db);
    const result = await history.read(preferences, null, 7200000, () => true, false,
      { since: 6600000, until: 7200000 });
    const rows = result.clients[0].sourcePoints.filter(row => row.latitude || row.longitude);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(row => row.heldReason && distanceMeters(row, HOME) < 1)).toBe(true);
    expect(result.clients[0].latest.heldReason).toBeTruthy();
    const raw = await history.read(preferences, null, 7200000, () => true, true,
      { since: 6600000, until: 7200000 });
    expect(raw.clients[0].rows[0].heldReason).toBeUndefined();
    const stored = await db.executeAsync('SELECT slave_lat FROM dog_status WHERE received_at >= 4200000');
    expect(stored.results.every(row => row.slave_lat === 25.0006)).toBe(true);
  } finally { db.close(); }
});

test('live hold rows: a cold start reads the window and seeds, later polls only new rows', async () => {
  const db = createMemoryConnection();
  try {
    await createDogDatabase(db).initialize();
    const cloud = createCloudDatabase(db);
    await cloud.initialize();
    const insert = (time, lat, sats, hdop) => db.executeAsync(`INSERT INTO dog_status(master_id,slave_id,
      received_at,slave_lat,slave_lon,satellites,hdop) VALUES(7,4,?,?,121,?,?)`, [time, lat, sats, hdop]);
    await insert(1000, 25, 9, 0.9);
    await insert(2000000, 0, 0, 655.35);
    const first = await cloud.holdRows(null, 1000000, null);
    expect(first.rows.map(row => row.time)).toEqual([2000000]);
    expect(first.seeds.map(row => row.time)).toEqual([1000]);
    await insert(2005000, 0, 0, 655.35);
    const next = await cloud.holdRows(null, 1000000, first.cursors);
    expect(next.rows.map(row => row.time)).toEqual([2005000]);
    expect(next.seeds).toEqual([]);
  } finally { db.close(); }
});

test('weak fixes far away release the hold even from a collar reporting every second', () => {
  const rows = [good(0), good(1000), good(2000)];
  for (let second = 3; second <= 120; second += 1) rows.push(none(second * 1000));
  const { tracker, events } = run(rows);
  expect(events[0]).toMatchObject({ type: 'start' });
  const away = [];
  for (let second = 121; second <= 400; second += 1) {
    // Sideways jitter so the fixes never look like a straight walk.
    away.push(weak(second * 1000, offset(HOME, 250 + (second % 7) * 10, (second % 5) * 10)));
  }
  expect(away.map(row => tracker.push(row)).find(event => event?.type === 'end'))
    .toMatchObject({ why: expect.stringMatching(/weak-fixes-away|travelling/) });
});

test('the same lone fix from BLE and from the cloud does not vouch for itself as a seed', () => {
  const tracker = createHoldTracker(HOLD_CONFIG, { classify: silent });
  const reflection = good(1000, offset(HOME, 70, 0));
  tracker.seed([good(0), good(5000), reflection, { ...reflection }].map(row => ({ ...row, time: row.time - 600000 })));
  for (let second = 0; second <= 120; second += 5) tracker.push(none(second * 1000));
  expect(distanceMeters(tracker.current().coordinate, HOME)).toBeLessThan(1);
});

test('rows arriving late are replayed in order instead of dropped', () => {
  const store = createHoldStore(HOLD_CONFIG, { classify: silent });
  const early = [good(0), good(5000)];
  const silence = [];
  for (let second = 10; second <= 120; second += 5) silence.push(none(second * 1000));
  // The silence arrives first (BLE), the good fixes before it later (cloud).
  store.ingest({ rows: silence });
  expect(store.holds(120000)[4]).toBeUndefined();
  store.ingest({ rows: early });
  expect(store.holds(120000)[4]).toMatchObject({ reason: 'GPS 沒有定位' });
});

test('the same measurement relayed by two Masters counts once', () => {
  const rows = [good(0), { ...good(20000), master_id: 9, time: 20000 }];
  // The second row is the first fix relayed by another Master 20 s later.
  rows[1].latitude = rows[0].latitude; rows[1].longitude = rows[0].longitude;
  const tracker = createHoldTracker(HOLD_CONFIG, { classify: silent });
  expect(rows.map(row => tracker.push(row))).toEqual([null, null]);
  for (let second = 25; second <= 120; second += 5) tracker.push(none(second * 1000));
  // One good fix alone never became trusted, so there is nothing to hold at.
  expect(tracker.current()).toBeNull();
});

test('the good-fix buffer stays bounded through on-and-off fixes', () => {
  const tracker = createHoldTracker(HOLD_CONFIG, { classify: silent });
  for (let cycle = 0; cycle < 1000; cycle += 1) {
    const base = cycle * 30000;
    [good(base), good(base + 5000), none(base + 10000)].forEach(row => tracker.push(row));
  }
  expect(tracker.goodFixes().length).toBeLessThanOrEqual(HOLD_CONFIG.anchorFixes * 8);
});

test('one fix relayed by two Masters does not vouch for itself as a seed', () => {
  const reflection = offset(HOME, 70, 0);
  const tracker = createHoldTracker(HOLD_CONFIG, { classify: silent });
  tracker.seed([{ ...good(-600000, reflection), master_id: 9 }, { ...good(-580000, reflection), master_id: 7 }]);
  expect(tracker.goodFixes()).toEqual([]);
});

test('a relayed copy still brings this phone\'s signal and the charger state', () => {
  const tracker = createHoldTracker(HOLD_CONFIG, { classify: silent });
  tracker.push({ ...good(0), source: 'cloud', rssi: -90 });
  tracker.push({ ...good(0), source: 'ble', rssi: -45 });
  expect(tracker.status()).toMatchObject({ bleRssi: -45, bleRssiAt: 0 });
});

test('a late row keeps a long hold where and since when it began', () => {
  const store = createHoldStore(HOLD_CONFIG, { classify: silent });
  store.ingest({ rows: [good(0), good(5000), good(10000)] });
  const silence = [];
  for (let time = 15000; time <= 50 * 60000; time += 10000) silence.push(none(time));
  store.ingest({ rows: silence });
  const before = store.holds(50 * 60000)[4];
  expect(before).toBeTruthy();
  // Another Master uploads a packet from 40 minutes ago.
  store.ingest({ rows: [{ ...none(10 * 60000 + 3000), master_id: 9 }] });
  const after = store.holds(50 * 60000)[4];
  expect(after.since).toBe(before.since);
  expect(distanceMeters(after.coordinate, HOME)).toBeLessThan(1);
});

test('the phone\'s own row coming back from the cloud is the same row, not a late one', () => {
  const store = createHoldStore(HOLD_CONFIG, { classify: silent });
  const rows = [good(0), good(5000), good(10000)];
  for (let time = 15000; time <= 50 * 60000; time += 10000) rows.push(none(time));
  store.ingest({ rows: rows.map(row => ({ ...row, source: 'ble' })) });
  const before = store.holds(50 * 60000)[4];
  store.ingest({ rows: [{ ...rows[rows.length - 30], source: 'cloud' }] });
  expect(store.holds(50 * 60000)[4]).toEqual(before);
});

test('history continued poll by poll matches one pass over the whole window', () => {
  const { continueHistoryHolds } = require('../src/mapHistory/HistoryDatabase');
  const rows = [];
  let id = 0;
  for (let time = 0; time < 40 * 60000; time += 10000) {
    const minute = time / 60000;
    const point = minute < 5 ? offset(HOME, minute * 60, 0)
      : minute < 30 ? null : offset(HOME, 300 + (minute - 30) * 60, 0);
    rows.push({ id: ++id, ...(point ? good(time, point) : weak(time, offset(HOME, 300 + (time % 70000) / 300, (time % 50000) / 400))) });
  }
  const full = applyHistoryHolds(rows);
  const cache = new Map();
  let shown;
  for (let end = 30; end <= rows.length; end += 30) shown = continueHistoryHolds(cache, 'dog', rows.slice(0, end), []);
  shown = continueHistoryHolds(cache, 'dog', rows, []);
  expect(shown.map(row => [row.latitude, row.longitude, row.heldReason ?? null]))
    .toEqual(full.map(row => [row.latitude, row.longitude, row.heldReason ?? null]));
  // The window slides forward: the earlier pass is reused, not restarted.
  const slid = continueHistoryHolds(cache, 'dog', rows.slice(12), []);
  expect(slid.map(row => row.heldReason ?? null)).toEqual(full.slice(12).map(row => row.heldReason ?? null));
});

test('a cold start replays a dog silent for longer than the window, and seeds it', async () => {
  const db = createMemoryConnection();
  try {
    await createDogDatabase(db).initialize();
    const cloud = createCloudDatabase(db);
    await cloud.initialize();
    const insert = (time, lat, sats, hdop) => db.executeAsync(`INSERT INTO dog_status(master_id,slave_id,
      received_at,slave_lat,slave_lon,satellites,hdop) VALUES(7,4,?,?,121,?,?)`, [time, lat, sats, hdop]);
    await insert(1000, 25, 9, 655.35);
    await insert(6000, 25, 9, 0.9);
    for (let time = 600000; time <= 3600000; time += 60000) await insert(time, 0, 0, 655.35);
    // Charging, silent since 3 600 000; the app starts two hours later.
    const batch = await cloud.holdRows(null, 3600000 + 2 * 3600000, null);
    expect(batch.rows.length).toBeGreaterThan(20);
    expect(batch.rows.every(row => row.time >= 3600000 - 30 * 60000)).toBe(true);
    // A missing-HDOP good fix seeds like it counts live.
    expect(batch.seeds.map(row => row.time)).toEqual([6000, 1000]);
  } finally { db.close(); }
});
