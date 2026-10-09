import { performance } from 'perf_hooks';
import { createTodayRouteEngine } from '../src/tracking/TodayRouteEngine';
import { todayRouteDistance, startOfToday } from '../src/tracking/TodayDistance';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const DAY_START = startOfToday(new Date(2026, 9, 9, 12, 0).getTime());

// A deterministic pseudo-random generator, so a failing day can be replayed.
function random(seed) {
  let x = seed % 2 ** 32;
  return () => {
    x = (x * 1664525 + 1013904223) % 2 ** 32;
    return x / 2 ** 32;
  };
}

/**
 * A simulated day of my route around Taoyuan station: legs of walking, stays
 * (position drift inside the accuracy), drives (fast enough to be a car),
 * breaks in the recording, and the odd bad row (no fix, a far jump, a poor
 * accuracy, the same time twice). Rows as phoneRouteSince reads them.
 */
function simulatedDay(seed, { legs = 30, step = 1, start = 7 * 60 } = {}) {
  const r = random(seed);
  const rows = [];
  let time = DAY_START + start * MINUTE;
  let lat = 24.9893, lon = 121.3135, heading = r() * 2 * Math.PI;
  let id = 0;
  // The phone's own measured speed (067's distance budget), missing now and then.
  let measured = 0;
  const push = (latitude, longitude, accuracy) => rows.push({ id: ++id, time, latitude, longitude, accuracy,
    raw_speed_kmh: r() < 0.05 ? null : measured * 3.6 * (0.8 + r() * 0.4), speed_accuracy_mps: 0.5 });
  for (let leg = 0; leg < legs; leg += 1) {
    const kind = r();
    const seconds = Math.round((kind < 0.15 ? 1 + r() * 2 : 3 + r() * 20) * 60);
    const speed = kind < 0.4 ? 0 : kind < 0.75 ? 0.8 + r() * 1.2 : kind < 0.9 ? 6 + r() * 12 : 4 + r() * 1.5;
    if (r() < 0.08) time += Math.round((3 + r() * 40) * MINUTE); // a break in the recording
    measured = speed;
    for (let s = 0; s < seconds; s += step) {
      heading += (r() - 0.5) * 0.3;
      const d = speed * step;
      lat += (Math.cos(heading) * d) / 110540;
      lon += (Math.sin(heading) * d) / (111320 * Math.cos((lat * Math.PI) / 180));
      const drift = speed === 0 ? 6 : 2;
      const odd = r();
      if (odd < 0.004) push(0, 0, 5);
      else if (odd < 0.008) push(lat + 0.05, lon, 5); // a jump far beyond 50 m/s
      else if (odd < 0.015) push(lat, lon, 60 + r() * 100); // poor accuracy
      else push(lat + ((r() - 0.5) * drift) / 110540, lon + ((r() - 0.5) * drift) / 111320, 3 + r() * 12);
      if (odd > 0.995) push(lat, lon, 4); // the same time again
      time += step * SECOND;
    }
  }
  return rows;
}

// Feed the rows in batches of random size and compare every answer.
function compare(rows, seed, { pauses = false } = {}) {
  const r = random(seed + 7);
  const engine = createTodayRouteEngine({ dayStart: DAY_START });
  let at = 0;
  let checks = 0;
  while (at < rows.length) {
    const size = 1 + Math.floor(r() * (r() < 0.3 ? 3000 : 300));
    const batch = rows.slice(at, at + size);
    at += batch.length;
    expect(engine.add(batch)).toBe(true);
    const now = batch[batch.length - 1].time + Math.floor(r() * 20 * SECOND);
    const seen = rows.slice(0, at);
    const expected = todayRouteDistance(seen, { now, dayStart: DAY_START });
    const got = engine.sum(now);
    expect(got.count).toBe(expected.count);
    expect(got.status).toBe(expected.status);
    expect(got.metres).toBeCloseTo(expected.metres, 6);
    if (pauses && r() < 0.2) {
      // No new rows, only the clock (a departure being confirmed).
      const later = now + Math.floor(r() * 9 * MINUTE);
      const again = todayRouteDistance(seen, { now: later, dayStart: DAY_START });
      const engineAgain = engine.sum(later);
      expect(engineAgain.status).toBe(again.status);
      expect(engineAgain.metres).toBeCloseTo(again.metres, 6);
    }
    checks += 1;
  }
  return checks;
}

describe('today\'s distance, carried on row by row (068)', () => {
  test.each([1, 2, 3, 4, 5, 6])('the same answer as the whole-day sum, simulated day %i', seed => {
    const rows = simulatedDay(seed, { legs: 18 });
    expect(compare(rows, seed, { pauses: true })).toBeGreaterThan(5);
  });

  test('a day at home: never departs, the same answer all day', () => {
    const r = random(99);
    const rows = Array.from({ length: 3000 }, (_, i) => ({ id: i + 1, time: DAY_START + 8 * 60 * MINUTE + i * SECOND,
      latitude: 24.9893 + (r() - 0.5) * 0.00008, longitude: 121.3135 + (r() - 0.5) * 0.00008, accuracy: 8 }));
    compare(rows, 99);
    const engine = createTodayRouteEngine({ dayStart: DAY_START });
    engine.add(rows);
    expect(engine.sum(rows[rows.length - 1].time).status).toBe('not-departed');
  });

  test('a row older than one already taken asks for a new engine', () => {
    const engine = createTodayRouteEngine({ dayStart: DAY_START });
    expect(engine.add([{ id: 1, time: DAY_START + MINUTE, latitude: 24.99, longitude: 121.31, accuracy: 5 }])).toBe(true);
    expect(engine.add([{ id: 2, time: DAY_START, latitude: 24.99, longitude: 121.31, accuracy: 5 }])).toBe(false);
  });

  test('nothing yet', () => {
    expect(createTodayRouteEngine({ dayStart: DAY_START }).sum(DAY_START)).toEqual({ count: 0, metres: 0, status: 'not-departed' });
  });

  test('a long day: each new batch costs a small part of the whole-day sum', () => {
    const rows = simulatedDay(42, { legs: 70 });
    const engine = createTodayRouteEngine({ dayStart: DAY_START });
    const head = rows.slice(0, rows.length - 15);
    engine.add(head);
    engine.sum(head[head.length - 1].time);
    const tail = rows.slice(rows.length - 15);
    const t0 = performance.now();
    engine.add(tail);
    const got = engine.sum(rows[rows.length - 1].time);
    const incremental = performance.now() - t0;
    const t1 = performance.now();
    const whole = todayRouteDistance(rows, { now: rows[rows.length - 1].time, dayStart: DAY_START });
    const full = performance.now() - t1;
    expect(got.metres).toBeCloseTo(whole.metres, 6);
    expect(rows.length).toBeGreaterThan(20000);
    expect(incremental).toBeLessThan(full / 4);
  });
});
