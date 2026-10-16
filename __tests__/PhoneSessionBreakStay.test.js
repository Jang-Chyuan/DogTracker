import { historyTimeline } from '../src/history/HistoryTimeline';
import { historyStops } from '../src/history/HistoryStops';
import { configFor, samePlaceGap, recordingSessionChanged } from '../src/history/HistoryConfig';
import { sectionText } from '../src/history/HistoryText';
import { buildExportSnapshot } from '../src/mapHistory/ExportSnapshot';
import { createTodayRouteEngine } from '../src/tracking/TodayRouteEngine';
import { todayRouteDistance } from '../src/tracking/TodayDistance';

// Invented rows. A recording session is a new id every time the recorder
// starts (an app update, the process killed, recording switched off and on).
// The list rule wins: time the recorder may not have been running is no stay
// time — a same-place break across a session change is always its own
// 「沒有資料」 row (`sessionChange`) between two stays, however short.
const base = 1600000000000;
const MINUTE = 60000;
const phone = configFor('phone');
const point = (seconds, metres = 0, extra = {}) => ({ time: base + seconds * 1000,
  latitude: 1, longitude: 1 + metres / 111320, raw_latitude: 1, raw_longitude: 1 + metres / 111320,
  accuracy: 2, raw_speed_kmh: 0, speed_kmh: 0, speed_accuracy_mps: 0.4,
  motion_state: 'stationary', session_id: 'fiction-before', ...extra });
const walk = (from, startM, step, extra = {}) => Array.from({ length: 60 }, (_, i) => point(from + i * 5,
  startM + step * i, { raw_speed_kmh: 4.3, speed_kmh: 4.3, motion_state: 'moving', ...extra }));
const still = (from, count, extra = {}) => Array.from({ length: count }, (_, i) => point(from + i * 5, 0, extra));
// Walk in, 30 min still, nothing saved for `breakS`, 30 min still, walk out.
const day = (breakS, after) => {
  const resume = 300 + 1800 + breakS;
  return [...walk(0, 354, -6), ...still(300, 360), ...still(resume, 360, { session_id: after }),
    ...walk(resume + 1800, 0, 6, { session_id: after })];
};
const timeline = rows => historyTimeline(rows, { subject: 'phone', dayStart: base, dayEnd: base + 86400000,
  manualRange: { start: rows[0].time, end: rows.at(-1).time } });
const lastBefore = 300 + 359 * 5; // last fix of the first session
const overlaps = (n, start, end) => n.start < end && n.end > start;

test('samePlaceGap: a phone break across a recording session change is no stay', () => {
  const a = point(0), b = point(3600);
  expect(samePlaceGap(a, b, phone)).toBe(true);
  expect(samePlaceGap(a, { ...b, session_id: 'fiction-after' }, phone)).toBe(false);
  // Place identity only (distance counting, display anchor) ignores the session.
  expect(samePlaceGap(a, { ...b, session_id: 'fiction-after' }, phone, { acrossSessions: true })).toBe(true);
  // Without a session on one side nothing is proven either way: unchanged.
  expect(samePlaceGap(a, { ...b, session_id: null }, phone)).toBe(true);
  expect(samePlaceGap({ ...a, session_id: '' }, { ...b, session_id: 'fiction-after' }, phone)).toBe(true);
  expect(recordingSessionChanged(a, { ...b, session_id: 'fiction-after' })).toBe(true);
  expect(recordingSessionChanged(a, b)).toBe(false);
  // A dog has no recording session: the rule does not apply.
  expect(samePlaceGap(a, { ...b, session_id: 'fiction-after' }, configFor('dog'))).toBe(true);
});

test.each([3600, 300, 200])('(a) a stay across a session change (break %i s) is two stays with 「沒有資料」 between', breakS => {
  const rows = day(breakS, 'fiction-after');
  const model = timeline(rows);
  const resume = 300 + 1800 + breakS;
  expect(model.nodes.map(n => n.type)).toEqual(['departure', 'movement', 'stop', 'gap', 'stop', 'movement', 'end']);
  const [first, second] = model.nodes.filter(n => n.type === 'stop');
  const gap = model.nodes.find(n => n.type === 'gap');
  expect(gap).toMatchObject({ start: point(lastBefore).time, end: point(resume).time, countedDistanceM: 0,
    sessionChange: true });
  expect(sectionText(gap).lead).toBe('沒有位置');
  expect([first.number, second.number]).toEqual([1, 2]);
  // The row sits exactly between the two stays: one ends where it starts.
  expect([first.end, second.start]).toEqual([gap.start, gap.end]);
  for (const stay of [first, second]) {
    expect(overlaps(stay, gap.start, gap.end)).toBe(false);
    expect(stay).toMatchObject({ interruptionMs: 0, gaps: [] });
    expect(stay.durationMs).toBe(stay.end - stay.start);
  }
  expect(model.sections.filter(n => n.sessionChange)).toEqual([gap]);
  // No visit (formal stay detection) spans the off period either.
  const stays = historyStops(model.points, { subject: 'phone', start: model.range.start, end: model.range.end });
  expect(stays.visits.some(v => overlaps(v, gap.start, gap.end))).toBe(false);
  // Exports: the break is a gap, the stays are two, nothing deducted inside them.
  const snapshot = buildExportSnapshot({ day: { subjects: [{ id: 'phone', model }] }, range: model.range, subject: 'phone' });
  expect(snapshot.subjects[0].gaps).toEqual([{ start: gap.start, end: gap.end }]);
  expect(snapshot.subjects[0].stays.map(s => [s.number, s.excludedMs])).toEqual([[1, 0], [2, 0]]);
});

test('a session change within gapMs is no break at all (no gap row, as for any 3 min step)', () => {
  const model = timeline(day(120, 'fiction-after'));
  expect(model.nodes.some(n => n.type === 'gap')).toBe(false);
  expect(model.sections.some(n => n.sessionChange)).toBe(false);
});

test('(b) a same-session break at one place is one stay, unchanged (PR 116)', () => {
  const model = timeline(day(3600, 'fiction-before'));
  expect(model.nodes.map(n => n.type)).toEqual(['departure', 'movement', 'stop', 'movement', 'end']);
  const [stay] = model.nodes.filter(n => n.type === 'stop');
  expect(stay).toMatchObject({ number: 1, interruptionMs: 0, gaps: [] });
  expect(stay.durationMs).toBe(stay.end - stay.start);
  // (2026-10-14: from where the walk in stopped to where the walk out began.)
  expect(stay.durationMs).toBeGreaterThan(2 * 60 * MINUTE - MINUTE);
  expect(model.edges.some(e => e.bridged && e.samePlaceBreak)).toBe(false); // contained in the stay
  expect(model.sections.some(n => n.sessionChange)).toBe(false);
});

test.each([3600, 300, 200])('distances do not change with a session change (break %i s): list, edges, today', breakS => {
  const changed = day(breakS, 'fiction-after'), same = day(breakS, 'fiction-before');
  const a = timeline(changed), b = timeline(same);
  expect(a.distanceM).toBeGreaterThan(600);
  expect(a.distanceM).toBe(b.distanceM);
  expect(a.edges.map(e => e.countedDistanceM)).toEqual(b.edges.map(e => e.countedDistanceM));
  const rowSum = m => m.sections.reduce((sum, n) => sum + n.countedDistanceM, 0);
  expect(rowSum(a)).toBeCloseTo(a.distanceM, 6);
  expect(a.sections.filter(n => n.type === 'movement').map(n => n.countedDistanceM))
    .toEqual(b.sections.filter(n => n.type === 'movement').map(n => n.countedDistanceM));
  // 「今天 x km」: the full recalculation and the incremental engine agree, and
  // neither changes with the session.
  const now = changed.at(-1).time, dayStart = base;
  const today = rows => todayRouteDistance(rows, { now, dayStart }).metres;
  const engine = rows => { const e = createTodayRouteEngine({ dayStart }); e.add(rows); return e.sum(now).metres; };
  expect(today(changed)).toBe(today(same));
  expect(engine(changed)).toBe(today(changed));
  expect(engine(same)).toBe(today(same));
});

test('(c) a dog is unaffected: a break at one place stays one stay whatever its rows carry', () => {
  const dogPoint = (seconds, extra = {}) => ({ time: base + seconds * 1000, latitude: 1, longitude: 1,
    accuracy: 5, slave_id: 7, ...extra });
  const rows = tag => [
    ...Array.from({ length: 40 }, (_, i) => ({ ...dogPoint(i * 10, tag ? { session_id: 'fiction-before' } : {}),
      longitude: 1 + (400 - i * 10) / 111320 })),
    ...Array.from({ length: 180 }, (_, i) => dogPoint(400 + i * 10, tag ? { session_id: 'fiction-before' } : {})),
    ...Array.from({ length: 180 }, (_, i) => dogPoint(2200 + 3600 + i * 10, tag ? { session_id: 'fiction-after' } : {}))];
  const dog = r => historyTimeline(r, { subject: 'dog', dayStart: base, dayEnd: base + 86400000,
    manualRange: { start: r[0].time, end: r.at(-1).time } });
  const tagged = dog(rows(true)), plain = dog(rows(false));
  const strip = m => m.nodes.map(({ points, center, ...n }) => n);
  expect(strip(tagged)).toEqual(strip(plain));
  const stays = tagged.nodes.filter(n => n.type === 'stop');
  expect(stays).toHaveLength(1);
  expect(stays[0].start).toBeLessThan(base + 2190 * 1000);
  expect(stays[0].end).toBeGreaterThan(base + 5800 * 1000);
  expect(stays[0].interruptionMs).toBe(0);
  expect(tagged.nodes.some(n => n.type === 'gap')).toBe(false);
  expect(tagged.distanceM).toBe(plain.distanceM);
});
