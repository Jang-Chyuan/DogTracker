import { phoneHistoryRow } from '../src/history/HistoryRows';
import { historyTimeline, mergePhoneSamePlaceStays } from '../src/history/HistoryTimeline';
import { configFor } from '../src/history/HistoryConfig';
import { countDistances, historyEdge, historyMovement } from '../src/history/HistoryMovement';
import { historyStops } from '../src/history/HistoryStops';
import { rangeEndRows, timelinePresentation } from '../src/history/HistoryTimelinePresentation';
import { createTodayRouteEngine } from '../src/tracking/TodayRouteEngine';
import { todayRouteDistance } from '../src/tracking/TodayDistance';
import { listedMetres, timelineClockMismatches } from '../test-support/TimelineClocks';

// 2026-10-14 (user): a whole day at home read as five unnumbered pieces and
// 「走路 4 分・240 m」 — a lift down and back up. Invented rows only: metres
// north / east of an arbitrary point near Taoyuan Station, an invented day,
// invented session ids; no real place, route or person.
const SECOND = 1000;
const dayStart = new Date(2026, 0, 20).getTime();
const dayEnd = new Date(2026, 0, 21).getTime();
const config = configFor('phone');
const ORIGIN = { latitude: 24.9893, longitude: 121.3135 };
const at = (north, east) => ({ latitude: ORIGIN.latitude + north / 111195,
  longitude: ORIGIN.longitude + east / (111195 * Math.cos(ORIGIN.latitude * Math.PI / 180)) });
const clock = (h, m = 0, s = 0) => dayStart + ((h * 60 + m) * 60 + s) * SECOND;

// A deterministic pseudo-random wobble, so a failing day can be replayed.
function random(seed) {
  let x = seed;
  return () => { x = (x * 1664525 + 1013904223) % 2 ** 32; return x / 2 ** 32; };
}

/**
 * Rows as phoneRouteSince reads them. A script is a list of
 * [kind, seconds, extra]: home — standing still indoors (a few metres of
 * wobble, 8–15 m, 0–0.3 km/h); jump — the GPS settles `metres` east for
 * those seconds at fine accuracy, the detector briefly reads moving, the
 * phone measures under 1 km/h; lift — the lift ride: Wi-Fi fixes of 25–49 m
 * out to `peak` metres and back over `minutes` (4), one claiming 32 km/h; walk — on foot at
 * 4 km/h, `step` metres east each fix, fine; drive — 40 km/h east; none —
 * nothing saved; session —
 * the recorder restarted (an app install).
 */
function day(script, { from = clock(6), every = 10, seed = 7 } = {}) {
  const r = random(seed);
  const out = [];
  let time = from, east = 0, session = 'fiction-session-a';
  const push = (north, eastM, accuracy, kmh, motion, extra = {}) => out.push({ id: out.length + 1, time,
    ...at(north, eastM), raw_latitude: at(north, eastM).latitude, raw_longitude: at(north, eastM).longitude,
    accuracy, raw_speed_kmh: kmh, speed_kmh: kmh, speed_accuracy_mps: kmh > 5 ? 2.5 : 0.3,
    motion_state: motion, session_id: session, ...extra });
  for (let [kind, seconds, extra = {}] of script) {
    if (kind === 'session') { session = seconds; continue; }
    if (kind === 'none') { time += seconds * SECOND; continue; }
    const lift0 = time;
    if (kind === 'lift') seconds = 0;
    const steps = Math.round(seconds / (extra.every ?? every));
    for (let k = 0; k < steps; k += 1, time += (extra.every ?? every) * SECOND) {
      if (kind === 'home') push((r() - 0.5) * 6, east + (r() - 0.5) * 6, 8 + r() * 7, r() * 0.3, 'stationary');
      if (kind === 'jump') push(0, east + extra.metres, 10 + r() * 3, 0.9, 'moving');
      if (kind === 'walk') { east += extra.step ?? 11; push(0, east, 4, 4, 'moving'); }
      if (kind === 'drive') { east += 110; push(0, east, 5, 40, 'moving'); }
    }
    if (kind === 'lift') {
      // The ride itself, as a phone in a lift records it: a fix on leaving,
      // Wi-Fi fixes without a speed, one far out claiming 30 km/h, a slow
      // one on the way back, then fine again at the door.
      const peak = extra.peak ?? 90, minutes = extra.minutes ?? 4, step = minutes * 60 / 8;
      for (const [k, north, eastM, accuracy, kmh, motion, spread] of [
        [0, 0, 5, 28, 11, 'moving', 1.5], [0.3, 2, 8, 26, 9, 'moving', 1.5], [0.6, 4, 12, 27, 8, 'moving', 1.5],
        [1, peak * 0.6, peak * 0.8, 30, null, 'unknown', null],
        [2, peak * 0.5, peak * 0.7, 30, null, 'unknown', null], [3, peak * 0.05, peak * 0.05, 47, 32, 'moving', 3.3],
        [4, peak * 0.7, peak * 0.6, 30, null, 'unknown', null], [6, peak * 0.3, peak * 0.4, 28, 4.5, 'moving', 1.3],
        [7, peak * 0.3, peak * 0.4, 24, 2.7, 'moving', 1.3], [8, peak * 0.3, peak * 0.4, 22, 0, 'stationary', 0.1]]) {
        out.push({ id: out.length + 1, time: lift0 + k * step * SECOND, ...at(north, east + eastM),
          raw_latitude: at(north, east + eastM).latitude, raw_longitude: at(north, east + eastM).longitude,
          accuracy, raw_speed_kmh: kmh, speed_kmh: kmh, speed_accuracy_mps: spread,
          motion_state: motion, session_id: session });
      }
      time = lift0 + 8 * step * SECOND + every * SECOND;
    }
  }
  return out;
}

const timeline = (rows, options = {}) => historyTimeline(rows.map(phoneHistoryRow), { subject: 'phone',
  dayStart, dayEnd, today: true, now: rows.at(-1).time + SECOND, timezone: 'Asia/Taipei', ...options });
const foot = n => n.type === 'movement' && (n.mode === 'walking' || n.mode === 'moving');
// The rows' metres (#200: a stay's own moves are on its row).
const rowMetres = model => listedMetres(model.nodes);
const engineMetres = (rows, batch = 50) => {
  const engine = createTodayRouteEngine({ dayStart });
  let metres = 0;
  for (let i = 0; i < rows.length; i += batch) {
    engine.add(rows.slice(i, i + batch));
    metres = engine.sum(rows[Math.min(i + batch, rows.length) - 1].time + SECOND).metres;
  }
  return metres;
};

// The day the user reported, made up: at home from 06:00, a GPS jump, the
// lift down and back up, then two app installs (the recorder off 61 s and
// 10 s) — and home again.
const atHome = day([['home', 3600], ['jump', 50, { metres: 67 }], ['home', 3600],
  ['lift', 0, { peak: 90 }], ['home', 3600],
  ['none', 61], ['session', 'fiction-session-b'], ['home', 1800],
  ['none', 10], ['session', 'fiction-session-c'], ['home', 1800]]);

describe('a day at home is one stay with no distance', () => {
  test('one row, the range\'s start and end both, 0 km — in the list, the summary and 「今天 x km」', () => {
    const model = timeline(atHome);
    const rows = timelinePresentation(model.nodes);
    expect(rows.map(n => n.type)).toEqual(['stop']);
    // (Still-here, or the visit the lift cut joined again: one stay either way.)
    expect(rows[0]).toMatchObject({ number: null, start: atHome[0].time, end: atHome.at(-1).time });
    expect(rangeEndRows(rows)).toEqual({ start: 0, end: 0 });
    expect(model.distanceM).toBe(0);
    expect(rowMetres(model)).toBe(0);
    expect(todayRouteDistance(atHome, { now: atHome.at(-1).time + SECOND, dayStart }).metres).toBe(0);
    expect(engineMetres(atHome)).toBe(0);
    expect(timelineClockMismatches(model.nodes)).toEqual([]);
    // No PR 116 fallback pieces beside it.
    expect(model.nodes.filter(n => n.presentationOnly === 'phone-stationary')).toEqual([]);
  });

  test('before these rules the lift alone counted metres', () => {
    const rows = atHome.map(phoneHistoryRow);
    const model = timeline(atHome, { config: { ...config, driftWalkFixes: null } });
    expect(model.distanceM).toBeGreaterThan(50);
    expect(rows).toHaveLength(atHome.length);
  });

  test('every minute of the day, as it is recorded, adds up', () => {
    for (let end = 600; end <= atHome.length; end += 600) {
      const prefix = atHome.slice(0, end);
      const model = timeline(prefix);
      expect(timelineClockMismatches(model.nodes)).toEqual([]);
      expect(rowMetres(model)).toBeCloseTo(model.distanceM, 6);
      expect(engineMetres(prefix)).toBeCloseTo(model.distanceM, 6);
    }
  });
});

describe('a drift trip counts nothing (countEdge)', () => {
  const counted = (rows, cfg = config) => timeline(rows, { config: cfg }).distanceM;

  test('the lift: coarse fixes, a vehicle\'s speed, back where it set off within minutes', () => {
    const lift = day([['home', 600], ['lift', 0, { peak: 90 }], ['home', 600]]);
    expect(counted(lift)).toBe(0);
    expect(counted(lift, { ...config, driftWalkFixes: null })).toBeGreaterThan(50);
  });

  test('a real short walk — to the letterbox and back on fine fixes — still counts', () => {
    const letterbox = day([['home', 600], ['walk', 60, { step: 11, every: 10 }],
      ['walk', 60, { step: -11, every: 10 }], ['home', 600]]);
    expect(counted(letterbox)).toBeGreaterThan(100);
  });

  test('a trip beyond stillPlaceM, or longer than excursionMs, is no drift', () => {
    const far = day([['home', 600], ['lift', 0, { peak: 140 }], ['home', 600]]);
    expect(counted(far)).toBeGreaterThan(0);
    const long = day([['home', 600], ['lift', 0, { peak: 90, minutes: 7 }], ['home', 600]]);
    expect(counted(long)).toBeGreaterThan(0);
  });

  test('「今天 x km」 takes the trip back too, whichever batch the rows come in', () => {
    const lift = day([['home', 1200], ['lift', 0, { peak: 90 }], ['home', 1200],
      ['walk', 300, { step: 11 }], ['home', 600]]);
    const whole = todayRouteDistance(lift, { now: lift.at(-1).time + SECOND, dayStart }).metres;
    expect(whole).toBeGreaterThan(250);
    for (const batch of [1, 7, 50, 400]) expect(engineMetres(lift, batch)).toBeCloseTo(whole, 6);
  });
});

describe('a visit that is the whole range always gives a row', () => {
  test('a real walk inside it splits it there: stay, walk, stay', () => {
    const rows = day([['home', 1800], ['walk', 120, { step: 11 }], ['walk', 120, { step: -11 }], ['home', 1800]]);
    const model = timeline(rows);
    const listed = timelinePresentation(model.nodes);
    expect(listed.map(n => n.type)).toEqual(['stop', 'movement', 'stop']);
    expect(listed.filter(n => n.type === 'stop').map(n => n.presentationOnly)).toEqual([undefined, undefined]);
    expect(rangeEndRows(listed)).toEqual({ start: 0, end: 2 });
    expect(listed[1].countedDistanceM).toBeGreaterThan(200);
    expect(rowMetres(model)).toBeCloseTo(model.distanceM, 6);
    expect(timelineClockMismatches(model.nodes)).toEqual([]);
  });
});

describe('unnumbered stays at one place split by a short break are one', () => {
  // Weak GPS indoors (30 m fixes, over the 25 m stay gate): no visit, only
  // PR 116's stationary runs — cut where the GPS jumped and where the
  // recorder restarted.
  const coarse = rows => rows.map(row => ({ ...row, accuracy: 30, raw_speed_kmh: 0, speed_kmh: 0 }));
  test.each([
    ['an app install of 10 s', [['home', 1800], ['none', 10], ['session', 'fiction-session-b'], ['home', 1800]]],
    ['an app install of 61 s', [['home', 1800], ['none', 61], ['session', 'fiction-session-b'], ['home', 1800]]],
    ['a GPS jump of 50 s', [['home', 1800], ['jump', 50, { metres: 67 }], ['home', 1800]]],
  ])('%s', (label, script) => {
    const rows = coarse(day(script));
    const model = timeline(rows);
    const listed = timelinePresentation(model.nodes);
    expect(listed.map(n => n.type)).toEqual(['stop']);
    expect(listed[0]).toMatchObject({ number: null, start: rows[0].time, end: rows.at(-1).time });
    expect(timelineClockMismatches(model.nodes)).toEqual([]);
  });

  test('a session change of over gapMs stays 「沒有資料」 between them', () => {
    const rows = coarse(day([['home', 1800], ['none', 240], ['session', 'fiction-session-b'], ['home', 1800]]));
    const listed = timelinePresentation(timeline(rows).nodes);
    expect(listed.map(n => n.type)).toEqual(['stop', 'gap', 'stop']);
    expect(listed[1].sessionChange).toBe(true);
  });

  test('two numbered stays at one place join over a short hole, never over a long one or apart', () => {
    const stay = (start, end, extra = {}) => ({ type: 'stop', number: 1, start, end, durationMs: end - start,
      ...at(0, 0), ...extra });
    const merge = nodes => mergePhoneSamePlaceStays(nodes, { config }).nodes;
    const joined = merge([stay(0, 600000), stay(605000, 1200000, { number: 2 })]);
    expect(joined).toHaveLength(1);
    expect(joined[0]).toMatchObject({ number: 1, start: 0, end: 1200000, durationMs: 1200000 });
    expect(merge([stay(0, 600000), stay(600000 + config.excursionMs + 1000, 1500000, { number: 2 })])).toHaveLength(2);
    expect(merge([stay(0, 600000), stay(605000, 1200000, { number: 2, ...at(0, 40) })])).toHaveLength(2);
  });
});

describe('the summary is the sum of the rows', () => {
  test('a coarse fix far out in the last stay is drift, not metres held for a next walk (10/13)', () => {
    // As the motion replay leaves them: home, one confirmed-moving Wi-Fi fix
    // 60 m off at 8.7 km/h (a walking speed: the coarse-fix rule lets it
    // count), home again — in the day's last stay, with no walk after it.
    const point = (seconds, north, extra = {}) => ({ time: clock(22, 9) + seconds * SECOND, ...at(north, 0),
      accuracy: 8, raw_speed_kmh: 0, speed_kmh: 0, speed_accuracy_mps: 0.2, motion_state: 'stationary',
      phoneMotionState: 'stationary', phoneStationary: true, phoneConfirmedMovement: false,
      session_id: 'fiction-session-a', ...extra });
    const points = [...Array.from({ length: 12 }, (_, i) => point(i * 5, 0)),
      point(65, 60, { accuracy: 30, raw_speed_kmh: 8.7, speed_kmh: 8.7, speed_accuracy_mps: 1.5,
        motion_state: 'moving', phoneMotionState: 'moving', phoneStationary: false, phoneConfirmedMovement: true }),
      ...Array.from({ length: 12 }, (_, i) => point(70 + i * 5, 0))];
    const counted = cfg => countDistances(points.slice(1).map((to, i) => historyEdge(points[i], to, 'phone', cfg)), cfg)
      .reduce((sum, e) => sum + e.countedDistanceM, 0);
    expect(counted({ ...config, driftWalkFixes: null })).toBeGreaterThan(50);
    expect(counted(config)).toBe(0);
  });

  test('pottering about the last stay on fine fixes keeps its metres in a row', () => {
    // A walk there, then a real move the visit's circle keeps inside, and no
    // walk after it: its metres are in a row. 2026-10-15 (user, #200): the
    // stay's own (「停 N 分・M m」), not the walk that arrived 20 min before.
    const rows = day([['walk', 300, { step: 11 }], ['home', 1200], ['walk', 30, { step: 3, every: 5 }],
      ['walk', 30, { step: -3, every: 5 }], ['home', 1200]]);
    const model = timeline(rows);
    expect(model.distanceM).toBeGreaterThan(340);
    expect(rowMetres(model)).toBeCloseTo(model.distanceM, 6);
    const shown = timelinePresentation(model.nodes);
    const stay = shown.at(-1).terminalStay ?? shown.at(-1);
    expect(stay.countedDistanceM).toBeGreaterThan(20);
    expect(shown.filter(foot).reduce((sum, n) => sum + n.countedDistanceM, 0)).toBeLessThan(340);
    expect(engineMetres(rows)).toBeCloseTo(model.distanceM, 6);
  });
});

describe('the edges of a stay', () => {
  test('a walk out and back of a minute right after a stay is no part of the next stay', () => {
    // As the motion replay leaves them: still, then a minute on foot at
    // 4 km/h on 4 m fixes out to 55 m and back to 20 m, then still there.
    const still = (seconds, east) => ({ time: clock(21, 30) + seconds * SECOND, ...at(0, east), accuracy: 5,
      raw_speed_kmh: 0.2, speed_kmh: 0.2, speed_accuracy_mps: 0.2, motion_state: 'stationary',
      phoneMotionState: 'stationary', phoneStationary: true, phoneConfirmedMovement: false, session_id: 'fiction-session-a' });
    const walking = (seconds, east) => ({ ...still(seconds, east), accuracy: 4, raw_speed_kmh: 4.2, speed_kmh: 4.2,
      speed_accuracy_mps: 0.3, motion_state: 'moving', phoneMotionState: 'moving', phoneStationary: false });
    const points = [...Array.from({ length: 48 }, (_, i) => still(i * 5, 0)),
      ...Array.from({ length: 6 }, (_, i) => walking(240 + i * 5, 5 + i * 5)),
      ...Array.from({ length: 6 }, (_, i) => walking(270 + i * 5, 30 + i * 5)),
      ...Array.from({ length: 7 }, (_, i) => walking(300 + i * 5, 50 - i * 5)),
      ...Array.from({ length: 120 }, (_, i) => still(335 + i * 5, 20))];
    const firstStill = points.find(p => p.time > clock(21, 34) && p.phoneStationary).time;
    const { visits } = historyStops(points, { subject: 'phone', config, start: points[0].time, end: points.at(-1).time,
      dayStart, dayEnd: dayEnd - 1 });
    const later = visits.filter(v => v.end > firstStill);
    expect(later).toHaveLength(1);
    expect(later[0].start).toBeGreaterThanOrEqual(firstStill);
    expect(visits.every(v => v.end <= clock(21, 34, 5) || v.start >= firstStill)).toBe(true);
  });

  test('a car parked for the evening: the phone waking in it is no drive', () => {
    // As the motion replay leaves them: a drive, parked and still, then the
    // phone silent at the spot for 40 minutes (a same-place break) and
    // waking for a minute — twice.
    const point = (seconds, east, extra = {}) => ({ time: clock(21) + seconds * SECOND, ...at(0, east),
      accuracy: 15, raw_speed_kmh: 0, speed_kmh: 0, speed_accuracy_mps: 0.6, motion_state: 'stationary',
      phoneMotionState: 'stationary', phoneStationary: true, phoneConfirmedMovement: false,
      session_id: 'fiction-session-a', ...extra });
    const moving = { raw_speed_kmh: 40, speed_kmh: 40, accuracy: 5, motion_state: 'moving',
      phoneMotionState: 'moving', phoneStationary: false, phoneConfirmedMovement: true };
    const awake = { phoneMotionState: 'moving', phoneStationary: false, motion_state: 'moving' };
    const points = [
      ...Array.from({ length: 60 }, (_, i) => point(i * 10, i * 110, moving)),
      ...Array.from({ length: 12 }, (_, i) => point(600 + i * 5, 6490)),
      point(3060, 6500, awake), ...Array.from({ length: 12 }, (_, i) => point(3065 + i * 5, 6495)),
      point(5520, 6490, awake), ...Array.from({ length: 12 }, (_, i) => point(5525 + i * 5, 6495))];
    const found = historyMovement(points, { subject: 'phone', config });
    expect(found.edges.some(e => e.bridged && e.durationMs > 30 * 60000)).toBe(true);
    expect(found.vehicles).toHaveLength(1);
    expect(found.vehicles[0].end).toBeLessThanOrEqual(points[71].time);
    const before = historyMovement(points, { subject: 'phone', config: { ...config, stillMps: config.stillMps,
      maxVehicleGapMs: Infinity } });
    expect(before.vehicles[0].end).toBeGreaterThan(points.at(-1).time - 60000);
  });
});
