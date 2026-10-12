import { historyTimeline, phoneStationaryPresentationStops } from '../src/history/HistoryTimeline';
import { configFor } from '../src/history/HistoryConfig';
import { buildExportSnapshot } from '../src/mapHistory/ExportSnapshot';

// PR 116: invented rows. Samsung stops GPS on a still phone with the screen
// off; the recorder keeps running (same session) but saves no fix for a while.
const base = 1600000000000;
const config = configFor('phone');
const point = (seconds, metres = 0, extra = {}) => ({ time: base + seconds * 1000,
  latitude: 1, longitude: 1 + metres / 111320, raw_latitude: 1, raw_longitude: 1 + metres / 111320,
  accuracy: 2, raw_speed_kmh: 0, speed_kmh: 0, speed_accuracy_mps: 0.4,
  motion_state: 'stationary', session_id: 'fiction-session', ...extra });
// 0–1900 s still, nothing saved for 35 min at the same place, a short walk.
const firstRun = Array.from({ length: 381 }, (_, i) => point(i * 5));
const shortWalk = (extra = {}) => Array.from({ length: 25 }, (_, i) => point(4000 + i * 5,
  i <= 12 ? i * 1.5 : (24 - i) * 1.5, { raw_speed_kmh: 3.6, speed_kmh: 3.6, motion_state: 'moving', ...extra }));
const timeline = rows => historyTimeline(rows, { subject: 'phone', dayStart: base, dayEnd: base + 86400000,
  manualRange: { start: rows[0].time, end: rows.at(-1).time } });

test('a same-session same-place break is part of the stay, not 「沒有資料」, and stays unobserved in exports', () => {
  const rows = [...firstRun, ...shortWalk()], raw = JSON.stringify(rows);
  const model = timeline(rows);
  expect(model.edges.some(e => e.bridged)).toBe(true);
  expect(model.nodes.some(n => n.type === 'gap' || n.type === 'resume')).toBe(false);
  const stay = model.nodes.find(n => n.presentationOnly);
  expect(stay.start).toBeLessThanOrEqual(point(30).time); // after the detector's own confirmation
  expect(stay).toMatchObject({ end: point(4000).time, number: null,
    unobserved: [{ start: point(1900).time, end: point(4000).time }] });
  const snapshot = buildExportSnapshot({ day: { subjects: [{ id: 'phone', model }] }, range: model.range, subject: 'phone' });
  expect(snapshot.subjects[0].gaps).toEqual(stay.unobserved);
  expect(snapshot.subjects[0].stays).toEqual([]);
  expect(JSON.stringify(rows)).toBe(raw);
});

test('a session change at the break (recording was off, e.g. an app update) remains 「沒有資料」', () => {
  const model = timeline([...firstRun, ...shortWalk({ session_id: 'fiction-after-update' })]);
  expect(model.nodes.some(n => n.type === 'gap' && n.start === point(1900).time && n.end === point(4000).time)).toBe(true);
  expect(model.nodes.some(n => n.type === 'stop' && n.start < point(4000).time && n.end > point(1900).time)).toBe(false);
});

const fix = (seconds, extra = {}) => ({ ...point(seconds), phoneStationary: true, phoneMotionState: 'stationary',
  phoneConfirmedMovement: false, ...extra });
const edge = (start, end, extra = {}, from = {}, to = {}) => ({ from: fix(start, from), to: fix(end, to),
  start: base + start * 1000, end: base + end * 1000, durationMs: (end - start) * 1000, gap: false, bridged: false,
  mode: 'walking', countedDistanceM: 0, ...extra });
const brk = (start, end, extra = {}) => edge(start, end, { gap: true, bridged: true, mode: 'gap', samePlaceBreak: true, ...extra });
const moving = { phoneStationary: false, phoneMotionState: 'moving' };

test('a break with the re-acquisition right after it joins the stays on both sides', () => {
  const edges = [edge(0, 100), edge(100, 200), brk(200, 4400),
    edge(4400, 4405, {}, moving, moving), edge(4405, 4430, { uncertain: true, gap: true, mode: 'gap' }, moving, moving),
    edge(4430, 4440, {}, moving), edge(4440, 4600), brk(4600, 12000), edge(12000, 12030, {}, moving, moving)];
  const [stay, ...rest] = phoneStationaryPresentationStops(edges, { config });
  expect(rest).toEqual([]);
  // Trailing re-acquisition without a following stay is not claimed.
  expect(stay).toMatchObject({ start: base, end: base + 12000 * 1000,
    unobserved: [{ start: base + 200000, end: base + 4400000 }, { start: base + 4600000, end: base + 12000000 }] });
});

test.each([
  ['counted distance after the break', { countedDistanceM: 6 }],
  ['confirmed movement after the break', {}, { phoneConfirmedMovement: true }],
  ['a drive after the break', { mode: 'driving' }],
])('%s ends the stay at the break', (_, extra, to = {}) => {
  const edges = [edge(0, 200), brk(200, 4400), edge(4400, 4410, extra, moving, { ...moving, ...to }), edge(4410, 4700)];
  const stops = phoneStationaryPresentationStops(edges, { config });
  expect(stops[0]).toMatchObject({ start: base, end: base + 4400 * 1000 });
  expect(stops.every(s => !(s.start < base + 4410000 && s.end > base + 4400000))).toBe(true);
});

test('re-acquisition longer than a recording gap is not stay time', () => {
  const edges = [brk(0, 4000), edge(4000, 4100, {}, moving, moving), edge(4100, 4200, {}, moving, moving), edge(4200, 4500)];
  const stops = phoneStationaryPresentationStops(edges, { config });
  expect(stops[0]).toMatchObject({ start: base, end: base + 4000 * 1000 });
});

test.each([
  ['no session evidence', { samePlaceBreak: true }, { session_id: null }],
  ['confirmed movement at an end', { samePlaceBreak: true }, { phoneConfirmedMovement: true }],
  ['an unflagged bridge', { samePlaceBreak: false }, {}],
])('a break with %s is no stay', (_, extra, to) => {
  expect(phoneStationaryPresentationStops([edge(0, 4000, { gap: true, bridged: true, mode: 'gap', ...extra }, {}, to)],
    { config })).toEqual([]);
});
