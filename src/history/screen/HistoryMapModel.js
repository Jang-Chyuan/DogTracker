// What the history map draws for one dog or my route (H1/H2/H2b; DESIGN.md
// 「路線」「時間標記」「歷史游标點」): provider-neutral lines, stop numbers, the
// indoor house, time markers and the cursor. Pure; GoogleTrackingMap draws it.
import { getTheme } from '../../theme/ThemeProvider';
import { size as sizes, space, layout } from '../../theme/tokens';
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
// A long day is drawn in pieces of at most this many edges, cut at the same
// edges wherever the cursor is: a cursor move changes the piece it is in
// (and the look of the pieces it passed), never the coordinates of the rest,
// so the map does not send thousands of points to the native line again
// (067: a tap on a long route froze the app).
export const ROUTE_CHUNK_EDGES = 200;

export function routeLines(
  edges,
  { color, cursorTime = Infinity, theme = getTheme(), chunkEdges = ROUTE_CHUNK_EDGES },
) {
  const { opacity } = theme;
  const lines = [];
  let current = null;
  for (let index = 0; index < edges.length; index += 1) {
    const edge = edges[index];
    if (edge.gap || edge.mode === 'gap') {
      current = null;
      continue;
    }
    const vehicle = isVehicle(edge.mode);
    const after = edge.start >= cursorTime;
    const width = vehicle
      ? sizes.route.drive
      : after
      ? sizes.route.upcoming
      : sizes.route.walk;
    const stroke = after
      ? withAlpha(color, opacity.routeUpcoming)
      : theme.isDark
      ? withAlpha(color, opacity.routeBeforeCursor)
      : color;
    const key = `${width}:${stroke}`;
    if (current && current.key === key && current.end === edge.start && index % chunkEdges !== 0) {
      current.coordinates.push(coordinateOf(edge.to));
      current.end = edge.end;
      continue;
    }
    current = {
      key,
      width,
      color: stroke,
      dashed: theme.isDark && after,
      vehicle,
      end: edge.end,
      start: edge.start,
      coordinates: [coordinateOf(edge.from), coordinateOf(edge.to)],
    };
    lines.push(current);
  }
  return lines.map(({ key, ...line }) => ({ ...line, id: lineId(line) }));
}

// What a drawn line is: the same id, the same coordinates and look (the map
// leaves a line with an unchanged id alone).
const lineId = line =>
  `${line.start}-${line.end}-${line.coordinates.length}-${line.width}-${line.color}-${line.dashed ? 1 : 0}`;

/** The day outside the range: 2dp dashed routeFaded, broken where the data is. */
export function outsideLines(
  dayPoints,
  range,
  { color, breakMs = sizes.route.breakAfterMs },
) {
  if (!range || range.start == null) return [];
  const before = dayPoints.filter(p => p.time <= range.start);
  const after = dayPoints.filter(p => p.time >= range.end);
  return [...runsOf(before, breakMs), ...runsOf(after, breakMs)].map(run => {
    const line = {
      width: sizes.route.faded,
      color,
      dashed: true,
      vehicle: false,
      start: run[0].time,
      end: run[run.length - 1].time,
      coordinates: run.map(coordinateOf),
    };
    return { ...line, id: lineId(line) };
  });
}

/**
 * Time markers: the range's first and last fix always (9dp), and in between
 * on round times at a step that keeps them few (7dp). None inside a break,
 * none in a stay, none on a route that is one indoor hold all day (判定表「整天都停在原處的地圖」).
 */
export function timeMarkers(
  points,
  { breakMs = sizes.route.breakAfterMs, allIndoor = false, stays = [] } = {},
) {
  if (!points.length || allIndoor) return [];
  const first = points[0],
    last = points[points.length - 1];
  const span = last.time - first.time;
  const markers = [
    {
      key: `t${first.time}`,
      time: first.time,
      label: clock(first.time),
      end: true,
      coordinate: coordinateOf(first),
    },
  ];
  const step =
    STEPS.find(value => span / value <= MAX_MIDDLE_MARKERS + 1) ??
    STEPS[STEPS.length - 1];
  let index = 0;
  for (
    let at = Math.ceil((first.time + 1) / step) * step;
    at < last.time;
    at += step
  ) {
    // Too close to either end to read apart from it.
    if (at - first.time < step / 2 || last.time - at < step / 2) continue;
    while (index < points.length - 1 && points[index + 1].time <= at)
      index += 1;
    const before = points[index],
      next = points[index + 1];
    // Inside a break (沒資料的時段不標), or a stay (its number marks it).
    if (!next || next.time - before.time > breakMs) continue;
    if (stays.some(n => at >= n.start && at <= n.end)) continue;
    const p = at - before.time <= next.time - at ? before : next;
    markers.push({
      key: `t${at}`,
      time: at,
      label: clock(at),
      end: false,
      coordinate: coordinateOf(p),
    });
  }
  if (last !== first)
    markers.push({
      key: `t${last.time}`,
      time: last.time,
      label: clock(last.time),
      end: true,
      coordinate: coordinateOf(last),
    });
  return markers;
}

/** Numbered stays and switch points, and the indoor houses, where the list has them. */
export function placeMarkers(locations) {
  return locations
    .filter(
      n =>
        ['stop', 'switch', 'indoor'].includes(n.type) &&
        Number.isFinite(n.latitude),
    )
    .map(n => ({
      key: `${n.type}${n.start}`,
      kind: n.type === 'indoor' ? 'indoor' : 'number',
      // For TalkBack (MarkerA11yLayer.stopSpeech): a stay or a switch, and
      // the stay's own length (interruptions left out, as its pill).
      type: n.type,
      durationMs: n.durationMs ?? null,
      number: n.number ?? null,
      start: n.start,
      end: n.end,
      coordinate: coordinateOf(n),
    }));
}

// Metres between two coordinates (equirectangular: the history is a few km).
const metresApart = (a, b) =>
  Math.hypot(
    (b.longitude - a.longitude) *
      Math.cos((a.latitude * Math.PI) / 180) *
      111320,
    (b.latitude - a.latitude) * 110540,
  );

/** Middle time markers at least `apartM` from the places and the times kept. */
export function uncrowded(times, places, apartM = 150) {
  const kept = times.filter(marker => marker.end);
  for (const marker of times) {
    if (marker.end) continue;
    const near = [...places, ...kept].some(
      other => metresApart(marker.coordinate, other.coordinate) < apartM,
    );
    if (!near) kept.push(marker);
  }
  return kept.sort((a, b) => a.time - b.time);
}

/**
 * Everything the map draws for the history screen: { lines, places, times,
 * cursor, camera, points } — `points` are the range's fixes (a tap or a drag
 * on the route snaps to them). `model` is historyTimeline's (with dayPoints
 * and edges); `cursor` is HistoryScreenCursor.screenCursor's.
 */
export function historyMapPresentation(
  model,
  { color, cursor = null, theme = getTheme() } = {},
) {
  const { colors } = theme;
  if (!model) return null;
  const points = model.points || [];
  const dayPoints = model.dayPoints || points;
  // The list numbers stays and switch points (the same node objects); a
  // switch the list dropped has no number and is not drawn.
  const places = placeMarkers(model.locations || []).filter(
    place => place.kind === 'indoor' || place.number != null,
  );
  const allIndoor = points.length > 0 && points.every(p => p.heldReason);
  const cursorTime = cursor?.point?.time ?? Infinity;
  const first = points[0],
    last = points[points.length - 1];
  return {
    color,
    lines: [
      ...outsideLines(
        dayPoints,
        first ? { start: first.time, end: last.time } : null,
        { color: colors.routeFaded },
      ),
      ...routeLines(model.edges || [], { color, cursorTime, theme }),
    ],

    places,
    // The cursor's label already says its time: no marker under it (H1);
    // a middle time only where the cursor has been; one too close to a number or another time is left
    // out (its label would sit on theirs).
    times: uncrowded(
      timeMarkers(points, {
        allIndoor,
        stays: (model.locations || []).filter(n =>
          ['stop', 'indoor', 'switch'].includes(n.type),
        ),
      })
        // 途中的時間標記只畫走過的部分（游標之前）; the ends always.
        .filter(marker =>
          marker.end
            ? marker.time !== cursor?.point?.time
            : marker.time <= cursorTime,
        ),
      places,
    ),
    cursor: cursor?.point
      ? {
          time: cursor.point.time,
          coordinate: coordinateOf(cursor.point),
          lines: cursor.label,
          stale: !!cursor.stale,
          key: cursor.point.time,
        }
      : null,
    camera: (points.length ? points : dayPoints).map(coordinateOf),
    points: points.map(p => ({
      time: p.time,
      latitude: p.latitude,
      longitude: p.longitude,
    })),
  };
}

/**
 * A touch on the drawn route (判定表「游標標籤」「點路線上任何一點」): the
 * nearest place on a drawn segment (fix to fix, nothing across a break of
 * over 3 minutes); where segments of different passes are about as near
 * (within `overlapM`), the one nearest in time to the cursor now. Returns
 * { point: the segment's nearer fix, coordinate: the place on the line,
 * distanceM } or null.
 */
export function nearestRouteSpot(
  points,
  coordinate,
  currentTime = null,
  { overlapM = 15, breakMs = sizes.route.breakAfterMs, grid = true } = {},
) {
  if (!points?.length || !coordinate) return null;
  // A long day (thousands of fixes) looks only at the segments in the grid
  // cells around the touch (routeSpotGrid); the answer is the same as going
  // through every segment (068: a drag or a tap on a long route was slow).
  const near = grid && points.length > GRID_MIN_POINTS
    ? gridCandidates(routeSpotGrid(points, breakMs), coordinate, overlapM)
    : null;
  return nearestOf(points, coordinate, currentTime, { overlapM, breakMs, near });
}

// Below this many fixes going through all of them is quick enough.
const GRID_MIN_POINTS = 400;
const GRID_CELL_M = 60;
const grids = new WeakMap();

/**
 * The segments of `points` by grid cell (about 60 m square), built once per
 * route (the points array of one presentation).
 */
export function routeSpotGrid(points, breakMs = sizes.route.breakAfterMs) {
  const cached = grids.get(points);
  if (cached && cached.breakMs === breakMs) return cached;
  const lat0 = points[0].latitude;
  const cellLat = GRID_CELL_M / 110540;
  const cellLon = GRID_CELL_M / (111320 * Math.cos((lat0 * Math.PI) / 180));
  const cells = new Map();
  const cellOf = (lat, lon) => [Math.floor(lat / cellLat), Math.floor(lon / cellLon)];
  for (let i = 0; i < points.length - 1; i += 1) {
    const p = points[i], q = points[i + 1];
    if (q.time - p.time > breakMs) continue;
    const [r0, c0] = cellOf(Math.min(p.latitude, q.latitude), Math.min(p.longitude, q.longitude));
    const [r1, c1] = cellOf(Math.max(p.latitude, q.latitude), Math.max(p.longitude, q.longitude));
    for (let r = r0; r <= r1; r += 1) {
      for (let c = c0; c <= c1; c += 1) {
        const key = `${r}:${c}`;
        const list = cells.get(key);
        if (list) list.push(i); else cells.set(key, [i]);
      }
    }
  }
  const grid = { breakMs, cells, cellOf, segments: points.length - 1 };
  grids.set(points, grid);
  return grid;
}

// Segment indices in rings of cells around the touch, out to where no
// segment can be within `overlapM` of the nearest one found (null: look at
// all of them, the grid found nothing nearby).
function gridCandidates(grid, coordinate, overlapM) {
  const [row, col] = grid.cellOf(coordinate.latitude, coordinate.longitude);
  const found = new Set();
  let nearestM = Infinity;
  for (let ring = 0; ring < 200; ring += 1) {
    // Every cell of this ring is at least (ring - 1) cells from the touch.
    if (Number.isFinite(nearestM) && (ring - 1) * GRID_CELL_M > nearestM + overlapM + GRID_CELL_M) break;
    for (let r = row - ring; r <= row + ring; r += 1) {
      for (let c = col - ring; c <= col + ring; c += 1) {
        if (Math.max(Math.abs(r - row), Math.abs(c - col)) !== ring) continue;
        const list = grid.cells.get(`${r}:${c}`);
        if (!list) continue;
        for (const index of list) found.add(index);
        // A segment in this ring is no farther than the ring's far corner.
        nearestM = Math.min(nearestM, (ring + 1) * GRID_CELL_M * Math.SQRT2);
      }
    }
  }
  return found.size ? [...found].sort((a, b) => a - b) : null;
}

function nearestOf(points, coordinate, currentTime, { overlapM, breakMs, near }) {
  const lat0 = (coordinate.latitude * Math.PI) / 180;
  const xy = p => ({
    x: (p.longitude - coordinate.longitude) * Math.cos(lat0) * 111320,
    y: (p.latitude - coordinate.latitude) * 110540,
  });
  const spots = [];
  if (points.length === 1) {
    const a = xy(points[0]);
    spots.push({
      point: points[0],
      coordinate: {
        latitude: points[0].latitude,
        longitude: points[0].longitude,
      },
      distanceM: Math.hypot(a.x, a.y),
      index: 0,
    });
  }
  const segment = i => {
    const p = points[i],
      q = points[i + 1];
    if (q.time - p.time > breakMs) return;
    const a = xy(p),
      b = xy(q);
    const dx = b.x - a.x,
      dy = b.y - a.y,
      length = dx * dx + dy * dy;
    const f = length
      ? Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / length))
      : 0;
    spots.push({
      point: f < 0.5 ? p : q,
      distanceM: Math.hypot(a.x + dx * f, a.y + dy * f),
      index: i,
      coordinate: {
        latitude: p.latitude + (q.latitude - p.latitude) * f,
        longitude: p.longitude + (q.longitude - p.longitude) * f,
      },
    });
  };
  if (near) near.forEach(segment);
  else for (let i = 0; i < points.length - 1; i += 1) segment(i);
  if (!spots.length) return null;
  let best = Infinity;
  for (const spot of spots) if (spot.distanceM < best) best = spot.distanceM;
  // Passes: runs of consecutive segments near the touch; the nearest of each.
  const passes = [];
  let last = -2;
  for (const spot of spots) {
    if (spot.distanceM > best + overlapM) continue;
    const pass = spot.index === last + 1 ? passes[passes.length - 1] : null;
    if (!pass) passes.push(spot);
    else if (spot.distanceM < pass.distanceM) passes[passes.length - 1] = spot;
    last = spot.index;
  }
  const chosen =
    currentTime == null || passes.length === 1
      ? passes.reduce((a, b) => (b.distanceM < a.distanceM ? b : a))
      : passes.reduce((a, b) =>
          Math.abs(b.point.time - currentTime) <
          Math.abs(a.point.time - currentTime)
            ? b
            : a,
        );
  const { index, ...result } = chosen;
  return result;
}

// The bottom keeps clear of 框住全部 (48dp, 12dp above the panel).
export const HISTORY_FRAME_PADDING = {
  top: layout.framePadding + sizes.mapFrame.historyControls,
  right: space.xl,
  bottom: layout.framePadding + sizes.mapFrame.historyPanel,
  left: space.xl,
};
// Half the cursor label's width (about 「08:46」「已移動 0.8 km」), so a label
// over a point at the left or right edge of the route is not cut off.
const LABEL_HALF = sizes.mapFrame.labelHalf;
/**
 * The history frame for `positions` with the cursor at `cursor`: more room
 * on the side where the cursor sits at the edge of the route (its label is
 * centred over it).
 */
export function historyFramePadding(
  positions,
  cursor,
  base = HISTORY_FRAME_PADDING,
) {
  if (!cursor || positions.length < 2) return base;
  const lons = positions.map(p => p.longitude);
  const west = Math.min(...lons),
    east = Math.max(...lons);
  const width = east - west;
  if (!(width > 0)) return base;
  const at = (cursor.longitude - west) / width;
  return {
    ...base,
    right: at > 0.8 ? Math.max(base.right, LABEL_HALF) : base.right,
    left: at < 0.2 ? Math.max(base.left, LABEL_HALF) : base.left,
  };
}
