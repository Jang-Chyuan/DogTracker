// 055a pure parts of the history screen: what the map draws, the range bar,
// the cursor's haptics, the panel's heights, the date row and the memory of
// dragged ranges.
import {
  historyMapPresentation, nearestRouteSpot, outsideLines, routeLines, timeMarkers, withAlpha,
} from '../src/history/screen/HistoryMapModel';
import {
  dragRangeHandle, rangeBarEnabled, rangeHandles, rangeTrack, stepRangeHandle, timeOfX, xOfTime,
} from '../src/history/screen/HistoryRangeBar';
import { cursorHaptic } from '../src/history/screen/HistoryScreenCursor';
import { dateRowLabel } from '../src/history/screen/HistoryScreenDates';
import { forgetRanges, rememberedRange, rememberRangeFor } from '../src/history/screen/RangeMemory';
import { mapPanelHeight, dogCardMaxHeight } from '../src/map/MapPanelHeight';
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

  test('a touch: the nearest place on a drawn segment; where the route passes twice, the pass nearest in time', () => {
    const out = [0, 1, 2, 3].map(i => ({ time: at(i), latitude: 25, longitude: 121 + i * 0.0002 }));
    const back = [4, 5, 6, 7].map(i => ({ time: at(i), latitude: 25.00005, longitude: 121 + (7 - i) * 0.0002 }));
    const points = [...out, ...back];
    const touch = { latitude: 25.00004, longitude: 121.0002 };
    expect(nearestRouteSpot(points, touch).point.time).toBe(at(6));
    expect(nearestRouteSpot(points, touch, at(1)).point.time).toBe(at(1));
    expect(nearestRouteSpot(points, touch, at(7)).point.time).toBe(at(6));
    // The middle of one long segment (two fixes 400 m apart) is on the route.
    const long = [{ time: at(0), latitude: 25, longitude: 121 }, { time: at(1), latitude: 25, longitude: 121.004 }];
    const middle = nearestRouteSpot(long, { latitude: 25, longitude: 121.0021 });
    expect(middle.distanceM).toBeLessThan(1);
    expect(middle.coordinate.longitude).toBeCloseTo(121.0021, 6);
    expect(middle.point.time).toBe(at(1));
    // Nothing is drawn across a break of over 3 minutes.
    const broken = [{ time: at(0), latitude: 25, longitude: 121 }, { time: at(10), latitude: 25, longitude: 121.004 }];
    expect(nearestRouteSpot(broken, { latitude: 25, longitude: 121.002 })).toBeNull();
    expect(nearestRouteSpot([], touch)).toBeNull();
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
    // TalkBack steps: a fix at least a minute on; the end past the last fix follows now.
    const stepped = stepRangeHandle({ start: at(0), end: at(4), following: false }, 'start', 1, { dayPoints, today: true });
    expect(stepped).toEqual({ range: { start: at(1), end: at(4), following: false }, valid: true });
    expect(stepRangeHandle({ start: at(0), end: at(10), following: true }, 'end', -1, { dayPoints, today: true }).range)
      .toEqual({ start: at(0), end: at(10), following: false });
    expect(stepRangeHandle({ start: at(0), end: at(10), following: false }, 'end', 1, { dayPoints, today: true }).range)
      .toMatchObject({ following: true });
    expect(stepRangeHandle({ start: at(0), end: at(10), following: false }, 'end', 1, { dayPoints, today: false }).valid)
      .toBe(false);
    expect(stepRangeHandle({ start: at(3), end: at(4), following: false }, 'start', 1, { dayPoints, today: true }).valid)
      .toBe(false);
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
  test('history shares the live card cap, including safe-area and scroll space', () => {
    expect(mapPanelHeight(800, 24)).toBe(582);
    expect(dogCardMaxHeight(800, 24, 20) + 8 + 20).toBe(mapPanelHeight(800, 24));
  });
  test('「10/03（六）今天」, another day 「9/28（一）」', () => {
    const today = new Date(2026, 9, 3).getTime();
    expect(dateRowLabel(today, today)).toBe('10/03（六）今天');
    expect(dateRowLabel(new Date(2026, 8, 28).getTime(), today)).toBe('9/28（一）');
  });
});

test('a time in the middle too close to a stop number or another time is left out; the ends stay', async () => {
  const { uncrowded } = require('../src/history/screen/HistoryMapModel');
  const marker = (time, east, end = false) => ({ time, end, coordinate: { latitude: 25, longitude: 121 + east / 100000 } });
  const kept = uncrowded([marker(1, 0, true), marker(2, 50), marker(3, 400), marker(4, 450), marker(5, 1000, true)],
    [{ coordinate: { latitude: 25, longitude: 121.009 } }]);
  expect(kept.map(m => m.time)).toEqual([1, 3, 5]);
});

describe('framing the history route', () => {
  const { historyFramePadding, HISTORY_FRAME_PADDING } = require('../src/history/screen/HistoryMapModel');
  const route = [0, 1, 2, 3, 4].map(i => ({ latitude: 25, longitude: 121 + i * 0.001 }));
  test('the side where the cursor sits at the edge has room for half its label', () => {
    expect(historyFramePadding(route, route[4])).toMatchObject({ right: 72, left: 24 });
    expect(historyFramePadding(route, route[0])).toMatchObject({ right: 24, left: 72 });
    expect(historyFramePadding(route, route[2])).toEqual(HISTORY_FRAME_PADDING);
    expect(historyFramePadding(route, null)).toEqual(HISTORY_FRAME_PADDING);
    // Clear of 框住全部 at the bottom.
    expect(HISTORY_FRAME_PADDING.bottom).toBeGreaterThanOrEqual(24 + 48);
  });
});

describe('nearestRouteSpot on a long day (068)', () => {
  // A deterministic walk that crosses itself, with breaks.
  const day = (n, seed) => {
    let x = seed, lat = 24.989, lon = 121.313, heading = 0, time = 0;
    const r = () => { x = (x * 1664525 + 1013904223) % 2 ** 32; return x / 2 ** 32; };
    return Array.from({ length: n }, () => {
      heading += (r() - 0.5) * 0.8;
      lat += (Math.cos(heading) * 2) / 110540;
      lon += (Math.sin(heading) * 2) / 111320;
      time += r() < 0.003 ? 5 * 60000 : 2000;
      return { time, latitude: lat, longitude: lon };
    });
  };
  test('the grid finds what going through every segment finds', () => {
    for (const seed of [1, 2, 3]) {
      const points = day(6000, seed);
      const lats = points.map(p => p.latitude), lons = points.map(p => p.longitude);
      const [south, north] = [Math.min(...lats), Math.max(...lats)];
      const [west, east] = [Math.min(...lons), Math.max(...lons)];
      for (let k = 0; k < 120; k += 1) {
        const touch = { latitude: south + ((k * 37) % 120) / 120 * (north - south) * 1.2 - 0.0005,
          longitude: west + ((k * 53) % 120) / 120 * (east - west) * 1.2 - 0.0005 };
        const cursor = k % 3 ? points[(k * 97) % points.length].time : null;
        expect(nearestRouteSpot(points, touch, cursor)).toEqual(nearestRouteSpot(points, touch, cursor, { grid: false }));
      }
    }
  });
});

test('404-point bounding-box counterexample: 394.30 m diagonal cannot hide a 300 m segment', () => {
  const touch = { latitude: 25, longitude: 121 };
  const p = (x, y, time) => ({ time, latitude: touch.latitude + y / 110540,
    longitude: touch.longitude + x / (111320 * Math.cos(25 * Math.PI / 180)) });
  const intercept = 394.30 * Math.SQRT2;
  const points = [p(-1000, intercept + 1000, 0), p(intercept + 1000, -1000, 1000),
    p(-10, 300, 400000), p(10, 300, 401000)];
  while (points.length < 404) points.push(p(2000, 2000, 401000 + points.length * 400000));
  const linear = nearestRouteSpot(points, touch, null, { grid: false });
  expect(linear.distanceM).toBeCloseTo(300, 6);
  expect(nearestRouteSpot(points, touch)).toEqual(linear);
});

test('grid equality across randomized segments, latitudes, overlap and distant touches', () => {
  let seed = 819;
  const random = () => { seed = (seed * 1664525 + 1013904223) % 2 ** 32; return seed / 2 ** 32; };
  for (const latitude of [0, 25, 70, 85]) {
    const points = Array.from({ length: 404 }, (_, i) => ({ time: i * 1000,
      latitude: latitude + (random() - 0.5) * 0.02,
      longitude: 121 + (random() - 0.5) * 0.04 }));
    for (let i = 0; i < 40; i += 1) {
      const coordinate = { latitude: latitude + (random() - 0.5) * (i ? 0.06 : 2),
        longitude: 121 + (random() - 0.5) * 0.08 };
      const current = points[Math.floor(random() * points.length)].time;
      const overlapM = random() * 50;
      expect(nearestRouteSpot(points, coordinate, current, { overlapM })).toEqual(
        nearestRouteSpot(points, coordinate, current, { overlapM, grid: false }));
    }
  }
});

test('grid longitude bounds use touch latitude even when the first fix is far south', () => {
  const points = [{ time: 0, latitude: 1, longitude: 121 }, ...Array.from({ length: 403 }, (_, i) => ({
    time: 400000 + i * 1000, latitude: 85 + Math.sin(i / 20) * 0.001,
    longitude: 121 + i * 0.0001,
  }))];
  for (let i = 0; i < 20; i += 1) {
    const coordinate = { latitude: 85.002, longitude: 121 + i * 0.002 };
    expect(nearestRouteSpot(points, coordinate, points[200].time)).toEqual(
      nearestRouteSpot(points, coordinate, points[200].time, { grid: false }));
  }
});
