import {
  addRoutePoints, emptyRouteDistance, formatTodayDistance, ROUTE_GAP_MS, startOfToday, todayPill,
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

describe('today\'s distance', () => {
  test('adds up a walk', () => {
    const walk = Array.from({ length: 11 }, (_, index) => north(index * 10, index * 10));
    const sum = addRoutePoints(emptyRouteDistance(), walk);
    expect(sum.count).toBe(11);
    expect(sum.metres).toBeCloseTo(100, 0);
  });

  test('standing still adds nothing: moves inside the fixes\' accuracy do not count', () => {
    const jitter = Array.from({ length: 60 }, (_, index) => north(index % 2 ? 4 : -4, index, 8));
    expect(addRoutePoints(emptyRouteDistance(), jitter).metres).toBe(0);
  });

  test('slow steps add up once they leave the accuracy, not lost one by one', () => {
    // 2 m steps with 5 m accuracy: each step alone is under the accuracy.
    const slow = Array.from({ length: 51 }, (_, index) => north(index * 2, index * 2));
    expect(addRoutePoints(emptyRouteDistance(), slow).metres).toBeGreaterThan(90);
  });

  test('a break longer than 3 minutes is not counted (the map draws no line there)', () => {
    const sum = addRoutePoints(emptyRouteDistance(), [north(0, 0), north(10, 10),
      north(500, 10 + ROUTE_GAP_MS / SECOND + 1), north(510, 10 + ROUTE_GAP_MS / SECOND + 11)]);
    expect(sum.metres).toBeCloseTo(20, 0);
  });

  test('a ride (over 25 km/h) is not counted; the walk on both sides is', () => {
    const walk = [north(0, 0), north(10, 10), north(20, 20)];
    // 2 km in 2 minutes by car, then walking again.
    const ride = [north(1020, 140), north(2020, 260)];
    const after = [north(2030, 270), north(2040, 280)];
    const sum = addRoutePoints(emptyRouteDistance(), [...walk, ...ride, ...after]);
    expect(sum.metres).toBeCloseTo(40, 0);
  });

  test('reading in pages gives the same sum as reading at once', () => {
    const walk = Array.from({ length: 40 }, (_, index) => north(index * 7, index * 5));
    const once = addRoutePoints(emptyRouteDistance(), walk);
    const paged = [walk.slice(0, 13), walk.slice(13, 29), walk.slice(29)]
      .reduce((sum, page) => addRoutePoints(sum, page), emptyRouteDistance());
    expect(paged.metres).toBeCloseTo(once.metres, 6);
    expect(paged.count).toBe(once.count);
  });

  test('rows without a fix and older rows are skipped', () => {
    const sum = addRoutePoints(emptyRouteDistance(), [north(0, 0), { latitude: 0, longitude: 0, time: 5000 },
      { latitude: NaN, longitude: 1, time: 6000 }, north(50, 10), north(30, 5)]);
    expect(sum.count).toBe(2);
    expect(sum.metres).toBeCloseTo(50, 0);
  });

  test('「今天 x km」 in tenths, rounded down (每 0.1 km 更新)', () => {
    expect(formatTodayDistance(0)).toBe('今天 0.0 km');
    expect(formatTodayDistance(99)).toBe('今天 0.0 km');
    expect(formatTodayDistance(2749.9)).toBe('今天 2.7 km');
    expect(formatTodayDistance(2750)).toBe('今天 2.7 km');
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
      .toMatchObject({ text: '未記錄', icon: 'walk-muted', muted: true });
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
      .toMatchObject({ text: '未記錄', icon: 'walk-off' });
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
    expect(first[0]).toEqual({ id: 2, time: day, latitude: 24.99, longitude: 121.31, accuracy: 4 });
    const last = first[first.length - 1];
    const rest = await database.phoneRouteSince(day, { time: last.time, id: last.id }, 3);
    expect(rest.map(row => row.id)).toEqual([5, 6]);
    const sum = [first, rest].reduce(addRoutePoints, emptyRouteDistance(day));
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
    expect(route).toEqual({ count: 2, metres: expect.any(Number) });
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
    expect(route).toEqual({ count: 0, metres: 0 });
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
