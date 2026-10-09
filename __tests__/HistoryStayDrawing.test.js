import { clipRouteAtStays, historyMapPresentation, outsideLines, routeLines, stayAwareModelEdges } from '../src/history/screen/HistoryMapModel';
import { historyTimeline } from '../src/history/HistoryTimeline';
import { historyMovement } from '../src/history/HistoryMovement';
import { distanceMeters } from '../src/history/HistoryConfig';
import { lightTheme, darkTheme } from '../src/theme/ThemeProvider';

// Invented Taoyuan station fixture; no real route or location data.
const origin = { latitude: 24.9893, longitude: 121.3143 };
const MINUTE = 60000;
const point = (minute, metres, extra = {}) => ({ ...origin,
  longitude: origin.longitude + metres / (111320 * Math.cos(origin.latitude * Math.PI / 180)),
  time: minute * MINUTE, accuracy: 5, ...extra });
const jitter = (start, end, metres = 0, extra = {}) => Array.from({ length: end - start + 1 },
  (_, i) => point(start + i, metres + Math.sin(i) * 8, extra));
const color = lightTheme.colors.phone;

test.each(['dog', 'phone'])('a stationary %s day draws no faded jitter', subject => {
  const day = jitter(0, 120, 0, subject === 'phone' ? { slave_id: 'phone', speed_kmh: 0 } : {});
  expect(outsideLines(day, { start: 100 * MINUTE, end: 110 * MINUTE }, { color, subject })).toEqual([]);
});

test.each(['dog', 'phone'])('a mixed %s day fades only actual travel outside the range', subject => {
  const day = [...jitter(0, 40), ...Array.from({ length: 9 }, (_, i) => point(41 + i, 50 + i * 50)),
    ...jitter(50, 90, 500)];
  const lines = outsideLines(day, { start: 80 * MINUTE, end: 90 * MINUTE }, { color, subject });
  expect(lines.length).toBeGreaterThan(0);
  expect(lines.every(line => line.dashed && line.width === 2)).toBe(true);
  expect(lines[0].start).toBeGreaterThan(40 * MINUTE);
  expect(lines[lines.length - 1].end).toBeLessThan(50 * MINUTE);
  for (const line of lines) for (const coordinate of line.coordinates) {
    expect(distanceMeters(origin, coordinate)).toBeGreaterThan(24);
    expect(distanceMeters(point(50, 500), coordinate)).toBeGreaterThan(24);
  }
});

test.each(['dog', 'phone'])('clip %s arrival and departure exactly at a stay radius', subject => {
  const points = [point(0, -100), point(1, 0), point(2, 8), point(3, -8), point(4, 0), point(5, 100)];
  const edges = historyMovement(points, { subject }).edges;
  const snapshot = JSON.stringify(edges);
  const clipped = clipRouteAtStays(edges, [{ type: 'stop', ...origin, start: MINUTE, end: 4 * MINUTE }]);
  expect(clipped).toHaveLength(2);
  expect(distanceMeters(origin, clipped[0].to)).toBeCloseTo(25, 0);
  expect(distanceMeters(origin, clipped[1].from)).toBeCloseTo(25, 0);
  expect(clipped[0].end).toBeLessThan(MINUTE);
  expect(clipped[1].start).toBeGreaterThan(4 * MINUTE);
  expect(JSON.stringify(edges)).toBe(snapshot);
  expect(routeLines(clipped, { color })).toHaveLength(2);
});

test('unconfirmed excursions during a stay vanish; earlier passes through its location remain', () => {
  const points = [point(0, -50), point(1, 50), point(2, 0), point(3, 120), point(4, 0), point(5, 100)];
  const edges = historyMovement(points, { subject: 'dog' }).edges;
  const clipped = clipRouteAtStays(edges, [{ type: 'stop', ...origin, start: 2 * MINUTE, end: 4 * MINUTE }]);
  expect(clipped[0]).toBe(edges[0]);
  expect(clipped.some(e => e.start >= 2 * MINUTE && e.end <= 4 * MINUTE)).toBe(false);
});

test('no indoor, same-place bridged or missing-data edges in either route style', () => {
  const points = [point(0, 0), point(10, 5), point(11, 5, { heldReason: 'stationary' }), point(20, 1000)];
  const edges = historyMovement(points).edges;
  expect(clipRouteAtStays(edges)).toEqual([]);
  expect(routeLines(edges, { color })).toEqual([]);
  expect(outsideLines(points, { start: 30 * MINUTE, end: 40 * MINUTE }, { color })).toEqual([]);
});

test('range drawing uses day stays, preserving original fixes, cursor and distances', () => {
  const points = [...jitter(0, 40), ...Array.from({ length: 9 }, (_, i) => point(41 + i, 50 + i * 50)),
    ...jitter(50, 90, 500)];
  const model = historyTimeline(points, { subject: 'phone', replayHolds: p => p,
    range: { start: 20 * MINUTE, end: 70 * MINUTE } });
  const original = JSON.stringify(model);
  const first = historyMapPresentation(model, { color, subject: 'phone', cursor: { point: model.points[5] } });
  const second = historyMapPresentation(model, { color, subject: 'phone', cursor: { point: model.points[30] } });
  expect(first.cursor.time).toBe(model.points[5].time);
  expect(second.points).toBe(first.points);
  expect(first.lines.length).toBeGreaterThan(0);
  expect(first.lines.every(line => line.start > 40 * MINUTE && line.end < 50 * MINUTE)).toBe(true);
  expect(JSON.stringify(model)).toBe(original);
});

test('day drawing invalidates after hold replay mutates observations', () => {
  const points = Array.from({ length: 5 }, (_, i) => point(i, i * 50));
  expect(outsideLines(points, { start: 10 * MINUTE, end: 20 * MINUTE }, { color }).length).toBeGreaterThan(0);
  points.forEach(p => { p.heldReason = 'stationary'; p.heldSince = 0; });
  expect(outsideLines(points, { start: 10 * MINUTE, end: 20 * MINUTE }, { color })).toEqual([]);
});

const channels = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const luminance = rgb => rgb.map(value => {
  const s = value / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
test.each([lightTheme, darkTheme])('header backing maintains text AA over even the worst map colour ($isDark)', theme => {
  const surface = channels(theme.colors.surface), alpha = theme.opacity.mapHeaderBacking;
  // Black under the light surface / white under the dark surface give the
  // lowest text contrast; every map pixel is bounded by those two colours.
  const background = surface.map(c => alpha * c + (1 - alpha) * (theme.isDark ? 255 : 0));
  const a = luminance(channels(theme.colors.text)), b = luminance(background);
  expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toBeGreaterThanOrEqual(4.5);
});


test('clipping scans only overlapping stays on a long timeline', () => {
  const points = Array.from({ length: 8001 }, (_, i) => point(i, i * 5));
  const edges = historyMovement(points).edges;
  let intervalReads = 0;
  const stays = Array.from({ length: 1000 }, (_, i) => ({
    type: 'stop', ...point(i * 8 + 2, (i * 8 + 2) * 5),
    get start() { intervalReads += 1; return (i * 8 + 2) * MINUTE; },
    get end() { intervalReads += 1; return (i * 8 + 3) * MINUTE; },
  }));
  const clipped = clipRouteAtStays(edges, stays);
  expect(clipped.length).toBeGreaterThan(0);
  // Broad operation-count bound, independent of machine speed. The old
  // nested scan performs millions of reads for this same fixture.
  expect(intervalReads).toBeLessThan(edges.length * 20 + stays.length * 20);
});

test('secondary geometry is reused and invalidated for coordinate/mode/stay edits', () => {
  const points = [point(0, -100), point(1, 0), point(2, 0), point(3, 100)];
  const stop = { type: 'stop', ...origin, start: MINUTE, end: 2 * MINUTE };
  const model = { edges: historyMovement(points).edges, locations: [stop] };
  const first = stayAwareModelEdges(model);
  expect(stayAwareModelEdges(model)).toBe(first);
  points[0].longitude = point(0, -150).longitude;
  const moved = stayAwareModelEdges(model);
  expect(moved).not.toBe(first);
  expect(moved[0].from.longitude).toBe(points[0].longitude);
  model.edges[0].mode = 'gap';
  const gap = stayAwareModelEdges(model);
  expect(gap).not.toBe(moved);
  expect(gap).toHaveLength(1);
  stop.end = 3 * MINUTE;
  const extended = stayAwareModelEdges(model);
  expect(extended).not.toBe(gap);
  expect(extended).toHaveLength(0);
  model.locations.splice(0, 1, { ...stop, start: 10 * MINUTE, end: 11 * MINUTE });
  const replaced = stayAwareModelEdges(model);
  expect(replaced).not.toBe(extended);
  expect(replaced.length).toBeGreaterThan(0);
  model.locations.push(stop);
  expect(stayAwareModelEdges(model)).toHaveLength(0);
});
