import { PhoneMotion, replayPhoneMotion } from '../src/locationTracker/PhoneMotion';
import { historyTimeline, phoneStationaryPresentationStops } from '../src/history/HistoryTimeline';
import { timelinePresentation } from '../src/history/HistoryTimelinePresentation';
import { todayRouteDistance } from '../src/tracking/TodayDistance';
import { historyVisits } from '../src/history/HistoryStops';

// Fictional phone fixes: x metres north, y metres east of an invented origin.
// A phone standing indoors with only Wi-Fi-like 30–50 m fixes (as when the
// system stops GPS on a still phone) must stay a stop, never become a walk.
const base = 1600000000000;
const fix = (seconds, x = 0, y = 0, extra = {}) => ({ time: base + seconds * 1000,
  latitude: 25 + x / 111195, longitude: 121 + y / 100777, accuracy: 8,
  raw_speed_kmh: 0, speed_kmh: 0, speed_accuracy_mps: 0.3, motion_state: 'moving',
  session_id: 'fiction-session', ...extra });
const wobble = (i, metres) => [metres * Math.sin(i * 1.3), metres * Math.cos(i * 0.7)];
const coarse = i => [35, 40, 45, 48][i % 4];
const states = (tracker, rows) => rows.map(p => tracker.accept(p));
const lock = (tracker, accuracy = 20) => {
  states(tracker, Array.from({ length: 21 }, (_, i) => fix(i + 1, 0, 0, { accuracy })));
  expect(tracker.state).toBe('stationary');
};

describe('the phone motion detector with 30–50 m fixes', () => {
  test.each([1, 5])('a locked stop stays locked on still coarse fixes (every %is)', step => {
    const tracker = new PhoneMotion(); lock(tracker);
    const rows = [];
    for (let t = 22; t <= 1200; t += step) rows.push(fix(t, ...wobble(t, 18), {
      accuracy: coarse(t), speed_accuracy_mps: t % 7 ? 0.3 : null }));
    expect(states(tracker, rows).every(s => s === 'stationary')).toBe(true);
  });

  test('coarse fixes cannot confirm a stop on their own', () => {
    const tracker = new PhoneMotion();
    const rows = Array.from({ length: 600 }, (_, i) => fix(i + 1, ...wobble(i, 15), { accuracy: coarse(i) }));
    expect(states(tracker, rows).includes('stationary')).toBe(false);
  });

  test('coarse fixes settled well beyond the accuracy-scaled radius end the stop', () => {
    const tracker = new PhoneMotion(); lock(tracker, 14);
    const rows = Array.from({ length: 400 }, (_, i) => fix(i + 22, 60 + (i % 3), 50, { accuracy: 45 }));
    const result = states(tracker, rows);
    // The usual 3-minute grace, then no longer stationary.
    expect(result.slice(0, 170).every(s => s === 'stationary')).toBe(true);
    expect(result.at(-1)).toBe('unknown');
  });

  test('a measured coarse walk leaves within seconds', () => {
    const tracker = new PhoneMotion(); lock(tracker, 14);
    const rows = Array.from({ length: 60 }, (_, i) => fix(i + 22, (i + 1) * 0.96, (i + 1) * 0.72,
      { accuracy: 40, raw_speed_kmh: 4.32, speed_kmh: 4.32 }));
    expect(states(tracker, rows).indexOf('moving')).toBeLessThanOrEqual(3);
  });

  test('a slow walk whose speed only overlaps zero is not kept past the usual grace', () => {
    const tracker = new PhoneMotion(); lock(tracker, 14);
    const rows = Array.from({ length: 400 }, (_, i) => fix(i + 22, (i + 1) * 0.42, (i + 1) * 0.56,
      { accuracy: 45, raw_speed_kmh: 2.52, speed_kmh: 2.52 }));
    const result = states(tracker, rows);
    expect(result.findIndex(s => s !== 'stationary')).toBeLessThanOrEqual(181);
    expect(result.slice(200).includes('stationary')).toBe(false);
  });

  test('a wrong-zero coarse walk still leaves: by geometry or the grace beyond the radius', () => {
    const tracker = new PhoneMotion(); lock(tracker);
    const rows = Array.from({ length: 700 }, (_, i) => fix(i + 22, (i + 1) * 0.5, (i + 1) * 0.5, { accuracy: 40 }));
    const result = states(tracker, rows);
    const left = result.findIndex(s => s !== 'stationary');
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThan(330);
    expect(result.slice(left).includes('stationary')).toBe(false);
  });
});

// Walk in (5 min), stand still 15 min, walk on (5 min); 5 s rows as recorded.
function day({ fineFirst = true, metres = 18 } = {}) {
  const rows = [];
  for (let s = 0; s < 300; s += 5) rows.push(fix(s, s * 1.2, 0, { raw_speed_kmh: 4.32, speed_kmh: 4.32 }));
  const coarseFrom = fineFirst ? 420 : 300;
  for (let s = 300; s < coarseFrom; s += 5) rows.push(fix(s, 360 + (s % 2)));
  for (let s = coarseFrom; s < 1320; s += 5) {
    const [x, y] = wobble(s / 5, metres);
    rows.push(fix(s, 360 + x, y, { accuracy: coarse(s / 5) }));
  }
  for (let s = 1320; s < 1620; s += 5) rows.push(fix(s, 360 + (s - 1320) * 1.2, 0,
    { raw_speed_kmh: 4.32, speed_kmh: 4.32 }));
  return rows;
}
const timeline = rows => historyTimeline(rows, { subject: 'phone', dayStart: base,
  dayEnd: base + 86400000, range: { start: rows[0].time, end: rows.at(-1).time } });
const walks = model => timelinePresentation(model.nodes)
  .filter(n => n.type === 'movement' && n.mode === 'walking');

describe('history of a phone standing still on coarse fixes', () => {
  test.each([18, 30])('a stop then 15 min of coarse fixes (±%i m) is one stop, not a walk', metres => {
    const rows = day({ metres }), raw = JSON.stringify(rows);
    const model = timeline(rows);
    const stop = model.nodes.find(n => n.type === 'stop');
    expect(stop).toBeDefined();
    expect(stop.start).toBeLessThanOrEqual(base + 300000);
    expect(stop.end).toBeGreaterThanOrEqual(base + 1315000);
    // Placed only by the fixes within 25 m.
    const judged = stop.points.filter(p => p.accuracy <= 25);
    expect(stop.latitude).toBeCloseTo(judged.reduce((sum, p) => sum + p.latitude, 0) / judged.length, 12);
    // No walk row takes the standing time.
    for (const walk of walks(model)) expect(walk.durationMs).toBeLessThanOrEqual(5 * 60000);
    expect(model.distanceM).toBeGreaterThan(650);
    expect(model.distanceM).toBeLessThan(730);
    expect(JSON.stringify(rows)).toBe(raw);
  });

  test('coarse fixes with no stop confirmed first are weak GPS, never walking time', () => {
    const rows = day({ fineFirst: false });
    const model = timeline(rows);
    const still = model.edges.filter(e => e.start >= base + 305000 && e.end <= base + 1315000);
    expect(still.length).toBeGreaterThan(150);
    expect(still.every(e => e.mode === 'gap' && e.uncertain && e.stillUnplaced && e.countedDistanceM === 0)).toBe(true);
    // The <30-minute fold must not make it 「走路 27 分」: it is an unnumbered stay.
    const rowsShown = timelinePresentation(model.nodes);
    const stay = rowsShown.find(n => n.type === 'stop');
    expect(stay).toMatchObject({ presentationOnly: 'phone-stationary', number: null, coarse: true });
    expect(stay.end - stay.start).toBeGreaterThanOrEqual(16 * 60000);
    const foot = rowsShown.filter(n => n.type === 'movement' && n.mode === 'walking');
    expect(foot).toHaveLength(2);
    for (const walk of foot) expect(walk.end - walk.start).toBeLessThanOrEqual(5 * 60000 + 5000);
    expect(model.distanceM).toBeGreaterThan(650);
  });

  test('weak GPS of a still phone right after a stay is that stay\'s time', () => {
    // Stay 5 min on good fixes, 60 s without a saved row (the detector
    // restarts), then 15 min of coarse still fixes there, then walk on.
    const rows = [];
    for (let s = 0; s < 300; s += 5) rows.push(fix(s, s * 1.2, 0, { raw_speed_kmh: 4.32, speed_kmh: 4.32 }));
    for (let s = 300; s < 600; s += 5) rows.push(fix(s, 360 + (s % 2)));
    for (let s = 660; s < 1560; s += 5) rows.push(fix(s, 360 + wobble(s / 5, 18)[0], wobble(s / 5, 18)[1],
      { accuracy: coarse(s / 5) }));
    for (let s = 1560; s < 1860; s += 5) rows.push(fix(s, 360 + (s - 1560) * 1.2, 0,
      { raw_speed_kmh: 4.32, speed_kmh: 4.32 }));
    const model = timeline(rows);
    expect(model.edges.filter(e => e.stillUnplaced).length).toBeGreaterThan(150);
    const shown = timelinePresentation(model.nodes);
    const stays = shown.filter(n => n.type === 'stop');
    expect(stays).toHaveLength(1);
    expect(stays[0].number).toBe(1);
    expect(stays[0].end).toBeGreaterThanOrEqual(base + 1555000);
    expect(shown.filter(n => n.type === 'movement' && n.mode === 'walking')
      .every(n => n.end - n.start <= 5 * 60000 + 5000)).toBe(true);
  });

  test.each([[0.02, 1], [0.5, 0]])('still weak GPS drifting %s m/s gives %i unnumbered stay', (speed, count) => {
    // Synthetic edges: weak GPS of a phone measuring itself still, 40 m fixes.
    const p = (s, extra = {}) => ({ ...fix(s, s * speed, 0, { accuracy: 40 }), raw_latitude: 25 + s * speed / 111195,
      raw_longitude: 121, phoneMotionState: 'unknown', phoneStationary: false, phoneConfirmedMovement: false, ...extra });
    const edges = Array.from({ length: 120 }, (_, i) => ({ from: p(i * 5), to: p(i * 5 + 5),
      start: base + i * 5000, end: base + i * 5000 + 5000, durationMs: 5000, gap: true, uncertain: true,
      stillUnplaced: true, bridged: false, mode: 'gap', countedDistanceM: 0 }));
    const stops = phoneStationaryPresentationStops(edges);
    expect(stops).toHaveLength(count);
    if (count) expect(stops[0]).toMatchObject({ number: null, coarse: true, accuracyM: 40 });
    // Without stillUnplaced the same weak GPS proves nothing.
    expect(phoneStationaryPresentationStops(edges.map(e => ({ ...e, stillUnplaced: false })))).toEqual([]);
  });

  test('today\'s distance agrees with the history for both', () => {
    for (const rows of [day(), day({ fineFirst: false })]) {
      const now = rows.at(-1).time;
      const today = todayRouteDistance(rows, { now, dayStart: base });
      const model = historyTimeline(rows, { subject: 'phone', dayStart: base, dayEnd: base + 86400000,
        today: true, now });
      expect(today.metres).toBeCloseTo(model.distanceM, 6);
    }
  });

  test('a coarse still stretch measuring a real slow walk is still walking', () => {
    const rows = [...Array.from({ length: 30 }, (_, i) => fix(i * 5)),
      ...Array.from({ length: 120 }, (_, i) => fix(150 + i * 5, (i + 1) * 5 * 0.8, 0,
        { accuracy: 40, raw_speed_kmh: 2.88, speed_kmh: 2.88, speed_accuracy_mps: 0.4 }))];
    const replay = replayPhoneMotion(rows);
    expect(replay.slice(30).some(p => p.phoneMotionState === 'unknown')).toBe(true);
    const model = timeline(rows);
    expect(model.edges.filter(e => e.start >= base + 400000).every(e => !e.uncertain)).toBe(true);
    expect(model.distanceM).toBeGreaterThan(300);
  });
});

test('a coarse locked fix never extends a visit across a recording session change', () => {
  const locked = (seconds, extra = {}) => ({ ...fix(seconds, 0, 0, extra), raw_latitude: 25, raw_longitude: 121,
    phoneMotionState: 'stationary', phoneStationary: true, phoneConfirmedMovement: false });
  const points = session => [...Array.from({ length: 13 }, (_, i) => locked(i * 5)),
    ...Array.from({ length: 30 }, (_, i) => locked(65 + i * 5, { accuracy: 40,
      session_id: i < 10 ? 'fiction-session' : session }))];
  const same = historyVisits(points('fiction-session'), { subject: 'phone' });
  expect(same).toHaveLength(1);
  expect(same[0].end).toBe(base + 210000);
  const changed = historyVisits(points('another-fiction-session'), { subject: 'phone' });
  expect(changed[0].end).toBe(base + 110000);
});
