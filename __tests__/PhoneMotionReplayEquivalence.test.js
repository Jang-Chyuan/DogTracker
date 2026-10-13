// PhoneMotion's windows are incremental (suffix search, cached step
// distances); test-support/PhoneMotionReference.js is the plain version it
// replaced. Every decision, coordinate and internal field must be the same,
// bit for bit, for seeded random days and the committed fixtures — the Kotlin
// MotionDetector parity fixture relies on JS deciding exactly as before.
import fs from 'fs';
import path from 'path';
import { PhoneMotion, replayPhoneMotion } from '../src/locationTracker/PhoneMotion';
import {
  PhoneMotion as ReferenceMotion,
  replayPhoneMotion as referenceReplay,
} from '../test-support/PhoneMotionReference';
import noisyRecovery from '../__fixtures__/PhoneNoisyRecovery';
import trafficLights from '../__fixtures__/PhoneTrafficLights';

const FIELDS = ['state', 'lowAt', 'highAt', 'last', 'strictReentry', 'departureSince',
  'lastGeometryAt', 'origin', 'movingProof', 'unconfirmedSince', 'anchor'];

// Park–Miller: exact in doubles, the same sequence everywhere.
function rng(seed) {
  let s = seed % 2147483646 + 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// A fictional origin; segments of stays, walks (measured, unmeasured and
// wrong-zero speed), drives, coarse indoor fixes, drift and relocations, at
// mixed cadences, with occasional gaps, repeats, clock steps back, sessions
// and malformed fields so the fallback paths are compared too.
function randomDay(seed, rows, { anomalies = true } = {}) {
  const r = rng(seed), out = [];
  const pick = list => list[Math.floor(r() * list.length)];
  let t = 1_700_000_000_000 + Math.floor(r() * 1e9), x = 0, y = 0, heading = r() * 7, session = 'a';
  const cadence = pick([[1], [1, 5], [5], [0.25, 1], [5, 12, 30], [1, 1, 2, 3]]);
  while (out.length < rows) {
    const kind = pick(['still', 'still', 'coarse', 'jitter', 'walk', 'walkNoSpeed', 'wrongZero',
      'drive', 'drift', 'jump', 'stopGo', 'slowWalk']);
    const length = 10 + Math.floor(r() * (r() < 0.3 ? 900 : 200));
    const accuracyBase = pick([3, 5, 8, 12, 18, 25, 35, 45]);
    for (let i = 0; i < length && out.length < rows; i += 1) {
      const dt = pick(cadence) * (0.8 + r() * 0.4);
      t += Math.round(dt * 1000);
      let v = 0, accuracy = accuracyBase * (0.7 + r() * 0.6), speed = 0, sacc = 0.1 + r() * 0.6, jitter = 1.5;
      if (kind === 'walk' || kind === 'walkNoSpeed' || kind === 'wrongZero') v = 0.6 + r();
      if (kind === 'slowWalk') v = 0.3 + r() * 0.4;
      if (kind === 'drive') v = 6 + r() * 14;
      if (kind === 'stopGo') v = (i % 60) < 25 ? 0 : 8;
      if (kind === 'drift') v = 0.15;
      if (kind === 'coarse') { accuracy = 30 + r() * 19; jitter = 20; }
      if (kind === 'jitter') jitter = 12;
      if (kind === 'jump' && i === 0) x += 40 + r() * 80;
      heading += (r() - 0.5) * 0.2;
      x += v * dt * Math.cos(heading); y += v * dt * Math.sin(heading);
      speed = v * 3.6 * (0.85 + r() * 0.3);
      if (kind === 'wrongZero') speed = 0;
      if (kind === 'coarse' || kind === 'jitter') speed = r() * 1.5;
      if (kind === 'walkNoSpeed') { speed = null; sacc = null; }
      if (r() < 0.05) sacc = null;
      if (r() < 0.03) sacc = 1.5 + r() * 3;
      const row = {
        id: out.length, time: t, session_id: session,
        latitude: 24.5 + (x + (r() - 0.5) * jitter) / 111195,
        longitude: 121.5 + (y + (r() - 0.5) * jitter) / 100777,
        accuracy: Math.round(accuracy * 100) / 100,
        raw_speed_kmh: speed, speed_kmh: speed ?? 0, speed_accuracy_mps: sacc,
      };
      if (r() < 0.2) {
        row.raw_latitude = row.latitude + 0.00001;
        row.raw_longitude = row.longitude;
      }
      if (anomalies) {
        const a = r();
        if (a < 0.004) t += 31000 + Math.floor(r() * 120000); // a gap resets
        else if (a < 0.006) row.time = t - Math.floor(r() * 5000); // repeat / step back
        else if (a < 0.008) delete row.raw_speed_kmh; // only the display speed
        else if (a < 0.010) row.raw_speed_kmh = pick([NaN, -1, Infinity]);
        else if (a < 0.012) row.accuracy = pick([NaN, null, undefined, -1, 50, 80]);
        else if (a < 0.013) { delete row.accuracy; row.accuracy_meters = 9; }
        else if (a < 0.014) { row.latitude = 0; row.longitude = 0; delete row.raw_latitude; }
        else if (a < 0.015) { row.latitude = pick([NaN, 95, null]); delete row.raw_latitude; }
        else if (a < 0.016) session = session === 'a' ? 'b' : 'a';
        else if (a < 0.0165) row.session_id = null;
      }
      out.push(row);
    }
  }
  return out;
}

// Every row has the same keys in the same order and Object.is-equal values
// (NaN, -0 and undefined included); toStrictEqual only to report a mismatch.
function expectSameRows(label, actual, expected) {
  const same = actual.length === expected.length && actual.every((row, i) => {
    const keys = Object.keys(row), other = Object.keys(expected[i]);
    return keys.length === other.length && keys.every((key, k) => key === other[k] && Object.is(row[key], expected[i][key]));
  });
  if (!same) expect([label, actual]).toStrictEqual([label, expected]);
}

// Step both trackers with the same points and compare everything they
// expose; returns how many fixes released a departure.
function compareAccepts(points) {
  const fast = new PhoneMotion(), reference = new ReferenceMotion();
  let departures = 0;
  for (let i = 0; i < points.length; i += 1) {
    const run = tracker => {
      try { return { state: tracker.accept(points[i]) }; } catch (error) { return { error: String(error) }; }
    };
    const a = run(fast), b = run(reference);
    if (a.state !== b.state || a.error !== b.error) expect([i, a]).toStrictEqual([i, b]);
    if (b.error) return departures;
    if (fast.departureSince != null) departures += 1;
    for (const field of FIELDS)
      if (!Object.is(fast[field], reference[field])) expect([i, field, fast[field]]).toStrictEqual([i, field, reference[field]]);
    for (const list of ['tail', 'entry'])
      if (fast[list].length !== reference[list].length || fast[list].some((p, k) => p !== reference[list][k]))
        expect([i, list, fast[list]]).toStrictEqual([i, list, reference[list]]);
  }
  return departures;
}

const motionPoints = rows => rows.map(row => ({
  ...row,
  latitude: row.raw_latitude ?? row.latitude,
  longitude: row.raw_longitude ?? row.longitude,
  accuracy: row.accuracy ?? row.accuracy_meters,
}));

test('seeded random days replay to identical rows', () => {
  for (let seed = 1; seed <= 60; seed += 1) {
    const rows = randomDay(seed, 300 + (seed * 7919) % 2700, { anomalies: seed % 4 !== 0 });
    const copy = () => rows.map(row => ({ ...row }));
    expectSameRows(seed, replayPhoneMotion(copy()), referenceReplay(copy()));
  }
});

test('seeded random days keep identical tracker state after every fix', () => {
  for (let seed = 1001; seed <= 1040; seed += 1) compareAccepts(motionPoints(randomDay(seed, 1500)));
});

test('a long day with long walks, stays and drives replays identically', () => {
  const rows = randomDay(424242, 30000, { anomalies: false });
  const copy = () => rows.map(row => ({ ...row }));
  const fast = replayPhoneMotion(copy());
  expectSameRows('long day', fast, referenceReplay(copy()));
  // The stream exercises every state, a backfilled departure included.
  expect(new Set(fast.map(p => p.phoneMotionState))).toEqual(
    new Set(['moving', 'unknown', 'suspected_stationary', 'stationary']));
  expect(fast.some(p => p.phoneDepartureSince != null)).toBe(true);
});

test('malformed clocks take the filtered fallback and still decide the same', () => {
  // Non-finite and zero times break the ordered-window shortcut.
  for (let seed = 1; seed <= 40; seed += 1) {
    const r = rng(seed), points = motionPoints(randomDay(seed + 5000, 600));
    for (const p of points) {
      const a = r();
      if (a < 0.01) p.time = NaN;
      else if (a < 0.015) p.time = 0;
      else if (a < 0.02) p.time = undefined;
    }
    compareAccepts(points);
  }
  // A fix at time 0 is not a previous time (`last` is falsy), so the clock
  // can then start 20 s earlier: the tail stays out of order while an
  // unmeasured 1.2 m/s walk (15 m fixes) reaches the 2-minute departure,
  // whose 30 s slices then hold non-adjacent fixes. Noisier seeds may never
  // release; the clean ones (seed % 4 === 0) do.
  let released = 0;
  for (let seed = 1; seed <= 12; seed += 1) {
    const r = rng(seed), walk = [];
    const at = (time, noise = 0) => ({ time, latitude: 25 + (1.2 * time / 1000 + noise) / 111195,
      longitude: 121 + (seed % 3) * noise / 100777, accuracy: 15, raw_speed_kmh: null, speed_accuracy_mps: null });
    walk.push(at(0));
    for (let time = -20000; time <= 400000; time += 1000) walk.push(at(time, (r() - 0.5) * 2 * (seed % 4)));
    released += compareAccepts(walk);
  }
  expect(released).toBeGreaterThan(0);
  // The same clock with that first fix 12 m east of a still start: its 30 s
  // slice must add the real distance to the next fix in time (failing the
  // 0.8 straightness), not the step stored beside it, which would release
  // the walk 25 s early.
  const fix = (time, north, east = 0) => ({ time, latitude: 25 + north / 111195, longitude: 121 + east / 100777,
    accuracy: 15, raw_speed_kmh: null, speed_accuracy_mps: null });
  const sidestep = [fix(0, 0, 12)];
  for (let time = -20000; time < 0; time += 1000) sidestep.push(fix(time, 0));
  for (let time = 0; time <= 300000; time += 1000) sidestep.push(fix(time, 1.2 * time / 1000));
  expect(compareAccepts(sidestep)).toBeGreaterThan(0);
});

test('committed phone fixtures replay identically', () => {
  const day = fs.readFileSync(path.join(__dirname, '../__fixtures__/stationary-day-phone.csv'), 'utf8')
    .split('\n').filter(line => line && !line.startsWith('#')).slice(1).map(line => {
      const [t, east, north, acc, kmh, sacc] = line.split(',');
      return { time: 1_767_564_000_000 + Math.round(Number(t) * 1000),
        latitude: 24.9893 + Number(north) / 110540, longitude: 121.3135 + Number(east) / 100900,
        accuracy: Number(acc), raw_speed_kmh: kmh === '' ? null : Number(kmh),
        speed_accuracy_mps: sacc === '' ? null : Number(sacc) };
    });
  const lights = Object.values(trafficLights).map(rows => rows.map(([time, north, , , , accuracy, kmh, sacc]) => ({
    time, latitude: 25 + north / 111195, longitude: 121, accuracy, raw_speed_kmh: kmh, speed_accuracy_mps: sacc })));
  const parity = JSON.parse(fs.readFileSync(path.join(__dirname,
    '../android/app/src/test/resources/phone-motion-parity.json'), 'utf8')).map(c => c.samples.map(s => ({
    time: Math.round(s.t * 1000), latitude: 25 + s.x / 111195, longitude: 121 + (s.y ?? 0) / 100777,
    accuracy: s.accuracy, raw_speed_kmh: s.speed, speed_accuracy_mps: s.sacc })));
  for (const rows of [day, noisyRecovery, ...lights, ...parity]) {
    const copy = () => rows.map(row => ({ ...row }));
    expectSameRows('fixture', replayPhoneMotion(copy()), referenceReplay(copy()));
    compareAccepts(motionPoints(rows));
  }
});
