// 055b: one day of several dogs (H7) — the protagonist, the shared range,
// the shared cursor and what the map draws for the others.
import {
  dayHasRecords, multiCursors, multiDayModel, multiMapPresentation, sharedCursorTime,
} from '../src/history/screen/HistoryMultiModel';
import { historyMapPresentation } from '../src/history/screen/HistoryMapModel';
import { historyTimeline } from '../src/history/HistoryTimeline';
import { dogHistoryRow } from '../src/history/HistoryRows';
import { colors, opacity } from '../src/theme/tokens';
import { withAlpha } from '../src/history/screen/HistoryMapModel';

const MINUTE = 60000;
const DAY = new Date(2026, 9, 3).getTime();
const at = minutes => DAY + 8 * 60 * MINUTE + minutes * MINUTE;
// A dog walking north-east from `from` to `to` minutes after 08:00, a fix
// every 30 s, in `source`; `east` keeps the dogs apart.
const walk = (slave, from, to, { source = 'local', east = 0, stay = null } = {}) => {
  const rows = [];
  for (let t = from; t <= to; t += 0.5) {
    const moving = !(stay && t >= stay[0] && t <= stay[1]);
    const step = moving ? t : stay[0];
    rows.push(dogHistoryRow({ id: rows.length + 1, slave_id: slave, received_at: at(t), track_at: at(t),
      slave_lat: 24.99 + step * 0.00012, slave_lon: 121.30 + east + step * 0.00008, satellites: 9, hdop: 1 }, source));
  }
  return rows;
};
const options = { dayStart: DAY, dayEnd: DAY + 86400000, today: false, now: at(240) };
const noHolds = packets => packets;
const subject = (id, rows) => ({ id, rows, replayHolds: noHolds });

describe('the day of several dogs', () => {
  test('the shared range is the protagonist’s own; every other dog is cut to it', () => {
    const a = walk(4, 30, 120), b = walk(6, 0, 150, { east: 0.01 });
    const day = multiDayModel([subject(4, a), subject(6, b)], { ...options, protagonist: 4 });
    expect(day.protagonist).toBe(4);
    const own = historyTimeline(a, { ...options, replayHolds: noHolds });
    expect(day.range).toMatchObject({ start: own.points[0].time, end: own.points[own.points.length - 1].time });
    const other = day.subjects[1].model;
    expect(other.points[0].time).toBeGreaterThanOrEqual(day.range.start);
    expect(other.points[other.points.length - 1].time).toBeLessThanOrEqual(day.range.end);
    // The same algorithm in the same range: its distance is the one alone.
    const alone = historyTimeline(b, { ...options, replayHolds: noHolds, range: { start: day.range.start, end: day.range.end } });
    expect(other.distanceM).toBe(alone.distanceM);
    // The range bar snaps to both dogs' fixes.
    expect(day.dayPoints.length).toBe(own.dayPoints.length + alone.dayPoints.length);
  });

  test('主角: a dog without records that day is never it while another has some; one alone stays', () => {
    const a = walk(4, 30, 120);
    const day = multiDayModel([subject(6, []), subject(4, a)], { ...options, protagonist: 6 });
    expect(day.protagonist).toBe(4);
    expect(day.subjects[0]).toMatchObject({ id: 6, model: null, dayRecords: false, hasData: false });
    const empty = multiDayModel([subject(6, [])], { ...options, protagonist: 6 });
    expect(empty).toMatchObject({ protagonist: 6, range: null });
    expect(empty.main.dayRecords).toBe(false);
    expect(multiDayModel([], options).protagonist).toBeNull();
  });

  test('merged sources keep both dogs eligible and retain the requested protagonist', () => {
    const a = walk(4, 30, 120, { source: 'local' }), b = walk(6, 0, 150, { source: 'cloud', east: 0.01 });
    const subjects = [subject(4, a), subject(6, b)];
    expect(multiDayModel(subjects, { ...options, protagonist: 4 }).protagonist).toBe(4);
    const merged = multiDayModel(subjects, { ...options, protagonist: 6 });
    expect(merged.protagonist).toBe(6);
    expect(merged.subjects[1].hasData).toBe(true);
    // Both local and cloud dogs remain eligible.
    expect(multiDayModel(subjects, { ...options, protagonist: 6 }).protagonist).toBe(6);
  });

  test('a dragged range the protagonist has no fix in: another dog with fixes leads', () => {
    const a = walk(4, 0, 30), b = walk(6, 60, 150, { east: 0.01 });
    const day = multiDayModel([subject(4, a), subject(6, b)], { ...options, protagonist: 4,
      manual: { start: at(70), end: at(140), following: false } });
    expect(day.protagonist).toBe(6);
    expect(day.range).toMatchObject({ start: at(70), end: at(140), following: false });
    expect(day.subjects[0].hasData).toBe(false);
  });

  test('dayHasRecords: packets of the day across both sources, a held packet without a fix included', () => {
    const rows = [{ time: at(0), source: 'local' }, { time: DAY - MINUTE, source: 'cloud' }];
    expect(dayHasRecords(rows, { ...options })).toBe(true);
    expect(dayHasRecords([{ time: at(0), source: 'ble' }], { ...options })).toBe(true);
  });
});

describe('the shared cursor', () => {
  const a = walk(4, 30, 120), b = walk(6, 0, 90, { east: 0.01 }), c = walk(8, 100, 200, { east: 0.02 });
  const day = multiDayModel([subject(4, a), subject(6, b), subject(8, c)], { ...options, protagonist: 4 });

  test('opening: the protagonist’s newest fix in the range; kept inside the range', () => {
    expect(sharedCursorTime(day, null)).toBe(at(120));
    expect(sharedCursorTime(day, at(10))).toBe(day.range.start);
    expect(sharedCursorTime(day, at(500))).toBe(day.range.end);
  });

  test('a dog whose last fix is before the time waits there, grey; one not started yet is not drawn', () => {
    const cursors = multiCursors(day, at(110));
    expect(cursors[4]).toMatchObject({ stale: false, hidden: false });
    expect(cursors[6]).toMatchObject({ stale: true });
    expect(cursors[6].point.time).toBe(at(90));
    expect(cursors[6].label[1]).toBe('這段沒資料（最後 09:30）');
    expect(multiCursors(day, at(40))[8].hidden).toBe(true);
  });

  test('one subject keeps the single screen’s cursor: the nearest fix', () => {
    const one = multiDayModel([subject(4, a)], { ...options, protagonist: 4 });
    const cursors = multiCursors(one, at(60.2));
    expect(cursors[4].point.time).toBe(at(60));
    expect(cursors[4].stale).toBe(false);
  });
});

describe('the map of several dogs', () => {
  const a = walk(4, 30, 120, { stay: [60, 80] }), b = walk(6, 0, 150, { east: 0.01, stay: [40, 70] });
  const day = multiDayModel([subject(4, a), subject(6, b)], { ...options, protagonist: 4 });
  const look = { 4: { color: colors.route1, name: '小黑' }, 6: { color: colors.route2, name: '豆豆' } };
  const cursors = multiCursors(day, at(90));
  const map = multiMapPresentation(day, cursors, look);

  test('numbers, times and the camera follow the protagonist only', () => {
    const alone = historyMapPresentation(day.main, { color: colors.route1, cursor: cursors[4] });
    expect(map.places).toEqual(alone.places);
    expect(map.times).toEqual(alone.times);
    expect(map.camera).toEqual(alone.camera);
    expect(map.color).toBe(colors.route1);
  });

  test('the others: 3dp, 50% before the cursor and 20% after, never dashed', () => {
    const others = map.lines.filter(line => line.color.startsWith(withAlpha(colors.route2, 1).slice(0, 14)));
    expect(others.length).toBeGreaterThan(0);
    expect(others.every(line => line.width === 3 && !line.dashed)).toBe(true);
    expect(others.some(line => line.color === withAlpha(colors.route2, opacity.routeBeforeCursor))).toBe(true);
    expect(others.some(line => line.color === withAlpha(colors.route2, opacity.routeAfterCursor))).toBe(true);
  });

  test('a face for every other dog at its cursor point; the protagonist’s cursor carries its name', () => {
    expect(map.faces).toEqual([expect.objectContaining({ id: 6, name: '豆豆', color: colors.route2, stale: false })]);
    expect(map.cursor.face).toMatchObject({ name: '小黑' });
  });

  test('middle time markers only where the cursor has been; both ends always', () => {
    const long = multiDayModel([subject(4, walk(4, 0, 240))], { ...options, protagonist: 4 });
    const time = long.range.start + 50 * MINUTE;
    const full = historyMapPresentation(long.main, { color: colors.route1 });
    const early = historyMapPresentation(long.main, { color: colors.route1, cursor: multiCursors(long, time)[4] });
    expect(full.times.some(marker => !marker.end && marker.time > time)).toBe(true);
    expect(early.times.every(marker => marker.end || marker.time <= time)).toBe(true);
    expect(early.times.filter(marker => marker.end)).toHaveLength(2);
  });

  test('one subject draws exactly the single screen’s map', () => {
    const one = multiDayModel([subject(4, a)], { ...options, protagonist: 4 });
    const c = multiCursors(one, at(90));
    expect(multiMapPresentation(one, c, look)).toEqual(historyMapPresentation(one.main,
      { color: colors.route1, cursor: c[4] }));
  });
});

test('移除不改範圍: a kept range stays when the dog that gave it has gone', () => {
  const a = walk(4, 30, 120), b = walk(6, 0, 150, { east: 0.01 });
  const kept = { start: at(30), end: at(120), following: false };
  const day = multiDayModel([subject(6, b)], { ...options, protagonist: 6, kept });
  expect(day.range).toMatchObject({ start: at(30), end: at(120) });
  expect(day.main.points[0].time).toBeGreaterThanOrEqual(at(30));
  expect(day.main.points[day.main.points.length - 1].time).toBeLessThanOrEqual(at(120));
  expect(a.length).toBeGreaterThan(0);
});
