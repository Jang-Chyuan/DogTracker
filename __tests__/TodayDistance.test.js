import { t as i18nT } from '../src/i18n';
import {
  formatTodayDistance, startOfToday, todayPill, todayRouteDistance,
} from '../src/tracking/TodayDistance';
import { distanceMeters } from '../src/tracking/ReceiverRange';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createHistoryDatabase } from '../src/mapHistory/HistoryDatabase';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const START = { latitude: 24.9893, longitude: 121.3135 };
// A point `north` metres north of START, `seconds` after t0.
const north = (metres, seconds, accuracy = 5) => ({
  latitude: START.latitude + metres / 111195, longitude: START.longitude, time: seconds * SECOND, accuracy,
});

// The sum of today's rows, as the pill and the history summary count them
// (todayRouteDistance runs the history logic, src/history).
const sumOf = (rows, now = rows.reduce((last, row) => Math.max(last, row.time || 0), 0)) =>
  todayRouteDistance(rows, { now, dayStart: 0 });
const ROUTE_GAP_MS = 3 * MINUTE;

describe('today\'s distance', () => {
  test('adds up a walk', () => {
    const walk = Array.from({ length: 11 }, (_, index) => north(index * 10, index * 10));
    const sum = sumOf(walk);
    expect(sum.count).toBe(11);
    expect(sum.metres).toBeCloseTo(100, 0);
  });

  test('standing still adds nothing: moves inside the fixes\' accuracy do not count', () => {
    const jitter = Array.from({ length: 60 }, (_, index) => north(index % 2 ? 4 : -4, index, 8));
    expect(sumOf(jitter).metres).toBe(0);
  });

  test('slow steps add up once they leave the accuracy, not lost one by one', () => {
    // 2 m steps with 5 m accuracy: each step alone is under the accuracy.
    const slow = Array.from({ length: 51 }, (_, index) => north(index * 2, index * 2));
    expect(sumOf(slow).metres).toBeGreaterThan(90);
  });

  test('a break longer than 3 minutes is not counted (the map draws no line there)', () => {
    const sum = sumOf([north(0, 0), north(10, 10),
      north(500, 10 + ROUTE_GAP_MS / SECOND + 1), north(510, 10 + ROUTE_GAP_MS / SECOND + 11)]);
    expect(sum.metres).toBeCloseTo(20, 0);
  });

  test('a drive (5 m/s for 30 s) is not counted; the walk on both sides is', () => {
    const walk = Array.from({ length: 4 }, (_, index) => north(index * 10, index * 10));
    // 2 km by car at 12.5 m/s, then walking again.
    const drive = Array.from({ length: 16 }, (_, index) => north(30 + (index + 1) * 125, 30 + (index + 1) * 10));
    const after = Array.from({ length: 3 }, (_, index) => north(2030 + (index + 1) * 10, 190 + (index + 1) * 10));
    expect(sumOf([...walk, ...drive, ...after]).metres).toBeCloseTo(60, 0);
  });

  test('before departure the whole day counts; after it, from the departure on', () => {
    // An hour at home with 3 m jitter, then a 15-minute walk at 1.2 m/s.
    const home = Array.from({ length: 360 }, (_, index) => north(index % 2 ? 3 : 0, index * 10));
    const walk = Array.from({ length: 90 }, (_, index) => north(12 * (index + 1), 3600 + (index + 1) * 10));
    const waiting = sumOf(home);
    expect(waiting).toMatchObject({ status: 'not-departed', metres: 0 });
    const out = sumOf([...home, ...walk]);
    expect(out.status).toBe('confirmed');
    // The first fix that is 40 m away 3 minutes later at walking pace: a
    // little before the first step (stops.txt 出發偵測), never the morning.
    expect(out.range.start).toBeGreaterThan(3400 * SECOND);
    expect(out.range.start).toBeLessThanOrEqual(3600 * SECOND);
    expect(out.metres).toBeCloseTo(1080, -1);
  });

  test('rows without a fix and rows after now are skipped', () => {
    const sum = todayRouteDistance([north(0, 0), { latitude: 0, longitude: 0, time: 5000 },
      { latitude: NaN, longitude: 1, time: 6000 }, north(50, 10), north(80, 20)], { now: 10000, dayStart: 0 });
    expect(sum.count).toBe(2);
    expect(sum.metres).toBeCloseTo(50, 0);
  });

  test('「今天 x km」 in tenths, rounded (判定表「距離的四捨五入」)', () => {
    expect(formatTodayDistance(0)).toBe('今天 0.0 km');
    expect(formatTodayDistance(49)).toBe('今天 0.0 km');
    expect(formatTodayDistance(2749.9)).toBe('今天 2.7 km');
    expect(formatTodayDistance(2750)).toBe('今天 2.8 km');
    expect(formatTodayDistance(12345)).toBe('今天 12.3 km');
  });

  test('today starts at local midnight', () => {
    const now = new Date(2026, 9, 7, 9, 30).getTime();
    expect(startOfToday(now)).toBe(new Date(2026, 9, 7).getTime());
  });
});

describe('the pill (判定表「右下『今天 x km』」)', () => {
  const route = { count: 300, metres: 2700 };
  const precise = { permission: 'precise', services: true, busy: false };
  const recording = { running: true, position: START, ageSeconds: 2 };

  // 067: the icon turned grey with every permission given. A check that is
  // still running or failed says nothing; only a known problem greys it.
  test('a passing or failed permission check never greys the walker', () => {
    for (const phone of [{ ...precise, busy: true }, { permission: 'checking', services: false },
      { ...precise, error: 'not attached to an Activity' }, { ...precise, services: false, error: 'x' }]) {
      expect(todayPill({ route, livePhone: recording, phone })).toMatchObject({ icon: 'walk', muted: false });
    }
    // Known problems still do.
    expect(todayPill({ route, livePhone: recording, phone: { ...precise, services: false } }).icon).toBe('walk-off');
    expect(todayPill({ route, livePhone: recording, phone: { ...precise, permission: 'approximate' } }).icon)
      .toBe('walk-off');
    expect(todayPill({ route, livePhone: { ...recording, ageSeconds: 11 * 60 }, phone: precise }).icon).toBe('walk-off');
    expect(todayPill({ route, livePhone: { running: false }, phone: precise }).icon).toBe('walk-muted');
  });

  // 067 (user 2026-10-09, captured live: indoors, the GPS fix 8 minutes old
  // at 238 m): weak indoor GPS is not 「記錄關閉」 — the walker stays as it is
  // when the last fix was taken standing still; it is slashed after losing
  // the fix while moving.
  test('weak indoor GPS: the walker stays normal', () => {
    const indoors = { running: true, ageSeconds: 30 * 60, position: { ...START, rawSpeedKmh: 0 } };
    expect(todayPill({ route, livePhone: indoors, phone: precise })).toMatchObject({ icon: 'walk', muted: false });
    const lostWhileWalking = { running: true, ageSeconds: 11 * 60, position: { ...START, rawSpeedKmh: 4.5 } };
    expect(todayPill({ route, livePhone: lostWhileWalking, phone: precise }).icon).toBe('walk-off');
    const unknownSpeed = { running: true, ageSeconds: 11 * 60, position: START };
    expect(todayPill({ route, livePhone: unknownSpeed, phone: precise }).icon).toBe('walk-off');
  });

  test('recording: walker in the phone colour and today\'s distance', () => {
    expect(todayPill({ route, livePhone: recording, phone: precise }))
      .toMatchObject({ text: '今天 2.7 km', icon: 'walk', muted: false, label: '今天 2.7 公里' });
  });

  test('recording with nothing yet today: 今天 0.0 km', () => {
    expect(todayPill({ route: { count: 0, metres: 0 }, livePhone: recording, phone: precise }))
      .toMatchObject({ text: '今天 0.0 km', icon: 'walk' });
  });

  test('recording off: grey walker, the same distance in grey; nothing today: 未記錄', () => {
    const off = { running: false };
    expect(todayPill({ route, livePhone: off, phone: precise }))
      .toMatchObject({ text: '今天 2.7 km', icon: 'walk-muted', muted: true });
    expect(todayPill({ route: { count: 0, metres: 0 }, livePhone: off, phone: precise }))
      .toMatchObject({ text: i18nT('c309'), icon: 'walk-muted', muted: true });
  });

  test.each([
    [{ permission: 'denied', services: true }, '沒有定位權限'],
    [{ permission: 'blocked', services: true }, '沒有定位權限'],
    [{ permission: 'approximate', services: true }, '只給了大概位置'],
    [{ permission: 'precise', services: false }, '定位服務關著'],
  ])('%o: the grey walker with a slash, no yellow dot', (state, reason) => {
    const off = { running: false };
    expect(todayPill({ route, livePhone: off, phone: { ...state, busy: false } }))
      .toMatchObject({ text: '今天 2.7 km', icon: 'walk-off', muted: true, label: `今天 2.7 公里，${reason}` });
    expect(todayPill({ route: { count: 0, metres: 0 }, livePhone: off, phone: { ...state, busy: false } }))
      .toMatchObject({ text: i18nT('c309'), icon: 'walk-off' });
  });

  test('no GPS for over 10 minutes while recording: slash; under 10 minutes the icon stays', () => {
    expect(todayPill({ route, livePhone: { ...recording, ageSeconds: 9 * 60 }, phone: precise }).icon).toBe('walk');
    expect(todayPill({ route, livePhone: { ...recording, ageSeconds: 11 * 60 }, phone: precise }))
      .toMatchObject({ icon: 'walk-off', text: '今天 2.7 km', label: '今天 2.7 公里，手機沒有定位' });
  });

  test('recording without a first fix waits 10 minutes before the slash too', () => {
    const now = 1000 * MINUTE;
    const waiting = { running: true, position: null, ageSeconds: null };
    expect(todayPill({ route, livePhone: waiting, phone: precise, now, waitingSince: now - 9 * MINUTE }).icon)
      .toBe('walk');
    expect(todayPill({ route, livePhone: waiting, phone: precise, now, waitingSince: now - 11 * MINUTE }).icon)
      .toBe('walk-off');
    expect(todayPill({ route, livePhone: waiting, phone: precise }).icon).toBe('walk');
  });

  test('before the first reads nothing flashes: no pill until the route is read, then no grey or 未記錄', () => {
    expect(todayPill({ route: null, livePhone: recording, phone: precise })).toBeNull();
    expect(todayPill({ route, livePhone: null, phone: { permission: 'checking', services: false } }))
      .toMatchObject({ text: '今天 2.7 km', icon: 'walk', muted: false });
  });
});

describe('reading today\'s route from myLocationTracker', () => {
  test('pages of new rows after a cursor, oldest first, from midnight on', async () => {
    const connection = createMemoryConnection();
    const database = createHistoryDatabase(connection);
    expect(await database.phoneRouteSince(0)).toEqual([]);
    connection.sqlite.exec(`CREATE TABLE myLocationTracker(id INTEGER PRIMARY KEY, recorded_at INTEGER,
      location_at INTEGER, latitude REAL, longitude REAL, accuracy_meters REAL, speed_kmh REAL)`);
    const day = 10 * 60 * MINUTE;
    const insert = connection.sqlite.prepare('INSERT INTO myLocationTracker VALUES(?,?,?,?,?,?,?)');
    insert.run(1, day - MINUTE, day - MINUTE, 24.98, 121.31, 5, 3);
    for (let index = 0; index < 5; index += 1)
      insert.run(index + 2, day + index * 5 * SECOND, day + index * 5 * SECOND, 24.99 + index * 0.0001, 121.31, 4, 3);
    const first = await database.phoneRouteSince(day, null, 3);
    expect(first.map(row => row.id)).toEqual([2, 3, 4]);
    expect(first[0]).toEqual({ id: 2, time: day, latitude: 24.99, longitude: 121.31, accuracy: 4,
      raw_speed_kmh: null, speed_accuracy_mps: null });
    const last = first[first.length - 1];
    const rest = await database.phoneRouteSince(day, { time: last.time, id: last.id }, 3);
    expect(rest.map(row => row.id)).toEqual([5, 6]);
    const sum = todayRouteDistance([...first, ...rest], { now: day + MINUTE, dayStart: day });
    expect(sum.metres).toBeCloseTo(distanceMeters(first[0], rest[1]), 0);
    connection.close();
  });
});

describe('useTodayRoute', () => {
  const React = require('react');
  const Renderer = require('react-test-renderer');
  const { act } = Renderer;
  const { useTodayRoute, TODAY_ROUTE_POLL_MS } = require('../src/locationTracker/useTodayRoute');

  test('adds only new rows each poll, and starts over at midnight', async () => {
    jest.useFakeTimers();
    let clock = new Date(2026, 9, 7, 9, 30).getTime();
    const day = new Date(2026, 9, 7).getTime();
    let rows = [{ id: 1, ...north(0, 0), time: day + 1000 }, { id: 2, ...north(100, 0), time: day + 61000 }];
    const calls = [];
    const database = {
      phoneRouteSince: jest.fn(async (since, cursor) => {
        calls.push({ since, cursor });
        return rows.filter(row => row.time >= since
          && (!cursor || row.time > cursor.time || (row.time === cursor.time && row.id > cursor.id)));
      }),
    };
    let route;
    function Probe() {
      route = useTodayRoute(database, true, true, () => clock);
      return null;
    }
    let renderer;
    await act(async () => { renderer = Renderer.create(React.createElement(Probe)); });
    expect(route).toEqual({ count: 2, metres: expect.any(Number), status: 'not-departed' });
    expect(route.metres).toBeCloseTo(100, 0);
    rows = [...rows, { id: 3, ...north(200, 0), time: day + 121000 }];
    await act(async () => jest.advanceTimersByTimeAsync(TODAY_ROUTE_POLL_MS));
    expect(calls.at(-1).cursor).toEqual({ time: day + 61000, id: 2 });
    expect(route.count).toBe(3);
    expect(route.metres).toBeCloseTo(200, 0);
    // Past midnight: tomorrow has nothing yet.
    clock = new Date(2026, 9, 8, 0, 1).getTime();
    await act(async () => jest.advanceTimersByTimeAsync(TODAY_ROUTE_POLL_MS));
    expect(calls.at(-1)).toEqual({ since: new Date(2026, 9, 8).getTime(), cursor: null });
    expect(route).toEqual({ count: 0, metres: 0, status: 'not-departed' });
    await act(async () => renderer.unmount());
    jest.useRealTimers();
  });

  // O4 (lane C, 061c/061d): S4 said 「今天 0 筆」 after 刪除我的路線 while the
  // recorder had already written new fixes — the count waited for the map's
  // 15 s poll. On S4 the count reads every 2 s, and switching to S4 reads now.
  test('S4 reads new fixes within its short poll, and a poll change reads at once', async () => {
    jest.useFakeTimers();
    const { TODAY_COUNT_POLL_MS } = require('../src/locationTracker/useTodayRoute');
    expect(TODAY_COUNT_POLL_MS).toBeLessThanOrEqual(2000);
    const clock = new Date(2026, 9, 7, 9, 30).getTime();
    const day = new Date(2026, 9, 7).getTime();
    let rows = [];
    const database = {
      phoneRouteSince: jest.fn(async (since, cursor) => rows.filter(row => row.time >= since
        && (!cursor || row.time > cursor.time || (row.time === cursor.time && row.id > cursor.id)))),
    };
    let route;
    let setPoll;
    function Probe() {
      const [pollMs, set] = React.useState(TODAY_ROUTE_POLL_MS);
      setPoll = set;
      route = useTodayRoute(database, true, true, () => clock, pollMs);
      return null;
    }
    let renderer;
    await act(async () => { renderer = Renderer.create(React.createElement(Probe)); });
    expect(route.count).toBe(0);
    rows = [{ id: 1, ...north(0, 0), time: day + 1000 }];
    // Switching to S4: read at once, not after the map's 15 s.
    const before = database.phoneRouteSince.mock.calls.length;
    await act(async () => setPoll(TODAY_COUNT_POLL_MS));
    expect(database.phoneRouteSince.mock.calls.length).toBeGreaterThan(before);
    expect(route.count).toBe(1);
    rows = [...rows, { id: 2, ...north(10, 0), time: day + 11000 }];
    await act(async () => jest.advanceTimersByTimeAsync(TODAY_COUNT_POLL_MS));
    expect(route.count).toBe(2);
    await act(async () => renderer.unmount());
    jest.useRealTimers();
  });
});

test('a bottom hint sits above the bottom row (「今天 x km」 beside 我的位置)', () => {
  const { edgeHints } = require('../src/map/EdgeHints');
  const marker = { slaveId: 4, coordinate: START, problem: false, stale: false, tag: { text: '豆豆' } };
  const view = { width: 392, height: 830, top: 100, bottom: 40 };
  const [plain] = edgeHints([marker], { 4: { x: 150, y: 1200 } }, view);
  const [raised] = edgeHints([marker], { 4: { x: 150, y: 1200 } }, { ...view, bottomRow: 48 });
  expect(plain.side).toBe('bottom');
  expect(raised.y + raised.height).toBeLessThanOrEqual(830 - 40 - 48 - 12);
});

