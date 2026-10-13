import { historyTimeline, phoneStationaryPresentationStops } from '../src/history/HistoryTimeline';
import { configFor } from '../src/history/HistoryConfig';
import { buildExportSnapshot } from '../src/mapHistory/ExportSnapshot';
import { buildCSV } from '../src/mapHistory/ExportCSV';
import { buildGPX } from '../src/mapHistory/ExportGPX';
import { nodePill, placeSpeech } from '../src/history/HistoryText';

const base = 1600000000000;
const config = configFor('phone');
const point = (seconds, metres = 0, extra = {}) => ({ time: base + seconds * 1000,
  latitude: 1, longitude: 1 + metres / 111320, raw_latitude: 1, raw_longitude: 1 + metres / 111320,
  accuracy: 2, raw_speed_kmh: 0, speed_kmh: 0, speed_accuracy_mps: 0.4,
  motion_state: 'stationary', session_id: 'fiction-session', ...extra });
const firstRun = Array.from({ length: 381 }, (_, i) => point(i * 5));
const shortWalk = Array.from({ length: 25 }, (_, i) => point(4000 + i * 5,
  i <= 12 ? i * 1.5 : (24 - i) * 1.5,
  { raw_speed_kmh: 3.6, speed_kmh: 3.6, motion_state: 'moving' }));
const timeline = rows => historyTimeline(rows, { subject: 'phone', dayStart: base, dayEnd: base + 86400000,
  manualRange: { start: rows[0].time, end: rows.at(-1).time } });

test('an observed stationary minute span is not silently lost when the whole-range visit has travel and no numbered stay', () => {
  const rows = [...firstRun, ...shortWalk], raw = JSON.stringify(rows);
  const model = timeline(rows);
  const stationary = model.edges.filter(e => !e.gap && !e.bridged && e.mode === 'walking'
    && e.from.phoneStationary && e.to.phoneStationary && e.countedDistanceM === 0);
  expect(stationary.length).toBeGreaterThan(300);
  expect(model.edges.some(e => e.bridged)).toBe(true);
  const pause = model.nodes.find(n => n.presentationOnly === 'phone-stationary');
  expect(!!pause).toBe(true);
  expect(pause.number).toBeNull();
  expect(pause.durationMs).toBe(pause.end - pause.start);
  expect(pause.durationMs).toBeGreaterThan(30 * 60000);
  expect(JSON.stringify(rows)).toBe(raw);
});

const edge = (start = 0, end = 200, extra = {}) => ({ from: { ...point(start), phoneStationary: true,
  phoneMotionState: 'stationary', phoneConfirmedMovement: false }, to: { ...point(end), phoneStationary: true,
  phoneMotionState: 'stationary', phoneConfirmedMovement: false }, start: base + start * 1000,
  end: base + end * 1000, durationMs: (end - start) * 1000, gap: false, bridged: false,
  mode: 'walking', countedDistanceM: 0, ...extra });

test.each(['driving', 'gap', 'bridge', 'uncertain', 'counted travel', 'confirmed walk', 'unknown',
  'beyond the accuracy filter', 'session change', 'legacy', 'covered'])('presentation fallback cannot claim %s as stationary', reason => {
  const e = edge(); let covered = () => false;
  if (reason === 'driving') e.mode = 'driving';
  if (reason === 'gap') e.gap = true;
  if (reason === 'bridge') e.bridged = true;
  if (reason === 'uncertain') e.uncertain = true;
  if (reason === 'counted travel') e.countedDistanceM = 1;
  if (reason === 'confirmed walk') e.to.phoneConfirmedMovement = true;
  if (reason === 'unknown') e.to.phoneMotionState = 'unknown';
  if (reason === 'beyond the accuracy filter') e.to.accuracy = config.accuracyM + 1;
  if (reason === 'session change') e.to.session_id = 'another-fiction-session';
  if (reason === 'legacy') delete e.to.motion_state;
  if (reason === 'covered') covered = () => true;
  expect(phoneStationaryPresentationStops([e], { config, covered })).toEqual([]);
});

// 2026-10-13: a stationary fix coarser than the 25 m stay gate is still
// observed stationary time; it never places the run (the first fix within
// 25 m does) and marks it `coarse`.
test('coarse stationary fixes keep their time in the run without placing it', () => {
  const e = edge(0, 200);
  e.from.latitude += 0.00001;
  e.to.accuracy = config.stayAccuracyM + 1;
  const [run] = phoneStationaryPresentationStops([e], { config });
  expect(run).toMatchObject({ number: null, coarse: true, accuracyM: config.stayAccuracyM + 1,
    latitude: e.from.latitude, longitude: e.from.longitude, durationMs: 200000 });
  const fine = phoneStationaryPresentationStops([edge(0, 200)], { config });
  expect(fine[0].coarse).toBeUndefined();
});

test('fallback uses the existing anchor, keeps raw edges untouched and breaks at an uncovered sampling interval', () => {
  const edges = [edge(0, 200), edge(210, 410)], raw = JSON.stringify(edges);
  const stops = phoneStationaryPresentationStops(edges, { config });
  expect(stops).toHaveLength(2);
  expect(stops[0]).toMatchObject({ number: null, latitude: edges[0].from.latitude,
    longitude: edges[0].from.longitude, durationMs: 200000 });
  expect(JSON.stringify(edges)).toBe(raw);
});

test('an unnumbered fallback uses the existing stop pill and readable address speech', () => {
  const stop = { type: 'stop', number: null, start: base, end: base + 30 * 60000,
    durationMs: 30 * 60000, presentationOnly: 'phone-stationary' };
  expect(nodePill(stop).text).toBe('停 30 分');
  expect(placeSpeech(stop, '虛構測試地點')).toContain('停留，虛構測試地點');
  expect(placeSpeech(stop, '虛構測試地點')).not.toMatch(/null|undefined/);
});


test('existing list/address/PNG contracts accept the unnumbered stop while CSV and GPX raw exports remain identical', () => {
  const model = timeline([...firstRun, ...shortWalk]);
  expect(model.nodes.some(n => n.presentationOnly)).toBe(true);
  const baseline = { ...model, nodes: model.nodes.filter(n => !n.presentationOnly),
    displayStays: model.displayStays || [] };
  const snapshot = value => buildExportSnapshot({ day: { subjects: [{ id: 'phone', model: value }] },
    range: value.range, subject: 'phone' });
  const before = snapshot(baseline), after = snapshot(model);
  expect(buildCSV(after)).toBe(buildCSV(before));
  expect(buildGPX(after)).toBe(buildGPX(before));
  expect(after.subjects[0].stays).toEqual(before.subjects[0].stays);
  // 2026-10-13: the run starts once the detector settled, seconds after the
  // first fix: it is the 出發's stay (「出發 · 停 N 分」), unnumbered.
  expect(after.subjects[0].timeline.some(n => n.kind === 'place' && n.number === null
    && (n.type === 'stop' || (n.type === 'departure' && n.pill.text.includes('停'))))).toBe(true);
  expect(after.subjects[0].map.lines).toEqual(before.subjects[0].map.lines);
  expect(after.subjects[0].map.places).toEqual(before.subjects[0].map.places);
});

test('a sub-threshold pause does not manufacture a newly qualified stay', () => {
  expect(phoneStationaryPresentationStops([edge(0, 179)], { config })).toEqual([]);
});


test('manual clipping keeps the stay from the clip start; the same-session same-place break stays unobserved', () => {
  const rows = [...firstRun, ...shortWalk];
  const start = point(600).time, end = rows.at(-1).time;
  const model = historyTimeline(rows, { subject: 'phone', dayStart: base, dayEnd: base + 86400000,
    manualRange: { start, end } });
  const pause = model.nodes.find(n => n.presentationOnly);
  // PR 116 / 067: the 35 min break at the same place, same session, is part
  // of the stay, and is kept as unobserved time (export gaps).
  expect(pause).toMatchObject({ start, end: point(4000).time, durationMs: 3400000, number: null,
    unobserved: [{ start: point(1900).time, end: point(4000).time }] });
  expect(model.nodes.some(n => n.type === 'gap' || n.type === 'resume')).toBe(false);
  expect(model.nodes.filter(n => n.type === 'stop')).toHaveLength(1);
  expect(model.points.every(p => p.time >= start && p.time <= end)).toBe(true);
  expect(model.edges.every(e => e.start >= start && e.end <= end)).toBe(true);
  expect(model.distanceM).toBeCloseTo(timeline(rows).distanceM);
});

test('an existing qualified stop retains its number without a duplicate presentation stay', () => {
  const walkAway = Array.from({ length: 81 }, (_, i) => point(1905 + i * 5, (i + 1) * 5,
    { motion_state: 'moving', raw_speed_kmh: 3.6, speed_kmh: 3.6 }));
  const model = timeline([...firstRun, ...walkAway]);
  const stop = model.locations.find(n => n.type === 'stop');
  expect(stop).toBeDefined();
  expect(stop.number).toBe(1);
  expect(model.nodes.filter(n => n.type === 'stop')).toHaveLength(1);
  expect(model.nodes.some(n => n.presentationOnly)).toBe(false);
});

test('an existing indoor hold does not gain a second stationary row', () => {
  const rows = firstRun.map(p => ({ ...p, heldReason: 'indoor', heldSince: base - 1, locationTime: null }));
  const model = timeline(rows);
  expect(model.nodes.some(n => n.type === 'indoor')).toBe(true);
  expect(model.nodes.some(n => n.presentationOnly)).toBe(false);
});

test('a five-minute red light remains part of its confirmed drive, including a clipped range', () => {
  let time = 0, metres = 0;
  const rows = [point(0, 0, { motion_state: 'moving', raw_speed_kmh: 28.8, speed_kmh: 28.8 })];
  for (const [speed, seconds] of [[8, 40], [0, 300], [3.5, 45], [8, 40]]) {
    for (let second = 0; second < seconds; second += 5) {
      time += 5; metres += speed * 5;
      rows.push(point(time, metres, { motion_state: speed ? 'moving' : 'stationary',
        raw_speed_kmh: speed * 3.6, speed_kmh: speed * 3.6 }));
    }
  }
  for (const range of [null, { start: point(100).time, end: point(300).time }]) {
    const model = range ? historyTimeline(rows, { subject: 'phone', range }) : timeline(rows);
    expect(model.edges.every(e => e.mode === 'driving')).toBe(true);
    expect(model.nodes.filter(n => n.type === 'stop' || n.type === 'gap')).toHaveLength(0);
    expect(model.distanceM).toBe(0);
  }
});
