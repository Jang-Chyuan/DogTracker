import { phoneHistoryRow } from '../src/history/HistoryRows';
import { historyTimeline } from '../src/history/HistoryTimeline';
import { phoneStayDisplayCoordinate } from '../src/history/PhoneStayDisplayAnchors';
import { historyMapPresentation, timeMarkers } from '../src/history/screen/HistoryMapModel';
import { buildExportSnapshot } from '../src/mapHistory/ExportSnapshot';
import { buildGPX } from '../src/mapHistory/ExportGPX';
import { buildCSV } from '../src/mapHistory/ExportCSV';
import { distanceMeters } from '../src/history/HistoryConfig';
import { cursorLabel } from '../src/history/screen/HistoryScreenCursor';

// Independently invented public QA input: a short approach followed by one
// confirmed stationary visit with coarse drift. No user-derived route shape.
const now = Date.parse('2026-10-07T01:30:00Z');
const rows = Array.from({ length: 77 }, (_, i) => {
  const weak = i >= 28 && i <= 31;
  const north = i < 4 ? i * 36 : weak ? 189 + (i % 3) * 8 : i < 28 ? 144 : 164;
  const latitude = 24.9901 + north / 111195, longitude = 121.3147 + (weak ? (i % 4) * 6 : 0) / 100782;
  return phoneHistoryRow({ id: i + 1, time: now - 40 * 60000 + i * 30000, latitude, longitude,
    raw_latitude: latitude, raw_longitude: longitude, accuracy: weak ? 80 : 5,
    raw_speed_kmh: i < 4 ? 4.32 : 0, speed_kmh: i < 4 ? 4.32 : 0,
    speed_accuracy_mps: 0.1, motion_state: i < 4 ? 'moving' : 'stationary', session_id: 'invented-single-stay' });
});
const options = { subject: 'phone', dayStart: now - 570 * 60000, dayEnd: now - 570 * 60000 + 86400000,
  now, range: { start: rows[0].time, end: rows.at(-1).time } };
const position = p => ({ latitude: p.latitude, longitude: p.longitude });

test.each([[true, true], [true, false], [false, false]])('single confirmed stay END and cursor share its representative: today=%s following=%s', (today, following) => {
  const before = JSON.stringify(rows);
  const model = historyTimeline(rows, { ...options, today, following });
  const stops = model.nodes.filter(n => n.type === 'stop');
  expect(stops).toHaveLength(1);
  const stop = stops[0], end = model.nodes.find(n => n.type === 'end');
  expect(stop.originalRepresentative).toBeUndefined();
  expect(distanceMeters(stop, rows.at(-1))).toBeGreaterThan(1);
  expect(position(end)).toEqual(position(stop));
  expect(end.originalRepresentative).toEqual(position(model.points.at(-1)));
  expect(end.start).toBe(rows.at(-1).time);
  for (const point of [model.points.find(p => p.time > stop.start + 60000), model.points.at(-1)]) {
    const shown = historyMapPresentation(model, { color: '#123456', subject: 'phone', cursor: { point } });
    expect(shown.cursor.coordinate).toEqual(position(stop));
    expect(shown.cursor.time).toBe(point.time);
  }
  expect(timeMarkers(model.points, { subject: 'phone', stays: model.locations }).at(-1).coordinate).toEqual(position(stop));
  const plainSource = { ...model, nodes: model.nodes.map(n => n.type === 'end'
    ? { ...n, ...position(model.points.at(-1)), originalRepresentative: undefined } : n) };
  const snapshot = m => buildExportSnapshot({ subject: 'phone', range: m.range, day: { subjects: [{ id: 'phone', model: m }] } });
  expect(snapshot(model).subjects[0].timeline.at(-1)).toMatchObject(position(stop));
  expect(snapshot(model).subjects[0].map.times.at(-1)).toMatchObject(position(stop));
  expect(buildGPX(snapshot(model))).toBe(buildGPX(snapshot(plainSource)));
  expect(buildCSV(snapshot(model))).toBe(buildCSV(snapshot(plainSource)));
  expect(JSON.stringify(rows)).toBe(before);
});

test('a plain confirmed stay never captures a recording gap, departure, switch or dog cursor', () => {
  const model = historyTimeline(rows, { ...options, today: true, following: true });
  const stop = model.locations.find(n => n.type === 'stop');
  expect(phoneStayDisplayCoordinate([stop], stop.end + 1)).toBeNull();
  expect(phoneStayDisplayCoordinate([{ ...stop, type: 'switch' }], stop.end)).toBeNull();
  const gapStart = stop.start + 60000, gapEnd = gapStart + 60000;
  expect(phoneStayDisplayCoordinate([{ ...stop, gaps: [{ start: gapStart, end: gapEnd }] }], gapStart + 30000)).toBeNull();
  const point = model.points.at(-1);
  for (const [subject, stale] of [['dog', false], ['phone', true]]) {
    expect(historyMapPresentation(model, { subject, color: '#123456', cursor: { point, stale } }).cursor.coordinate)
      .toEqual(position(point));
  }
  expect(timeMarkers(model.points, { subject: 'dog', stays: model.locations }).at(-1).coordinate).toEqual(position(point));
});

test('genuine departure after the visit keeps its actual endpoint and walking evidence', () => {
  const departure = Array.from({ length: 8 }, (_, i) => {
    const last = rows.at(-1), latitude = last.latitude + (i + 1) * 36 / 111195;
    return phoneHistoryRow({ ...last, time: last.time + (i + 1) * 30000, latitude,
      raw_latitude: latitude, raw_speed_kmh: 4.32, speed_kmh: 4.32, motion_state: 'moving' });
  });
  const all = [...rows, ...departure];
  const model = historyTimeline(all, { ...options, now: all.at(-1).time, today: true, following: true,
    range: { start: all[0].time, end: all.at(-1).time } });
  const point = model.points.at(-1), end = model.nodes.find(n => n.type === 'end');
  expect(model.edges.some(edge => edge.start >= rows.at(-1).time && edge.countedDistanceM > 0)).toBe(true);
  expect(model.distanceM).toBeGreaterThan(244);
  expect(phoneStayDisplayCoordinate(model.locations, point.time)).toBeNull();
  expect(position(end)).toEqual(position(point));
  expect(end.originalRepresentative).toBeUndefined();
  expect(historyMapPresentation(model, { subject: 'phone', color: '#123456', cursor: { point } }).cursor.coordinate)
    .toEqual(position(point));
});


test.each([false, true])('a fixed range ending inside a day-confirmed phone stay keeps it: today=%s', today => {
  const before = JSON.stringify(rows);
  const full = historyTimeline(rows, { ...options, today, following: false });
  const confirmed = full.locations.find(n => n.type === 'stop');
  const range = { start: rows[0].time, end: confirmed.start + 20 * 60000 };
  const clipped = historyTimeline(rows, { ...options, today, following: false, range });
  const stop = clipped.locations.find(n => n.id === confirmed.id);
  expect(stop).toBeDefined();
  expect(stop.durationMs).toBeLessThan(30 * 60000);
  expect(stop.end).toBeLessThanOrEqual(range.end);
  expect(stop.points.every(p => p.time <= range.end)).toBe(true);
  expect(clipped.nodes.some(n => n.type === 'movement' && n.start >= confirmed.start)).toBe(false);
  const point = clipped.points.at(-1);
  expect(position(clipped.nodes.find(n => n.type === 'end'))).toEqual(position(stop));
  expect(historyMapPresentation(clipped, { subject: 'phone', color: '#123456', cursor: { point } }).cursor.coordinate)
    .toEqual(position(stop));
  expect(clipped.distanceM).toBe(full.edges.filter(e => e.end <= range.end).reduce((n, e) => n + e.countedDistanceM, 0));
  expect(JSON.stringify(rows)).toBe(before);
});

test('partial observations do not borrow an unobserved future stay confirmation', () => {
  const end = rows[4].time + 20 * 60000;
  const available = rows.filter(p => p.time <= end);
  const model = historyTimeline(available, { ...options, today: true, now: end, following: false,
    range: { start: available[0].time, end } });
  expect(model.locations.filter(n => n.type === 'stop')).toHaveLength(0);
  expect(model.displayStays).toBeUndefined();
  expect(model.nodes.find(n => n.type === 'end').originalRepresentative).toBeUndefined();
});

test('a range wholly inside one stay keeps the existing unnumbered still-here contract', () => {
  const model = historyTimeline(rows, { ...options, following: false,
    range: { start: rows[10].time, end: rows[45].time } });
  expect(model.locations.filter(n => n.type === 'stop')).toHaveLength(0);
});


test('coarse range-tail fixes inside a day-confirmed visit share its display interval, but never a true gap', () => {
  const input = rows.map((p, i) => i >= 35 && i <= 39 ? { ...p, accuracy: 40, accuracy_meters: 40 } : p);
  const model = historyTimeline(input, { ...options, following: false,
    range: { start: input[0].time, end: input[39].time } });
  const stop = model.locations.find(n => n.type === 'stop'), point = model.points.at(-1);
  expect(stop).toBeDefined();
  expect(point.time).toBeGreaterThan(stop.end);
  expect(stop.points.every(p => p.accuracy <= 25)).toBe(true);
  expect(position(model.nodes.find(n => n.type === 'end'))).toEqual(position(stop));
  expect(historyMapPresentation(model, { subject: 'phone', color: '#123456', cursor: { point } }).cursor.coordinate)
    .toEqual(position(stop));
  expect(cursorLabel(model, point.time, 'phone')[1]).toMatch(/^停留 /);
  const gap = { start: point.time - 30000, end: point.time + 30000 };
  expect(phoneStayDisplayCoordinate([{ ...stop, displayRange: { ...stop.displayRange, gaps: [gap] } }], point.time)).toBeNull();
  expect(phoneStayDisplayCoordinate([stop], input[40].time)).toBeNull();
});


test('clipping a real departure after a confirmed stay never anchors the departure endpoint', () => {
  const departure = Array.from({ length: 8 }, (_, i) => {
    const last = rows.at(-1), latitude = last.latitude + (i + 1) * 36 / 111195;
    return phoneHistoryRow({ ...last, time: last.time + (i + 1) * 30000, latitude,
      raw_latitude: latitude, raw_speed_kmh: 4.32, speed_kmh: 4.32, motion_state: 'moving' });
  });
  const all = [...rows, ...departure], endTime = departure[5].time;
  const model = historyTimeline(all, { ...options, following: false, now: all.at(-1).time,
    range: { start: all[0].time, end: endTime } });
  const point = model.points.at(-1);
  expect(point.time).toBe(endTime);
  expect(model.distanceM).toBeGreaterThan(170);
  expect(model.edges.some(e => e.start >= rows.at(-1).time && e.countedDistanceM > 0)).toBe(true);
  expect(phoneStayDisplayCoordinate(model.locations, point.time)).toBeNull();
  expect(position(model.nodes.find(n => n.type === 'end'))).toEqual(position(point));
  expect(cursorLabel(model, point.time, 'phone')[1]).not.toMatch(/^停留 /);
});


test.each(['first', 'last', 'both'])('a wholly stationary range remains unnumbered with coarse %s boundary fixes', boundary => {
  const input = rows.map((p, i) => ((boundary !== 'last' && i >= 10 && i <= 14)
    || (boundary !== 'first' && i >= 35 && i <= 39)) ? { ...p, accuracy: 40, accuracy_meters: 40 } : p);
  const full = historyTimeline(input, { ...options, following: false });
  expect(full.locations.filter(n => n.type === 'stop')).toHaveLength(1);
  const model = historyTimeline(input, { ...options, following: false,
    range: { start: input[10].time, end: input[39].time } });
  expect(model.points[0].time).toBe(input[10].time);
  expect(model.points.at(-1).time).toBe(input[39].time);
  expect(model.locations.filter(n => n.type === 'stop')).toHaveLength(0);
  expect(model.distanceM).toBe(0);
});


test('a true gap inside the available visit cannot establish continuous still-here coverage', () => {
  const input = rows.filter((p, i) => i < 15 || i > 24).map(p => {
    const i = rows.findIndex(r => r.time === p.time);
    if (i !== 14 && i !== 25) return p;
    // Both endpoints fit the visit circle, but their raw separation is 40m
    // with no measured stationary speed: this is not a same-place bridge.
    const latitude = rows[4].latitude + (i === 14 ? -20 : 20) / 111195;
    return { ...p, latitude, raw_latitude: latitude, raw_speed_kmh: null,
      speed_kmh: null, motion_state: 'unknown' };
  });
  const model = historyTimeline(input, { ...options, following: false,
    range: { start: rows[10].time, end: rows[39].time } });
  const stop = model.locations.find(n => n.type === 'stop');
  const gap = { start: rows[14].time, end: rows[25].time };
  expect(stop.gaps).toContainEqual(gap);
  expect(model.sections.find(n => n.type === 'gap')).toMatchObject(gap);
  expect(model.displayStays).toBeUndefined();
  const middle = (gap.start + gap.end) / 2;
  expect(phoneStayDisplayCoordinate(model.locations, middle)).toBeNull();
  expect(cursorLabel(model, middle, 'phone')[1]).not.toMatch(/^停留 /);
});


test.each(['good', 'first', 'last', 'both'])('a wholly inside day-confirmed stay keeps unnumbered display evidence with %s boundaries', boundary => {
  const input = rows.map((p, i) => ((['first', 'both'].includes(boundary) && i >= 10 && i <= 14)
    || (['last', 'both'].includes(boundary) && i >= 35 && i <= 39))
    ? { ...p, accuracy: 40, accuracy_meters: 40 } : p);
  const full = historyTimeline(input, { ...options, following: false });
  const confirmed = full.locations.find(n => n.type === 'stop');
  const model = historyTimeline(input, { ...options, following: false,
    range: { start: input[10].time, end: input[39].time } });
  expect(model.locations.filter(n => n.type === 'stop')).toHaveLength(0);
  expect(model.nodes.some(n => n.type === 'movement')).toBe(false);
  const point = model.points.at(-1), end = model.nodes.find(n => n.type === 'end');
  expect(position(end)).toEqual(position(confirmed));
  expect(historyMapPresentation(model, { subject: 'phone', color: '#123456', cursor: { point } }).cursor.coordinate)
    .toEqual(position(confirmed));
  expect(cursorLabel(model, point.time, 'phone')[1]).toMatch(/^停留 /);
  expect(model.points).toEqual(full.points.filter(p => p.time >= input[10].time && p.time <= input[39].time));
  expect(model.distanceM).toBe(0);
});


test('a measured short walk inside the place region cannot borrow unnumbered display confirmation', () => {
  const input = rows.map((p, i) => {
    if (i < 15 || i > 23) return p;
    const north = (i <= 19 ? i - 14 : 24 - i) * 4;
    return { ...p, latitude: p.latitude + north / 111195, raw_latitude: p.raw_latitude + north / 111195,
      accuracy: 5, accuracy_meters: 5, raw_speed_kmh: 4.32, speed_kmh: 4.32,
      speed_accuracy_mps: 0.1, motion_state: 'moving' };
  });
  const model = historyTimeline(input, { ...options, following: false,
    range: { start: input[10].time, end: input[39].time } });
  expect(model.distanceM).toBeGreaterThan(0);
  expect(model.nodes.some(n => n.type === 'movement' && n.countedDistanceM > 0)).toBe(true);
  expect(model.displayStays).toBeUndefined();
});
