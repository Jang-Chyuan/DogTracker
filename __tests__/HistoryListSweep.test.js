// 2026-10-13: what a sweep of the history list found (invented places, times
// and rows only). The minute-accounting shapes are in PhoneMinuteAccounting.
import { t } from '../src/i18n';
import { listDuration, nodePill, nodeTimes } from '../src/history/HistoryText';
import { timelinePresentation } from '../src/history/HistoryTimelinePresentation';
import { historyTimeline } from '../src/history/HistoryTimeline';
import { historyIndoorNodes } from '../src/history/HistoryStops';
import { historyDeparture } from '../src/history/HistoryDeparture';
import { point } from '../__fixtures__/HistoryLogicFixtures';
import { historyMapPresentation } from '../src/history/screen/HistoryMapModel';
import { buildExportSnapshot, exportTimelineRows } from '../src/mapHistory/ExportSnapshot';
import { buildGPX } from '../src/mapHistory/ExportGPX';

const MINUTE = 60000;
const T0 = new Date(2026, 0, 5, 7, 0).getTime();

describe('a merged stay of no minutes says no 「停 0 分」', () => {
  const stay = (start, end) => ({ type: 'stop', number: 1, start, end, durationMs: end - start,
    latitude: 24.9, longitude: 121.3, gaps: [] });

  test('出發 merged with 20 s of a stay (a manual range starting at its end) is 「出發」', () => {
    const shown = timelinePresentation([{ type: 'departure', start: T0, end: T0, latitude: 24.9, longitude: 121.3, manual: true },
      stay(T0, T0 + 20000), { type: 'movement', mode: 'walking', start: T0 + 20000, end: T0 + 5 * MINUTE,
        durationMs: 5 * MINUTE - 20000, distanceM: 300, countedDistanceM: 300 }]);
    expect(shown[0].departureStay).toBeTruthy();
    // 2026-10-14: no 「出發」 capsule at all.
    expect(nodePill(shown[0])).toBeNull();
  });

  // 2026-10-14: no stay goes into the end any more, and the end says no 「結束」.
  test('a stay of its own is 「停 不到 1 分」; the end row has no capsule', () => {
    expect(nodePill(stay(T0, T0 + 20000)).text).toBe(t('c127', { duration: t('c1276') }));
    expect(nodePill({ type: 'end', start: T0, end: T0, label: t('c330') })).toBeNull();
  });
});

describe('a hold carried over midnight keeps one place on both days', () => {
  const dayEnd = new Date(2026, 0, 6).getTime();
  const held = (time, north, since) => point(0, north, { time, heldReason: 'indoor', heldSince: since, locationTime: null });

  test('the day before shows it where it was held at midnight, where the next day\'s 「接續前一天」 begins', () => {
    const since = dayEnd - 5 * 3600000;
    // Good fixes inside refined the anchor 30 m north two hours in.
    const points = [];
    for (let time = since; time < dayEnd + 3 * MINUTE; time += MINUTE) {
      points.push(held(time, time < since + 2 * 3600000 ? 0 : 30, since));
    }
    const [before] = historyIndoorNodes(points, { start: since, end: dayEnd - 1, dayStart: dayEnd - 86400000, dayEnd: dayEnd - 1 });
    expect(before.continuesNextDay).toBe(true);
    const [next] = historyIndoorNodes(points, { start: dayEnd, end: dayEnd + 3 * MINUTE, dayStart: dayEnd, dayEnd: dayEnd + 86400000 - 1 });
    expect(next.continuesPreviousDay).toBe(true);
    expect({ latitude: before.latitude, longitude: before.longitude })
      .toEqual({ latitude: next.latitude, longitude: next.longitude });
    // A hold that ends that day keeps the place where it began.
    const [ended] = historyIndoorNodes(points.filter(p => p.time < dayEnd - 30 * MINUTE),
      { start: since, end: dayEnd - 1, dayStart: dayEnd - 86400000, dayEnd: dayEnd - 1 });
    expect(ended.latitude).toBe(points[0].latitude);
  });
});

test('a dog heard all day without a fix lists 「收不到 GPS」, not 「這段時間沒有紀錄」', () => {
  const dayStart = T0 - 7 * 3600000;
  const rows = Array.from({ length: 60 }, (_, i) => ({ time: T0 + i * MINUTE, latitude: null, longitude: null }));
  const model = historyTimeline(rows, { subject: 'dog', dayStart, dayEnd: dayStart + 86400000, replayHolds: packets => packets });
  expect(model.dayRecords).toBe(true);
  expect(model.points).toEqual([]);
  expect(model.nodes).toEqual([expect.objectContaining({ type: 'gap', reason: 'no-gps', start: T0, end: T0 + 59 * MINUTE })]);
  // Nothing to draw: no section with a coordinate for the map.
  expect(model.sections).toEqual([]);
  // A day with nothing at all is still H8.
  expect(historyTimeline([], { subject: 'dog', dayStart, dayEnd: dayStart + 86400000 }).nodes).toEqual([]);
});

test('出發 is where the walk began, not a fix of the stay three minutes before it', () => {
  // A dog at a stay from 07:00 (3 m jitter, a fix every 10 s), walking off at
  // 07:12 at 1.4 m/s.
  const rows = [];
  for (let s = 0; s < 12 * 60; s += 10) rows.push(point(s, s % 20 ? 3 : 0));
  for (let s = 12 * 60, m = 0; s <= 30 * 60; s += 10) { m += 14; rows.push(point(s, m)); }
  const found = historyDeparture(rows, { subject: 'dog' });
  expect(found.status).toBe('confirmed');
  expect(found.automaticRange.start).toBeGreaterThanOrEqual(11 * MINUTE + 40000);
  expect(found.automaticRange.start).toBeLessThanOrEqual(12 * MINUTE);
});

test('a day that begins indoors: the 室內 row starts where the range does', () => {
  const departure = { type: 'departure', start: T0, end: T0, latitude: 24.9, longitude: 121.3 };
  const hold = { type: 'indoor', start: T0 + 40000, end: T0 + 40 * MINUTE, latitude: 24.9, longitude: 121.3 };
  const shown = timelinePresentation([departure, { type: 'movement', mode: 'moving', start: T0, end: T0 + 40000,
    durationMs: 40000, distanceM: 0, countedDistanceM: 0 }, hold]);
  expect(shown.map(n => n.type)).toEqual(['indoor']);
  expect(nodeTimes(shown[0])[0]).toBe(nodeTimes(departure)[0]);
  expect(shown[0].start).toBe(T0);
});

// 2026-10-14 (user): a range that begins with a stay starts with that stay
// (no 出發 row), from the first fix on.
test('a stationary run that settles a few seconds after the first fix is the first row from that fix, with no 出發', () => {
  const departure = { type: 'departure', start: T0, end: T0, latitude: 1, longitude: 1 };
  const run = { type: 'stop', presentationOnly: 'phone-stationary', number: null, start: T0 + 20000, end: T0 + 30 * MINUTE,
    durationMs: 30 * MINUTE - 20000, interruptionMs: 0, gaps: [], latitude: 1, longitude: 1 };
  const shown = timelinePresentation([departure, run, { type: 'end', start: T0 + 31 * MINUTE, end: T0 + 31 * MINUTE,
    label: t('c330'), latitude: 1, longitude: 1.0001 }]);
  // (The still minute before the end is that stay's too: every minute has a
  // row; the range ends in it, so it is the last row: no end row.)
  expect(shown.map(n => n.type)).toEqual(['stop']);
  expect(shown[0]).toMatchObject({ start: T0, end: T0 + 31 * MINUTE });
  expect(nodePill(shown[0]).text).toBe(t('c127', { duration: listDuration(31 * MINUTE) }));
});

// 2026-10-13 (user, #154): the numbers shown start at 1 and skip none — list,
// map markers, PNG list, GPX names. 2026-10-14 (user): the stays a range
// begins and ends with are its first and last rows, numbered (no 出發, no end).
test('the first and last stays are the range\'s start and end; the stays between count from 1', () => {
  // A phone at home (5 s fixes), a walk, a stay elsewhere, a walk, a stay to the end.
  const base = new Date(2026, 0, 5, 8, 0).getTime();
  const rows = [];
  let s = 0, east = 0;
  const fix = extra => rows.push({ time: base + s * 1000, latitude: 1, longitude: 1 + east / 111320, raw_latitude: 1,
    raw_longitude: 1 + east / 111320, accuracy: 4, raw_speed_kmh: 0, speed_kmh: 0, speed_accuracy_mps: 0.4,
    motion_state: 'stationary', session_id: 'fiction-session', ...extra });
  for (const [kind, seconds] of [['still', 1200], ['walk', 300], ['still', 900], ['walk', 300], ['still', 1200]]) {
    for (let k = 0; k < seconds; k += 5, s += 5) {
      if (kind === 'walk') { east += 7; fix({ raw_speed_kmh: 5.04, speed_kmh: 5.04, motion_state: 'moving' }); }
      else fix({});
    }
  }
  const dayStart = new Date(2026, 0, 5).getTime();
  const model = historyTimeline(rows, { subject: 'phone', dayStart, dayEnd: dayStart + 86400000,
    manualRange: { start: rows[0].time, end: rows.at(-1).time } });
  const shown = timelinePresentation(model.nodes);
  // 2026-10-14 (round 3): the first and the last stay are the range's start
  // and end (the hollow / solid circle, no number); no 出發, no end row.
  expect(shown[0]).toMatchObject({ type: 'stop', number: null, start: rows[0].time });
  expect(shown.some(n => n.type === 'departure' || n.departureStay)).toBe(false);
  expect(shown.at(-1)).toMatchObject({ type: 'stop', number: null });
  expect(shown.some(n => n.type === 'end' || n.terminalStay)).toBe(false);
  // The list: the one stay in between is 1.
  expect(shown.filter(n => n.number != null).map(n => n.number)).toEqual([1]);
  expect(model.locations.filter(n => n.type === 'stop').map(n => [n.number, n.listedWith ?? null]))
    .toEqual([[null, 'start'], [1, null], [null, 'end']]);
  // The map draws the same numbers (the ends are its time markers).
  const map = historyMapPresentation(model, { color: '#1A73E8', subject: 'phone' });
  expect(map.places.filter(p => p.kind === 'number').map(p => p.number)).toEqual([1]);
  // The PNG list is the screen's list, with no 出發 pill.
  const png = exportTimelineRows(model.nodes, () => '虛構地址');
  expect(png.filter(r => r.number != null).map(r => r.number)).toEqual([1]);
  expect(png.some(r => r.type === 'departure' || r.pill?.text?.includes('出發'))).toBe(false);
  // GPX: every stay is still a waypoint; the merged ones are named without a number.
  const snapshot = buildExportSnapshot({ day: { subjects: [{ id: 'phone', model }] },
    range: { start: rows[0].time, end: rows.at(-1).time }, subject: 'phone' });
  const names = [...buildGPX(snapshot).matchAll(/<wpt[^>]*><time>[^<]*<\/time><name>([^<]*)<\/name>/g)].map(m => m[1]);
  const numbered = number => new RegExp(`^${t('c793', { prefix: '', number, value: '\\d+' })}$`);
  const unnumbered = new RegExp(`^${t('c1310', { prefix: '', value: '\\d+' })}$`);
  expect(names).toHaveLength(3);
  expect(names[0]).toMatch(unnumbered);
  expect(names[1]).toMatch(numbered(1));
  expect(names[2]).toMatch(unnumbered);
  expect(names.some(name => name.includes('出發') || name.includes(t('c330')))).toBe(false);
});
