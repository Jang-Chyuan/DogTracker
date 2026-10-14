import { historyTimeline, phoneStationaryPresentationStops, mergePhoneSamePlaceStays,
  emptyPhoneFootRows } from '../src/history/HistoryTimeline';
import { configFor } from '../src/history/HistoryConfig';
import { buildExportSnapshot } from '../src/mapHistory/ExportSnapshot';
import { timelinePresentation } from '../src/history/HistoryTimelinePresentation';

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

test('a same-session same-place break is part of the stay, not 「沒有資料」', () => {
  const rows = [...firstRun, ...shortWalk()], raw = JSON.stringify(rows);
  const model = timeline(rows);
  expect(model.edges.some(e => e.bridged)).toBe(true);
  expect(model.nodes.some(n => n.type === 'gap' || n.type === 'resume')).toBe(false);
  // 2026-10-14: the visit is the whole range, and the walk at its end counts
  // metres: it is split there (historyStops), so the stay before the walk is
  // a stay of its own — the range's first row — over the break, not PR 116's
  // unnumbered fallback.
  const walkStart = model.edges.find(e => e.countedDistanceM > 0).start;
  const stays = model.nodes.filter(n => n.type === 'stop');
  expect(stays).toHaveLength(1);
  expect(stays[0]).toMatchObject({ start: rows[0].time, number: null, listedWith: 'start' });
  // It ends where the walk set off (2026-10-14: not on its walking fixes).
  expect(stays[0].end).toBeLessThanOrEqual(walkStart);
  expect(stays[0].end).toBeGreaterThanOrEqual(point(4000).time);
  expect(stays[0].durationMs).toBe(stays[0].end - stays[0].start);
  expect(stays[0].presentationOnly).toBeUndefined();
  expect(timelinePresentation(model.nodes).map(n => n.type)).toEqual(['stop', 'movement', 'end']);
  const snapshot = buildExportSnapshot({ day: { subjects: [{ id: 'phone', model }] }, range: model.range, subject: 'phone' });
  expect(snapshot.subjects[0].stays).toHaveLength(1);
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

// Reported shape (invented times): 停 76 分 → 沒有資料 13 分 → 走路 0 分 · 0.0 km →
// 結束 · 停 39 分, all at one place in one recording session.
const minute = 60000;
const stayNode = (from, to, extra = {}) => ({ type: 'stop', id: `visit:${from}`, start: base + from * minute,
  end: base + to * minute, durationMs: (to - from) * minute, interruptionMs: 0, gaps: [], latitude: 1, longitude: 1, ...extra });
const reported = breakNode => [
  { type: 'departure', start: base, end: base, latitude: 1, longitude: 1.001 },
  { type: 'movement', mode: 'walking', start: base, end: base + 5 * minute, durationMs: 5 * minute, distanceM: 110, countedDistanceM: 110 },
  stayNode(5, 81, { number: 1 }), breakNode,
  { type: 'movement', mode: 'walking', start: base + 94 * minute, end: base + 94 * minute + 40000, durationMs: 40000,
    distanceM: 0, countedDistanceM: 0 },
  stayNode(94 + 40 / 60, 134, { number: 2, id: 'visit:after' }),
  { type: 'end', start: base + 134 * minute, end: base + 134 * minute, latitude: 1, longitude: 1 }];

// 2026-10-14: a range that ends in a stay ends with that stay (no end row).
test('the reported stay / break / 0 m walk / stay ending shape is one stay, the last row', () => {
  const brkStay = { type: 'stop', id: 'phone-stationary:x', presentationOnly: 'phone-stationary', number: null,
    start: base + 81 * minute, end: base + 94 * minute, durationMs: 13 * minute, interruptionMs: 0, gaps: [],
    unobserved: [{ start: base + 81 * minute, end: base + 94 * minute }], latitude: 1, longitude: 1 };
  const nodes = reported(brkStay);
  const { nodes: merged, removed } = mergePhoneSamePlaceStays(nodes, { config });
  expect(merged.map(n => n.type)).toEqual(['departure', 'movement', 'stop', 'end']);
  const [, , stay] = merged;
  expect(stay).toMatchObject({ id: 'visit:5', start: base + 5 * minute, end: base + 134 * minute,
    durationMs: 129 * minute, unobserved: brkStay.unobserved });
  expect(removed.size).toBe(3);
  const shown = timelinePresentation(merged);
  expect(shown.map(n => n.type)).toEqual(['departure', 'movement', 'stop']);
  expect(shown[2]).toMatchObject({ id: 'visit:5', start: base + 5 * minute, durationMs: 129 * minute });
  expect(nodes[2].end).toBe(base + 81 * minute); // the source stay is not mutated
});

test('a real 「沒有資料」 between the two stays (recording off) keeps them apart', () => {
  const gap = { type: 'gap', mode: 'gap', start: base + 81 * minute, end: base + 94 * minute, durationMs: 13 * minute,
    distanceM: 0, countedDistanceM: 0 };
  const { nodes: merged } = mergePhoneSamePlaceStays(reported(gap), { config });
  expect(merged.filter(n => n.type === 'stop')).toHaveLength(2);
  expect(merged.some(n => n.type === 'gap')).toBe(true);
});

test('a phone list never shows 「走路 0 分 · 0.0 km」 next to a break, a place or an end', () => {
  const gap = { type: 'gap', mode: 'gap', start: base + 81 * minute, end: base + 94 * minute, durationMs: 13 * minute,
    distanceM: 0, countedDistanceM: 0 };
  const nodes = reported(gap);
  const empty = emptyPhoneFootRows(nodes);
  expect([...empty]).toEqual([nodes[4]]);
  // A 0 m minute that still reads 「走路 1 分」, a counted walk, or a 0 m leg
  // between two movement rows is kept.
  const kept = [{ ...nodes[4], end: nodes[4].start + 90000, durationMs: 90000 }, { ...nodes[4], countedDistanceM: 6 }];
  for (const walk of kept) expect(emptyPhoneFootRows([nodes[2], walk, nodes[5]]).size).toBe(0);
  expect(emptyPhoneFootRows([nodes[1], nodes[4], { ...nodes[1], mode: 'driving' }]).size).toBe(0);
});

// A break stay that reaches the endpoint is the last row (2026-10-14: no end row).
test('a same-place break stay ending at the last fix is the last row without double counting', () => {
  // Walk 0–300 s, stay, a 70 min break, stay to the last fix at 4800 s.
  const [stay] = phoneStationaryPresentationStops([edge(300, 600), brk(600, 4500),
    edge(4500, 4505, {}, moving, moving), edge(4505, 4800)], { config });
  expect(stay).toMatchObject({ start: base + 300000, end: base + 4800000, unobserved: [{ start: base + 600000, end: base + 4500000 }] });
  const nodes = [{ type: 'departure', start: base, end: base, latitude: 1, longitude: 1 },
    { type: 'movement', mode: 'walking', start: base, end: base + 300000, durationMs: 300000, distanceM: 400, countedDistanceM: 400 },
    stay, { type: 'end', start: base + 4800000, end: base + 4800000, latitude: 1, longitude: 1 }];
  const end = nodes[3];
  const shown = timelinePresentation(nodes);
  expect(shown.some(n => n.type === 'gap' || n.type === 'end')).toBe(false);
  const last = shown[shown.length - 1];
  expect(last).toMatchObject({ type: 'stop', id: stay.id, start: stay.start, end: end.start,
    durationMs: stay.durationMs, number: null });
  expect(last.durationMs).toBe(last.end - last.start);
  // Every shown minute once: no row overlaps another.
  const spans = shown.filter(n => n.end > n.start).sort((a, b) => a.start - b.start);
  for (let i = 1; i < spans.length; i++) expect(spans[i].start).toBeGreaterThanOrEqual(spans[i - 1].end);
});
