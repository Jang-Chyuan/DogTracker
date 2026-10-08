// 055a pure parts of the history screen: what the map draws, the range bar,
// the cursor's haptics, the panel's heights, the date row and the memory of
// dragged ranges.
import {
  historyMapPresentation, nearestRoutePoint, outsideLines, routeLines, timeMarkers, withAlpha,
} from '../src/history/screen/HistoryMapModel';
import { dragRangeHandle, rangeBarEnabled, rangeHandles, rangeTrack, timeOfX, xOfTime } from '../src/history/screen/HistoryRangeBar';
import { cursorHaptic } from '../src/history/screen/HistoryScreenCursor';
import { dateRowLabel } from '../src/history/screen/HistoryScreenDates';
import { forgetRanges, rememberedRange, rememberRangeFor } from '../src/history/screen/RangeMemory';
import { panelLevels, settleLevel } from '../src/mapHistory/HistoryPanel';
import { rangeSummaryLines } from '../src/mapHistory/HistoryRangeSummary';
import { HAPTIC_EFFECTS, haptic } from '../src/utils/haptics';
import NativeTrackingPlatform from '../specs/NativeTrackingPlatform';
import { historyTimeline } from '../src/history/HistoryTimeline';
import { phoneHistoryRow } from '../src/history/HistoryRows';
import { colors, opacity } from '../src/theme/tokens';

const MINUTE = 60000;
const DAY = new Date(2026, 9, 7).getTime();
const at = minutes => DAY + 8 * 60 * MINUTE + minutes * MINUTE;
const edge = (start, end, mode, extra = {}) => ({ start: at(start), end: at(end), mode, gap: mode === 'gap',
  from: { latitude: 25, longitude: 121 + start / 1000 }, to: { latitude: 25, longitude: 121 + end / 1000 }, ...extra });

describe('the route on the map', () => {
  test('on foot 4dp up to the cursor, 3dp at 30% after it; a car 2dp; nothing across a break', () => {
    const lines = routeLines([edge(0, 1, 'walking'), edge(1, 2, 'walking'), edge(2, 3, 'driving'), edge(3, 10, 'gap'),
      edge(10, 11, 'walking'), edge(11, 12, 'walking')], { color: colors.phone, cursorTime: at(11) });
    expect(lines.map(line => [line.width, line.color, line.coordinates.length])).toEqual([
      [4, colors.phone, 3], [2, colors.phone, 2], [4, colors.phone, 2],
      [3, withAlpha(colors.phone, opacity.routeUpcoming), 2],
    ]);
  });

  test('outside the range: 2dp dashed routeFaded, broken where the data breaks', () => {
    const day = [0, 1, 2, 20, 21, 30, 31].map(m => ({ time: at(m), latitude: 25, longitude: 121 + m / 1000 }));
    const lines = outsideLines(day, { start: at(20), end: at(30) }, { color: colors.routeFaded });
    // [0,1,2] before the break, 20 alone (no line), [30,31] after the range.
    expect(lines.map(line => [line.dashed, line.width, line.coordinates.length])).toEqual([[true, 2, 3], [true, 2, 2]]);
  });

  test('time markers: both ends, round times between, none in a break or a stay', () => {
    // A fix a minute 08:03–10:03, nothing 09:00–09:25, a stay 08:25–08:35:
    // every 30 minutes, but 08:30 is in the stay, 09:00 in the break and
    // 10:00 too close to the end.
    const points = Array.from({ length: 121 }, (_, i) => ({ time: at(i + 3), latitude: 25, longitude: 121 }))
      .filter(p => p.time <= at(60) || p.time >= at(85));
    const markers = timeMarkers(points, { stays: [{ start: at(25), end: at(35) }] });
    expect(markers.map(m => [m.label, m.end])).toEqual([['08:03', true], ['09:30', false], ['10:03', true]]);
    expect(timeMarkers(points, { allIndoor: true })).toEqual([]);
  });

  test('the presentation: numbered places as in the list, the cursor, no end marker under it', () => {
    const rows = Array.from({ length: 80 }, (_, i) => phoneHistoryRow({ id: i + 1, time: at(i / 2),
      latitude: 24.98 + (i < 40 ? i : 40) * 0.0001, longitude: 121.31, accuracy: 5 }));
    const model = historyTimeline(rows, { subject: 'phone', dayStart: DAY, dayEnd: DAY + 86400000 });
    const last = model.points[model.points.length - 1];
    const map = historyMapPresentation(model, { color: colors.phone,
      cursor: { point: last, label: ['08:39', '已走 0.4 km'], stale: false } });
    expect(map.cursor).toMatchObject({ time: last.time, lines: ['08:39', '已走 0.4 km'] });
    expect(map.times.some(marker => marker.time === last.time)).toBe(false);
    expect(map.camera).toHaveLength(model.points.length);
    expect(map.places.every(place => place.kind === 'indoor' || place.number > 0)).toBe(true);
  });

  test('a touch: the nearest fix; where the route passes twice, the pass nearest in time to the cursor', () => {
    const out = [0, 1, 2, 3].map(i => ({ time: at(i), latitude: 25, longitude: 121 + i * 0.0002 }));
    const back = [4, 5, 6, 7].map(i => ({ time: at(i), latitude: 25.00005, longitude: 121 + (7 - i) * 0.0002 }));
    const points = [...out, ...back];
    const touch = { latitude: 25.00004, longitude: 121.0002 };
    expect(nearestRoutePoint(points, touch).point.time).toBe(at(6));
    expect(nearestRoutePoint(points, touch, at(1)).point.time).toBe(at(1));
    expect(nearestRoutePoint(points, touch, at(7)).point.time).toBe(at(6));
    expect(nearestRoutePoint([], touch)).toBeNull();
  });
});

describe('the range bar', () => {
  const dayPoints = [0, 1, 2, 3, 4, 5, 10].map(m => ({ time: at(m) }));
  const track = rangeTrack({ dayStart: at(0), dayEnd: DAY + 86400000, today: true, now: at(10) });

  test('today the track runs to this minute; the end following now sits at its right end', () => {
    expect(track).toEqual({ start: at(0), end: at(10) });
    expect(rangeTrack({ dayStart: DAY, dayEnd: DAY + 86400000, today: false, now: at(10) }).end).toBe(DAY + 86400000);
    expect(rangeHandles({ start: at(1), end: at(5), following: true }, track)).toEqual({ start: at(1), end: at(10),
      following: true });
    expect(xOfTime(at(5), 200, track)).toBe(100);
    expect(timeOfX(100, 200, track)).toBe(at(5));
  });

  test('a handle snaps to a fix; the end at the right end follows now; under a minute is refused', () => {
    const range = { start: at(0), end: at(10), following: true };
    expect(dragRangeHandle(range, 'start', 41, 200, { track, dayPoints, today: true }))
      .toMatchObject({ range: { start: at(2) }, valid: true, atEdge: false });
    const fixed = dragRangeHandle(range, 'end', 80, 200, { track, dayPoints, today: true });
    expect(fixed.range).toMatchObject({ end: at(4), following: false });
    expect(dragRangeHandle(fixed.range, 'end', 200, 200, { track, dayPoints, today: true }))
      .toMatchObject({ range: { following: true }, valid: true, atEdge: true });
    // Start on the end's fix (同一筆) or past it: refused.
    expect(dragRangeHandle({ start: at(0), end: at(2), following: false }, 'start', 40, 200,
      { track, dayPoints, today: true }).valid).toBe(false);
    expect(rangeBarEnabled([{ time: at(0) }])).toBe(false);
    expect(rangeBarEnabled([{ time: at(0) }, { time: at(1) }])).toBe(true);
  });

  test('the summary while the bar is open says the range itself (no 「已手動調整」)', () => {
    const model = { points: [{ time: at(0) }, { time: at(130) }], distanceM: 3100, durationMs: 130 * MINUTE,
      nodes: [], departure: { status: 'confirmed', manual: true } };
    expect(rangeSummaryLines(model, { subject: 'phone', open: true, range: { start: at(0), end: at(130), following: true } }))
      .toEqual({ title: '08:00 – 現在', detail: '走了 3.1 km・2 小時 10 分' });
    expect(rangeSummaryLines(model, { subject: 'dog', open: true, range: { start: at(0), end: at(130), following: false } }))
      .toEqual({ title: '08:00 – 10:10', detail: '移動 3.1 km・2 小時 10 分' });
    expect(JSON.stringify(rangeSummaryLines(model, { subject: 'phone', open: false, range: {} }))).not.toContain('手動');
  });

  test('a dragged range is remembered per subject and day (only while the app runs)', () => {
    forgetRanges();
    rememberRangeFor('phone:2026-10-07', { start: at(1), end: at(5), following: false });
    rememberRangeFor('dog:4:2026-10-07', { start: at(2), end: at(9), following: true });
    expect(rememberedRange('phone:2026-10-07')).toEqual({ start: at(1), end: at(5), following: false });
    expect(rememberedRange('dog:4:2026-10-07')).toEqual({ start: at(2), end: null, following: true });
    expect(rememberedRange('phone:2026-10-06')).toBeNull();
  });
});

describe('haptics', () => {
  const model = { points: [0, 5, 10, 15, 60, 65].map(m => ({ time: at(m) })),
    locations: [{ type: 'stop', start: at(10), end: at(15) }] };
  test('a drag: double into a stay, heavy at an end, click on the hour, tick every 10 minutes', () => {
    expect(cursorHaptic(model, at(5), at(10))).toBe('double');
    expect(cursorHaptic(model, at(10), at(15))).toBeNull();
    expect(cursorHaptic(model, at(5), at(0))).toBe('heavy');
    expect(cursorHaptic(model, at(15), at(60))).toBe('click');
    expect(cursorHaptic({ ...model, locations: [] }, at(5), at(15))).toBe('tick');
    expect(cursorHaptic(model, at(5), at(5))).toBeNull();
    expect(cursorHaptic(model, at(5), at(15), 'node')).toBe('double');
    expect(cursorHaptic(model, at(5), at(15), 'route')).toBe('tick');
  });
  test('played through the native module as Android effects', () => {
    NativeTrackingPlatform.performHaptic.mockClear();
    expect(haptic('double')).toBe(true);
    expect(NativeTrackingPlatform.performHaptic).toHaveBeenCalledWith('EFFECT_DOUBLE_CLICK');
    expect(haptic(null)).toBe(false);
    expect(Object.values(HAPTIC_EFFECTS)).toEqual(['EFFECT_TICK', 'EFFECT_CLICK', 'EFFECT_DOUBLE_CLICK',
      'EFFECT_HEAVY_CLICK']);
  });
});

describe('the panel and the date row', () => {
  test('three heights: about 140dp, half (55%), 75%; a day without records keeps 40%', () => {
    expect(panelLevels(800, 0)).toEqual({ summary: 140, half: 440, full: 600 });
    expect(panelLevels(800, 0, { empty: true })).toEqual({ summary: 320, half: 320, full: 320 });
  });
  test('a drag settles on the nearest height; a flick goes one on', () => {
    const levels = { summary: 140, half: 440, full: 600 };
    expect(settleLevel(500, 0, levels)).toBe('half');
    expect(settleLevel(560, 0, levels)).toBe('full');
    expect(settleLevel(450, -1, levels)).toBe('full');
    expect(settleLevel(430, 1, levels)).toBe('summary');
  });
  test('「10/03（六）今天」, another day 「9/28（一）」', () => {
    const today = new Date(2026, 9, 3).getTime();
    expect(dateRowLabel(today, today)).toBe('10/03（六）今天');
    expect(dateRowLabel(new Date(2026, 8, 28).getTime(), today)).toBe('9/28（一）');
  });
});
