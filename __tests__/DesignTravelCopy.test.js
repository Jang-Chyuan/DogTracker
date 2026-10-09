import { vehicleExclusion, sectionText } from '../src/history/HistoryText';
import { rangeSummaryLines } from '../src/mapHistory/HistoryRangeSummary';
import { pngTitle } from '../src/mapHistory/ExportPNG';

test.each(['phone', 'dog'])('vehicle summary follows only the selected range for %s', subject => {
  const vehicle = { type: 'movement', mode: subject === 'phone' ? 'driving' : 'ride', start: 10, end: 20 };
  expect(vehicleExclusion({ nodes: [] }, subject)).toBe('');
  expect(vehicleExclusion({ nodes: [vehicle] }, subject)).toBe(subject === 'phone' ? '（不含開車）' : '（不含坐車）');
  expect(sectionText({ ...vehicle, durationMs: 60000, distanceM: 1000 }).rest).toBe('・1.0 km');
  const model = { points: [{ time: 10 }], nodes: [vehicle], distanceM: 1000, durationMs: 60000 };
  expect(rangeSummaryLines(model, { subject, open: true, range: { start: 10, end: 20 } }).detail)
    .toContain(vehicleExclusion(model, subject));
});

test('PNG title carries the range-specific exclusion captured for that subject', () => {
  const snapshot = { since: 0, until: 60000, timeZone: 'UTC' };
  const one = { kind: 'phone', name: '我的路線', distanceWord: '走了', distanceKm: '1.0 km', distanceExclusion: '（不含開車）' };
  expect(pngTitle(snapshot, [one]).subtitle).toContain('走了 1.0 km（不含開車）');
  expect(pngTitle(snapshot, [{ ...one, distanceExclusion: '' }]).subtitle).not.toContain('不含');
});
