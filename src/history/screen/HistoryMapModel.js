// What the history map draws for one dog or my route (H1/H2/H2b; DESIGN.md
// 「路線」「時間標記」「歷史游标點」): provider-neutral lines, stop numbers, the
// indoor house, time markers and the cursor. Pure; GoogleTrackingMap draws it.
import { getTheme } from '../../theme/ThemeProvider';
import { size as sizes, space, layout } from '../../theme/tokens';
import { clock } from '../HistoryText';
import { configFor, coordinateValid, distanceMeters } from '../HistoryConfig';
import { historyMovement } from '../HistoryMovement';
import { historyStops, historyIndoorNodes } from '../HistoryStops';
import { phoneReliableSpeed } from '../../locationTracker/PhoneMotion';
import { phoneDisplayLocations, phoneStayDisplayCoordinate } from '../PhoneStayDisplayAnchors';

const MINUTE = 60000;
const isVehicle = mode => mode === 'driving' || mode === 'ride';
// Time marker spacing: the smallest step that keeps the route's middle to a
// few markers (判定表「時間標記」: 途中依畫面上放得下的密度選間隔).
const STEPS = [10, 15, 30, 60, 120, 180, 240].map(minutes => minutes * MINUTE);
const MAX_MIDDLE_MARKERS = 5;

const coordinates = new WeakMap();
const coordinateOf = p => {
  let coordinate = coordinates.get(p);
  if (!coordinate || coordinate.latitude !== p.latitude || coordinate.longitude !== p.longitude) {
    coordinate = { latitude: p.latitude, longitude: p.longitude };
    coordinates.set(p, coordinate);
  }
  return coordinate;
};
const pointHashes = new WeakMap();
const projectedRoutes = new WeakMap();
const routeIdentities = new WeakMap();

// Hold replay can mutate source points. Reuse only a matching value snapshot.
function projectedRoute(points) {
  let route = projectedRoutes.get(points);
  if (!route || route.length !== points.length || points.some((p, i) =>
    p.time !== route[i].time || p.latitude !== route[i].latitude || p.longitude !== route[i].longitude)) {
    route = points.map(p => ({ time: p.time, ...coordinateOf(p) }));
    projectedRoutes.set(points, route);
  }
  return route;
}

export function routeGeometryIdentity(points) {
  if (!points?.length) return 'empty';
  points = projectedRoute(points);
  let identity = routeIdentities.get(points);
  if (!identity) {
    let hash = geometryId(points);
    for (const point of points) hash = (hash * 31 + point.time) % 2 ** 32;
    identity = `${points.length}:${points[0].time}:${points[points.length - 1].time}:${hash}`;
    routeIdentities.set(points, identity);
  }
  return identity;
}

/** 「#RRGGBB」 at `alpha` (0–1) as rgba(), for the faded parts of a route. */
export function withAlpha(hex, alpha) {
  const [r, g, b] = [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16));
  return `rgba(${r},${g},${b},${alpha})`;
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
    if (edge.gap || ['gap', 'indoor'].includes(edge.mode) || edge.bridged) {
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
  `${line.start}-${line.end}-${geometryId(line.coordinates)}-${line.width}-${line.color}-${line.dashed ? 1 : 0}`;

// Hash exact coordinate text so reconciliation invalidates only changed pieces.
function geometryId(points) {
  let hash = 2166136261;
  for (const point of points) {
    const coordinate = coordinateOf(point);
    let pointHash = pointHashes.get(coordinate);
    if (pointHash == null) {
      pointHash = 2166136261;
      const text = `${point.latitude},${point.longitude};`;
      for (let i = 0; i < text.length; i += 1) pointHash = (pointHash * 31 + text.charCodeAt(i)) % 2 ** 32;
      pointHashes.set(coordinate, pointHash);
    }
    hash = (hash * 31 + pointHash) % 2 ** 32;
  }
  return hash;
}

// Cache only drawing geometry; cursor-dependent colour/chunks are still built
// by routeLines. The snapshot detects hold replay mutating source observations.
const dayDrawings = new WeakMap();
const rangeDrawings = new WeakMap();
const drawingFields = ['time', 'latitude', 'longitude', 'accuracy', 'heldReason',
  'heldSince', 'raw_speed_kmh', 'speed_kmh', 'speed_accuracy_mps',
  'phoneMotionState', 'phoneStationary', 'phoneConfirmedMovement', 'raw_latitude', 'raw_longitude'];
function dayDrawing(points, subject) {
  const cached = dayDrawings.get(points);
  if (cached && cached.subject === subject && cached.snapshot.length === points.length
    && points.every((p, i) => drawingFields.every((key, j) => p[key] === cached.snapshot[i][j]))) {
    return cached;
  }
  const config = configFor(subject);
  const movement = historyMovement(points, { subject, config });
  const start = points[0]?.time, end = points[points.length - 1]?.time;
  const stays = historyStops(points, { subject, config, start, end, vehicles: movement.vehicles });
  const places = [...stays.stops, ...historyIndoorNodes(points, { config })];
  // A stationary whole day deliberately has no numbered stop. It still has
  // no route: preserve 判定表「整天都停在原處的地圖」 for context lines too.
  if (stays.visits.length === 1 && stays.visits[0].durationMs >= config.alwaysStayMs
    && stays.visits[0].start === start && stays.visits[0].end === end) places.push(stays.visits[0]);
  const quietRecoveries = stationaryRecoveryEdges(movement.edges, places);
  const result = { subject, places, quietRecoveries,
    edges: clipRouteAtStays(movement.edges, places, config.radiusM, quietRecoveries),
    snapshot: points.map(p => drawingFields.map(key => p[key])) };
  dayDrawings.set(points, result);
  return result;
}

// A short zero-speed fix after a recording gap can jump within its accuracy
// footprint before the detector confirms a stay. It supplies no drawn arrival
// route. Keep the raw observations, timeline/gap and counted distance intact.
function stationaryRecoveryEdges(edges, places) {
  const quiet = new Set(), config = configFor('phone');
  const raw = p => ({ latitude: p.raw_latitude, longitude: p.raw_longitude });
  const stationarySpeed = p => {
    const speed = phoneReliableSpeed(p);
    return speed != null && speed < config.stillMps;
  };
  const valid = p => Number.isFinite(p.accuracy) && p.accuracy >= 0
    && p.accuracy <= 30 && coordinateValid(raw(p));
  const arrivals = new Set(places.filter(p => p.type === 'stop'
    && p.end - p.start >= config.stayMs).map(p => p.start));
  for (let i = 1; i < edges.length; i += 1) {
    const edge = edges[i], prior = edges[i - 1];
    if (edge.mode !== 'walking' || edge.gap || edge.bridged || edge.durationMs <= 0 || edge.durationMs > 10000
      || !prior.gap || prior.durationMs <= config.gapMs || !arrivals.has(edge.end)
      || edge.from.phoneMotionState == null || edge.to.phoneMotionState == null
      || edge.from.phoneConfirmedMovement || edge.to.phoneConfirmedMovement
      || !valid(edge.from) || !valid(edge.to)
      || phoneReliableSpeed(edge.from) !== 0 || phoneReliableSpeed(edge.to) !== 0
      || distanceMeters(raw(edge.from), raw(edge.to)) > edge.from.accuracy + edge.to.accuracy) continue;
    // Confirm from the same production detector within its bounded entry
    // window, rejecting credible travel, uncertain speed or another break.
    for (let j = i; j < edges.length && j < i + 64; j += 1) {
      const next = edges[j], p = next.to;
      if (p.time - edge.end > config.enterMs || next.gap || next.bridged
        || next.mode !== 'walking' || p.phoneConfirmedMovement || !valid(p)
        || !stationarySpeed(p) || distanceMeters(raw(edge.to), raw(p)) > config.radiusM) break;
      if (p.phoneStationary) { quiet.add(`${edge.start}:${edge.end}`); break; }
    }
  }
  return quiet;
}

// The interval along a segment inside a stay's radius (local metre projection).
function circleInterval(from, to, place, radiusM) {
  const center = place.center || place;
  const lonM = Math.cos(center.latitude * Math.PI / 180) * 111320;
  const x = (from.longitude - center.longitude) * lonM;
  const y = (from.latitude - center.latitude) * 110540;
  const dx = (to.longitude - from.longitude) * lonM;
  const dy = (to.latitude - from.latitude) * 110540;
  const a = dx * dx + dy * dy;
  if (!a) return x * x + y * y <= radiusM * radiusM ? [0, 1] : null;
  const b = 2 * (x * dx + y * dy), c = x * x + y * y - radiusM * radiusM;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  const lo = Math.max(0, (-b - root) / (2 * a)), hi = Math.min(1, (-b + root) / (2 * a));
  return hi > lo ? [lo, hi] : null;
}
const between = (edge, fraction) => fraction === 0 ? edge.from : fraction === 1 ? edge.to : ({
  time: edge.start + (edge.end - edge.start) * fraction,
  latitude: edge.from.latitude + (edge.to.latitude - edge.from.latitude) * fraction,
  longitude: edge.from.longitude + (edge.to.longitude - edge.from.longitude) * fraction,
});

/** Drawing only: never mutate measured edges, cursor fixes or distance totals.
 * Suppress the visit's whole time interval (including unconfirmed excursions),
 * plus the circle on its arrival/departure edge. The same place visited later
 * does not hide a genuine earlier pass through that location. */
export function clipRouteAtStays(edges, locations = [], radiusM = configFor().radiusM,
  quietRecoveries = stationaryRecoveryEdges(edges, locations)) {
  // Timeline edges are chronological. Sweep sorted intervals so each edge
  // checks only concurrent stays, rather than every stay from the entire day.
  const places = locations.filter(n => ['stop', 'indoor'].includes(n.type))
    .slice().sort((a, b) => a.start - b.start);
  let nextPlace = 0, active = [];
  return edges.flatMap(edge => {
    if (edge.gap || ['gap', 'indoor'].includes(edge.mode) || edge.bridged
      || quietRecoveries.has(`${edge.start}:${edge.end}`)) return [];
    while (nextPlace < places.length && places[nextPlace].start <= edge.end) {
      active.push(places[nextPlace]); nextPlace += 1;
    }
    active = active.filter(place => place.end >= edge.start);
    let intervals = [[0, 1]];
    for (const place of active) {
      const span = edge.end - edge.start;
      const timeInside = span > 0
        ? [Math.max(0, (place.start - edge.start) / span), Math.min(1, (place.end - edge.start) / span)]
        : [0, 1];
      const circle = circleInterval(edge.from, edge.to, place, radiusM);
      for (const [lo, hi] of [timeInside, circle].filter(Boolean)) {
        if (hi <= lo) continue;
        intervals = intervals.flatMap(([a, b]) => hi <= a || lo >= b ? [[a, b]]
          : [[a, Math.min(b, lo)], [Math.max(a, hi), b]].filter(([x, y]) => y - x > 1e-9));
      }
    }
    return intervals.map(([a, b]) => {
      if (a === 0 && b === 1) return edge;
      const from = between(edge, a), to = between(edge, b);
      return { ...edge, from, to, start: from.time, end: to.time };
    });
  });
}

// Cache secondary as well as primary clipped geometry independently of the
// cursor. Value snapshots keep replay/in-place edits from leaving stale lines.
const recoveryFields = ['accuracy', 'phoneMotionState', 'phoneStationary', 'phoneConfirmedMovement',
  'raw_latitude', 'raw_longitude', 'raw_speed_kmh', 'speed_kmh', 'speed_accuracy_mps'];
const edgeSnapshot = e => [e.start, e.end, e.mode, e.gap, e.bridged,
  e.from.latitude, e.from.longitude, e.to.latitude, e.to.longitude, e.durationMs,
  ...recoveryFields.map(key => e.from[key]), ...recoveryFields.map(key => e.to[key])];
const edgeMatches = (e, v) => e.start === v[0] && e.end === v[1] && e.mode === v[2]
  && e.gap === v[3] && e.bridged === v[4] && e.from.latitude === v[5]
  && e.from.longitude === v[6] && e.to.latitude === v[7] && e.to.longitude === v[8]
  && e.durationMs === v[9] && recoveryFields.every((key, i) => e.from[key] === v[10 + i]
    && e.to[key] === v[10 + recoveryFields.length + i]);
const placeSnapshot = p => [p.type, p.start, p.end, p.latitude, p.longitude,
  p.center?.latitude, p.center?.longitude];
const placeMatches = (p, v) => p.type === v[0] && p.start === v[1] && p.end === v[2]
  && p.latitude === v[3] && p.longitude === v[4]
  && p.center?.latitude === v[5] && p.center?.longitude === v[6];
export function stayAwareModelEdges(model, { day = null, radiusM = configFor().radiusM } = {}) {
  let cached = rangeDrawings.get(model);
  const edges = model.edges || [], locations = model.locations || [];
  const places = [...(day?.places || []), ...locations];
  if (cached && cached.day === day && cached.radiusM === radiusM
    && cached.sourceEdges === edges && cached.locations === locations
    && cached.edgeSnapshot.length === edges.length && cached.placeSnapshot.length === places.length
    && edges.every((e, i) => edgeMatches(e, cached.edgeSnapshot[i]))
    && places.every((p, i) => placeMatches(p, cached.placeSnapshot[i]))) return cached.clipped;
  cached = { day, radiusM, sourceEdges: edges, locations, places,
    edgeSnapshot: edges.map(edgeSnapshot), placeSnapshot: places.map(placeSnapshot),
    clipped: clipRouteAtStays(edges, places, radiusM, day?.quietRecoveries ?? stationaryRecoveryEdges(edges, places)) };
  rangeDrawings.set(model, cached);
  return cached.clipped;
}

/** The day outside the range: only stay-aware movement, dashed and chunked. */
export function outsideLines(dayPoints, range, { color, subject = 'dog',
  breakMs = sizes.route.breakAfterMs, edges = null } = {}) {
  if (!range || range.start == null) return [];
  const movement = edges || dayDrawing(dayPoints, subject).edges;
  const outside = movement.filter(e => e.end - e.start <= breakMs
    && (e.end <= range.start || e.start >= range.end));
  return routeLines(outside, { color }).map(line => {
    const faded = { ...line, width: sizes.route.faded, color, dashed: true };
    return { ...faded, id: lineId(faded) };
  });
}

/**
 * Time markers: the range's first and last fix always (9dp), and in between
 * on round times at a step that keeps them few (7dp). None inside a break,
 * none in a stay, none on a route that is one indoor hold all day (判定表「整天都停在原處的地圖」).
 */
export function timeMarkers(
  points,
  { breakMs = sizes.route.breakAfterMs, allIndoor = false, stays = [], subject = 'dog' } = {},
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
      coordinate: (subject === 'phone' ? phoneStayDisplayCoordinate(stays, first.time) : null) || coordinateOf(first),
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
      coordinate: (subject === 'phone' ? phoneStayDisplayCoordinate(stays, last.time) : null) || coordinateOf(last),
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

// Cursor changes must not restart native projection of every stay. Snapshot
// every input node, including hidden ones: in-place replay can make one visible.
const markerProjections = new WeakMap();
const markerFields = ['type', 'start', 'end', 'number', 'durationMs', 'latitude', 'longitude'];
const emptyLocations = [];
function stablePlaceMarkers(locations) {
  const cached = markerProjections.get(locations);
  if (cached && cached.snapshot.length === locations.length
    && locations.every((node, i) => markerFields.every((key, j) =>
      Object.is(node[key], cached.snapshot[i][j])))) return cached.places;
  const places = placeMarkers(locations).filter(place => place.kind === 'indoor' || place.number != null);
  markerProjections.set(locations, { places,
    snapshot: locations.map(node => markerFields.map(key => node[key])) });
  return places;
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
  { color, cursor = null, theme = getTheme(), subject = null } = {},
) {
  const { colors } = theme;
  if (!model) return null;
  const points = model.points || [];
  const dayPoints = model.dayPoints || points;
  // The list numbers stays and switch points (the same node objects); a
  // switch the list dropped has no number and is not drawn.
  const places = stablePlaceMarkers(model.locations || emptyLocations);
  const allIndoor = points.length > 0 && points.every(p => p.heldReason);
  subject = subject || (dayPoints.some(p => p.slave_id === 'phone')
    || model.edges?.some(e => ['walking', 'driving'].includes(e.mode)) ? 'phone' : 'dog');
  const displayLocations = subject === 'phone' ? phoneDisplayLocations(model) : model.locations || emptyLocations;
  const drawing = dayDrawing(dayPoints, subject);
  const rangeEdges = stayAwareModelEdges(model, { day: drawing, radiusM: configFor(subject).radiusM });
  const cursorTime = cursor?.point?.time ?? Infinity;
  const first = points[0],
    last = points[points.length - 1];
  return {
    color,
    lines: [
      ...outsideLines(
        dayPoints,
        first ? { start: first.time, end: last.time } : null,
        { color: colors.routeFaded, subject, edges: subject === 'dog' ? model.dayEdges ?? drawing.edges : drawing.edges },
      ),
      ...routeLines(rangeEdges, { color, cursorTime, theme }),
    ],

    places,
    // The cursor's label already says its time: no marker under it (H1);
    // a middle time only where the cursor has been; one too close to a number or another time is left
    // out (its label would sit on theirs).
    times: uncrowded(
      timeMarkers(points, {
        subject, allIndoor,
        stays: displayLocations.filter(n =>
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
          coordinate: subject === 'phone' && !cursor.stale
            ? phoneStayDisplayCoordinate(displayLocations, cursor.point.time) || coordinateOf(cursor.point)
            : coordinateOf(cursor.point),
          lines: cursor.label,
          stale: !!cursor.stale,
          key: cursor.point.time,
        }
      : null,
    camera: (points.length ? points : dayPoints).map(coordinateOf),
    points: projectedRoute(points),
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
    ? gridCandidates(routeSpotGrid(points, breakMs), points, coordinate, overlapM)
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
  const grid = { breakMs, cells, cellOf, cellLat, cellLon, segments: points.length - 1 };
  grids.set(points, grid);
  return grid;
}

// Segment indices in rings of cells around the touch, out to where no
// segment can be within `overlapM` of the nearest one found (null: look at
// all of them, the grid found nothing nearby).
function gridCandidates(grid, points, coordinate, overlapM) {
  const [row, col] = grid.cellOf(coordinate.latitude, coordinate.longitude);
  const found = new Set();
  const lonM = Math.abs(Math.cos(coordinate.latitude * Math.PI / 180) * 111320);
  let best = Infinity;
  const visit = (r, c) => {
    for (const index of grid.cells.get(`${r}:${c}`) || []) {
      if (found.has(index)) continue;
      found.add(index);
      best = Math.min(best, projectedSegment(points[index], points[index + 1], coordinate).distanceM);
    }
  };
  for (let ring = 0; ring < 200; ring += 1) {
    for (let c = col - ring; c <= col + ring; c += 1) {
      visit(row - ring, c);
      if (ring) visit(row + ring, c);
    }
    for (let r = row - ring + 1; r < row + ring; r += 1) {
      visit(r, col - ring);
      visit(r, col + ring);
    }
    // Any undiscovered segment lies outside this rectangle: its bounding
    // box occupied every visited cell it intersected. Distance to the four
    // sides is a lower bound for ALL remaining rings, at the touch latitude.
    const bound = Math.min(
      (coordinate.latitude - (row - ring) * grid.cellLat) * 110540,
      ((row + ring + 1) * grid.cellLat - coordinate.latitude) * 110540,
      (coordinate.longitude - (col - ring) * grid.cellLon) * lonM,
      ((col + ring + 1) * grid.cellLon - coordinate.longitude) * lonM,
    );
    if (bound > best + overlapM + 1e-6) return [...found].sort((a, b) => a - b);
  }
  // A bounded search is only an optimization, never an incomplete answer.
  return null;
}

function projectedSegment(p, q, coordinate) {
  const scale = Math.cos(coordinate.latitude * Math.PI / 180) * 111320;
  const ax = (p.longitude - coordinate.longitude) * scale;
  const ay = (p.latitude - coordinate.latitude) * 110540;
  const dx = (q.longitude - p.longitude) * scale;
  const dy = (q.latitude - p.latitude) * 110540;
  const length = dx * dx + dy * dy;
  const f = length ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length)) : 0;
  return { f, distanceM: Math.hypot(ax + dx * f, ay + dy * f) };
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
    const { f, distanceM } = projectedSegment(p, q, coordinate);
    spots.push({
      point: f < 0.5 ? p : q,
      distanceM,
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
