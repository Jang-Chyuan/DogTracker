import { historyMovement } from '../src/history';
import { point } from '../__fixtures__/HistoryLogicFixtures';
import { historyTimeline } from '../src/history/HistoryTimeline';
import { phoneHistoryRow } from '../src/history/HistoryRows';
import { createTodayRouteEngine } from '../src/tracking/TodayRouteEngine';
import recovery from '../__fixtures__/PhoneNoisyRecovery';

const fix = (seconds, meters, speed, spread, accuracy = 5) => point(seconds, meters, {
  accuracy, raw_speed_kmh: speed * 3.6, speed_accuracy_mps: spread,
  phoneMotionState: 'moving', phoneStationary: false, phoneConfirmedMovement: false,
});
const count = rows => historyMovement(rows, { subject: 'phone' }).distanceM;

test('isolated noisy recovery cannot spend its full estimate at the next zero-speed fix', () => {
  const rows = [fix(0, 0, 0.4, 2, 15),
    fix(5, 12, 3, 2.5, 15), fix(10, 18, 0, 0.5, 10)];
  expect(count(rows)).toBe(0);
});

test('sustained high-uncertainty real walking still counts within its positive lower bound', () => {
  const rows = Array.from({ length: 9 }, (_, i) => fix(i * 5, i * 3, 2.8, 2.2));
  expect(count(rows)).toBeGreaterThanOrEqual(18);
  expect(count(rows)).toBeLessThanOrEqual(24.1);
});

test('credible last step ending at zero preserves accumulated walking credit', () => {
  expect(count([fix(0, 0, 1, 0.2), fix(5, 4, 1, 0.2), fix(10, 8, 0, 0.2)]))
    .toBeCloseTo(8);
});

test.each([undefined, null, -1])('legacy missing or invalid SACC %s preserves its existing speed policy', spread => {
  expect(count([fix(0, 0, 1.2, spread), fix(5, 6, 1.2, spread), fix(10, 12, 1.2, spread)]))
    .toBeCloseTo(12);
});

test('vehicle geometry remains excluded from walking budget', () => {
  const model = historyMovement(Array.from({ length: 9 }, (_, i) => fix(i * 5, i * 30, 6, 2)), { subject: 'phone' });
  expect(model.vehicles).toHaveLength(1);
  expect(model.distanceM).toBe(0);
});

test('sparse credible walk ending at zero retains its final distance', () => {
  expect(count([fix(0, 0, 1, 0.2), fix(15, 12, 0, 0.2)])).toBeCloseTo(12);
});

test('one missing speed inherits conservative noisy credit for at most ten seconds', () => {
  const a = fix(0, 0, 2.8, 2.2), b = fix(5, 12, 0, null);
  b.raw_speed_kmh = null;
  expect(count([a, b])).toBe(0);
});

test('invented indoor recovery has zero distance in history and incremental live engine', () => {
  const rows = recovery.map(phoneHistoryRow), first = rows[0].time, last = rows.at(-1).time;
  const dayStart = 0;
  const model = historyTimeline(rows, { subject: 'phone', dayStart, dayEnd: dayStart + 86400000,
    range: { start: first, end: last }, today: false, now: last });
  expect(model.distanceM).toBe(0);
  const engine = createTodayRouteEngine({ dayStart });
  for (const row of rows) expect(engine.add([row])).toBe(true);
  expect(engine.sum(last).metres).toBe(0);
});
