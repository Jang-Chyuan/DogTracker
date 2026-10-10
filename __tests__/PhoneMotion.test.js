import { PhoneMotion, phoneMotionPoint, replayPhoneMotion } from '../src/locationTracker/PhoneMotion';
import { historyTimeline } from '../src/history/HistoryTimeline';
import { phoneHistoryRow } from '../src/history/HistoryRows';
import { sectionText } from '../src/history/HistoryText';
import { t as translate } from '../src/i18n';

const sample = (seconds, metres = 0, options = {}) => ({
  time: seconds * 1000, latitude: 25 + metres / 111195, longitude: 121,
  accuracy: 14, raw_speed_kmh: 0, speed_accuracy_mps: 0.3, ...options,
});
const parked = tracker => {
  for (let t = 1; t <= 21; t += 1) tracker.accept(sample(t));
  expect(tracker.state).toBe('stationary');
};
test('normal indoor accuracy is usable; a shifted compact group stays locked', () => {
  const tracker = new PhoneMotion(); parked(tracker);
  for (let t = 22; t < 300; t += 1) expect(tracker.accept(sample(t, 65 + (t % 2)))).toBe('stationary');
});
test('credible speed exits within three seconds', () => {
  const tracker = new PhoneMotion(); parked(tracker);
  for (let t = 22; t < 25; t += 1) expect(tracker.accept(sample(t, (t - 21) * 2,
    { raw_speed_kmh: 7.2, speed_accuracy_mps: 0.1 }))).toBe('stationary');
  expect(tracker.accept(sample(25, 8, { raw_speed_kmh: 7.2, speed_accuracy_mps: 0.1 }))).toBe('moving');
});
test.each([0.2, 0.4, 0.8])('coarse wrong-zero walk at %sm/s cannot remain locked', speed => {
  const tracker = new PhoneMotion(); parked(tracker);
  let release = null;
  for (let t = 22; t <= 650; t += 1) {
    if (tracker.accept(sample(t, (t - 21) * speed)) === 'moving') { release = t; break; }
  }
  expect(release).not.toBeNull();
  expect(release - 21).toBeLessThanOrEqual(360);
});
test('fine slow walk never enters stationary', () => {
  const tracker = new PhoneMotion();
  for (let t = 1; t < 200; t += 1) expect(tracker.accept(sample(t, t * 0.4,
    { accuracy: 3, raw_speed_kmh: 1.44, speed_accuracy_mps: 0.1 }))).not.toBe('stationary');
});
test('missing speed expires after a bounded grace; a long signal gap resets', () => {
  const tracker = new PhoneMotion(); parked(tracker);
  for (let t = 22; t <= 201; t += 1) expect(tracker.accept(sample(t, 0,
    { raw_speed_kmh: null }))).toBe('stationary');
  expect(tracker.accept(sample(202, 0, { raw_speed_kmh: null }))).toBe('unknown');
  parked(tracker);
  expect(tracker.accept(sample(1000))).toBe('moving');
});
test('raw speed and coordinates survive a display lock', () => {
  const tracker = new PhoneMotion();
  for (let t = 1; t <= 21; t += 1) phoneMotionPoint(sample(t), tracker);
  const output = phoneMotionPoint(sample(22, 65, { raw_latitude: 25 + 65 / 111195,
    raw_longitude: 121, raw_speed_kmh: 0.36 }), tracker);
  expect(output.latitude).toBe(25);
  expect(output.raw_latitude).toBe(25 + 65 / 111195);
  expect(output.raw_speed_kmh).toBe(0.36);
});
test('a missing-speed sample does not poison stationary distance indefinitely', () => {
  const rows = Array.from({ length: 600 }, (_, i) => sample(i * 5 + 1,
    i < 120 ? 0 : 65 + Math.sin(i / 7) * 3, { accuracy: 14,
      raw_speed_kmh: i === 20 ? null : 0 }));
  const model = historyTimeline(rows.map(phoneHistoryRow), { subject: 'phone', today: false });
  expect(model.departure.status).toBe('undetermined');
  expect(model.range.start).toBe(rows[0].time);
  expect(model.distanceM).toBeLessThan(1);
  expect(replayPhoneMotion(rows).filter(p => p.phoneStationary).length).toBeGreaterThan(500);
});
test('confirmed wrong-zero departure restores the observed walk, excluding an older offset cluster', () => {
  const rows = Array.from({ length: 1000 }, (_, i) => sample(i + 1,
    i < 60 ? 0 : i < 240 ? 65 : 65 + (i - 240) * 0.4));
  const model = historyTimeline(rows.map(phoneHistoryRow), { subject: 'phone', today: false,
    range: { start: rows[0].time, end: rows.at(-1).time } });
  // The unconfirmed final tail is not funded by a perpetual departure flag.
  // Preserve at least 90% of the physical walk and exclude the earlier jump.
  expect(model.distanceM).toBeGreaterThan(759 * 0.4 * 0.9);
  expect(model.distanceM).toBeLessThan(320);
  const restored = model.points.filter(p => p.phoneConfirmedMovement);
  expect(restored[0].time).toBeGreaterThan(220000);
  expect(restored[0].time).toBeLessThan(255000);
  expect(model.points.filter(p => p.time > 60000 && p.time < 220000).every(p => p.phoneStationary)).toBe(true);
});
test('dense raw callbacks remain time-bounded and cannot prevent a wrong-zero exit', () => {
  const tracker = new PhoneMotion();
  for (let tick = 20; tick < 460; tick += 1) tracker.accept(sample(tick / 20));
  expect(tracker.state).toBe('stationary');
  let release = null;
  for (let tick = 460; tick < 7000; tick += 1) {
    const t = tick / 20;
    if (tracker.accept(sample(t, (t - 23) * 0.4)) === 'moving') { release = t; break; }
    expect(tracker.tail.length).toBeLessThanOrEqual(720);
  }
  expect(release).not.toBeNull();
  expect(release - 23).toBeLessThan(180);
});
test('a new recording session cannot reuse an old stationary lock', () => {
  const tracker = new PhoneMotion();
  for (let t = 1; t <= 21; t += 1) phoneMotionPoint(sample(t, 0, { session_id: 'session-1' }), tracker);
  const point = phoneMotionPoint(sample(22, 60, { session_id: 'session-2' }), tracker);
  expect(point.phoneStationary).toBe(false);
  expect(point.latitude).toBe(25 + 60 / 111195);
});

test('uncertain speeds and missing speeds create interruption, not imaginary walking', () => {
  const rows = Array.from({ length: 480 }, (_, i) => sample(i * 5 + 1,
    i < 60 ? 0 : 65 + Math.sin(i / 3) * 5, {
      raw_speed_kmh: i < 60 ? 0 : i % 3 === 0 ? null : 2,
      speed_accuracy_mps: i < 60 ? 0.3 : 5,
    }));
  const model = historyTimeline(rows.map(phoneHistoryRow), { subject: 'phone', today: false });
  expect(model.distanceM).toBe(0);
  expect(model.edges.some(e => e.uncertain && e.mode === 'gap')).toBe(true);
  expect(model.nodes.some(n => n.type === 'gap' && n.reason === 'uncertain')).toBe(true);
  expect(sectionText({ type: 'gap', reason: 'uncertain', start: 1000, end: 2000 }).lead).toBe(translate('c883'));
  expect(model.points.filter(p => p.time > 1200000).every(p => !p.phoneStationary)).toBe(true);
  expect(model.departure.status).toBe('undetermined');
  expect(model.range.start).toBe(rows[0].time);
});
test('missing-speed genuine continuous walking is recovered from raw progress', () => {
  const rows = Array.from({ length: 601 }, (_, i) => sample(i + 1, i,
    { raw_speed_kmh: null, speed_accuracy_mps: null }));
  const model = historyTimeline(rows.map(phoneHistoryRow), { subject: 'phone', today: false,
    range: { start: rows[0].time, end: rows.at(-1).time } });
  expect(model.points.some(p => p.phoneConfirmedMovement)).toBe(true);
  expect(model.distanceM).toBeGreaterThan(480);
  expect(model.distanceM).toBeLessThan(610);
});
test('credible speed real walk and vehicle remain measurable', () => {
  for (const speed of [1.4, 12]) {
    const rows = Array.from({ length: 121 }, (_, i) => sample(i * 5 + 1, i * 5 * speed,
      { raw_speed_kmh: speed * 3.6, speed_accuracy_mps: 0.1 }));
    const model = historyTimeline(rows.map(phoneHistoryRow), { subject: 'phone', today: false,
      range: { start: rows[0].time, end: rows.at(-1).time } });
    expect(model.edges.some(e => e.uncertain)).toBe(false);
    if (speed < 5) expect(model.distanceM).toBeGreaterThan(800);
    else expect(model.edges.some(e => e.mode === 'driving')).toBe(true);
  }
});
test('isolated speed before a sparse uncertain endpoint cannot fund a false walk', () => {
  const rows = [sample(1, 0, { raw_speed_kmh: 21.6, speed_accuracy_mps: 4 }),
    sample(135, 60, { raw_speed_kmh: 2, speed_accuracy_mps: 4 }),
    sample(270, 90, { raw_speed_kmh: null, speed_accuracy_mps: null })];
  const model = historyTimeline(rows.map(phoneHistoryRow), { subject: 'phone', today: false });
  expect(model.distanceM).toBe(0);
  expect(model.points.some(p => p.phoneStationary)).toBe(false);
  expect(model.edges.every(e => e.uncertain)).toBe(true);
});
test('an explicit missing raw speed is not replaced by display speed zero', () => {
  const rows = Array.from({ length: 250 }, (_, i) => sample(i + 1, 60 + Math.sin(i),
    { raw_speed_kmh: null, speed_kmh: 0, speed_accuracy_mps: 0.3 }));
  const replay = replayPhoneMotion(rows);
  expect(replay.every(p => !p.phoneStationary)).toBe(true);
  expect(replay.every(p => p.raw_speed_kmh === null)).toBe(true);
  const model = historyTimeline(rows.map(phoneHistoryRow), { subject: 'phone', today: false });
  expect(model.distanceM).toBe(0);
  expect(model.edges.every(e => e.uncertain)).toBe(true);
});
test('unknown-speed confirmed movement resets and can reenter only on fresh compact proof', () => {
  const tracker = new PhoneMotion(); parked(tracker);
  let confirmed = false;
  for (let t = 22; t <= 200; t += 1) {
    const p = phoneMotionPoint(sample(t, (t - 21) * 0.8, { raw_speed_kmh: null }), tracker);
    if (p.phoneConfirmedMovement) confirmed = true;
  }
  expect(confirmed).toBe(true);
  expect(tracker.strictReentry).toBe(true);
  for (let t = 201; t < 221; t += 1) expect(tracker.accept(sample(t, 179 * 0.8))).not.toBe('stationary');
  expect(tracker.accept(sample(221, 179 * 0.8))).toBe('stationary');
  expect(tracker.strictReentry).toBe(false);
});
test('a long recording interruption is retained even near confirmed visits', () => {
  const rows = [
    ...Array.from({ length: 121 }, (_, i) => sample(i * 5 + 1)),
    ...Array.from({ length: 121 }, (_, i) => sample(1201 + i * 5)),
  ];
  const model = historyTimeline(rows.map(phoneHistoryRow), { subject: 'phone', today: false,
    config: { ...require('../src/history/HistoryConfig').HISTORY_CONFIG.phone, samePlaceGapMaxMs: 0 } });
  const edge = model.edges.find(e => e.durationMs > 180000);
  expect(edge.mode).toBe('gap');
  expect(model.nodes.some(n => n.type === 'gap' && n.start <= edge.start && n.end >= edge.end)).toBe(true);
});
test.each([undefined, NaN, -1, 50])('invalid accuracy %s cannot confirm raw geometry', accuracy => {
  const tracker = new PhoneMotion();
  for (let t = 1; t < 400; t += 1) {
    expect(tracker.accept(sample(t, t, { accuracy, raw_speed_kmh: null }))).toBe('unknown');
    expect(tracker.departureSince).toBeNull();
  }
});
test('backward observation time clears old tail, lock and relative sample clock', () => {
  const tracker = new PhoneMotion(); parked(tracker);
  expect(tracker.accept(sample(2, 100))).toBe('moving');
  expect(tracker.tail).toHaveLength(1);
  expect(tracker.origin).toBe(2000);
  expect(tracker.lastGeometryAt).toBe(0);
});

const confirmedWalkThen = tail => [
  ...Array.from({ length: 21 }, (_, i) => sample(i + 1, 0, { accuracy: 20, speed_accuracy_mps: 0.4 })),
  ...Array.from({ length: 201 }, (_, i) => sample(i + 22, (i + 1) * 0.8, { accuracy: 20, speed_accuracy_mps: 0.4 })),
  ...tail,
];
test('a confirmed walk followed by coarse stopped jitter is not perpetual confirmed travel', () => {
  const rows = confirmedWalkThen(Array.from({ length: 61 }, (_, i) => sample(227 + i * 5,
    160.8 + (i % 2 ? 12 : -12), { accuracy: 20, speed_accuracy_mps: 0.4 })));
  const stopped = replayPhoneMotion(rows).filter(p => p.time >= 227000);
  expect(stopped.every(p => !p.phoneConfirmedMovement)).toBe(true);
  expect(stopped.slice(4).every(p => p.phoneStationary)).toBe(true);
  expect(require('../src/history/HistoryMovement').historyMovement(stopped, { subject: 'phone' }).distanceM).toBe(0);
});
test.each([2, 10])('a bounded %sm/15s coarse drift after walking cannot fund new distance', metres => {
  const rows = confirmedWalkThen(Array.from({ length: 61 }, (_, i) => sample(227 + i * 5,
    160.8 + Math.min(i * 5 / 15 * metres, 20), { accuracy: 20, speed_accuracy_mps: 0.4 })));
  const stopped = replayPhoneMotion(rows).filter(p => p.time >= 227000);
  // The first short prefix can still overlap the already confirmed walk;
  // it cannot become perpetual proof or finance the bounded coarse drift.
  expect(stopped.filter(p => p.time >= 287000).every(p => !p.phoneConfirmedMovement)).toBe(true);
  expect(stopped.at(-1).phoneStationary).toBe(true);
  expect(require('../src/history/HistoryMovement').historyMovement(stopped, { subject: 'phone' }).distanceM).toBe(0);
});
test.each([0.2, 0.4, 0.8])('strict coarse reentry does not recapture continuous wrong-zero walking %sm/s', speed => {
  const rows = [
    ...Array.from({ length: 21 }, (_, i) => sample(i + 1, 0, { accuracy: 20 })),
    ...Array.from({ length: 1400 }, (_, i) => sample(i + 22, (i + 1) * speed, { accuracy: 20 })),
  ];
  const replay = replayPhoneMotion(rows), firstExit = replay.findIndex(p => p.phoneDepartureSince != null);
  expect(firstExit).toBeGreaterThan(21);
  expect(replay.slice(firstExit).every(p => !p.phoneStationary)).toBe(true);
  const movement = require('../src/history/HistoryMovement').historyMovement(replay, { subject: 'phone' });
  expect(movement.distanceM).toBeGreaterThan(speed * 1400 * 0.6);
  expect(movement.distanceM).toBeLessThan(speed * 1400 + 5);
});
test('geometry credit does not survive into a later contradictory zero-speed phone step', () => {
  const rows = [sample(1, 0), sample(6, 12), sample(11, 35)].map((p, i) => ({ ...p,
    accuracy: 20, phoneMotionState: 'moving', phoneConfirmedMovement: i < 2 }));
  expect(require('../src/history/HistoryMovement').historyMovement(rows, { subject: 'phone' }).distanceM).toBe(0);
});
test('coarse measured motion without speed accuracy agrees with raw geometry after departure', () => {
  const rows = confirmedWalkThen(Array.from({ length: 61 }, (_, i) => sample(227 + i * 5,
    160.8 + (5 + i * 5) * 0.8, { accuracy: 20, raw_speed_kmh: 1.8, speed_accuracy_mps: null })));
  const moving = replayPhoneMotion(rows).filter(p => p.time >= 227000);
  expect(moving.every(p => p.phoneMotionState === 'moving' && !p.phoneStationary)).toBe(true);
  expect(require('../src/history/HistoryMovement').historyMovement(moving, { subject: 'phone' }).distanceM).toBeGreaterThan(200);
});
