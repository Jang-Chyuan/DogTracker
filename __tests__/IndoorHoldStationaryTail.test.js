import { applyHistoryHolds, createHistoryHolds, createHoldTracker, HOLD_CONFIG } from '../src/placement/IndoorHold';
import { rawCoordinate, rawSpeedKmh } from '../src/placement/RawObservation';
import { historyMovement } from '../src/history/HistoryMovement';
import { historyTimeline } from '../src/history/HistoryTimeline';
import { offset } from '../__fixtures__/IndoorScenarios';
import { compactStationaryFixes } from '../__fixtures__/IndoorStationaryCounterexample';

const origin = { latitude: 24.9892, longitude: 121.3132 };
const good = (time, metres, speed = null) => ({ time, ...offset(origin, metres, 0),
  satellites: 9, hdop: 1, speed_kmh: speed, master_id: 1, slave_id: 6 });
const classify = rows => ({ environment: 'window', observedAt: Math.max(...rows.map(r => r.track_at)) });
const initial = [good(0, 0), good(5000, 0),
  ...Array.from({ length: 24 }, (_, i) => ({ ...good(10000 + i * 5000, 0),
    latitude: 0, longitude: 0, satellites: 0, hdop: 655.35 })),
  ...Array.from({ length: 16 }, (_, i) => good(130000 + i * 5000, 0, 0))];
const tracker = () => {
  const value = createHoldTracker(HOLD_CONFIG, { classify });
  initial.forEach(r => value.push(r));
  expect(value.current()).not.toBeNull();
  return value;
};

test.each(['north', 'east'])('invented %s stationary tail does not turn its compact offset into a departure', name => {
  const value = tracker();
  const events = compactStationaryFixes(origin, 210000, name).map(r => value.push(r)).filter(Boolean);
  expect(events).toEqual([]);
  expect(value.current()).not.toBeNull();
});

test('a minute of compact zero-speed offset fixes waits for movement rather than releasing on quality alone', () => {
  const value = tracker();
  const events = Array.from({ length: 13 }, (_, i) => value.push(good(210000 + i * 10000, 65 + (i % 2), 0))).filter(Boolean);
  expect(events).toEqual([]);
  expect(value.current()).not.toBeNull();
  expect(value.snapshot().rawTail.at(-1).speedKmh).toBe(0);
  expect(value.push(good(340000, 0, 0))).toBeNull();
});

test('stationary evidence has a bounded grace even if the dog left unseen and then stopped', () => {
  const value = tracker();
  const events = Array.from({ length: 25 }, (_, i) => value.push(good(210000 + i * 10000, 65, 0))).filter(Boolean);
  expect(events).toMatchObject([{ type: 'end', time: 450000 }]);
});

test.each([null, 2])('missing or moving speed %s cannot masquerade as sustained stationary evidence', speed => {
  const value = tracker();
  const events = Array.from({ length: 7 }, (_, i) => value.push(good(210000 + i * 10000, 65, speed))).filter(Boolean);
  expect(events).toMatchObject([{ type: 'end', time: 270000 }]);
});

test('incorrect zero speeds cannot trap a slow continuous walk', () => {
  const value = tracker();
  const events = Array.from({ length: 61 }, (_, i) => value.push(good(210000 + i * 5000, i * 2.5, 0))).filter(Boolean);
  expect(events.some(e => e.type === 'end')).toBe(true);
  expect(value.current()).toBeNull();
});

test('history restores a confirmed 220m walk including the raw departure while still held', () => {
  const rows = [...initial, ...Array.from({ length: 23 }, (_, i) => good(210000 + i * 10000, i * 10, 0))];
  const replay = applyHistoryHolds(rows, { classify });
  const movement = historyMovement(replay, { subject: 'dog' });
  expect(movement.distanceM).toBeGreaterThan(200);
  expect(movement.distanceM).toBeLessThan(230);
  expect(replay.find(r => r.time === 250000).heldReason).toBeUndefined();
  expect(replay.find(r => r.time === 250000).speed_kmh).toBe(0);
  expect(rows.find(r => r.time === 250000).heldReason).toBeUndefined();
});

test('a sparse genuine walk keeps its observed raw distance', () => {
  const rows = [...initial, ...Array.from({ length: 6 }, (_, i) => good(210000 + i * 60000, i * 44, 2.64))];
  const movement = historyMovement(applyHistoryHolds(rows, { classify }), { subject: 'dog' });
  expect(movement.distanceM).toBeGreaterThan(200);
  expect(movement.distanceM).toBeLessThan(230);
});

test('a later genuine walk does not retrospectively turn an earlier stationary GPS relocation into distance', () => {
  const drift = Array.from({ length: 13 }, (_, i) => good(210000 + i * 10000, 65, 0));
  const walk = Array.from({ length: 23 }, (_, i) => good(340000 + i * 10000, 65 + i * 10, 0));
  const rows = [...initial, ...drift, ...walk];
  const value = tracker();
  const events = [...drift, ...walk].map(r => value.push(r)).filter(Boolean);
  expect(events.find(e => e.type === 'end').departureSince).toBeGreaterThanOrEqual(320000);
  const movement = historyMovement(applyHistoryHolds(rows, { classify }), { subject: 'dog' });
  expect(movement.distanceM).toBeGreaterThan(200);
  expect(movement.distanceM).toBeLessThan(235);
});

test('a display-anchor seam counts only the two raw observations', () => {
  const from = { ...good(0, 0, 0), heldReason: 'window', raw_latitude: offset(origin, 65, 0).latitude,
    raw_longitude: origin.longitude };
  const to = good(20000, 66, 0);
  const movement = historyMovement([from, to], { subject: 'dog' });
  expect(movement.edges[0].distanceM).toBeLessThan(2);
  expect(movement.distanceM).toBe(0);
});

test.each([null, 0])('a no-GPS hold release (%s) breaks counting before the next observed movement', missing => {
  const from = { ...good(0, 0), heldReason: 'window', raw_latitude: missing, raw_longitude: missing };
  const movement = historyMovement([from, good(20000, 300, 2), good(40000, 330, 2)], { subject: 'dog' });
  expect(movement.edges[0]).toMatchObject({ mode: 'gap', gapReason: 'no-gps', bridged: false,
    distanceM: 0, countedDistanceM: 0 });
  expect(movement.edges[1].mode).toBe('moving');
  expect(movement.distanceM).toBeCloseTo(30, 0);
});

test('confirmed raw departure around a no-GPS packet keeps a gap and subsequent genuine walking in batch and append replay', () => {
  const walk = Array.from({ length: 23 }, (_, i) => good(210000 + i * 10000, i * 10, 0));
  walk[4] = { ...walk[4], latitude: 0, longitude: 0, satellites: 0, hdop: 655.35 };
  const rows = [...initial, ...walk];
  const batch = applyHistoryHolds(rows, { classify });
  const incremental = createHistoryHolds({ classify });
  incremental.append(rows.slice(0, initial.length + 8));
  incremental.append(rows.slice(initial.length + 8));
  expect(incremental.output).toEqual(batch);
  const movement = historyMovement(batch, { subject: 'dog' });
  expect(movement.edges.find(e => e.start === walk[4].time)).toMatchObject({ mode: 'gap', gapReason: 'no-gps',
    distanceM: 0, countedDistanceM: 0 });
  expect(movement.distanceM).toBeGreaterThan(170);
  expect(movement.distanceM).toBeLessThan(221);
  const timeline = historyTimeline(rows, { subject: 'dog', dayStart: 0, dayEnd: 500000,
    range: { start: 0, end: 430000 }, holdOptions: { classify } });
  expect(timeline.sections.find(s => s.start === walk[4].time)).toMatchObject({ type: 'gap', reason: 'no-gps',
    countedDistanceM: 0 });
  const appendedTimeline = historyTimeline(rows, { subject: 'dog', dayStart: 0, dayEnd: 500000,
    range: { start: 0, end: 430000 },
    replayHolds: packets => incremental.output.map((p, i) => ({ ...packets[i], ...p })) });
  expect(appendedTimeline.distanceM).toBe(timeline.distanceM);
  expect(appendedTimeline.sections).toEqual(timeline.sections);
  expect(appendedTimeline.nodes.map(n => n.type)).toEqual(timeline.nodes.map(n => n.type));
  expect(walk[4].heldReason).toBeUndefined();
});

test('raw adapters preserve explicit missing fixes and speeds, and accept dog database columns', () => {
  expect(rawCoordinate({ latitude: 25, longitude: 121, raw_latitude: null, raw_longitude: null }))
    .toEqual({ latitude: null, longitude: null });
  expect(rawCoordinate({ latitude: 25, longitude: 121, slave_lat: 24.99, slave_lon: 121.31 }))
    .toEqual({ latitude: 24.99, longitude: 121.31 });
  expect(rawSpeedKmh({ raw_speed_kmh: null, speed_kmh: 4 })).toBeNull();
});
