import { historyTimeline } from '../src/history/HistoryTimeline';
import { cursorLabel } from '../src/history/screen/HistoryScreenCursor';
import { historyMapPresentation } from '../src/history/screen/HistoryMapModel';
import { buildExportSnapshot } from '../src/mapHistory/ExportSnapshot';
import { buildCSV } from '../src/mapHistory/ExportCSV';
import { buildGPX } from '../src/mapHistory/ExportGPX';
import { point } from '../__fixtures__/HistoryLogicFixtures';

const minute = 60000;
const rows = Array.from({ length: 43 }, (_, i) => point(i * 60, i < 3 ? i * 50 : 150,
  { accuracy: 5, satellites: 9, hdop: 1, usb: false }));
const options = { subject: 'dog', dayStart: 0, dayEnd: 86400000, following: false };
const range = { start: 20 * minute, end: 35 * minute };
const selected = input => historyTimeline(input, { ...options, range });

test('full-day-confirmed dog stay retains an unnumbered display interval in its shorter interior range', () => {
  const raw = JSON.stringify(rows);
  const full = historyTimeline(rows, options);
  expect(full.locations.filter(n => n.type === 'stop')).toHaveLength(1);
  expect(full.locations.find(n => n.type === 'stop').durationMs).toBe(39 * minute);
  const model = selected(rows);
  expect(model.locations.filter(n => n.type === 'stop')).toHaveLength(0);
  expect(model.displayStays).toHaveLength(1);
  expect(model.displayStays[0]).toMatchObject({ start: range.start, end: range.end, durationMs: 15 * minute });
  expect(model.sections).toEqual([]);
  expect(cursorLabel(model, range.end)[1]).toBe('停留 15 分');
  const drawing = historyMapPresentation(model, { color: '#123456', subject: 'dog', cursor: { point: model.points.at(-1) } });
  expect(drawing.places).toEqual([]);
  expect(drawing.cursor.coordinate).toEqual({ latitude: model.points.at(-1).latitude, longitude: model.points.at(-1).longitude });
  expect(model.points.map(p => p.time)).toEqual(rows.filter(p => p.time >= range.start && p.time <= range.end).map(p => p.time));
  expect(JSON.stringify(rows)).toBe(raw);
});

test('a measured twenty-metre return inside the known stay is preserved as possible short walking', () => {
  const input = rows.map((p, i) => i === 27 ? { ...p, latitude: point(i * 60, 170).latitude } : p);
  const model = selected(input);
  expect(model.edges.some(e => e.countedDistanceM > 0)).toBe(true);
  expect(model.displayStays).toBeUndefined();
  expect(model.sections.some(n => n.type === 'movement' && n.countedDistanceM > 0)).toBe(true);
});

test('a nearby but not day-confirmed short stationary interval does not become a display stay', () => {
  const model = selected(rows.filter(p => p.time <= 25 * minute));
  expect(model.displayStays).toBeUndefined();
  expect(model.sections.some(n => n.type === 'movement')).toBe(true);
});

test('a real departure and later return cannot be hidden by an earlier long stay', () => {
  const input = rows.map((p, i) => i >= 26 && i <= 29 ? { ...p, latitude: point(i * 60, 250).latitude } : p);
  const model = selected(input);
  expect(model.displayStays).toBeUndefined();
  expect(model.sections.some(n => n.type === 'movement' && n.countedDistanceM > 0)).toBe(true);
});

// A true signal gap beyond the existing same-place continuation limit must
// remain visible; known stationary periods on either side cannot prove it.
test('a real signal gap between long stationary visits remains in the selected range', () => {
  const later = Array.from({ length: 40 }, (_, i) => point((17 * 60 + i) * 60, 150,
    { accuracy: 5, satellites: 9, hdop: 1, usb: false }));
  const model = historyTimeline([...rows, ...later], { ...options,
    range: { start: 20 * minute, end: (17 * 60 + 15) * minute } });
  expect(model.edges.some(e => e.gap && !e.uncertain && !e.bridged)).toBe(true);
  expect(model.displayStays).toBeUndefined();
  expect(model.sections.some(n => n.type === 'gap')).toBe(true);
});

test('unnumbered presentation preserves every selected raw CSV and GPX observation', () => {
  const model = selected(rows);
  const snapshot = buildExportSnapshot({ subject: 'dog', range, day: { subjects: [{ id: 41, model }] } });
  const expected = rows.filter(p => p.time >= range.start && p.time <= range.end);
  const csv = buildCSV(snapshot);
  expect(csv.trim().split('\r\n')).toHaveLength(expected.length + 1);
  for (const p of expected) expect(csv).toContain(new Date(p.time).toISOString());
  const gpx = buildGPX(snapshot);
  expect([...gpx.matchAll(/<trkpt[^>]*>.*?<time>([^<]+)<\/time><\/trkpt>/g)].map(match => match[1]))
    .toEqual(expected.map(p => new Date(p.time).toISOString()));
  expect(snapshot.subjects[0].stays).toEqual([]);
});
