import { performance } from 'perf_hooks';
import * as movement from '../src/history/HistoryMovement';
import { createTodayRouteEngine } from '../src/tracking/TodayRouteEngine';
import { todayRouteDistance, startOfToday, endOfDay } from '../src/tracking/TodayDistance';
import { historyTimeline } from '../src/history/HistoryTimeline';
import { phoneHistoryRow } from '../src/history/HistoryRows';

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
 * `foot`: walking and standing still only, recorded without a break — a day
 * with no edge that ends a run of walking (068 finding 5).
 */
function simulatedDay(seed, { legs = 30, step = 1, start = 7 * 60, foot = false } = {}) {
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
    // foot: only the two slow kinds, so no leg is fast enough for a car.
    const kind = r() * (foot ? 0.75 : 1);
    const seconds = Math.round((kind < 0.15 ? 1 + r() * 2 : 3 + r() * 20) * 60);
    const speed = kind < 0.4 ? 0 : kind < 0.75 ? 0.8 + r() * 1.2 : kind < 0.9 ? 6 + r() * 12 : 4 + r() * 1.5;
    if (r() < (foot ? 0 : 0.08)) time += Math.round((3 + r() * 40) * MINUTE); // a break in the recording
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

// What todayRouteDistance says about `rows` at `now`, as sum() returns it.
function reference(rows, now) {
  const { count, metres, status } = todayRouteDistance(rows, { now, dayStart: DAY_START });
  return { count, metres, status };
}

// The engine's answer is the whole-day sum's (metres to the nearest micrometre:
// the two add the same edges up in different groups).
function expectSame(got, expected) {
  expect(got.count).toBe(expected.count);
  expect(got.status).toBe(expected.status);
  expect(got.metres).toBeCloseTo(expected.metres, 6);
}

// Feed the rows in batches of random size and compare every answer. `clock`:
// `now` can land inside the batch, so rows are ahead of the clock and the
// clock can go backwards between calls (todayRouteDistance leaves rows later
// than `now` out altogether).
function compare(rows, seed, { pauses = false, clock = false } = {}) {
  const r = random(seed + 7);
  const engine = createTodayRouteEngine({ dayStart: DAY_START });
  let at = 0;
  let checks = 0;
  while (at < rows.length) {
    const size = 1 + Math.floor(r() * (r() < 0.3 ? 3000 : 300));
    const batch = rows.slice(at, at + size);
    at += batch.length;
    expect(engine.add(batch)).toBe(true);
    const now = clock && batch.length > 1 && r() < 0.5
      ? batch[Math.floor(r() * batch.length)].time
      : batch[batch.length - 1].time + Math.floor(r() * 20 * SECOND);
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

  test('a row ahead of the clock waits for it', () => {
    // The whole-day sum takes the rows of today up to `now`: a row recorded
    // a second ahead of the clock is not part of the answer yet.
    const rows = [
      { id: 1, time: DAY_START + SECOND, latitude: 24.9893, longitude: 121.3135, accuracy: 5 },
      { id: 2, time: DAY_START + 2 * SECOND, latitude: 24.9894, longitude: 121.3135, accuracy: 5 },
    ];
    const engine = createTodayRouteEngine({ dayStart: DAY_START });
    expect(engine.add(rows)).toBe(true);
    const early = engine.sum(DAY_START + SECOND);
    expectSame(early, reference(rows, DAY_START + SECOND));
    expect(early).toEqual({ count: 1, metres: 0, status: 'not-departed' });
    // The clock reaches the second row: 11 m walked (no measured speed, so
    // the speed budget cannot call it drift).
    const later = engine.sum(DAY_START + 2 * SECOND);
    expectSame(later, reference(rows, DAY_START + 2 * SECOND));
    expect(later.count).toBe(2);
    expect(later.metres).toBeCloseTo(11.12, 1);
  });

  test.each([2, 5])('the same answer when the clock runs behind the rows, simulated day %i', seed => {
    const rows = simulatedDay(seed, { legs: 14 });
    expect(compare(rows, seed + 200, { clock: true, pauses: true })).toBeGreaterThan(5);
  });

  test('the clock going backwards: the rows after it leave the answer, and come back', () => {
    const rows = simulatedDay(3, { legs: 12 });
    const engine = createTodayRouteEngine({ dayStart: DAY_START });
    expect(engine.add(rows)).toBe(true);
    const end = rows[rows.length - 1].time;
    const middle = rows[Math.floor(rows.length / 2)].time;
    const at = [end, middle, DAY_START + MINUTE, middle, end, end];
    for (const now of at) expectSame(engine.sum(now), reference(rows, now));
    // The day was long enough for the departure to be found again.
    expect(engine.sum(end).status).toBe('confirmed');
  });

  test('midnight: from the day\'s first millisecond, and the next day is not today', () => {
    const r = random(5);
    const walk = (from, n, first) => Array.from({ length: n }, (_, i) => ({ id: first + i,
      time: from + i * 10 * SECOND, latitude: 24.9893 + i * 0.0002 + (r() - 0.5) * 0.00004,
      longitude: 121.3135 + (r() - 0.5) * 0.00004, accuracy: 6 }));
    const today = walk(DAY_START, 120, 1);
    // The first row of the next day is at the day's end exactly.
    const tomorrow = walk(endOfDay(DAY_START), 10, 1000);
    const engine = createTodayRouteEngine({ dayStart: DAY_START });
    expect(engine.add([...today, ...tomorrow])).toBe(true);
    const statuses = [];
    for (const now of [DAY_START, DAY_START + 4 * MINUTE, DAY_START + 10 * MINUTE,
      endOfDay(DAY_START) - 1, endOfDay(DAY_START) + MINUTE]) {
      const got = engine.sum(now);
      expectSame(got, reference(today, now));
      statuses.push(got.status);
    }
    // Only today's rows, whatever the clock says.
    expect(statuses).toEqual(['not-departed', 'confirming', 'confirmed', 'confirmed', 'confirmed']);
    expect(engine.sum(endOfDay(DAY_START) + MINUTE).count).toBe(today.length);
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

  test('a day on foot: a poll costs no more late in the day than early', () => {
    const rows = simulatedDay(11, { legs: 40, foot: true });
    const now = rows[rows.length - 1].time;
    // Walking and standing still, recorded without a break: no car and no
    // gap, so nothing ends the run of walking the distance is counted along.
    // The checkpoint can only move if it carries the run's anchor and speed
    // budget (otherwise a poll adds the whole retained route up again).
    const model = historyTimeline(rows.map(phoneHistoryRow), { subject: 'phone', source: 'all',
      dayStart: DAY_START, dayEnd: endOfDay(DAY_START), today: true, now });
    expect(model.edges.length).toBeGreaterThan(20000);
    // A run of missing measurements may be explicitly uncertain; it is not
    // a vehicle or an invented indoor hold and never finances distance.
    expect(model.edges.every(e => e.mode === 'walking' || (e.mode === 'gap' && e.uncertain))).toBe(true);
    expect(model.edges.filter(e => e.uncertain).every(e => e.countedDistanceM === 0)).toBe(true);
    // A day fed in batches of 150 rows, as the live map polls: what the
    // batches cost altogether, per row.
    const perRow = fed => {
      const engine = createTodayRouteEngine({ dayStart: DAY_START });
      let cost = 0;
      for (let at = 0; at < fed.length; at += 150) {
        const batch = fed.slice(at, at + 150);
        const t0 = performance.now();
        engine.add(batch);
        engine.sum(batch[batch.length - 1].time);
        cost += performance.now() - t0;
      }
      return { cost: cost / fed.length, answer: engine.sum(fed[fed.length - 1].time) };
    };
    const first = perRow(rows.slice(0, 3000));
    const whole = perRow(rows);
    expectSame(first.answer, reference(rows.slice(0, 3000), rows[2999].time));
    expectSame(whole.answer, reference(rows, now));
    expect(whole.answer.metres).toBeGreaterThan(1000);
    // 0.4 when the checkpoint moves, 7.5 when it cannot (068 finding 5).
    expect(whole.cost).toBeLessThan(first.cost * 2);
  });
});


test('a sparse walk ending on a still fix keeps its distance in incremental and whole-day sums', () => {
  const rows = [
    { id: 1, time: DAY_START + SECOND, latitude: 24.9893, longitude: 121.3135,
      accuracy: 5, raw_speed_kmh: 5, speed_accuracy_mps: 0.4 },
    { id: 2, time: DAY_START + 41 * SECOND, latitude: 24.9898, longitude: 121.3135,
      accuracy: 5, raw_speed_kmh: 0, speed_accuracy_mps: 0.4 },
  ];
  const engine = createTodayRouteEngine({ dayStart: DAY_START });
  engine.add(rows.slice(0, 1));
  engine.sum(rows[0].time);
  engine.add(rows.slice(1));
  const result = engine.sum(rows[1].time);
  expectSame(result, reference(rows, rows[1].time));
  expect(result.metres).toBeGreaterThan(50);
});


test('a 10k ongoing drive only steps its new suffix, retaining parking and walking backfills', () => {
  let time = DAY_START + MINUTE, metres = 0;
  const rows = [];
  const push = speed => {
    time += 2000; metres += speed * 2;
    rows.push({ id: rows.length + 1, time, latitude: 24.989,
      longitude: 121.313 + metres / (111320 * Math.cos(24.989 * Math.PI / 180)),
      accuracy: 5, raw_speed_kmh: speed * 3.6, speed_accuracy_mps: 0.1 });
  };
  // Positive walking departure first: compare a meaningful distance, rather
  // than accepting any optimisation merely because a car-only answer is zero.
  for (let i = 0; i < 180; i += 1) push(1.4);
  for (let i = 0; i < 10000; i += 1) push(10);
  const engine = createTodayRouteEngine({ dayStart: DAY_START });
  engine.add(rows); engine.sum(time);
  const step = jest.spyOn(movement, 'stepVehicles');
  const count = jest.spyOn(movement, 'countEdge');
  const compareAppend = (speed, size, scanLimit) => {
    const start = rows.length;
    for (let i = 0; i < size; i += 1) push(speed);
    step.mockClear(); count.mockClear();
    engine.add(rows.slice(start));
    const got = engine.sum(time);
    if (scanLimit != null) {
      expect(step.mock.calls.length).toBeLessThanOrEqual(scanLimit);
      expect(count.mock.calls.length).toBeLessThanOrEqual(scanLimit);
    }
    expectSame(got, reference(rows, time));
  };
  try {
    compareAppend(10, 3, 3);
    // Displayed terminal parking is provisional: it must not be committed
    // into the retained vehicle scan, or resuming would invent a new car.
    compareAppend(0, 100, 100);
    // A fresh geometry-confirmed departure after parking legitimately
    // revokes the earlier stationary tail; check correctness at that event.
    compareAppend(3.5, 20);
    compareAppend(10, 3);
    compareAppend(0, 30, 30);
    compareAppend(1.4, 20); // true short walk after leaving the vehicle
    compareAppend(10, 20);
    compareAppend(10, 3, 3);
    expect(engine.sum(time).metres).toBeGreaterThan(400);
  } finally {
    step.mockRestore(); count.mockRestore();
  }
});

test('a retained active car across a high-speed signal gap survives clock rollback and parked backfill', () => {
  let time = DAY_START + MINUTE, metres = 0;
  const rows = [];
  const push = (speed, seconds = 5) => {
    time += seconds * SECOND; metres += speed * seconds;
    rows.push({ id: rows.length + 1, time, latitude: 24.989,
      longitude: 121.313 + metres / (111320 * Math.cos(24.989 * Math.PI / 180)),
      accuracy: 5, raw_speed_kmh: speed * 3.6, speed_accuracy_mps: 0.1 });
  };
  for (let i = 0; i < 30; i += 1) push(10);
  const beforeGap = time;
  push(10, 240); // signal gap, still below the vehicle interruption limit
  for (let i = 0; i < 20; i += 1) push(10);
  for (let i = 0; i < 40; i += 1) push(0); // provisional terminal parking
  for (let i = 0; i < 20; i += 1) push(10);
  const engine = createTodayRouteEngine({ dayStart: DAY_START });
  for (let start = 0; start < rows.length; start += 7) {
    const prefix = rows.slice(0, start + 7);
    engine.add(prefix.slice(start));
    expectSame(engine.sum(prefix.at(-1).time), reference(prefix, prefix.at(-1).time));
  }
  // A backwards clock revokes future parking/departure evidence before
  // reaching those rows again; it must not keep an old active checkpoint.
  expectSame(engine.sum(beforeGap), reference(rows, beforeGap));
  expectSame(engine.sum(rows.at(-1).time), reference(rows, rows.at(-1).time));
});
