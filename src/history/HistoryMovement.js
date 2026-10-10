import { configFor, distanceMeters, atLeast, accuracyOf, measuredSpeedMps, samePlaceGap } from './HistoryConfig';
import { phoneReliableSpeed } from '../locationTracker/PhoneMotion';
import { rawCoordinate } from '../placement/RawObservation';
import { hasFix } from '../placement/IndoorHold';

const travelMode = subject => (subject === 'phone' ? 'driving' : 'ride');
const footMode = subject => (subject === 'phone' ? 'walking' : 'moving');

/**
 * 判定表「開車段落」「狗坐車」「開車規則套到狗坐車」: the vehicle intervals of
 * a run of edges. Each is { start, end, firstEdge, lastEdge }.
 */
function detectVehicles(edges, config) {
  const scan = vehicleScan();
  for (let i = 0; i < edges.length; i += 1) stepVehicles(scan, edges, i, config);
  return finishVehicles(scan, edges, config);
}

/**
 * The vehicle detection one edge at a time (detectVehicles above), so today's
 * distance (TodayRouteEngine) can carry it on from where it stopped instead
 * of scanning the whole day again. `scan` is { high, active, low, vehicles }.
 */
export const vehicleScan = () => ({ high: null, active: null, low: null,
  footLow: null, parked: null, vehicles: [] });

// `exited`: confirmed walking or terminal parking (legacy: low speed), so
// its last fix is the first one outside the vehicle; ended by a gap or hold,
// its last fix was still
// in the car (判定表「開車和停留」: car fixes take no part in visits).
function closeVehicle(scan, edges, endIndex, exited = false) {
  scan.vehicles.push({ start: edges[scan.active].start, end: edges[endIndex].end,
    firstEdge: scan.active, lastEdge: endIndex, exited });
  scan.active = null; scan.low = null; scan.high = null;
  scan.footLow = null; scan.parked = null;
}

export function stepVehicles(scan, edges, i, config) {
  const edge = edges[i];
  if (edge.gap || edge.mode === 'indoor') {
    if (scan.active != null && (edge.mode === 'indoor' || edge.durationMs > config.maxVehicleGapMs
      || !atLeast(edge.speed, config.vehicleSpeed))) closeVehicle(scan, edges, i - 1);
    scan.high = null; scan.low = null; scan.footLow = null; scan.parked = null; return;
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
    // Phone replay decorates legacy geometry-only rows too. That derived state
    // does not prove the recorder supplied modern raw speed/motion evidence.
    // Explicit null raw speed is modern missing evidence, not a legacy fix.
    const recordedMotion = edge.to.raw_speed_kmh !== undefined
      || edge.to.speed_kmh !== undefined || edge.to.motion_state !== undefined;
    if (!config.stillMps || edge.to.phoneMotionState == null || !recordedMotion) {
      if (edge.end - edges[scan.low].start >= config.exitMs) closeVehicle(scan, edges, scan.low - 1, true);
    } else {
      // A red light is not getting out of the car. Require positive walking
      // evidence, rather than spending the exit clock on zero-speed fixes.
      const measured = phoneReliableSpeed(edge.to);
      const freshProgress = edge.to.phoneConfirmedMovement
        && Number.isFinite(edge.to.phoneDepartureSince)
        && edge.to.phoneDepartureSince >= edges[scan.low].start;
      const walking = !edge.to.phoneStationary && (measured != null
        ? measured >= config.stillMps && measured <= config.departureMaxSpeed
        : freshProgress && edge.speed >= config.stillMps
          && edge.speed <= config.departureMaxSpeed);
      if (walking) {
        if (scan.footLow == null) scan.footLow = i;
        const first = edges[scan.footLow].from;
        const raw = p => Number.isFinite(p.raw_latitude) && Number.isFinite(p.raw_longitude)
          ? { latitude: p.raw_latitude, longitude: p.raw_longitude } : p;
        const departure = edge.to.phoneConfirmedMovement && distanceMeters(raw(first), raw(edge.to))
          > Math.max(config.minMoveM, accuracyOf(first, config), accuracyOf(edge.to, config));
        if (departure || edge.end - edges[scan.footLow].start >= config.exitMs) {
          closeVehicle(scan, edges, scan.footLow - 1, true);
          return;
        }
      } else scan.footLow = null;
      // Keep a pending long light; cap its lifetime at the existing vehicle
      // interruption bound. finishVehicles can display terminal parking sooner.
      if (edge.to.phoneStationary && measured != null && measured < config.stillMps) {
        if (scan.parked == null) scan.parked = i;
        if (edge.end - edges[scan.parked].start >= config.maxVehicleGapMs)
          closeVehicle(scan, edges, scan.parked - 1, true);
      } else scan.parked = null;
    }
  } else { scan.low = null; scan.footLow = null; scan.parked = null; }
}

/** The vehicles found, a vehicle still going closed at the data's end. */
export function finishVehicles(scan, edges, config = configFor('phone')) {
  if (scan.active != null) {
    // A terminal stationary interval can display a stay without committing
    // an exit in the reusable scan. A long red light can still resume driving.
    const parked = scan.parked != null && edges.at(-1).end - edges[scan.parked].start >= config.stayMs;
    closeVehicle(scan, edges, parked ? scan.parked - 1 : edges.length - 1, parked);
  }
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
 * Where counting a run stands between two edges: `anchor` is the last COUNTED
 * fix the next move is measured from, `budget` how far the phone's own
 * measured speeds say it went since that fix (config.speedBudget, phone only;
 * Infinity once a fix has no speed). Today's distance (TodayRouteEngine)
 * keeps one at the last edge that can no longer change, so a day of
 * uninterrupted walking is not added up again every poll.
 */
export const countState = () => ({ anchor: null, budget: 0 });

// The step's speed for the budget: the speed measured at the fix it
// reaches; a long step (over 10 s, sparse fixes) also takes the speed it
// left with, so a walk that ends on a fix taken standing still still counts
// (Codex review, 067). null when neither fix has one.
function phoneBudgetSpeed(point) {
  const speed = phoneReliableSpeed(point), spread = point.speed_accuracy_mps;
  // A noisy speed is accepted only because its lower bound proves progress.
  // Spend that bound, rather than crediting the full uncertain estimate.
  return speed != null && Number.isFinite(spread) && spread > 1.5
    ? Math.max(0, speed - spread) : speed;
}

function stepSpeed(edge) {
  if (edge.phoneSpeedEvidence != null && phoneReliableSpeed(edge.to) == null)
    return phoneBudgetSpeed(edge.from) ?? edge.phoneSpeedEvidence;
  const measured = edge.to.phoneMotionState != null ? phoneBudgetSpeed : measuredSpeedMps;
  const to = measured(edge.to);
  // Both endpoint measurements must remain credible; unknown endpoints are
  // interrupted edges and never reach the distance budget.
  const from = edge.durationMs > 10000 ? measured(edge.from) : null;
  if (to == null && (edge.durationMs <= 10000 || from == null)) return to == null && from == null ? null : to ?? from;
  return Math.max(to ?? 0, from ?? 0);
}

/** countDistances below for one edge, carrying `state` (countState). */
export function countEdge(state, edge, config) {
  if (edge.mode !== 'walking' && edge.mode !== 'moving') {
    edge.countedDistanceM = 0; state.anchor = null; return;
  }
  if (!state.anchor) { state.anchor = edge.from; state.budget = 0; }
  if (edge.from.phoneStationary && !edge.to.phoneStationary) {
    state.anchor = edge.from; state.budget = 0;
  }
  // Confirmed phone stationarity spends no old speed budget. A missing speed
  // earlier in the run must not turn a later stationary fix into movement.
  if (edge.to.phoneStationary) {
    edge.countedDistanceM = 0; state.anchor = edge.to; state.budget = 0; return;
  }
  // A break at one place (samePlaceGap) is no walk.
  if (edge.bridged) { edge.countedDistanceM = 0; return; }
  const speed = config.speedBudget && !edge.to.phoneConfirmedMovement ? stepSpeed(edge) : null;
  // A geometry-confirmed step cannot leave unlimited credit for later phone
  // observations whose own speed contradicts travel. Fresh proof is required.
  if (edge.to.phoneMotionState != null && !edge.to.phoneConfirmedMovement
    && speed != null && !Number.isFinite(state.budget)) state.budget = 0;
  // Speeds under stillMps are a phone standing still (measurement noise).
  state.budget += speed == null ? Infinity : speed < config.stillMps ? 0 : speed * (edge.durationMs / 1000);
  const moved = distanceMeters(state.anchor, edge.to);
  const threshold = Math.max(config.minMoveM, accuracyOf(state.anchor, config), accuracyOf(edge.to, config));
  // 067: indoors all day the position drifts 50–110 m for minutes while the
  // phone measures 0–1 km/h. A move the measured speeds cannot cover (half
  // again what they add up to, plus minMoveM) is drift: it neither counts
  // nor becomes the anchor.
  if (moved > threshold && moved <= state.budget * 1.5 + config.minMoveM) {
    edge.countedDistanceM = moved; state.anchor = edge.to; state.budget = 0;
  } else edge.countedDistanceM = 0;
}

/**
 * 判定表「距離怎麼加」: the range is cut into runs of continuous walking (or
 * a dog's movement), broken by a gap over 3 minutes, a vehicle or an indoor
 * hold. The first fix of a run is only a reference; each later fix is
 * compared with the last COUNTED one and counts once it is farther than the
 * larger accuracy of the two (at least 5 m, 10 m without an accuracy). The
 * distance lands on the edge that crossed the threshold. `state` carries a
 * run on from an earlier call (TodayRouteEngine); without one each call
 * starts a fresh run.
 */
export function countDistances(edges, config = configFor('dog'), state = countState()) {
  for (const edge of edges) countEdge(state, edge, config);
  return edges;
}

/** One fix-to-fix step, as historyMovement and today's distance (TodayRouteEngine) see it. */
export function historyEdge(from, to, subject = 'dog', config = configFor(subject)) {
  let missingReleaseFix = false;
  // A released display hold starts at its measured raw fix, never its anchor.
  if (from.heldReason && !to.heldReason) {
    const raw = rawCoordinate(from);
    if (hasFix(raw)) from = { ...from, ...raw };
    else missingReleaseFix = true;
  }
  const durationMs = to.time - from.time;
  if (from.phoneStationary && !to.phoneStationary && Number.isFinite(from.raw_latitude)
    && Number.isFinite(from.raw_longitude)) from = { ...from,
      latitude: from.raw_latitude, longitude: from.raw_longitude };
  const distanceM = missingReleaseFix ? 0 : distanceMeters(from, to);
  // 067: a break at one place is part of the stay there, not a gap.
  const bridged = !missingReleaseFix && samePlaceGap(from, to, config);
  // One missed speed in an otherwise measured walk may use the immediately
  // preceding reliable speed for at most ten seconds, never across a gap.
  const modernPhone = subject === 'phone' && to.phoneMotionState != null
    && ('raw_speed_kmh' in to || 'speed_kmh' in to || 'speed_accuracy_mps' in to);
  const phoneSpeedEvidence = modernPhone ? phoneReliableSpeed(to) ??
    ((to.raw_speed_kmh === undefined ? to.speed_kmh : to.raw_speed_kmh) == null && durationMs <= 10000
      ? phoneReliableSpeed(from) : null) : null;
  const uncertain = modernPhone && !bridged && !to.phoneStationary
    && !to.phoneConfirmedMovement && phoneSpeedEvidence == null;
  return { from, to, start: from.time, end: to.time, durationMs, distanceM, bridged,
    speed: distanceM / (durationMs / 1000), uncertain, phoneSpeedEvidence,
    gap: missingReleaseFix || uncertain || (durationMs > config.gapMs && !bridged),
    ...(missingReleaseFix ? { gapReason: 'no-gps' } : {}),
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
