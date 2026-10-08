// Second review of the 054a history logic against the v3 design (判定表
// rows quoted above each test).
import { historyMovement, historyTimeline, historyVisits, historyDeparture, historyStops } from '../src/history';
import { point } from '../__fixtures__/HistoryLogicFixtures';

// A path along the meridian: [seconds, metres] pairs with an accuracy.
const path = (pairs, extra = { accuracy: 5 }) => pairs.map(([t, m]) => point(t, m, extra));
// Every `step` seconds from `from` to `to`, moving `speed` m/s from `start` metres.
function leg(from, to, start, speed, step = 10) {
  const out = [];
  for (let t = from; t <= to; t += step) out.push([t, start + (t - from) * speed]);
  return out;
}
const end = pairs => pairs[pairs.length - 1][1];

// 判定表「距離怎麼加」: compared with the last counted fix; counts once it is
// farther than the larger accuracy of the two (at least 5 m).
test('slow steps under the accuracy still add up against the last counted fix', () => {
  const walk = historyMovement(path(leg(0, 100, 0, 1, 1)), { subject: 'phone' });
  // 100 one-metre steps with 5 m accuracy: counted every 5–6 m, never lost.
  expect(walk.distanceM).toBeGreaterThan(94); expect(walk.distanceM).toBeLessThanOrEqual(100);
});
test('standing still with jitter inside the accuracy adds nothing', () => {
  const jitter = path(Array.from({ length: 60 }, (_, i) => [i * 10, i % 2 ? 4 : 0]));
  expect(historyMovement(jitter).distanceM).toBe(0);
});
// 判定表「缺誤差值的位置」: as 10 m; and the floor is 5 m.
test('a fix without accuracy counts as 10 m, an exact fix as 5 m', () => {
  expect(historyMovement(path([[0, 0], [10, 10]], {})).distanceM).toBe(0);
  expect(historyMovement(path([[0, 0], [10, 11]], {})).distanceM).toBeCloseTo(11);
  expect(historyMovement(path([[0, 0], [10, 6]], { accuracy: 0 })).distanceM).toBeCloseTo(6);
});

// 判定表「停留的代表位置」: the mean of the visit's judged fixes.
test('a visit is placed at the mean of its fixes, entered by its first fix', () => {
  const [visit] = historyVisits(path([[0, 0], [60, 10], [120, 20]]));
  expect(visit.center.latitude).toBe(point(0).latitude);
  expect(visit.latitude).toBeCloseTo(point(0, 10).latitude, 9);
});

// 判定表「恢復記錄節點」: over 30 minutes → 沒有資料 then 恢復記錄; within 30
// minutes only the 沒有資料 row.
test('a break over thirty minutes adds a resume node after the no-data row', () => {
  const long = historyTimeline(path([...leg(0, 300, 0, 1), ...leg(2200, 2500, 300, 1)]), { range: { start: 0, end: 2500000 } });
  expect(long.nodes.map(n => n.type)).toEqual(['departure', 'movement', 'gap', 'resume', 'movement', 'end']);
  const short = historyTimeline(path([...leg(0, 300, 0, 1), ...leg(1500, 1800, 300, 1)]), { range: { start: 0, end: 1800000 } });
  expect(short.nodes.map(n => n.type)).toEqual(['departure', 'movement', 'gap', 'movement', 'end']);
});

// hist.txt H2: walk → stay 1 → walk → stay 2 → drive → switch 3 → walk → now.
// The stay before the car is its own boundary: no extra switch beside it.
function morning() {
  const a = leg(0, 1200, 0, 1.2);
  const stayA = leg(1210, 1800, end(a), 0);
  const b = leg(1810, 2700, end(a), 1.2);
  const stayB = leg(2710, 3300, end(b), 0);
  const drive = leg(3310, 3790, end(b), 12);
  const c = leg(3800, 4700, end(drive), 1.2);
  return path([...a, ...stayA, ...b, ...stayB, ...drive, ...c]);
}
test('H2 order: stays and the car-to-foot switch share one numbering', () => {
  const model = historyTimeline(morning(), { subject: 'phone' });
  expect(model.departure.status).toBe('confirmed');
  expect(model.nodes.map(n => (n.type === 'movement' ? n.mode : n.type))).toEqual([
    'departure', 'walking', 'stop', 'walking', 'stop', 'driving', 'switch', 'walking', 'end']);
  expect(model.nodes.filter(n => n.number).map(n => [n.type, n.number])).toEqual([['stop', 1], ['stop', 2], ['switch', 3]]);
  // The car's kilometres are kept for its row but never counted.
  const drive = model.sections.find(s => s.mode === 'driving');
  expect(drive.distanceM).toBeGreaterThan(5000); expect(drive.countedDistanceM).toBe(0);
  // 判定表「距離的四捨五入」: the total is the rows' counted metres.
  expect(model.distanceM).toBeCloseTo(model.sections.reduce((sum, s) => sum + s.countedDistanceM, 0), 6);
});

// 判定表「記錄被迫中止的終點膠囊」: a closed recording ends 「記錄已關閉 10:20」.
test('a closed recording labels its end with the closing time', () => {
  const model = historyTimeline(morning(), { subject: 'phone', today: true, now: 4800000, following: false, closedAt: 4750000 });
  expect(model.nodes[model.nodes.length - 1]).toMatchObject({ type: 'end', label: '記錄已關閉', closedAt: 4750000 });
});

// The pill re-runs departure detection on a whole day of fixes every poll.
test('a whole day standing still is judged quickly', () => {
  const day = path(Array.from({ length: 8640 }, (_, i) => [i * 10, i % 3]));
  const started = Date.now();
  expect(historyDeparture(day, { subject: 'phone', today: true, now: 86400000 }).status).toBe('not-departed');
  expect(Date.now() - started).toBeLessThan(1500);
});

// Known gap (README「已知缺口」): a dog in a car without GPS does not borrow
// the phone's route yet (H2c waits for the car field test). Until then the
// collar's silence is 沒有資料 and the first fix after it does not add the
// car's kilometres to the dog's distance.
test('a collar without fixes in the car is no data, not distance', () => {
  const before = leg(0, 600, 0, 1.2);
  const after = leg(1500, 2100, 6000, 1.2);
  const model = historyTimeline(path([...before, ...after]), { range: { start: 0, end: 2100000 } });
  expect(model.nodes.map(n => n.type)).toEqual(['departure', 'movement', 'gap', 'movement', 'end']);
  expect(model.distanceM).toBeLessThan(1500);
  expect(model.sections.find(s => s.type === 'gap').countedDistanceM).toBe(0);
});

// 判定表「停留的重算」: a whole recalculation replays in time order, so a stay
// marked early is kept when longer visits later raise the baseline — opening
// the finished day gives what following it live gave (Codex review #1).
test('stays are replayed in time order, not judged once with the final median', () => {
  const early = [...[0, 60, 120, 180, 240].map(t => [t, 0]), ...[300, 330, 360].map(t => [t, 100]),
    ...[390, 420, 450].map(t => [t, 200]), ...[480, 510, 540].map(t => [t, 300]), ...[570, 600, 630].map(t => [t, 400])];
  // Five later visits of 150 s each: the final median is 150 s, 3× is 450 s.
  const later = [];
  for (let k = 0; k < 5; k += 1) for (let s = 0; s <= 150; s += 30) later.push([660 + k * 180 + s, 500 + k * 100]);
  const all = path([...early, ...later], {});
  const replayed = historyStops(all, { following: false });
  expect(replayed.stops.map(s => s.start)).toEqual([0]);
  // Live, in two appends, the same answer.
  const part = historyStops(all.filter(p => p.time <= 640000), { following: true });
  expect(part.stops.map(s => s.start)).toEqual([0]);
});

// Codex review #6 — 判定表「停在原處前後的距離」: drift drawn onto the hold
// spot does not count; the release from the spot does.
test('the edge into a hold adds no distance, the release does', () => {
  const held = { heldReason: 'indoor', heldSince: 100000, accuracy: 5 };
  const m = historyMovement([point(0, 0, { accuracy: 5 }), point(110, 100, held), point(170, 100, held),
    point(180, 120, { accuracy: 5 })]);
  expect(m.distanceM).toBeCloseTo(20);
});
// Codex review #7 — fixes over 25 m are not judged: they cannot bridge a
// 10-minute interruption between judged fixes (判定表「造訪的起訖」).
test('a poor fix in the middle does not join two visits across ten minutes', () => {
  expect(historyVisits([point(0), point(500, 0, { accuracy: 30 }), point(700)])).toHaveLength(2);
});
// Codex review #9 — a drive cut off by the end of the data keeps its last fix
// in the car: no zero-length visit there.
test('the last fix of a drive that runs to the end is not a visit', () => {
  const drive = path(leg(0, 40, 0, 6), { accuracy: 5 });
  const m = historyMovement(drive, { subject: 'phone' });
  expect(m.vehicles[0].exited).toBe(false);
  expect(historyVisits(drive, { subject: 'phone', vehicles: m.vehicles })).toHaveLength(0);
});
// Codex review #10 — minutes on foot without counted distance are still a
// row, and the switch to the car stays (判定表「交通方式切換點」).
test('a long slow stretch before the car keeps its row and the switch point', () => {
  const pairs = [...leg(0, 300, 0, 0.01), ...leg(310, 400, 3, 9)];
  const model = historyTimeline(path(pairs), { subject: 'phone', range: { start: 0, end: 400000 } });
  expect(model.nodes.map(n => (n.type === 'movement' ? n.mode : n.type))).toEqual(
    ['departure', 'walking', 'switch', 'driving', 'end']);
});
