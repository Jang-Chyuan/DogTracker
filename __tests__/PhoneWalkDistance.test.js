import { countDistances, historyEdge, odometerAt } from '../src/history/HistoryMovement';
import { configFor, distanceMeters } from '../src/history/HistoryConfig';
import { historyTimeline } from '../src/history/HistoryTimeline';
import { todayRouteDistance } from '../src/tracking/TodayDistance';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createHistoryDatabase } from '../src/mapHistory/HistoryDatabase';

// 2026-10-13 (user, distance): a walk's distance on my route. Fictional
// fixes x metres north, y metres east of an invented point near Taoyuan
// Station; no real place, time or person.
const base = 1600000000000;
const config = configFor('phone');
const ORIGIN = { latitude: 24.989, longitude: 121.313 };
const place = (north, east) => ({ latitude: ORIGIN.latitude + north / 111195,
  longitude: ORIGIN.longitude + east / (111195 * Math.cos(ORIGIN.latitude * Math.PI / 180)) });
// A fix as the history logic sees it after the phone motion replay.
const fix = (seconds, north, east, extra = {}) => ({ time: base + seconds * 1000, ...place(north, east),
  accuracy: 4, raw_speed_kmh: 4.3, speed_kmh: 4.3, speed_accuracy_mps: 0.2, motion_state: 'moving',
  phoneMotionState: 'moving', phoneStationary: false, phoneConfirmedMovement: false,
  session_id: 'fiction-walk', ...extra });
const edgesOf = points => points.slice(1).map((to, i) => historyEdge(points[i], to, 'phone', config));
const count = (points, cfg = config) => countDistances(edgesOf(points), cfg)
  .reduce((sum, e) => sum + e.countedDistanceM, 0);
const path = points => points.slice(1).reduce((sum, p, i) => sum + distanceMeters(points[i], p), 0);
// A walk every 5 s at `speed` m/s around a circle of `radius` metres.
const circle = (n, { speed = 0.8, radius = 15, every = 5, extra = () => ({}) } = {}) =>
  Array.from({ length: n }, (_, i) => {
    const angle = (speed * i * every) / radius;
    return fix(i * every, radius * Math.sin(angle), radius * (1 - Math.cos(angle)),
      { raw_speed_kmh: speed * 3.6, speed_kmh: speed * 3.6, ...extra(i, angle) });
  });

describe('a confirmed walk on fine fixes counts from 2 m', () => {
  test('4 m steps of a slow walk count each, not every other chord', () => {
    const walk = circle(40);
    expect(count(walk)).toBeGreaterThan(path(walk) * 0.99);
    expect(count(walk, { ...config, fineMoveM: null })).toBeLessThan(count(walk) - 2);
  });

  test.each([
    ['coarser than 10 m', { accuracy: 12 }],
    ['a speed only its spread away from 0.5 m/s', { raw_speed_kmh: 2, speed_kmh: 2, speed_accuracy_mps: 0.5 }],
    ['not in the moving state', { phoneMotionState: 'suspected_stationary' }],
  ])('%s keeps the 5 m threshold', (label, extra) => {
    const walk = circle(40, { extra: () => extra });
    expect(count(walk)).toBeCloseTo(count(walk, { ...config, fineMoveM: null }), 6);
  });

  test('a phone wobbling in place while it claims a walking speed counts nothing', () => {
    const wobble = Array.from({ length: 60 }, (_, i) => fix(i * 5, (i % 2 ? 1.6 : -1.6), (i % 3) - 1));
    expect(count(wobble)).toBe(0);
  });

  test('the step into a stop still counts what the walk added', () => {
    const walk = [fix(0, 0, 0), fix(5, 4, 0), fix(10, 8, 0, { raw_speed_kmh: 0, speed_kmh: 0 })];
    expect(count(walk)).toBeCloseTo(8, 3);
  });
});

describe('confirmed movement on coarse fixes with no walking speed', () => {
  // At home (stationary), then a "departure" on Wi-Fi/elevator fixes of 27–40 m
  // claiming 15–27 km/h, 30–60 m off, then home again on a fine fix.
  const home = Array.from({ length: 12 }, (_, i) => fix(i * 5, 0, 0,
    { raw_speed_kmh: 0, speed_kmh: 0, phoneMotionState: 'stationary', phoneStationary: true }));
  const junk = [[33, 23.9, 18, 8], [27, 15.2, 30, 10], [40, 26.8, 55, 20], [28, 20.4, 12, -40]]
    .map(([accuracy, kmh, north, east], i) => fix(60 + (i + 1) * 5, north, east,
      { accuracy, raw_speed_kmh: kmh, speed_kmh: kmh, speed_accuracy_mps: 2.5, phoneConfirmedMovement: true }));
  const back = [fix(90, 1, 1, { accuracy: 5, raw_speed_kmh: 0.5, speed_kmh: 0.5 }),
    fix(95, 0, 1, { raw_speed_kmh: 0, speed_kmh: 0, phoneMotionState: 'stationary', phoneStationary: true })];

  test('count nothing (and before this rule they did)', () => {
    expect(count([...home, ...junk, ...back])).toBe(0);
    // 2026-10-14: back home within minutes, never 100 m away, no fine walk:
    // a drift trip as well (countEdge), so each rule alone counts nothing.
    expect(count([...home, ...junk, ...back], { ...config, coarseConfirmedAccuracyM: null })).toBe(0);
    expect(count([...home, ...junk, ...back], { ...config, driftWalkFixes: null })).toBe(0);
    expect(count([...home, ...junk, ...back], { ...config, coarseConfirmedAccuracyM: null, driftWalkFixes: null }))
      .toBeGreaterThan(20);
  });

  test('a real walk after them is counted from home', () => {
    const walk = Array.from({ length: 30 }, (_, i) => fix(100 + i * 5, 1, 2 + (i + 1) * 6,
      { raw_speed_kmh: 4.3, speed_kmh: 4.3 }));
    const counted = count([...home, ...junk, ...walk]);
    expect(counted).toBeGreaterThan(170);
    expect(counted).toBeLessThan(185);
  });

  test('a coarse walk measuring a walking speed of its own still counts', () => {
    const walk = Array.from({ length: 60 }, (_, i) => fix(60 + i * 5, (i + 1) * 4, 0,
      { accuracy: 40, raw_speed_kmh: 2.88, speed_kmh: 2.88, speed_accuracy_mps: 0.4, phoneConfirmedMovement: true }));
    expect(count([...home, ...walk])).toBeGreaterThan(200);
  });
});

describe('the recorder\'s per-second odometer (odometer_m)', () => {
  // The 1 s path of a circle of 15 m at 1.2 m/s: 6 m per 5 s on the arc.
  const arc = (extra = () => ({})) => circle(30, { speed: 1.2, extra: (i, angle) => ({
    odometer_m: 1000 + angle * 15, ...extra(i) }) });

  test('a walk counts its per-second path, not the chords', () => {
    const walk = arc();
    const odometer = odometerAt(walk.at(-1)) - odometerAt(walk[0]);
    expect(count(walk)).toBeCloseTo(odometer, 6);
    expect(count(walk)).toBeGreaterThan(path(walk) + 1);
  });

  test('another session, no value or a smaller value keeps the chord', () => {
    const chords = count(arc(() => ({ odometer_m: null })));
    expect(chords).toBeCloseTo(path(arc()), 6);
    expect(count(arc(i => ({ session_id: `fiction-${i}` })))).toBeCloseTo(chords, 6);
    expect(count(arc(i => ({ odometer_m: 1000 + i * 0.5 })))).toBeCloseTo(chords, 6);
  });

  test('never more than 1.5 × the chord plus 5 m, nor the speed budget', () => {
    const wild = arc(i => ({ odometer_m: 1000 + i * 100 }));
    const counted = count(wild);
    expect(counted).toBeLessThanOrEqual(path(wild) * 1.5 + 5 * (wild.length - 1) + 1e-6);
    // The speeds add up to 1.2 m/s × 145 s: 1.5 × that plus 5 m per step.
    expect(counted).toBeLessThanOrEqual(1.2 * 145 * 1.5 + 5 * 29 + 1e-6);
  });

  test('odometerAt reads a number of metres or nothing', () => {
    expect(odometerAt({ odometer_m: 12.5 })).toBe(12.5);
    expect(odometerAt({ odometer_m: '7' })).toBe(7);
    for (const value of [undefined, null, '', -1, 'x']) expect(odometerAt({ odometer_m: value })).toBeNull();
  });
});

describe('my route with the odometer, end to end', () => {
  // Recorder rows: 3 minutes at home, then 10 minutes walking a square of
  // 60 m sides at 1.2 m/s, a fix every 5 s, the odometer the 1 s path.
  function rows({ odometer = true } = {}) {
    const out = [];
    let travelled = 0;
    const row = (seconds, north, east, kmh, extra = {}) => out.push({ id: out.length + 1, time: base + seconds * 1000,
      ...place(north, east), accuracy: 4, raw_latitude: place(north, east).latitude,
      raw_longitude: place(north, east).longitude, raw_speed_kmh: kmh, speed_kmh: kmh, speed_accuracy_mps: 0.2,
      motion_state: kmh ? 'moving' : 'stationary', session_id: 'fiction-walk',
      ...(odometer ? { odometer_m: travelled } : {}), ...extra });
    for (let s = 0; s < 180; s += 5) row(s, ((s / 5) % 3) * 0.3, 0, 0);
    const corner = d => { const side = Math.floor(d / 60) % 4, along = d % 60;
      return [[along, 0], [60, along], [60 - along, 60], [0, 60 - along]][side]; };
    for (let s = 5; s <= 600; s += 5) {
      travelled = 1.2 * s;
      const [north, east] = corner(1.2 * s);
      row(180 + s, north, east, 4.32);
    }
    return out;
  }
  const model = list => historyTimeline(list, { subject: 'phone', dayStart: base - 3600000,
    dayEnd: base + 82800000, today: true, now: list.at(-1).time + 1000 });

  test('the walk counts the odometer\'s path, and 「今天 x km」 agrees with the history', () => {
    const withOdometer = rows(), without = rows({ odometer: false });
    const history = model(withOdometer).distanceM;
    expect(history).toBeGreaterThan(model(without).distanceM);
    expect(history).toBeLessThanOrEqual(720 + 1e-6);
    expect(history).toBeGreaterThan(690);
    const now = withOdometer.at(-1).time + 1000;
    expect(todayRouteDistance(withOdometer, { now, dayStart: base - 3600000 }).metres).toBeCloseTo(history, 6);
  });

  test('phoneRouteSince and historyDayRows read the session and the odometer', async () => {
    const connection = createMemoryConnection();
    const database = createHistoryDatabase(connection);
    connection.sqlite.exec(`CREATE TABLE myLocationTracker(id INTEGER PRIMARY KEY, recorded_at INTEGER,
      location_at INTEGER, latitude REAL, longitude REAL, accuracy_meters REAL, speed_kmh REAL,
      raw_speed_kmh REAL, speed_accuracy_mps REAL, session_id TEXT, odometer_m REAL)`);
    const insert = connection.sqlite.prepare('INSERT INTO myLocationTracker VALUES(?,?,?,?,?,?,?,?,?,?,?)');
    insert.run(1, base, base, ORIGIN.latitude, ORIGIN.longitude, 4, 4.3, 4.3, 0.2, 'fiction-walk', 12.5);
    insert.run(2, base + 5000, base + 5000, ORIGIN.latitude, ORIGIN.longitude, 4, 4.3, 4.3, 0.2, 'fiction-walk', null);
    const route = await database.phoneRouteSince(base - 1000);
    expect(route[0]).toMatchObject({ session_id: 'fiction-walk', odometer_m: 12.5 });
    // A row the recorder wrote without one: null, as on historyDayRows' rows.
    expect(route[1]).toMatchObject({ odometer_m: null });
    const { rows: day } = await database.historyDayRows({ subject: 'phone', start: base - 1000, end: base + 86400000 });
    expect(day[0]).toMatchObject({ session_id: 'fiction-walk', odometer_m: 12.5 });
    connection.close();
  });

  test('a column the recorder adds after the first read (an app update) is read from then on', async () => {
    const connection = createMemoryConnection();
    const database = createHistoryDatabase(connection);
    connection.sqlite.exec(`CREATE TABLE myLocationTracker(id INTEGER PRIMARY KEY, recorded_at INTEGER,
      location_at INTEGER, latitude REAL, longitude REAL, accuracy_meters REAL, speed_kmh REAL,
      raw_speed_kmh REAL, speed_accuracy_mps REAL, session_id TEXT)`);
    connection.sqlite.prepare('INSERT INTO myLocationTracker VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(1, base, base, ORIGIN.latitude, ORIGIN.longitude, 4, 4.3, 4.3, 0.2, 'fiction-walk');
    expect((await database.phoneRouteSince(base - 1000))[0]).not.toHaveProperty('odometer_m');
    connection.sqlite.exec('ALTER TABLE myLocationTracker ADD COLUMN odometer_m REAL');
    connection.sqlite.prepare('INSERT INTO myLocationTracker VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(2, base + 5000, base + 5000, ORIGIN.latitude, ORIGIN.longitude, 4, 4.3, 4.3, 0.2, 'fiction-walk', 6.5);
    expect((await database.phoneRouteSince(base - 1000))[1]).toMatchObject({ odometer_m: 6.5 });
    connection.close();
  });
});
