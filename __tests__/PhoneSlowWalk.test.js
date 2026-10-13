import { PhoneMotion, phoneMotionPoint, replayPhoneMotion } from '../src/locationTracker/PhoneMotion';
import { PhoneMotion as ReferenceMotion } from '../test-support/PhoneMotionReference';
import { historyTimeline } from '../src/history/HistoryTimeline';
import { timelinePresentation } from '../src/history/HistoryTimelinePresentation';

// 2026-10-14 (user): slow dog walks were listed as numbered stays of 0 m.
// The live detector sees about one fix a second, but history replays the
// saved rows, 5 s apart below 10 km/h: their last 20 s spanned only 15–18 s,
// so the fine geometric departure (which needs 19 s) never ran, and a
// 3.6 km/h walk measures 1.0 ± 0.72 m/s, inside "not reliably moving".
// Fictional rows near Taoyuan Station: no real place, route, time or dog.
const MINUTE = 60000;
const dayStart = new Date(2026, 0, 12).getTime();
const dayEnd = new Date(2026, 0, 13).getTime();
const ORIGIN = { latitude: 24.9893, longitude: 121.3135 };
const NORTH = 1 / 111195, EAST = 1 / 100777;

// A script is a list of [kind, seconds, extra], one fix every 5 or 6 s in
// turn (saved rows are 5 s apart at the earliest; on the phone they average
// about 5.3 s): still — 0 ± 0.07 m/s; walk — `speed` m/s (default 1.0)
// heading `heading` degrees, measured with ± 0.72 m/s; drift — indoors at
// the same 3.8 m accuracy: the phone still (0 ± 0.1 m/s) but each fix
// `step` metres on.
function rows(script, { from = dayStart + 9 * 3600000, accuracy = 3.8 } = {}) {
  const out = [];
  let time = from, north = 0, east = 0, n = 0;
  const fix = (speedKmh, sacc, extra = {}) => {
    const latitude = ORIGIN.latitude + north * NORTH, longitude = ORIGIN.longitude + east * EAST;
    out.push({ id: out.length + 1, time, latitude, longitude, raw_latitude: latitude, raw_longitude: longitude,
      accuracy, raw_speed_kmh: speedKmh, speed_kmh: speedKmh, speed_accuracy_mps: sacc,
      motion_state: speedKmh ? 'moving' : 'stationary', session_id: 'fiction-session-1', ...extra });
  };
  for (const [kind, seconds, extra = {}] of script) {
    for (let k = 0, dt = 5; k < seconds; k += dt, time += dt * 1000) {
      dt = n++ % 2 ? 6 : 5;
      if (kind === 'still') fix(0, 0.07);
      if (kind === 'walk') {
        const speed = extra.speed ?? 1, heading = ((extra.heading ?? 0) + (n % 4 ? 4 : -4)) * Math.PI / 180;
        north += dt * speed * Math.cos(heading);
        east += dt * speed * Math.sin(heading);
        fix(speed * 3.6, 0.72);
      }
      if (kind === 'drift') {
        const heading = (extra.heading ?? 0) * Math.PI / 180;
        north += (extra.step ?? 5) * Math.cos(heading);
        east += (extra.step ?? 5) * Math.sin(heading);
        fix(0, 0.1);
      }
    }
  }
  return out;
}
const timeline = input => historyTimeline(input, { subject: 'phone', dayStart, dayEnd, today: false,
  following: false, now: input.at(-1).time + 1000, timezone: 'Asia/Taipei',
  range: { start: input[0].time, end: input.at(-1).time } });
// The day's stays (the first and last are listed with the departure / end).
const numbered = model => model.nodes.filter(n => n.type === 'stop' && !n.presentationOnly);
const walked = model => timelinePresentation(model.nodes)
  .filter(n => n.type === 'movement' && n.mode === 'walking')
  .reduce((sum, n) => sum + (n.countedDistanceM || 0), 0);
const between = (input, a, b) => input.filter(p => p.time >= input[0].time + a && p.time < input[0].time + b);

describe('a slow walk replayed from 5-second rows', () => {
  // 10 min at home, a 10 min walk at 3.6 km/h (600 m north), 10 min still.
  const input = rows([['still', 600], ['walk', 600], ['still', 600]]);

  test('leaves the stop within half a minute and is not held stationary', () => {
    const out = replayPhoneMotion(input);
    const walk = between(out, 10 * MINUTE, 20 * MINUTE);
    const firstMoving = walk.findIndex(p => !p.phoneStationary);
    expect(firstMoving).toBeGreaterThanOrEqual(0);
    expect(walk[firstMoving].time - walk[0].time).toBeLessThanOrEqual(30000);
    expect(walk.slice(firstMoving).every(p => !p.phoneStationary)).toBe(true);
    // Raw coordinates, not the stop's locked anchor.
    expect(walk.at(-1).latitude).toBe(walk.at(-1).raw_latitude);
  });

  test('is a walking row of about 600 m between two stays, not a stay of 0 m', () => {
    const model = timeline(input);
    const stays = numbered(model);
    expect(stays).toHaveLength(2);
    expect(stays[0].end - input[0].time).toBeLessThanOrEqual(10.5 * MINUTE);
    expect(walked(model)).toBeGreaterThan(540);
    expect(walked(model)).toBeLessThan(640);
  });

  test('every heading leaves (east, south-west)', () => {
    for (const heading of [90, 225]) {
      const model = timeline(rows([['still', 600], ['walk', 600, { heading }], ['still', 600]]));
      expect(numbered(model)).toHaveLength(2);
      expect(walked(model)).toBeGreaterThan(540);
    }
  });

  test('the incremental detector and the plain reference agree fix by fix', () => {
    const fast = new PhoneMotion(), plain = new ReferenceMotion();
    for (const row of input) {
      const point = { time: row.time, latitude: row.latitude, longitude: row.longitude, accuracy: row.accuracy,
        raw_speed_kmh: row.raw_speed_kmh, speed_accuracy_mps: row.speed_accuracy_mps };
      expect(fast.accept({ ...point })).toBe(plain.accept({ ...point }));
    }
  });
});

describe('indoor drift at the same accuracy stays one stay', () => {
  // 40 min at home; every 4 min the fixes run 5–6 m a row three or four
  // times (16–22 s, in a straight line, as indoor GPS does) while the speed
  // reads a confident 0, then settle where they ended.
  const script = [['still', 300]];
  for (let i = 0; i < 9; i += 1)
    script.push(['drift', 16 + (i % 2) * 6, { heading: i * 40, step: 5 + (i % 3) * 0.5 }], ['still', 220]);
  const input = rows(script);

  test('the replay never releases the lock', () => {
    const out = replayPhoneMotion(input);
    const locked = out.findIndex(p => p.phoneStationary);
    expect(locked).toBeGreaterThanOrEqual(0);
    expect(out.slice(locked).every(p => p.phoneStationary)).toBe(true);
    expect(out.some(p => p.phoneConfirmedMovement)).toBe(false);
  });

  test('one stay, no distance', () => {
    const model = timeline(input);
    // A day that never leaves lists its one stay without a departure.
    const stops = model.nodes.filter(n => n.type === 'stop');
    expect(stops.map(n => n.type)).toEqual(['stop']);
    expect(model.nodes.some(n => n.type === 'movement')).toBe(false);
    expect(model.distanceM).toBe(0);
  });
});

describe('a stop-and-go walk', () => {
  // 10 min still; 12 rounds of about 40 s walking at 1 m/s and 20 s
  // sniffing; 10 min still.
  const script = [['still', 600]];
  for (let i = 0; i < 12; i += 1) script.push(['walk', 40, { heading: (i % 2) * 20 }], ['still', 20]);
  script.push(['still', 600]);
  const input = rows(script);
  // The walked path: each walking fix's time since the previous fix, at 1 m/s.
  const path = input.reduce((sum, p, i) => sum + (i && p.raw_speed_kmh ? (p.time - input[i - 1].time) / 1000 : 0), 0);

  test('is one walk between two stays: the short sniffing stops are no stays', () => {
    const model = timeline(input);
    expect(numbered(model)).toHaveLength(2);
    // The first step of a round may go uncounted.
    expect(walked(model)).toBeGreaterThan(0.85 * path);
    expect(walked(model)).toBeLessThan(1.02 * path);
  });
});

describe('the reached-back window only counts a walk', () => {
  test('a car slowing down after sparse fixes is no confirmed (walking) movement', () => {
    const tracker = new PhoneMotion();
    let time = dayStart, north = 0;
    const accept = (speed, sacc) => phoneMotionPoint({ time, latitude: ORIGIN.latitude + north * NORTH,
      longitude: ORIGIN.longitude, accuracy: 4, raw_speed_kmh: speed * 3.6, speed_accuracy_mps: sacc }, tracker);
    // 7 m/s, a fix every 3 s, then one 6 s later reading 1.15 ± 0.76 m/s
    // (no reliable speed either way): its 20 s hold 18 s of fixes.
    for (let s = 0; s < 20; s += 1, time += 3000, north += 21) accept(7, 0.8);
    time += 3000; north += 20;
    const slow = accept(1.15, 0.76);
    expect(slow.phoneMotionState).not.toBe('stationary');
    expect(slow.phoneDepartureSince).toBeNull();
    expect(slow.phoneConfirmedMovement).toBe(false);
  });
});
