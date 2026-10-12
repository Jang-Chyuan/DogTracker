import { historyTimeline } from '../src/history';
import { rangeSummaryDistances, rangeSummaryLines } from '../src/mapHistory/HistoryRangeSummary';

const north = (metres, seconds) => ({ latitude: 24.9893 + metres / 111195, longitude: 121.3135,
  time: seconds * 1000, accuracy: 5 });
const walkDriveWalk = [
  ...Array.from({ length: 4 }, (_, i) => north(i * 10, i * 10)),
  ...Array.from({ length: 16 }, (_, i) => north(30 + (i + 1) * 125, 30 + (i + 1) * 10)),
  ...Array.from({ length: 3 }, (_, i) => north(2030 + (i + 1) * 10, 190 + (i + 1) * 10)),
];

test.each(['phone', 'dog'])('production %s summary separates movement/vehicle, never counts distant missing-data jump', subject => {
  const rows = [...walkDriveWalk, north(10000, 900), north(10010, 910)];
  const model = historyTimeline(rows, { subject, dayStart: 0, today: true, now: 910000,
    manualRange: { start: 0, end: 910000, following: false } });
  const before = JSON.stringify(model);
  const distances = rangeSummaryDistances(model, subject);
  expect(model.sections.some(n => n.type === 'gap')).toBe(true);
  expect(distances.map(n => n.icon)).toEqual([subject === 'phone' ? 'walk' : 'paw', 'car']);
  expect(distances[0].distanceM).toBe(model.distanceM);
  expect(distances[0].distanceM).toBeLessThan(100);
  expect(distances[1].distanceM).toBeGreaterThan(1800);
  expect(distances[1].distanceM).toBeLessThan(2200);
  expect(distances[1].distanceM).toBeCloseTo(model.sections.filter(n => n.type === 'movement' && ['driving', 'ride'].includes(n.mode)).reduce((sum, n) => sum + n.distanceM, 0), 9);
  const lines = rangeSummaryLines(model, { subject, range: model.range, open: false });
  expect(lines.detail).not.toMatch(/分|小時/);
  expect(lines.title).toMatch(/–/);
  expect(JSON.stringify(model)).toBe(before);
});

test('uncertain/gap rows, invalid distance and duplicate presentation nodes do not inflate vehicle total; confirmed zero stays visible', () => {
  const model = { points: [{ time: 0 }], distanceM: 0, nodes: [{ type: 'movement', mode: 'driving', distanceM: 900 }],
    sections: [{ type: 'gap', mode: 'driving', distanceM: 5000 }, { type: 'movement', mode: 'uncertain', distanceM: 2000 }, { type: 'movement', mode: 'driving', reason: 'uncertain', distanceM: 2000 },
      { type: 'movement', mode: 'driving', distanceM: 0 }, { type: 'movement', mode: 'driving', distanceM: NaN } ] };
  expect(rangeSummaryDistances(model, 'phone').map(n => n.distanceM)).toEqual([0, 0]);
  expect(rangeSummaryLines({ ...model, points: [] }, { subject: 'phone' })).toBeNull();
});
