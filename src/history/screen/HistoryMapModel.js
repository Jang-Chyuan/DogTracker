// What the history map draws for one dog or my route (H1/H2/H2b; DESIGN.md
// 「路線」「時間標記」「歷史游标點」): provider-neutral lines, stop numbers, the
// indoor house, time markers and the cursor. Pure; GoogleTrackingMap draws it.
import { colors, size as sizes, opacity } from '../../theme/tokens';
import { clock } from '../HistoryText';

const MINUTE = 60000;
const isVehicle = mode => mode === 'driving' || mode === 'ride';
// Time marker spacing: the smallest step that keeps the route's middle to a
// few markers (判定表「時間標記」: 途中依畫面上放得下的密度選間隔).
const STEPS = [10, 15, 30, 60, 120, 180, 240].map(minutes => minutes * MINUTE);
const MAX_MIDDLE_MARKERS = 5;

const coordinateOf = p => ({ latitude: p.latitude, longitude: p.longitude });

/** 「#RRGGBB」 at `alpha` (0–1) as rgba(), for the faded parts of a route. */
export function withAlpha(hex, alpha) {
  const [r, g, b] = [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16));
  return `rgba(${r},${g},${b},${alpha})`;
}

// Runs of points split where the data breaks (over 3 minutes, edges marked gap).
function runsOf(points, breakMs) {
  const runs = [];
  let run = [];
  for (const p of points) {
    if (run.length && p.time - run[run.length - 1].time > breakMs) {
      if (run.length > 1) runs.push(run);
      run = [];
    }
    run.push(p);
  }
  if (run.length > 1) runs.push(run);
  return runs;
}

/**
 * The route inside the range as lines: on foot 4dp before the cursor and 3dp
 * at 30% after it; a car or ride 2dp solid in the route colour (also 30%
 * after the cursor); nothing across a break. Consecutive edges of the same
 * look join into one line.
 */
export function routeLines(edges, { color, cursorTime = Infinity }) {
  const lines = [];
  let current = null;
  for (const edge of edges) {
    if (edge.gap || edge.mode === 'gap') { current = null; continue; }
    const vehicle = isVehicle(edge.mode);
    const after = edge.start >= cursorTime;
    const width = vehicle ? sizes.route.drive : after ? sizes.route.upcoming : sizes.route.walk;
    const stroke = after ? withAlpha(color, opacity.routeUpcoming) : color;
    const key = `${width}:${stroke}`;
    if (current && current.key === key && current.end === edge.start) {
      current.coordinates.push(coordinateOf(edge.to));
      current.end = edge.end;
      continue;
    }
    current = { key, width, color: stroke, dashed: false, vehicle, end: edge.end, start: edge.start,
      coordinates: [coordinateOf(edge.from), coordinateOf(edge.to)] };
    lines.push(current);
  }
  return lines.map(({ key, end, ...line }) => line);
}

/** The day outside the range: 2dp dashed routeFaded, broken where the data is. */
export function outsideLines(dayPoints, range, { color, breakMs = sizes.route.breakAfterMs }) {
  if (!range || range.start == null) return [];
  const before = dayPoints.filter(p => p.time <= range.start);
  const after = dayPoints.filter(p => p.time >= range.end);
  return [...runsOf(before, breakMs), ...runsOf(after, breakMs)].map(run => ({
    width: sizes.route.faded, color, dashed: true, vehicle: false, start: run[0].time,
    coordinates: run.map(coordinateOf),
  }));
}

/**
 * Time markers: the range's first and last fix always (9dp), and in between
 * on round times at a step that keeps them few (7dp). None inside a break,
 * none in a stay, none on a route that is one indoor hold all day (判定表「整天都停在原處的地圖」).
 */
export function timeMarkers(points, { breakMs = sizes.route.breakAfterMs, allIndoor = false, stays = [] } = {}) {
  if (!points.length || allIndoor) return [];
  const first = points[0], last = points[points.length - 1];
  const span = last.time - first.time;
  const markers = [{ key: `t${first.time}`, time: first.time, label: clock(first.time), end: true,
    coordinate: coordinateOf(first) }];
  const step = STEPS.find(value => span / value <= MAX_MIDDLE_MARKERS + 1) ?? STEPS[STEPS.length - 1];
  let index = 0;
  for (let at = Math.ceil((first.time + 1) / step) * step; at < last.time; at += step) {
    // Too close to either end to read apart from it.
    if (at - first.time < step / 2 || last.time - at < step / 2) continue;
    while (index < points.length - 1 && points[index + 1].time <= at) index += 1;
    const before = points[index], next = points[index + 1];
    // Inside a break (沒資料的時段不標), or a stay (its number marks it).
    if (!next || next.time - before.time > breakMs) continue;
    if (stays.some(n => at >= n.start && at <= n.end)) continue;
    const p = at - before.time <= next.time - at ? before : next;
    markers.push({ key: `t${at}`, time: at, label: clock(at), end: false, coordinate: coordinateOf(p) });
  }
  if (last !== first) markers.push({ key: `t${last.time}`, time: last.time, label: clock(last.time), end: true,
    coordinate: coordinateOf(last) });
  return markers;
}

/** Numbered stays and switch points, and the indoor houses, where the list has them. */
export function placeMarkers(locations) {
  return locations.filter(n => ['stop', 'switch', 'indoor'].includes(n.type) && Number.isFinite(n.latitude))
    .map(n => ({ key: `${n.type}${n.start}`, kind: n.type === 'indoor' ? 'indoor' : 'number', number: n.number ?? null,
      start: n.start, end: n.end, coordinate: coordinateOf(n) }));
}

/**
 * Everything the map draws for the history screen: { lines, places, times,
 * cursor, camera, points } — `points` are the range's fixes (a tap or a drag
 * on the route snaps to them). `model` is historyTimeline's (with dayPoints
 * and edges); `cursor` is HistoryScreenCursor.screenCursor's.
 */
export function historyMapPresentation(model, { color, cursor = null } = {}) {
  if (!model) return null;
  const points = model.points || [];
  const dayPoints = model.dayPoints || points;
  // The list numbers stays and switch points (the same node objects); a
  // switch the list dropped has no number and is not drawn.
  const places = placeMarkers(model.locations || []).filter(place => place.kind === 'indoor' || place.number != null);
  const allIndoor = points.length > 0 && points.every(p => p.heldReason);
  const cursorTime = cursor?.point?.time ?? Infinity;
  const first = points[0], last = points[points.length - 1];
  return {
    color,
    lines: [
      ...outsideLines(dayPoints, first ? { start: first.time, end: last.time } : null, { color: colors.routeFaded }),
      ...routeLines(model.edges || [], { color, cursorTime }),
    ],
    places,
    // The cursor's label already says its time: no marker under it (H1).
    times: timeMarkers(points, { allIndoor,
      stays: (model.locations || []).filter(n => ['stop', 'indoor', 'switch'].includes(n.type)) }).filter(marker => !(marker.end && marker.time === cursor?.point?.time)),
    cursor: cursor?.point ? { time: cursor.point.time, coordinate: coordinateOf(cursor.point), lines: cursor.label,
      stale: !!cursor.stale, key: cursor.point.time } : null,
    camera: (points.length ? points : dayPoints).map(coordinateOf),
    points: points.map(p => ({ time: p.time, latitude: p.latitude, longitude: p.longitude })),
  };
}

// Metres between two coordinates (equirectangular: the history is a few km).
function metres(a, b) {
  const lat = ((a.latitude + b.latitude) / 2) * Math.PI / 180;
  const x = (b.longitude - a.longitude) * Math.cos(lat) * 111320;
  const y = (b.latitude - a.latitude) * 110540;
  return Math.hypot(x, y);
}

/**
 * The fix a touch on the route means (判定表「游標標籤」): the nearest fix to
 * `coordinate`. Where the route passes the same place more than once (passes
 * — runs of consecutive fixes — whose nearest fix is within `overlapM` of the
 * nearest of all), the pass nearest in time to the cursor now wins, and its
 * nearest fix is taken. Returns { point, distanceM } or null.
 */
export function nearestRoutePoint(points, coordinate, currentTime = null, overlapM = 15) {
  if (!points?.length || !coordinate) return null;
  const distances = points.map(p => metres(p, coordinate));
  const best = Math.min(...distances);
  // Passes: consecutive fixes near the touch.
  const passes = [];
  let pass = null;
  points.forEach((p, i) => {
    if (distances[i] > best + overlapM) { pass = null; return; }
    if (!pass) { pass = { point: p, distanceM: distances[i] }; passes.push(pass); }
    else if (distances[i] < pass.distanceM) { pass.point = p; pass.distanceM = distances[i]; }
  });
  if (currentTime == null || passes.length === 1) return passes.reduce((a, b) => (b.distanceM < a.distanceM ? b : a));
  return passes.reduce((a, b) => (Math.abs(b.point.time - currentTime) < Math.abs(a.point.time - currentTime) ? b : a));
}
