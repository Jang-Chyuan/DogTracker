import { configFor, distanceMeters, atLeast, accuracyOf, measuredSpeedMps, samePlaceGap,
  recordingSessionChanged } from './HistoryConfig';
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
  footLow: null, parked: null, chain: null, vehicles: [] });

// 2026-10-14 (phone, config.vehicleMergeMs): stop-and-go traffic. A car or
// scooter in town moves in bursts of 10–30 s between lights and crawls in
// jams; a crawl at walking pace reads as getting out (the exit below), and a
// burst shorter than enterMs never starts a vehicle. `scan.chain` is the
// vehicle evidence the scan has just seen while no vehicle is going: a
// vehicle that just ended (`vehicle: true`) or bursts (runs of fast edges of
// at least vehicleBurstMs, `highMs` adding them up). It lasts vehicleMergeMs
// from the end of the last piece and breaks on foot evidence (a walk:
// footEdge time of at least vehicleFootMs, once the phone got farther than
// vehicleFootM from where that piece ended), an indoor hold or a recording
// session change. Another burst within it is the same trip: a vehicle that
// ended goes on (its exit was a red light, a jam or a weak fix), and bursts
// adding up to enterMs are a vehicle from the first one. A stay between two
// such pieces is shorter than vehicleMergeMs and becomes part of the drive.
// The chain object is replaced, never changed, so a copy of the scan
// (TodayRouteEngine's checkpoint) keeps its own.
const rawPoint = p => (Number.isFinite(p?.raw_latitude) && Number.isFinite(p?.raw_longitude)
  ? { latitude: p.raw_latitude, longitude: p.raw_longitude } : p);
// Phone: a fast edge is fast by geometry, or by the phone's own measured
// speed when the geometry is at least backtrackSpeed (one fix's jitter must
// not cut a burst; a still phone's speed noise has no geometry behind it).
function fastEdge(edge, config) {
  if (atLeast(edge.speed, config.vehicleSpeed)) return true;
  if (!config.vehicleMergeMs || config.backtrackSpeed == null || !atLeast(edge.speed, config.backtrackSpeed)) return false;
  const measured = phoneReliableSpeed(edge.to);
  return measured != null && atLeast(measured, config.vehicleSpeed);
}
// A step on foot: measured at walking pace (stillMps to vehicleFootMaxMps),
// not held stationary. A crawl in a jam reads the same; only its length tells.
function footEdge(edge, config) {
  if (edge.gap || edge.mode === 'indoor' || edge.to.phoneStationary) return false;
  const measured = phoneReliableSpeed(edge.to);
  return measured != null && measured >= config.stillMps && measured <= config.vehicleFootMaxMps;
}
function chainFoot(chain, edge, config) {
  if (!footEdge(edge, config)) return chain;
  const far = chain.far || distanceMeters(rawPoint(chain.anchor), rawPoint(edge.to))
    > Math.max(config.vehicleFootM, accuracyOf(chain.anchor, config), accuracyOf(edge.to, config));
  const footMs = chain.footMs + edge.durationMs;
  return far && footMs >= config.vehicleFootMs ? null : { ...chain, footMs, far };
}
// After a vehicle ended at lastEdge (exited on foot from footFrom on): the
// foot window that ended it counts as foot evidence already.
function chainAfter(edges, lastEdge, footFrom, endIndex, config) {
  if (!config.vehicleMergeMs) return null;
  let chain = { vehicle: true, lastEnd: edges[lastEdge].end, anchor: edges[lastEdge].to,
    footMs: 0, far: false, highMs: 0, first: null };
  for (let j = footFrom; j != null && j <= endIndex && chain; j += 1) chain = chainFoot(chain, edges[j], config);
  return chain;
}
// Re-open the vehicle the chain holds (the last one found).
function reopenVehicle(scan) {
  const vehicle = scan.vehicles[scan.vehicles.length - 1];
  scan.vehicles = scan.vehicles.slice(0, -1);
  scan.active = vehicle.firstEdge;
  scan.chain = null; scan.high = null; scan.low = null; scan.footLow = null; scan.parked = null;
}
function backtrack(edges, index, config) {
  let start = index;
  if (config.backtrackSpeed != null) {
    while (start > 0 && !edges[start - 1].gap && edges[start - 1].mode !== 'indoor'
      && atLeast(edges[start - 1].speed, config.backtrackSpeed)) start -= 1;
  }
  return start;
}

// `exited`: confirmed walking or terminal parking (legacy: low speed), so
// its last fix is the first one outside the vehicle; ended by a gap or hold,
// its last fix was still
// in the car (判定表「開車和停留」: car fixes take no part in visits).
function closeVehicle(scan, edges, endIndex, exited = false) {
  scan.vehicles = [...scan.vehicles, { start: edges[scan.active].start, end: edges[endIndex].end,
    firstEdge: scan.active, lastEdge: endIndex, exited }];
  scan.active = null; scan.low = null; scan.high = null;
  scan.footLow = null; scan.parked = null; scan.chain = null;
}

export function stepVehicles(scan, edges, i, config) {
  const edge = edges[i];
  const merging = !!config.vehicleMergeMs;
  // The chain ends vehicleMergeMs after its last piece, at a hold and where
  // the recorder was off (a session change).
  if (scan.chain && (edge.end - scan.chain.lastEnd > config.vehicleMergeMs || edge.mode === 'indoor'
    || recordingSessionChanged(edge.from, edge.to))) scan.chain = null;
  if (edge.gap || edge.mode === 'indoor') {
    const closing = scan.active != null && (edge.mode === 'indoor' || edge.durationMs > config.maxVehicleGapMs
      || !atLeast(edge.speed, config.vehicleSpeed));
    if (scan.high != null && merging) registerBurst(scan, edges, i - 1, config);
    if (closing) {
      closeVehicle(scan, edges, i - 1);
      // A weak fix or a short break at a light: the trip may go on.
      if (merging && edge.mode !== 'indoor' && edge.durationMs <= config.maxVehicleGapMs
        && !recordingSessionChanged(edge.from, edge.to)) scan.chain = chainAfter(edges, i - 1, null, i, config);
    }
    scan.high = null; scan.low = null; scan.footLow = null; scan.parked = null; return;
  }
  if (scan.active == null) {
    if (merging ? fastEdge(edge, config) : atLeast(edge.speed, config.vehicleSpeed)) {
      if (scan.high == null) scan.high = i;
      const run = edge.end - edges[scan.high].start;
      const chain = scan.chain;
      if (run >= config.enterMs) {
        scan.active = backtrack(edges, scan.high, config);
        scan.high = null;
        if (chain?.vehicle) reopenVehicle(scan);
        else if (chain) { scan.active = Math.min(scan.active, chain.first); scan.chain = null; }
      } else if (chain && run >= config.vehicleBurstMs) {
        if (chain.vehicle) reopenVehicle(scan);
        else if (chain.highMs + run >= config.enterMs) {
          scan.active = chain.first; scan.chain = null; scan.high = null;
        }
      }
    } else {
      if (scan.high != null && merging) registerBurst(scan, edges, i - 1, config);
      scan.high = null;
      if (scan.chain) scan.chain = chainFoot(scan.chain, edge, config);
    }
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
          const footFrom = scan.footLow;
          closeVehicle(scan, edges, footFrom - 1, true);
          // A crawl in a jam reads as this walk: the trip may go on.
          scan.chain = chainAfter(edges, footFrom - 1, footFrom, i, config);
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

// A run of fast edges (scan.high to endIndex) that ended before enterMs: a
// burst when it lasted vehicleBurstMs, the first piece of a chain or the
// next one of a chain of bursts (a chain holding a vehicle re-opened it).
function registerBurst(scan, edges, endIndex, config) {
  const run = edges[endIndex].end - edges[scan.high].start;
  if (endIndex < scan.high || run < config.vehicleBurstMs) return;
  const chain = scan.chain && !scan.chain.vehicle ? scan.chain : null;
  scan.chain = { vehicle: false, first: chain ? chain.first : backtrack(edges, scan.high, config),
    highMs: (chain?.highMs ?? 0) + run, lastEnd: edges[endIndex].end, anchor: edges[endIndex].to,
    footMs: 0, far: false };
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
  // A chain may still turn the edges since its last piece into a drive.
  if (scan.active != null || scan.high != null || scan.chain != null) return false;
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
export const countState = () => ({ anchor: null, budget: 0, unproven: false });

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
  if (!state.anchor) { state.anchor = edge.from; state.budget = 0; state.unproven = false; }
  if (edge.from.phoneStationary && !edge.to.phoneStationary) {
    state.anchor = edge.from; state.budget = 0;
  }
  // Confirmed phone stationarity spends no old speed budget. A missing speed
  // earlier in the run must not turn a later stationary fix into movement.
  if (edge.to.phoneStationary) {
    edge.countedDistanceM = 0; state.anchor = edge.to; state.budget = 0; state.unproven = false; return;
  }
  // A break at one place (samePlaceGap) is no walk. Phone (2026-10-13): the
  // run goes on from where the phone was seen again (the place may span
  // stillPlaceM), so the drift across the break never counts later either.
  if (edge.bridged) {
    edge.countedDistanceM = 0;
    if (config.stillMps) { state.anchor = edge.to; state.budget = 0; state.unproven = false; }
    return;
  }
  // 2026-10-13: confirmed movement on a coarse fix claiming no walking
  // speed (indoors: Wi-Fi or elevator fixes of 20–40 m at 15–27 km/h, in
  // walking mode) is no evidence of distance. It counts nothing, spends the
  // speed budget and leaves the anchor where it was, and so do the coarse
  // fixes after it until a finer fix or a stop proves where the phone is. A
  // coarse walk measuring a walking speed of its own counts as before.
  if (state.unproven || junkDeparture(edge.to, config)) {
    if (coarseFix(edge.to, config)) {
      edge.countedDistanceM = 0; state.budget = 0; state.unproven = true; return;
    }
    state.unproven = false;
  }
  const speed = config.speedBudget && !edge.to.phoneConfirmedMovement ? stepSpeed(edge) : null;
  // A geometry-confirmed step cannot leave unlimited credit for later phone
  // observations whose own speed contradicts travel. Fresh proof is required.
  if (edge.to.phoneMotionState != null && !edge.to.phoneConfirmedMovement
    && speed != null && !Number.isFinite(state.budget)) state.budget = 0;
  // Speeds under stillMps are a phone standing still (measurement noise).
  state.budget += speed == null ? Infinity : speed < config.stillMps ? 0 : speed * (edge.durationMs / 1000);
  const moved = distanceMeters(state.anchor, edge.to);
  // 2026-10-13: on a walk the detector confirms — the last counted fix fine
  // and measuring walking speed, the fix reached fine and still moving, and
  // the move at least fineMoveProgress of what the measured speeds add up
  // to since (a walk gets where its speed says; a phone wobbling in place
  // does not) — a move counts from fineMoveM. Only the anchor needs the
  // speed: the step into a stop still counts what the walk added since.
  const fine = fineWalk(state.anchor, config) && fineFix(edge.to, config)
    && Number.isFinite(state.budget) && moved >= state.budget * config.fineMoveProgress;
  const threshold = fine ? config.fineMoveM
    : Math.max(config.minMoveM, accuracyOf(state.anchor, config), accuracyOf(edge.to, config));
  // 067: indoors all day the position drifts 50–110 m for minutes while the
  // phone measures 0–1 km/h. A move the measured speeds cannot cover (half
  // again what they add up to, plus minMoveM) is drift: it neither counts
  // nor becomes the anchor.
  const limit = state.budget * 1.5 + config.minMoveM;
  if (moved > threshold && moved <= limit) {
    edge.countedDistanceM = odometerStep(state.anchor, edge.to, moved, limit, config);
    state.anchor = edge.to; state.budget = 0;
  } else edge.countedDistanceM = 0;
}

// A fix coarser than config.coarseConfirmedAccuracyM (phone only), and
// confirmed movement on one whose own speed is none or faster than walking.
const coarseFix = (point, config) => config.coarseConfirmedAccuracyM != null
  && accuracyOf(point, config) > config.coarseConfirmedAccuracyM;
function junkDeparture(point, config) {
  if (!point.phoneConfirmedMovement || !coarseFix(point, config)) return false;
  const speed = phoneReliableSpeed(point);
  return speed == null || speed > config.departureMaxSpeed;
}

// A fix of a walk the phone's detector confirms (moving state) within
// fineMoveAccuracyM (fineFix); fineWalk also measuring at least
// fineMoveSpeedMps beyond its speed accuracy. Phone only (config.fineMoveM).
const fineFix = (point, config) => config.fineMoveM != null && point?.phoneMotionState === 'moving'
  && Number.isFinite(point.accuracy) && point.accuracy >= 0 && point.accuracy <= config.fineMoveAccuracyM;
function fineWalk(point, config) {
  if (!fineFix(point, config)) return false;
  // The speed proven: less its own spread, when the phone gave one (a phone
  // jiggling in a hand reads 0.55 ± 0.5 m/s).
  const speed = phoneReliableSpeed(point), spread = point.speed_accuracy_mps;
  const proven = speed == null ? null : Number.isFinite(spread) && spread >= 0 ? speed - spread : speed;
  return proven != null && proven >= config.fineMoveSpeedMps;
}

/**
 * The recorder's running distance (odometer_m: the per-second fused fixes
 * of one recording, LocationPipeline) at a fix, or null without one.
 */
export function odometerAt(point) {
  const value = point?.odometer_m;
  if (value == null || value === '') return null;
  const metres = Number(value);
  return Number.isFinite(metres) && metres >= 0 ? metres : null;
}

// 2026-10-13 (user, distance): the distance a counted step adds. The chord
// from the last counted fix (`moved`) cuts every curve and corner between
// two saved fixes; when both carry the recorder's odometer of one session,
// the path it measured on the per-second fixes counts instead — never less
// than the chord, at most odometerMaxRatio times it plus minMoveM, and never
// more than the speed budget allows (`limit`). Rows without it (older rows,
// a dog, another session) keep the chord.
function odometerStep(anchor, to, moved, limit, config) {
  if (config.odometerMaxRatio == null) return moved;
  const a = odometerAt(anchor), b = odometerAt(to);
  if (a == null || b == null || !(b > a)) return moved;
  if (typeof anchor.session_id !== 'string' || anchor.session_id !== to.session_id) return moved;
  const path = Math.min(b - a, moved * config.odometerMaxRatio + config.minMoveM, limit);
  return path > moved ? path : moved;
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
  // Leaving a displayed hold (a dog's indoor hold, a phone's stationary
  // anchor) starts where the dog or phone was shown. Its raw fix was not
  // trusted while held: drift on the far side of the spot must not add its
  // distance (and a missing fix must not cut the walk out of the spot). The
  // raw fix is taken only when it already lies nearer the first released
  // fix, as when the release confirms a compact offset the GPS had settled on.
  if ((from.heldReason && !to.heldReason) || (from.phoneStationary && !to.phoneStationary)) {
    const raw = rawCoordinate(from);
    if (hasFix(raw) && distanceMeters(raw, to) < distanceMeters(from, to)) from = { ...from, ...raw };
  }
  const durationMs = to.time - from.time;
  const distanceM = distanceMeters(from, to);
  // 067: a break at one place is no walk and no gap of the route (distance,
  // vehicles, today's distance). Across a recording session change too: the
  // ends are one place either way. Whether the break is stay time is decided
  // by the visits (samePlaceGap without acrossSessions); the phone list shows
  // a bridge outside a stay as 「沒有資料」 (historyTimeline).
  const bridged = samePlaceGap(from, to, config, { acrossSessions: true });
  // One missed speed in an otherwise measured walk may use the immediately
  // preceding reliable speed for at most ten seconds, never across a gap.
  const modernPhone = subject === 'phone' && to.phoneMotionState != null
    && ('raw_speed_kmh' in to || 'speed_kmh' in to || 'speed_accuracy_mps' in to);
  const phoneSpeedEvidence = modernPhone ? phoneReliableSpeed(to) ??
    ((to.raw_speed_kmh === undefined ? to.speed_kmh : to.raw_speed_kmh) == null && durationMs <= 10000
      ? phoneReliableSpeed(from) : null) : null;
  // A coarse fix the detector could not place (unknown) whose own speed says
  // standing still is no walk either: 0 m of 「走路」 must not absorb minutes
  // of a phone standing indoors on Wi-Fi fixes.
  const stillUnplaced = to.phoneMotionState === 'unknown' && phoneSpeedEvidence != null
    && phoneSpeedEvidence < config.stillMps;
  const uncertain = modernPhone && !bridged && !to.phoneStationary
    && !to.phoneConfirmedMovement && (phoneSpeedEvidence == null || stillUnplaced);
  return { from, to, start: from.time, end: to.time, durationMs, distanceM, bridged,
    speed: distanceM / (durationMs / 1000), uncertain, phoneSpeedEvidence,
    // Weak GPS of a phone measuring itself still (not a walk, not placed).
    ...(modernPhone && uncertain && stillUnplaced ? { stillUnplaced: true } : {}),
    gap: uncertain || (durationMs > config.gapMs && !bridged),
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
