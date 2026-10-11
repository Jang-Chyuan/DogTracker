import { timelinePresentation } from '../src/history/HistoryTimelinePresentation';
import { exportTimelineRows } from '../src/mapHistory/ExportSnapshot';
import { layoutRow } from '../src/mapHistory/ExportPNG';
import { pngDrawPages } from '../src/mapHistory/ExportDraw';

const walk = (start, end, metres = 20) => ({ type: 'movement', mode: 'walking', start, end,
  durationMs: end - start, distanceM: metres, countedDistanceM: metres });
const gap = (start, end, reason) => ({ type: 'gap', mode: 'gap', start, end, reason });

test('consecutive observed walking legs become one presentation without counting unobserved time or mutating source', () => {
  const nodes = [walk(0, 60000), walk(90000, 150000), gap(150000, 180000, 'uncertain'), walk(180000, 240000)];
  const before = JSON.stringify(nodes);
  const shown = timelinePresentation(nodes);
  expect(shown).toHaveLength(1);
  expect(shown[0]).toMatchObject({ start: 0, end: 240000, durationMs: 180000, countedDistanceM: 60 });
  expect(JSON.stringify(nodes)).toBe(before);
});

test.each([
  { type: 'stop', start: 60000, end: 120000, number: 2 },
  { type: 'indoor', start: 60000, end: 120000 },
  { type: 'switch', start: 60000, end: 60000, number: 3 },
  { type: 'resume', start: 60000, end: 60000 },
  { ...walk(60000, 120000), mode: 'driving' },
  gap(60000, 120000), gap(60000, 120000, 'no-gps'), gap(60000, 120000, 'no-signal'),
])('real stop/mode/gap boundary is retained: %j', boundary => {
  const nodes = [walk(0, 60000), boundary, walk(120000, 180000)];
  expect(timelinePresentation(nodes)).toEqual(nodes);
  expect(timelinePresentation(nodes)[2].countedDistanceM).toBe(20);
});

test('PNG uses the same collapsed rows; places expose start only, duration before address and no coordinates', () => {
  const place = { type: 'stop', start: 0, end: 60000, durationMs: 60000, number: 1, latitude: 24.9892, longitude: 121.3132 };
  const rows = exportTimelineRows([place, walk(60000, 120000), walk(130000, 190000)], () => '虛構測試地址');
  expect(rows).toHaveLength(2);
  expect(rows[0].times).toHaveLength(1);
  expect(rows[0].coordinates).toBe('');
  const block = { type: 'row', row: rows[0], ...layoutRow(rows[0], (text, size) => text.length * size), color: '#123456', y: 0 };
  const page = { width: 1080, height: 500, titleLines: [], subtitleLines: [], legend: [], blocks: [block], footer: { page: '1', y: 480, height: 20 } };
  const ops = pngDrawPages({ pages: [page] })[0].ops;
  const pill = ops.find(op => op.text === rows[0].pill.text);
  const address = ops.find(op => op.text?.startsWith('虛構'));
  expect(pill.y).toBe(address.y);
  expect(pill.x).toBeLessThan(address.x);
});

test('PNG address wraps below an unusually wide leading pill without shrinking its text', () => {
  const row = { kind: 'place', title: '虛構長地址', pill: { text: '停留', tone: 'plain' } };
  const block = layoutRow(row, (text, size) => text === '停留' ? 800 : text.length * size);
  expect(block.titleX).toBe(0);
  expect(block.titleY).toBeGreaterThan(0);
  expect(block.titleLines.join('')).toBe(row.title);
});
