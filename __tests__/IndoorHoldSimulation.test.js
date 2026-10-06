import { createHoldTracker, applyHistoryHolds, distanceMeters } from '../src/placement/IndoorHold';
import { predictEnvironment, ENVIRONMENT_WINDOW_MS } from '../src/ml/Environment';
import { HOME, offset, generate, displayRaw } from '../__fixtures__/IndoorScenarios';

// Each scenario runs through three ways of drawing the dog:
//   raw   main without a set point (three-point average, last fix kept)
//   point main with a set point at HOME (charging, or indoor/window from the model)
//   hold  this change, as the live map sees it row by row
// Set REPORT=1 to print the table.
const FIELD = offset(HOME, 900, 600);
const PARK = offset(HOME, -400, 700);
const OTHER = offset(HOME, 2500, -3000);
const DOOR = offset(HOME, 12, 0);
const ROOM = HOME;

export const SCENARIOS = {
  'home, no fix for 2 h, walk out': [
    { kind: 'open', minutes: 6, from: PARK, to: DOOR },
    { kind: 'indoor', minutes: 120, from: ROOM, fix: 0 },
    { kind: 'open', minutes: 6, from: DOOR, to: PARK, label: 'leave' },
  ],
  'home, drifting fixes 1 h': [
    { kind: 'open', minutes: 5, from: PARK, to: DOOR },
    { kind: 'indoor', minutes: 60, from: ROOM, fix: 0.85 },
    { kind: 'open', minutes: 5, from: DOOR, to: PARK, label: 'leave' },
  ],
  'home, on and off fixes 1 h': [
    { kind: 'open', minutes: 5, from: PARK, to: DOOR },
    { kind: 'indoor', minutes: 60, from: ROOM, fix: 0.3, goodShare: 0.08 },
    { kind: 'open', minutes: 5, from: DOOR, to: PARK, label: 'leave' },
  ],
  'by a window 40 min': [
    { kind: 'open', minutes: 5, from: PARK, to: DOOR },
    { kind: 'window', minutes: 40, from: ROOM },
    { kind: 'open', minutes: 5, from: DOOR, to: PARK, label: 'leave' },
  ],
  'charging indoors 3 h': [
    { kind: 'open', minutes: 5, from: PARK, to: DOOR },
    { kind: 'indoor', minutes: 180, from: ROOM, fix: 0.5, usb: true },
  ],
  'charging in a moving car': [
    { kind: 'drive', minutes: 20, from: HOME, to: OTHER, usb: true, master: 'dog' },
  ],
  'open field, handler far away': [
    { kind: 'open', minutes: 30, from: FIELD, to: offset(FIELD, 600, 900), master: HOME },
  ],
  'open field, handler close': [
    { kind: 'open', minutes: 30, from: FIELD, to: offset(FIELD, 600, 900), master: 'dog' },
  ],
  'walking under trees': [
    { kind: 'open', minutes: 3, from: FIELD, to: offset(FIELD, 100, 0), master: 'dog' },
    { kind: 'forest', minutes: 20, from: offset(FIELD, 100, 0), to: offset(FIELD, 1300, 400), master: 'dog' },
  ],
  'switched on indoors': [
    { kind: 'indoor', minutes: 60, from: ROOM, fix: 0.6 },
  ],
  'another building far from home': [
    { kind: 'drive', minutes: 10, from: HOME, to: OTHER, master: 'dog' },
    { kind: 'indoor', minutes: 60, from: OTHER, fix: 0.5, master: 'dog' },
    { kind: 'open', minutes: 5, from: OTHER, to: offset(OTHER, 300, 0), master: 'dog', label: 'leave' },
  ],
  'tunnel while walking': [
    { kind: 'open', minutes: 5, from: FIELD, to: offset(FIELD, 300, 0), master: 'dog' },
    { kind: 'indoor', minutes: 0.7, from: offset(FIELD, 300, 0), to: offset(FIELD, 350, 0), fix: 0, master: 'dog' },
    { kind: 'open', minutes: 5, from: offset(FIELD, 350, 0), to: offset(FIELD, 650, 0), master: 'dog' },
  ],
  'out of range 10 min': [
    { kind: 'open', minutes: 5, from: FIELD, to: offset(FIELD, 300, 0), master: 'dog' },
    { kind: 'silent', minutes: 10, from: offset(FIELD, 300, 0), to: offset(FIELD, 900, 0) },
    { kind: 'open', minutes: 5, from: offset(FIELD, 900, 0), to: offset(FIELD, 1200, 0), master: 'dog' },
  ],
  'large building, moving inside': [
    { kind: 'open', minutes: 5, from: PARK, to: DOOR },
    { kind: 'indoor', minutes: 60, from: ROOM, to: offset(ROOM, -50, 40), fix: 0.5 },
  ],
  'yard for 2 min, back in': [
    { kind: 'open', minutes: 5, from: PARK, to: DOOR },
    { kind: 'indoor', minutes: 20, from: ROOM, fix: 0.5 },
    { kind: 'open', minutes: 2, from: DOOR, to: offset(DOOR, 25, 10), label: 'yard' },
    { kind: 'indoor', minutes: 20, from: ROOM, fix: 0.5 },
  ],
};

function displaySetPoint(rows) {
  const raw = displayRaw(rows);
  const finished = [];
  let bucket = null, bucketRows = [];
  return rows.map((row, index) => {
    const start = Math.floor(row.time / ENVIRONMENT_WINDOW_MS) * ENVIRONMENT_WINDOW_MS;
    if (bucket !== null && start !== bucket && bucketRows.length) {
      finished.push(predictEnvironment(bucketRows.map(item => ({ ...item,
        slave_lat: item.latitude, slave_lon: item.longitude, track_at: item.time }))));
      bucketRows = [];
    }
    bucket = start;
    bucketRows.push(row);
    const environment = finished[finished.length - 1];
    const indoor = environment && row.time - environment.observedAt <= 120000
      && ['indoor', 'window'].includes(environment.environment);
    return row.usb_present === 1 || indoor ? HOME : raw[index];
  });
}

function displayHold(rows, config) {
  const raw = displayRaw(rows);
  const tracker = createHoldTracker(config);
  return rows.map((row, index) => {
    tracker.push(row);
    return tracker.current(row.time)?.coordinate ?? raw[index];
  });
}

function displayHistory(rows, config) {
  const raw = displayRaw(rows);
  const points = rows.map((row, index) => ({ ...row, raw_latitude: row.latitude, raw_longitude: row.longitude,
    latitude: raw[index]?.latitude ?? 0, longitude: raw[index]?.longitude ?? 0 }));
  return applyHistoryHolds(points, config ? { config } : undefined).map(point => (point.latitude || point.longitude ? point : null));
}

const percentile = (values, share) => {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))];
};

export function measure(rows, shown) {
  const still = { errors: [], jitter: 0, hours: 0 };
  const moving = { errors: [], frozen: 0, count: 0 };
  let previous = null, previousTime = null;
  rows.forEach((row, index) => {
    const at = shown[index];
    if (!at) { previous = null; return; }
    const error = distanceMeters(at, row.truth);
    if (row.moving) {
      moving.errors.push(error);
      moving.count += 1;
      if (previous && distanceMeters(previous, at) < 0.5) moving.frozen += 1;
    } else {
      still.errors.push(error);
      if (previous) still.jitter += distanceMeters(previous, at);
      if (previousTime) still.hours += (row.time - previousTime) / 3600000;
    }
    previous = at;
    previousTime = row.time;
  });
  const round = value => (value === null ? '—' : Math.round(value));
  return {
    stillP50: round(percentile(still.errors, 0.5)),
    stillP95: round(percentile(still.errors, 0.95)),
    jitterPerHour: still.hours ? round(still.jitter / still.hours) : '—',
    movingP50: round(percentile(moving.errors, 0.5)),
    movingP95: round(percentile(moving.errors, 0.95)),
    frozenShare: moving.count ? Math.round(moving.frozen / moving.count * 100) : '—',
  };
}

export function runAll(seeds = [1, 2, 3, 4, 5], config = undefined, methods = null, stepSeconds = 5) {
  const table = {};
  for (const [name, segments] of Object.entries(SCENARIOS)) {
    const merged = { raw: [], point: [], hold: [], history: [] };
    for (const seed of seeds) {
      const rows = generate(segments, { seed, stepSeconds });
      if (!methods || methods.includes('raw')) merged.raw.push(measure(rows, displayRaw(rows)));
      if (!methods || methods.includes('point')) merged.point.push(measure(rows, displaySetPoint(rows)));
      if (!methods || methods.includes('hold')) merged.hold.push(measure(rows, displayHold(rows, config)));
      if (!methods || methods.includes('history')) merged.history.push(measure(rows, displayHistory(rows, config)));
    }
    table[name] = Object.fromEntries(Object.entries(merged).filter(([, results]) => results.length)
      .map(([method, results]) => [method,
      Object.fromEntries(Object.keys(results[0]).map(key => {
        const values = results.map(result => result[key]).filter(value => value !== '—');
        return [key, values.length ? Math.max(...values) : '—'];
      }))]));
  }
  return table;
}

const describeSimulation = process.env.GRID ? describe.skip : describe;
describeSimulation('indoor hold against simulated collars', () => {
  const table = runAll();
  if (process.env.REPORT) {
    for (const [name, methods] of Object.entries(table)) {
      console.log(`\n${name}`);
      console.table(methods);
    }
  }

  test.each(['home, no fix for 2 h, walk out', 'home, drifting fixes 1 h', 'home, on and off fixes 1 h',
    'charging indoors 3 h', 'switched on indoors', 'another building far from home'])(
    '%s: the dog stays put indoors', name => {
      const { raw, hold } = table[name];
      expect(hold.stillP95).toBeLessThanOrEqual(Math.max(40, raw.stillP95 / 2));
      expect(hold.jitterPerHour).toBeLessThan(Math.max(300, raw.jitterPerHour / 3));
    });

  test.each(['charging in a moving car', 'open field, handler far away', 'open field, handler close',
    'tunnel while walking', 'out of range 10 min'])(
    '%s: a moving dog is not held back', name => {
      const { raw, hold } = table[name];
      expect(hold.movingP95).toBeLessThanOrEqual(raw.movingP95 + 25);
    });

  test('a set point at home would draw a dog charging in a car at home', () => {
    expect(table['charging in a moving car'].point.movingP50).toBeGreaterThan(1000);
    expect(table['charging in a moving car'].hold.movingP50)
      .toBeLessThanOrEqual(table['charging in a moving car'].raw.movingP50 + 3);
  });

  test('another building is held there, not drawn at home', () => {
    expect(table['another building far from home'].hold.stillP95).toBeLessThan(60);
  });
});
