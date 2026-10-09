import { configFor, distanceMeters, atLeast, accuracyOf, measuredSpeedMps, samePlaceGap } from './HistoryConfig';

const travelMode = subject => (subject === 'phone' ? 'driving' : 'ride');
const footMode = subject => (subject === 'phone' ? 'walking' : 'moving');

/**
 * 判定表「開車段落」「狗坐車」「開車規則套到狗坐車」: the vehicle intervals of
 * a run of edges. Each is { start, end, firstEdge, lastEdge }.
 */
function detectVehicles(edges, config) {
  const scan = vehicleScan();
  for (let i = 0; i < edges.length; i += 1) stepVehicles(scan, edges, i, config);
  return finishVehicles(scan, edges);
}

/**
 * The vehicle detection one edge at a time (detectVehicles above), so today's
 * distance (TodayRouteEngine) can carry it on from where it stopped instead
 * of scanning the whole day again. `scan` is { high, active, low, vehicles }.
 */
export const vehicleScan = () => ({ high: null, active: null, low: null, vehicles: [] });

// `exited`: ended by 30/60 s of low speed, so its last fix is the first one
// on foot; ended by a gap, a hold or the data's end, its last fix was still
// in the car (判定表「開車和停留」: car fixes take no part in visits).
function closeVehicle(scan, edges, endIndex, exited = false) {
  scan.vehicles.push({ start: edges[scan.active].start, end: edges[endIndex].end,
    firstEdge: scan.active, lastEdge: endIndex, exited });
  scan.active = null; scan.low = null; scan.high = null;
}

export function stepVehicles(scan, edges, i, config) {
  const edge = edges[i];
  if (edge.gap || edge.mode === 'indoor') {
    if (scan.active != null && (edge.mode === 'indoor' || edge.durationMs > config.maxVehicleGapMs
      || !atLeast(edge.speed, config.vehicleSpeed))) closeVehicle(scan, edges, i - 1);
    scan.high = null; scan.low = null; return;
  }
  if (scan.active == null) {
    if (atLeast(edge.speed, config.vehicleSpeed)) {
      if (scan.high == null) scan.high = i;
      if (edge.end - edges[scan.high].start >= config.enterMs) {
        scan.active = scan.high;
        if (config.backtrackSpeed != null) {
          while (scan.active > 0 && !edges[scan.active - 1].gap && edges[scan.active - 1].mode !== 'indoor'
            && atLeast(edges[scan.active - 1].speed, config.backtrackSpeed)) scan.active -= 1;
        }
        scan.high = null;
      }
    } else scan.high = null;
  } else if (!atLeast(edge.speed, config.exitSpeed)) {
    if (scan.low == null) scan.low = i;
    if (edge.end - edges[scan.low].start >= config.exitMs) closeVehicle(scan, edges, scan.low - 1, true);
  } else scan.low = null;
}

/** The vehicles found, a vehicle still going closed at the data's end. */
export function finishVehicles(scan, edges) {
  if (scan.active != null) closeVehicle(scan, edges, edges.length - 1);
  return scan.vehicles;
}

/**
 * After stepping edge `i`: nothing later can change a vehicle up to it — none
 * is going or about to start, and the edge stops backtracking (a gap, a hold,
 * or slower than backtrackSpeed).
 */
export function vehiclesSettledAt(scan, edges, i, config) {
  const edge = edges[i];
  if (scan.active != null || scan.high != null) return false;
  if (edge.gap || edge.mode === 'indoor') return true;
  return config.backtrackSpeed == null ? true : !atLeast(edge.speed, config.backtrackSpeed);
}

/**
 * 判定表「距離怎麼加」: the range is cut into runs of continuous walking (or
 * a dog's movement), broken by a gap over 3 minutes, a vehicle or an indoor
 * hold. The first fix of a run is only a reference; each later fix is
 * compared with the last COUNTED one and counts once it is farther than the
 * larger accuracy of the two (at least 5 m, 10 m without an accuracy). The
 * distance lands on the edge that crossed the threshold.
 */
// The step's speed for the budget: the speed measured at the fix it
// reaches; a long step (over 10 s, sparse fixes) also takes the speed it
// left with, so a walk that ends on a fix taken standing still still counts
// (Codex review, 067). null when neither fix has one.
function stepSpeed(edge) {
  const to = measuredSpeedMps(edge.to);
  const from = edge.durationMs > 10000 ? measuredSpeedMps(edge.from) : null;
  if (to == null && (edge.durationMs <= 10000 || from == null)) return to == null && from == null ? null : to ?? from;
  return Math.max(to ?? 0, from ?? 0);
}

export function countDistances(edges, config = configFor('dog')) {
  let anchor = null;
  // How far the phone's own measured speeds say it went since the anchor
  // (config.speedBudget, phone only; Infinity once a fix has no speed).
  let budget = 0;
  for (const edge of edges) {
    if (edge.mode !== 'walking' && edge.mode !== 'moving') {
      edge.countedDistanceM = 0; anchor = null; continue;
    }
    if (!anchor) { anchor = edge.from; budget = 0; }
    // A break at one place (samePlaceGap) is no walk.
    if (edge.bridged) { edge.countedDistanceM = 0; continue; }
    // With neither fix's speed measured, the old rule (Infinity).
    const speed = config.speedBudget ? stepSpeed(edge) : null;
    // Speeds under stillMps are a phone standing still (measurement noise).
    budget += speed == null ? Infinity : speed < config.stillMps ? 0 : speed * (edge.durationMs / 1000);
    const moved = distanceMeters(anchor, edge.to);
    const threshold = Math.max(config.minMoveM, accuracyOf(anchor, config), accuracyOf(edge.to, config));
    // 067: indoors all day the position drifts 50–110 m for minutes while the
    // phone measures 0–1 km/h. A move the measured speeds cannot cover (half
    // again what they add up to, plus minMoveM) is drift: it neither counts
    // nor becomes the anchor.
    if (moved > threshold && moved <= budget * 1.5 + config.minMoveM) {
      edge.countedDistanceM = moved; anchor = edge.to; budget = 0;
    } else edge.countedDistanceM = 0;
  }
  return edges;
}

/** One fix-to-fix step, as historyMovement and today's distance (TodayRouteEngine) see it. */
export function historyEdge(from, to, subject = 'dog', config = configFor(subject)) {
  const durationMs = to.time - from.time;
  const distanceM = distanceMeters(from, to);
  // 067: a break at one place is part of the stay there, not a gap.
  const bridged = samePlaceGap(from, to, config);
  return { from, to, start: from.time, end: to.time, durationMs, distanceM, bridged,
    speed: distanceM / (durationMs / 1000), gap: durationMs > config.gapMs && !bridged,
    // Into or within a hold: not movement (判定表「停在原處前後的距離」:
    // the drift drawn onto the hold spot does not count); the release edge
    // out of it is ordinary movement from the spot.
    mode: to.heldReason ? 'indoor' : footMode(subject) };
}

/**
 * Edges keep both their actual distance and the counted distance. Gaps never
 * connect. `vehicles` classifies the edges with intervals found on a longer
 * stream (the whole day), so clipping a range cannot lose a confirmation.
 */
export function historyMovement(points, { subject = 'dog', config = configFor(subject), vehicles = null } = {}) {
  const edges = points.slice(1).map((to, i) => historyEdge(points[i], to, subject, config));
  const found = vehicles ?? detectVehicles(edges, config);
  for (const edge of edges) {
    if (edge.mode === 'indoor') continue;
    if (found.some(v => edge.start >= v.start && edge.end <= v.end)) edge.mode = travelMode(subject);
  }
  for (const edge of edges) if (edge.gap) edge.mode = 'gap';
  countDistances(edges, config);
  // 判定表「交通方式切換點」: where two modes meet, never across a gap or a hold.
  const switches = edges.slice(1).flatMap((edge, i) => {
    const before = edges[i];
    return !['gap', 'indoor'].includes(edge.mode) && !['gap', 'indoor'].includes(before.mode)
      && edge.mode !== before.mode ? [{ type: 'switch', start: edge.start, end: edge.start,
        latitude: edge.from.latitude, longitude: edge.from.longitude, point: edge.from }] : [];
  });
  const high = vehicles ? null : pendingHigh(edges, config);
  return { edges, vehicles: found.map(({ start, end, firstEdge, lastEdge, exited = true }) => ({ start, end, firstEdge, lastEdge, exited })),
    switches, pendingHighStart: high, distanceM: edges.reduce((sum, e) => sum + e.countedDistanceM, 0) };
}

// The start of a high-speed run at the end that is not yet a vehicle (the
// phone's departure grace looks at it).
function pendingHigh(edges, config) {
  let start = null;
  for (let i = edges.length - 1; i >= 0; i -= 1) {
    const e = edges[i];
    if (e.mode !== 'walking' && e.mode !== 'moving') break;
    if (!atLeast(e.speed, config.vehicleSpeed)) break;
    start = e.start;
  }
  return start;
}

export const isVehiclePoint = (point, vehicles) => vehicles.some(v => point.time >= v.start
  && (point.time < v.end || (v.exited === false && point.time === v.end)));
