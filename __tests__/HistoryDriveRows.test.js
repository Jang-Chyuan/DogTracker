// 2026-10-14 (user): two shapes of 「我的路線」 around a drive.
// 1. A slow car (about 18 km/h) was listed inside the walk before it
//    (「走路 25 分・860 m」) and the next walk got its metres (「19 分・2.6
//    km」): a steady 15 km/h or more is a vehicle (config.cruiseMs), and a
//    move the speeds never covered no longer waits past a stay to count.
// 2. A stay the car left at once had a 0-minute numbered switch node after
//    it (no leave chevron, #168), and the stay after the drive no number:
//    the drive went on over the parked minutes until the walk.
// Every day here is invented: straight lines from made-up points near
// Taoyuan station, positions generated from speed × time.
import React from 'react';
import Renderer from 'react-test-renderer';
import { historyMovement } from '../src/history/HistoryMovement';
import { historyTimeline } from '../src/history/HistoryTimeline';
import { timelinePresentation } from '../src/history/HistoryTimelinePresentation';
import { phoneHistoryRow } from '../src/history/HistoryRows';
import { configFor, distanceMeters } from '../src/history/HistoryConfig';
import { createTodayRouteEngine } from '../src/tracking/TodayRouteEngine';
import { todayRouteDistance } from '../src/tracking/TodayDistance';
import HistoryTimelineList from '../src/mapHistory/HistoryTimelineList';
import { AddressLookupContext } from '../src/placement/AddressLookup';
import { departureClocks, timelineClockMismatches } from '../test-support/TimelineClocks';

const SECOND = 1000, MINUTE = 60 * SECOND;
const METRES_PER_DEGREE = 111195;
const offset = (base, north, east) => ({
  latitude: base.latitude + north / METRES_PER_DEGREE,
  longitude: base.longitude + east / (METRES_PER_DEGREE * Math.cos((base.latitude * Math.PI) / 180)),
});

// ---- 1. the slow car ------------------------------------------------------

// The screen fixture demo-slowcar (src/dev/ScreenFixtures legsPath and its
// recorder columns): a fix every 10 s, every fix saying 3.8 km/h and
// 「moving」 whatever the leg, a stay wobbling a metre or two.
function legsPath(now, fromAgo, from, legs, every = 10 * SECOND) {
  const out = [];
  let time = now - fromAgo, here = from, index = 0;
  for (const leg of legs) {
    const minutes = leg.walk ?? leg.stay ?? leg.drive;
    const until = time + minutes * MINUTE;
    const speed = leg.walk != null || leg.drive != null ? leg.speed : 0;
    const angle = ((leg.bearing ?? 45) * Math.PI) / 180;
    for (; time < until && time <= now - 5 * SECOND; time += every, index += 1) {
      if (speed) here = offset(here, Math.cos(angle) * speed * (every / SECOND), Math.sin(angle) * speed * (every / SECOND));
      const wobble = leg.stay != null ? ((index % 5) - 2) * 1.2 : 0;
      out.push({ time, fix: offset(here, wobble, -wobble / 2), leg });
    }
    time = until;
  }
  return out;
}
const NOW = new Date(2026, 9, 13, 9, 30).getTime();
const DAY_START = new Date(2026, 9, 13).getTime();
const slowCar = (walk = 0.8) => [{ stay: 8 }, { walk: 18, bearing: 30, speed: walk },
  { drive: 4, speed: 5, bearing: 100 }, { drive: 3, speed: 5, bearing: 20 }, { stay: 22 },
  { walk: 20, bearing: 220, speed: walk }, { stay: 6 }];
const SLOW_CAR = slowCar();
const START = { latitude: 24.9893 - 0.006, longitude: 121.3135 - 0.012 };
// measured: the leg's own speed (stays 0, stationary) instead of the
// fixture's constant 3.8 km/h.
const slowCarRows = ({ measured = false, legs = SLOW_CAR } = {}) => legsPath(NOW, 95 * MINUTE, START, legs)
  .map(({ time, fix, leg }, i) => phoneHistoryRow({ id: i + 1, time, latitude: fix.latitude, longitude: fix.longitude,
    accuracy: 6, accuracy_meters: 6, location_at: time - 400, raw_latitude: fix.latitude, raw_longitude: fix.longitude,
    session_id: 'fixture-walk', speed_kmh: 3.6, speed_accuracy_mps: 0.4, display_source: 'pipeline',
    raw_speed_kmh: measured ? (leg.stay != null ? 0 : leg.speed * 3.6) : 3.8,
    motion_state: measured && leg.stay != null ? 'stationary' : 'moving' }));
const legStart = n => NOW - 95 * MINUTE + SLOW_CAR.slice(0, n).reduce((sum, leg) => sum + (leg.walk ?? leg.stay ?? leg.drive), 0) * MINUTE;
const timeline = (rows, extra = {}) => historyTimeline(rows, { subject: 'phone', dayStart: DAY_START,
  dayEnd: DAY_START + 86400000, today: true, now: NOW, ...extra });
// The path a row's own fixes draw (and a minute either side: the rows'
// edges are the list's): no row counts more than its own segment.
const ownPath = (model, row) => {
  const fixes = model.dayPoints.filter(p => p.time >= row.start - MINUTE && p.time <= row.end + MINUTE);
  return fixes.slice(1).reduce((sum, p, i) => sum + distanceMeters(fixes[i], p), 0);
};
const walks = rows => rows.filter(n => n.type === 'movement' && n.mode === 'walking');

describe('demo-slowcar: a car at 18 km/h', () => {
  // Measured, the walks are 1.3 m/s: a 0.8 m/s walk measured at 0.8 ± 0.4
  // with 10 s fixes never leaves PhoneMotion's stop (the recorder saves 5 s
  // rows below 10 km/h).
  test.each([['the fixture as it is (every fix says 3.8 km/h)', false, 0.8], ['speeds measured', true, 1.3]])('%s: a drive of its own, each walk its own metres', (_, measured, walk) => {
    const model = timeline(slowCarRows({ measured, legs: slowCar(walk) }));
    const rows = timelinePresentation(model.nodes);
    const drives = rows.filter(n => n.type === 'movement' && n.mode === 'driving');
    expect(drives).toHaveLength(1);
    // The drive is the car's 7 minutes (to the 10 s fix), not part of the walk.
    expect(Math.abs(drives[0].start - legStart(2))).toBeLessThanOrEqual(20 * SECOND);
    expect(Math.abs(drives[0].end - legStart(4))).toBeLessThanOrEqual(60 * SECOND);
    const [before, after] = walks(rows);
    expect(before.end).toBeLessThanOrEqual(drives[0].start);
    // 18 min and 20 min at the walk's speed (864 m and 960 m at 0.8 m/s).
    expect(before.countedDistanceM).toBeGreaterThan(18 * 60 * walk * 0.9);
    expect(before.countedDistanceM).toBeLessThan(18 * 60 * walk * 1.05);
    expect(after.countedDistanceM).toBeGreaterThan(20 * 60 * walk * 0.9);
    expect(after.countedDistanceM).toBeLessThan(20 * 60 * walk * 1.05);
    for (const row of walks(rows)) expect(row.countedDistanceM).toBeLessThanOrEqual(ownPath(model, row) + 1);
    // Walk → car is a switch point (1); the stay where the car stopped is
    // stay 2. The times add up.
    expect(rows[rows.indexOf(drives[0]) - 1]).toMatchObject({ type: 'switch', number: 1 });
    expect(rows[rows.indexOf(drives[0]) + 1]).toMatchObject({ type: 'stop', number: 2 });
    expect(timelineClockMismatches(model.nodes)).toEqual([]);
    for (const clocks of departureClocks(model.nodes)) expect(clocks.stay).toBe(clocks.next);
  });

  test('without the cruise rule the car is walking, yet no row gets another row\'s metres', () => {
    const model = timeline(slowCarRows(), { config: { ...configFor('phone'), cruiseMs: null } });
    const rows = timelinePresentation(model.nodes);
    expect(rows.some(n => n.mode === 'driving')).toBe(false);
    const [before, after] = walks(rows);
    // The car's 2.1 km never had speeds to cover it: not counted at all
    // (it used to be counted inside the stay and go to the next walk).
    expect(before.countedDistanceM).toBeLessThan(864 * 1.05);
    expect(after.countedDistanceM).toBeGreaterThan(960 * 0.9);
    expect(after.countedDistanceM).toBeLessThan(960 * 1.05);
    for (const row of walks(rows)) expect(row.countedDistanceM).toBeLessThanOrEqual(ownPath(model, row) + 1);
    expect(model.edges.filter(e => e.countedDistanceM > 100)).toEqual([]);
  });
});

// Invented phone fixes, 5 s apart, a straight line north. Phases are
// [metres per second, seconds]; each fix measures its phase's speed.
const route = (phases, { accuracy = 8, start = Date.UTC(2026, 0, 5, 1) } = {}) => {
  let time = start, metres = 0;
  const make = speed => ({ time, latitude: 24.989 + metres / METRES_PER_DEGREE, longitude: 121.313,
    raw_latitude: 24.989 + metres / METRES_PER_DEGREE, raw_longitude: 121.313,
    accuracy, raw_speed_kmh: Math.abs(speed) * 3.6, speed_accuracy_mps: 0.3,
    phoneMotionState: speed ? 'moving' : 'stationary', phoneStationary: !speed,
    phoneConfirmedMovement: !!speed, session_id: 'invented-cruise' });
  const points = [make(phases[0][0])];
  for (const [speed, seconds] of phases) for (let t = 0; t < seconds; t += 5) {
    time += 5000; metres += speed * 5; points.push(make(speed));
  }
  return points;
};
const kmh = value => value / 3.6;
const movement = (points, config = configFor('phone')) => historyMovement(points, { subject: 'phone', config });

describe('15 km/h and up, held for two minutes, is a vehicle; walking and running are not', () => {
  test.each([
    ['a bike at 16 km/h for 5 minutes', [[0, 60], [kmh(16), 300], [0, 60]]],
    ['a slow car at 15.5 km/h for 2.5 minutes', [[0, 60], [kmh(15.5), 150], [0, 60]]],
    ['a slow car at 17 km/h between two walks', [[1.3, 300], [kmh(17), 240], [1.3, 300]]],
  ])('%s', (_, phases) => {
    const model = movement(route(phases));
    expect(model.vehicles).toHaveLength(1);
    const cruise = phases.find(([speed]) => speed >= kmh(15));
    const [vehicle] = model.vehicles;
    // The whole cruise, from its first fix.
    const start = route(phases)[0].time + phases.slice(0, phases.indexOf(cruise)).reduce((s, [, t]) => s + t, 0) * 1000;
    expect(vehicle.start).toBe(start);
    expect(vehicle.end - vehicle.start).toBeGreaterThanOrEqual(cruise[1] * 1000);
  });

  test.each([
    ['a brisk walk at 7 km/h', [[0, 60], [kmh(7), 1200], [0, 60]]],
    ['a jog at 12 km/h', [[0, 60], [kmh(12), 600], [0, 60]]],
    ['a run at 14.4 km/h (4:10 /km)', [[0, 60], [kmh(14.4), 600], [0, 60]]],
    ['a 40 s sprint at 16 km/h in a walk', [[1.3, 300], [kmh(16), 40], [1.3, 300]]],
    ['a 110 s dash at 17 km/h', [[1.3, 300], [kmh(17), 110], [1.3, 300]]],
  ])('%s stays on foot, its metres counted', (_, phases) => {
    const points = route(phases);
    const model = movement(points);
    expect(model.vehicles).toHaveLength(0);
    const path = phases.reduce((sum, [speed, seconds]) => sum + Math.abs(speed) * seconds, 0);
    expect(model.distanceM).toBeGreaterThan(path * 0.95);
    expect(model.distanceM).toBeLessThanOrEqual(path + 1);
  });

  test('fast steps that get nowhere, or on coarse fixes, are no cruise', () => {
    // Back and forth at 16 km/h for 5 minutes: no progress.
    const shuttle = Array.from({ length: 15 }, (_, i) => [i % 2 ? -kmh(16) : kmh(16), 20]);
    expect(movement(route([[0, 60], ...shuttle, [0, 60]])).vehicles).toHaveLength(0);
    // Fixes coarser than coarseConfirmedAccuracyM prove no cruise.
    expect(movement(route([[0, 60], [kmh(16), 300], [0, 60]], { accuracy: 30 })).vehicles).toHaveLength(0);
    // A dog has no cruise rule.
    expect(configFor('dog').cruiseMs).toBeUndefined();
  });

  test('today distance (row by row) agrees with the whole-day answer', () => {
    for (const phases of [[[1.3, 300], [kmh(17), 240], [1.3, 300]], [[1.3, 200], [kmh(16), 110], [1.3, 200]],
      [[0, 60], [kmh(15.5), 150], [0, 120], [1.3, 300]]]) {
      const rows = route(phases);
      const dayStart = rows[0].time - 60000;
      for (const step of [1, 7, 25]) {
        const engine = createTodayRouteEngine({ dayStart });
        for (let i = 0; i < rows.length; i += step) {
          const prefix = rows.slice(0, Math.min(i + step, rows.length));
          engine.add(prefix.slice(i));
          const now = prefix.at(-1).time;
          expect(engine.sum(now).metres).toBeCloseTo(todayRouteDistance(prefix, { now, dayStart }).metres, 6);
        }
      }
    }
  });
});

// ---- 2. a stay the car leaves at once --------------------------------------

// The invented phone day of HistoryTimeClocks: 5 s fixes, still fixes
// measuring 0 (stationary), a walk at 5 km/h, a drive at 50 km/h from the
// very next fix after a stay.
function day(script, from) {
  const rows = [];
  let s = 0, east = 0;
  const fix = extra => rows.push({ time: from + s * 1000, latitude: 24.9892, longitude: 121.3138 + east / 101000,
    accuracy: 4, raw_speed_kmh: 0, speed_kmh: 0, speed_accuracy_mps: 0.4, motion_state: 'stationary',
    session_id: 'fiction-session', ...extra });
  for (const [kind, seconds] of script) {
    for (let k = 0; k < seconds; k += 5, s += 5) {
      if (kind === 'walk') {
        east += 7;
        fix({ raw_speed_kmh: 5.04, speed_kmh: 5.04, motion_state: 'moving' });
      } else if (kind === 'drive') {
        east += 70;
        fix({ raw_speed_kmh: 50.4, speed_kmh: 50.4, motion_state: 'moving' });
      } else fix({});
    }
  }
  return rows;
}
const stayDriveDay = [['still', 1200], ['walk', 600], ['still', 900], ['drive', 480], ['still', 900],
  ['walk', 600], ['still', 1200]];
const phoneDay = (script, { offsetMs = 0, manual = false } = {}) => {
  const from = DAY_START + 8 * 3600000 + offsetMs;
  const rows = day(script, from);
  return historyTimeline(rows, { subject: 'phone', dayStart: DAY_START, dayEnd: DAY_START + 86400000,
    ...(manual ? { manualRange: { start: rows[0].time, end: rows.at(-1).time } } : {}) });
};
const variants = [0, 37000].flatMap(offsetMs => [false, true].map(manual => [offsetMs, manual]));

describe('stay → drive at once → stay → walk', () => {
  test.each(variants)('offset %s ms, manual range %s: no switch node, numbers 1, 2, a chevron after every stay', (offsetMs, manual) => {
    const model = phoneDay(stayDriveDay, { offsetMs, manual });
    expect(model.nodes.filter(n => n.type === 'switch')).toEqual([]);
    const rows = timelinePresentation(model.nodes);
    const stays = rows.filter(n => n.type === 'stop');
    // The detected range starts at the walk (出發); the dragged one at the
    // first stay (the hollow start circle, no number).
    expect(stays.map(n => n.number ?? n.listedWith ?? n.presentationOnly))
      .toEqual([...(manual ? ['start'] : []), 1, 2, 'end']);
    // The stay the car left, and the one it parked at, are real stays.
    const drive = rows.find(n => n.mode === 'driving');
    expect(rows[rows.indexOf(drive) - 1]).toMatchObject({ type: 'stop', number: 1 });
    expect(rows[rows.indexOf(drive) + 1]).toMatchObject({ type: 'stop', number: 2 });
    expect(rows[rows.indexOf(drive) + 1].presentationOnly).toBeUndefined();
    // Every stay but the last is left along a movement row: its chevron.
    stays.slice(0, -1).forEach(stay => expect(rows[rows.indexOf(stay) + 1].type).toBe('movement'));
    expect(departureClocks(model.nodes)).toHaveLength(manual ? 3 : 2);
    for (const clocks of departureClocks(model.nodes)) expect(clocks.stay).toBe(clocks.next);
    expect(timelineClockMismatches(model.nodes)).toEqual([]);
  });

  test('on screen: three leave chevrons', async () => {
    const lookup = { lookup: () => null, subscribe: () => () => {} };
    let renderer;
    await Renderer.act(async () => { renderer = Renderer.create(<AddressLookupContext.Provider value={lookup}>
      <HistoryTimelineList model={phoneDay(stayDriveDay, { manual: true })} color="#1A73E8" />
    </AddressLookupContext.Provider>); });
    const chevrons = renderer.root.findAll(node => typeof node.type === 'string' && node.props.testID === 'leave-chevron');
    expect(chevrons).toHaveLength(3);
    await Renderer.act(async () => renderer.unmount());
  });

  test('a drive straight into a stay has no switch node either; a walk that becomes a drive keeps its switch', () => {
    const intoStay = phoneDay([['still', 600], ['walk', 300], ['drive', 300], ['still', 900]]);
    expect(intoStay.nodes.filter(n => n.type === 'switch')).toHaveLength(1);
    const listed = timelinePresentation(intoStay.nodes);
    const drive = listed.find(n => n.mode === 'driving');
    expect(listed[listed.indexOf(drive) - 1].type).toBe('switch');
    expect(listed[listed.indexOf(drive) + 1].type).toBe('stop');
    expect(timelineClockMismatches(intoStay.nodes)).toEqual([]);
    const straight = phoneDay([['still', 600], ['drive', 300], ['still', 900]], { manual: true });
    expect(straight.nodes.filter(n => n.type === 'switch')).toEqual([]);
    expect(timelinePresentation(straight.nodes).map(n => n.type + (n.mode ? `:${n.mode}` : '')))
      .toEqual(['stop', 'movement:driving', 'stop']);
  });
});
