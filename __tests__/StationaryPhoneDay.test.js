// 067: a phone that stayed indoors all day (a real recording, kept only as
// offsets from an arbitrary origin; __fixtures__/stationary-day-phone.csv).
// The position drifts 50–110 m for minutes while the phone measures 0–1 km/h:
// that drift is not distance, and it does not leave a stay.
import fs from 'fs';
import path from 'path';
import { historyTimeline } from '../src/history/HistoryTimeline';
import { phoneHistoryRow } from '../src/history/HistoryRows';
import { HISTORY_CONFIG, measuredSpeedMps, stillFix } from '../src/history/HistoryConfig';
import { countDistances } from '../src/history/HistoryMovement';
import { todayRouteDistance } from '../src/tracking/TodayDistance';

const ORIGIN = { latitude: 24.9893, longitude: 121.3135 };
const START = new Date(2026, 0, 5, 6, 0).getTime();
const METRES_PER_DEGREE = 111320;

function stationaryDay() {
  const lines = fs.readFileSync(path.join(__dirname, '../__fixtures__/stationary-day-phone.csv'), 'utf8')
    .split('\n').filter(line => line && !line.startsWith('#')).slice(1);
  return lines.map(line => {
    const [t, east, north, acc, kmh, sacc] = line.split(',');
    return {
      time: START + Math.round(Number(t) * 1000),
      latitude: ORIGIN.latitude + Number(north) / 110540,
      longitude: ORIGIN.longitude + Number(east) / (METRES_PER_DEGREE * Math.cos((ORIGIN.latitude * Math.PI) / 180)),
      accuracy: Number(acc), raw_speed_kmh: kmh === '' ? null : Number(kmh),
      speed_accuracy_mps: sacc === '' ? null : Number(sacc),
    };
  });
}

const dayStart = new Date(2026, 0, 5).getTime();
const dayEnd = dayStart + 86400000;
const timeline = (rows, config) => historyTimeline(rows.map(phoneHistoryRow), { subject: 'phone', dayStart, dayEnd,
  now: dayEnd, config, range: { start: dayStart, end: dayEnd - 1 } });
// The rules as they were: no measured-speed check, no same-place breaks, no
// long-visit stays.
const BEFORE = { ...HISTORY_CONFIG.phone, speedBudget: false, stillMps: 0, stillPlaceM: 0,
  samePlaceGapMaxMs: 0, alwaysStayMs: 0 };

test('a whole day indoors: little distance, a few long stays, the overnight breaks inside them', () => {
  const rows = stationaryDay();
  expect(rows).toHaveLength(4005);
  const before = timeline(rows, BEFORE);
  const after = timeline(rows);
  const count = (model, type) => model.nodes.filter(n => n.type === type).length;
  // Before: 808 m walked, 8 stays, 11 「沒有資料」 rows, 6 恢復記錄.
  expect(before.distanceM).toBeGreaterThan(700);
  expect(count(before, 'stop')).toBe(8);
  // After: about 220 m (moves the phone measured itself), two or three long
  // stays, one break left (the first, before the day settles).
  expect(after.distanceM).toBeLessThan(250);
  expect(count(after, 'stop')).toBeGreaterThanOrEqual(1);
  expect(count(after, 'stop')).toBeLessThanOrEqual(3);
  expect(after.nodes.filter(n => n.type === 'stop').every(n => n.durationMs >= 3 * 3600000)).toBe(true);
  // Preserve both actual recording gaps and uncertain boundary observations.
  // The 18:47→19:04 bridge has no confirmed compact stationary return:
  // it is an interruption, never a zero-distance walking section.
  const gaps = after.nodes.filter(n => n.type === 'gap');
  expect(gaps.map(n => ({ start: n.start - START, end: n.end - START,
    reason: n.reason, countedDistanceM: n.countedDistanceM }))).toEqual([
    { start: 0, end: 357051, reason: 'uncertain', countedDistanceM: 0 },
    { start: 357051, end: 4707330, reason: undefined, countedDistanceM: 0 },
    { start: 46046458, end: 47085377, reason: undefined, countedDistanceM: 0 },
    { start: 47085377, end: 47091108, reason: 'uncertain', countedDistanceM: 0 },
  ]);
  const returnGap = gaps.find(n => n.start === START + 46046458);
  expect(returnGap).toMatchObject({ durationMs: 1038919, line: 'long-dashed' });
  expect(after.nodes.filter(n => n.type === 'movement'
    && n.start < returnGap.end && n.end > returnGap.start)).toHaveLength(0);
  expect(after.edges.filter(e => e.uncertain).every(e => e.countedDistanceM === 0)).toBe(true);
  expect(count(after, 'resume')).toBeLessThanOrEqual(1);
  // 「今天 x km」 is the same history logic.
  const today = todayRouteDistance(rows, { now: dayEnd - 1, dayStart, recording: false });
  expect(today.metres).toBeLessThan(250);
});

// A walk the phone measured (1.3 m/s) counts as before; so does one without
// measured speeds (older rows, screen fixtures).
test('a measured walk still counts; fixes without a speed keep the old rule', () => {
  const walk = (speed, sacc) => Array.from({ length: 120 }, (_, i) => ({
    time: START + i * 5000, accuracy: 8, raw_speed_kmh: speed, speed_accuracy_mps: sacc,
    latitude: ORIGIN.latitude + (i * 6.5) / 110540, longitude: ORIGIN.longitude,
  }));
  const measured = timeline(walk(1.3 * 3.6, 0.4));
  const unmeasured = timeline(walk(null, null));
  expect(measured.distanceM).toBeGreaterThan(119 * 6.5 * 0.9);
  expect(Math.abs(measured.distanceM - unmeasured.distanceM)).toBeLessThan(20);
});

test('stillFix and measuredSpeedMps read the phone row', () => {
  const config = HISTORY_CONFIG.phone;
  expect(measuredSpeedMps({ raw_speed_kmh: 3.6 })).toBe(1);
  expect(measuredSpeedMps({ raw_speed_kmh: '', speed_kmh: 7.2 })).toBe(2);
  expect(measuredSpeedMps({})).toBeNull();
  expect(stillFix({ raw_speed_kmh: 0, speed_accuracy_mps: 0.3 }, config)).toBe(true);
  expect(stillFix({ raw_speed_kmh: 0, speed_accuracy_mps: 3 }, config)).toBe(false);
  expect(stillFix({ raw_speed_kmh: 4, speed_accuracy_mps: 0.3 }, config)).toBe(false);
  expect(stillFix({ raw_speed_kmh: null }, config)).toBe(false);
  // Dogs keep their own rules (IndoorHold).
  expect(stillFix({ raw_speed_kmh: 0, speed_accuracy_mps: 0.3 }, HISTORY_CONFIG.dog)).toBe(false);
  const still = { raw_speed_kmh: 0, speed_accuracy_mps: 0.3 };
  const step = (from, to) => [{ mode: 'walking', from: { latitude: 0, longitude: 0, accuracy: 5, ...from },
    to: { latitude: 0.0005, longitude: 0, accuracy: 5, ...to }, durationMs: 40000 }];
  // 55 m in 40 s with both fixes measured standing still: drift.
  expect(countDistances(step(still, still), config)[0].countedDistanceM).toBe(0);
  // A walk that ends on a still fix: the faster end counts (Codex review).
  expect(countDistances(step({ raw_speed_kmh: 5, speed_accuracy_mps: 0.4 }, still), config)[0].countedDistanceM)
    .toBeGreaterThan(50);
  // No measured speed at either end: the old rule.
  expect(countDistances(step({}, {}), config)[0].countedDistanceM).toBeGreaterThan(50);
});
