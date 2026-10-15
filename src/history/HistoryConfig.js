// v3 stops.txt and spec.txt 判定表. Times are UTC milliseconds; day bounds
// are supplied by the caller in the phone's current timezone (including DST).
const common = { radiusM: 25, leaveMs: 20000, stayMs: 180000, stayRatio: 3,
  minVisits: 5, gapMs: 180000, mergeGapMs: 600000, maxVehicleGapMs: 1800000,
  accuracyM: 50, stayAccuracyM: 25, exitSpeed: 4, departureMinSpeed: 0.3,
  // 判定表「距離怎麼加」: a move counts once it exceeds the larger accuracy of
  // the two fixes, at least 5 m; 「缺誤差值的位置」 counts as 10 m.
  minMoveM: 5, missingAccuracyM: 10,
  // 判定表「恢復記錄節點」: after a break longer than this the list adds a
  // 恢復記錄 node at the first fix after it.
  resumeAfterMs: 1800000,
  // 2026-10-13 (user): in the list, a break inside one recording session
  // shorter than this is no row of its own — its minutes go to the stay or
  // walk beside it, with no note (inside a stay: no 「不含中斷」). Longer
  // ones, and every session change, stay 「沒有資料」／「GPS 訊號弱」 rows.
  listGapMs: 30 * 60000,
  // 067 (user 2026-10-09): a break whose two ends are at the same place
  // (within radiusM) is one continuous stay, up to this long — no 「沒有資料」
  // row, no 恢復記錄 node (battery saving stops a phone overnight; the user's
  // breaks at home were 72–130 min, many in a row).
  samePlaceGapMaxMs: 16 * 3600000,
  // 067: a visit this long is a stay even before five visits give a baseline
  // (a phone at home all day has only a few, very long visits).
  alwaysStayMs: 30 * 60000,
  // 067: a hold the dog walked on out of — its next real fix this far from
  // the hold spot (IndoorHold releases at travelReleaseM 80 m) — was
  // 「收不到 GPS」 while moving, not a stay.
  movedOnM: 150 };
export const HISTORY_CONFIG = Object.freeze({
  // stillMps (phone only): a fix whose own measured speed is under this, with
  // a speed accuracy within stillSpeedAccuracyMps, was taken standing still
  // (067: indoors all day the position drifts 50–110 m for minutes while the
  // speed says 0–0.9 km/h; walking measures 1 m/s and more).
  // 2026-10-14 (user): the phone has no 「≥ 一般的 3 倍」 baseline
  // (stayRatio null): a visit of stayMs is a stay. On real days the baseline
  // rose to 4–16 min once the red lights of misread drives were no visits,
  // and 4–17 min stops of a dog walk lost their numbers. The dog keeps it.
  phone: Object.freeze({ ...common, stayRatio: null, maxSpeed: 50, vehicleSpeed: 5,
    enterMs: 30000, exitMs: 30000, departureMaxSpeed: 3, backtrackSpeed: 4,
    stillMps: 0.3, stillSpeedAccuracyMps: 1.5, speedBudget: true,
    // 2026-10-15 (#200, 出發偵測, HistoryDeparture): the minute-three move
    // must be over 40 m beyond the accuracy of both fixes (a lift at home);
    // the departure goes back to where the walk left the last stay, at most
    // this far before the candidate (a stop-and-go dog walk).
    departureBeyondAccuracy: true, departureWalkBackMs: 10 * 60000,
    // 2026-10-15 (user, #200): a stay's own moves are shown on it; only those
    // within edgeMoveMs of arriving or setting off are the walk's beside it.
    // A stay whose own moves add up to wanderM or more over wanderMinutes
    // distinct minutes or more is 「在附近走動」 (a walk round one place: on
    // 10/11 210 m over 16 minutes of 109; the most of any other stay on the
    // four real days was 135 m over 5 minutes).
    edgeMoveMs: 60000, wanderM: 100, wanderMinutes: 10,
    // samePlaceGap between two still fixes (IndoorHold's anchorCheckM).
    stillPlaceM: 100,
    // 2026-10-13 (user): two stays at one place with a short real walk
    // between them are one stay when the walk lasts at most excursionMs, and
    // both its farthest fix and the second stay lie within the first stay's
    // radius: excursionAccuracyFactor × its accuracy, clamped to
    // [excursionMinM, excursionMaxM] (never the 100 m of stillPlaceM).
    excursionMs: 5 * 60000, excursionAccuracyFactor: 2, excursionMinM: 30, excursionMaxM: 50,
    // 2026-10-14 (user: a lift ride counted 240 m on a day at home): a
    // counted trip from a stationary fix that is stationary again within
    // excursionMs and stillPlaceM of where it set off is drift (countEdge),
    // unless this many of its counted steps reach a fine walking fix
    // (walkFix). One: on the 14 real days every trip with one was a walk.
    driftWalkFixes: 1,
    // 2026-10-13 (user, distance): 「距離怎麼加」 on a walk the detector
    // confirms. Between two fixes both in the moving state, both within
    // fineMoveAccuracyM and both measuring at least fineMoveSpeedMps, a move
    // counts from fineMoveM (instead of minMoveM and the accuracy) when it is
    // at least fineMoveProgress of the distance the measured speeds add up to
    // since the last counted fix: the 5 m chord from the last counted fix cut
    // about 0.5 % off a 4.4 km walk at 4 m accuracy. Drift never meets these
    // (it is stationary, coarse, slow, or gets nowhere for its speed).
    fineMoveM: 2, fineMoveAccuracyM: 10, fineMoveSpeedMps: 0.5, fineMoveProgress: 0.75,
    // Confirmed movement (phoneConfirmedMovement: no speed budget) on a fix
    // coarser than this, claiming no walking speed of its own (none, or over
    // departureMaxSpeed), is no evidence of distance: indoors the phone
    // confirms "movement" on Wi-Fi/elevator fixes of 20–40 m at 15–27 km/h
    // (one day: 30 m + 47 m at home). It, and the coarser-than-this fixes
    // after it until a finer fix or a stop, count nothing and do not move the
    // anchor. 20 m: on three days of real walks it removed every such count
    // and no walk changed; 25 m kept the 47 m, 10 m dropped two short walks.
    coarseConfirmedAccuracyM: 20,
    // A walk step uses the recorder's per-second odometer (odometer_m, same
    // session) instead of the chord when it is longer, up to this many times
    // the chord plus minMoveM (and the speed budget).
    odometerMaxRatio: 1.5,
    // 2026-10-14 (user, stays between drives): stop-and-go traffic is one
    // drive. While no vehicle is going, a run of fast edges of at least
    // vehicleBurstMs is a burst; a vehicle that just ended, or bursts, go on
    // as the same trip when another burst comes within vehicleMergeMs of the
    // last one and the phone walked less than vehicleFootMs in between
    // (steps measured stillMps to vehicleFootMaxMps, counted once it is
    // vehicleFootM from where the last piece ended). Bursts adding up to
    // enterMs are a vehicle. A stay between two such pieces is shorter than
    // vehicleMergeMs: it is part of the drive (a red light, a jam). On real
    // days: a scooter in town (bursts of 11–32 s between lights) and a jam
    // whose 10 s creep ended the drive; an errand of 12.8 min between two
    // drives stays a stay.
    vehicleMergeMs: 10 * 60000, vehicleBurstMs: 10000, vehicleFootMs: 90000,
    vehicleFootMaxMps: 2, vehicleFootM: 30,
    // 2026-10-14 (user, a slow car read as walking): a steady 15–18 km/h
    // is a vehicle — a bike, or a car in slow traffic — not a walk or a run.
    // Fast edges (vehicleSpeed, 18 km/h) start a vehicle after enterMs; a
    // cruise does after cruiseMs: every edge at least cruiseSpeed (15 km/h,
    // a 4:00 /km pace) by geometry, every fix within
    // coarseConfirmedAccuracyM, and the run getting somewhere (from its first
    // fix at least cruiseProgress of the path it drew). A brisk walk or a jog
    // (6–12 km/h) is far below it; a sprint after the dog is over long before
    // two minutes; drift (coarse, or wandering about one spot) gets nowhere.
    cruiseSpeed: 15 / 3.6, cruiseMs: 2 * 60000, cruiseProgress: 0.5 }),
  dog: Object.freeze({ ...common, maxSpeed: 15, vehicleSpeed: 9,
    enterMs: 60000, exitMs: 60000, departureMaxSpeed: 15, backtrackSpeed: null }),
});
export const configFor = (subject = 'dog') => HISTORY_CONFIG[subject];
export function distanceMeters(a, b) {
  const rad = Math.PI / 180;
  const dlat = (b.latitude - a.latitude) * rad;
  const dlon = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(a.latitude * rad)
    * Math.cos(b.latitude * rad) * Math.sin(dlon / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
export const coordinateValid = p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude)
  && Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180
  && !(p.latitude === 0 && p.longitude === 0);
export function median(values) {
  const sorted = [...values].sort((a, b) => a - b), n = sorted.length;
  return n ? (sorted[Math.floor(n / 2)] + sorted[Math.floor((n - 1) / 2)]) / 2 : null;
}

/**
 * A fix measured standing still: its own speed (raw_speed_kmh, else
 * speed_kmh) under config.stillMps, with a speed accuracy within
 * config.stillSpeedAccuracyMps. Without a speed or its accuracy, or for a
 * subject without stillMps, it says nothing (false).
 */
export function stillFix(p, config) {
  if (!config?.stillMps || !p) return false;
  const number = value => (value == null || value === '' ? null
    : Number.isFinite(Number(value)) ? Number(value) : null);
  const kmh = number(p.raw_speed_kmh) ?? number(p.speed_kmh);
  const spread = number(p.speed_accuracy_mps);
  if (kmh == null || kmh < 0 || spread == null || spread < 0) return false;
  return kmh / 3.6 < config.stillMps && spread <= config.stillSpeedAccuracyMps;
}

const recordingSession = p => (typeof p?.session_id === 'string' && p.session_id.length > 0
  ? p.session_id : null);

/**
 * Two phone fixes from different recording sessions (session_id is a new UUID
 * every time the recorder starts: an app update, the process killed, the
 * recording switched off and on). Only when both ends carry a session; a fix
 * without one (older rows, a dog) proves nothing either way.
 */
export function recordingSessionChanged(a, b) {
  const from = recordingSession(a), to = recordingSession(b);
  return from != null && to != null && from !== to;
}

/**
 * A break longer than gapMs (and at most samePlaceGapMaxMs) whose two ends are
 * at the same place (within radiusM): one continuous stay, not 「沒有資料」.
 *
 * Phone: never across a recording session change. The recorder was not
 * running for (part of) that time, so the time cannot be proven a stay; the
 * list shows it as 「沒有資料」 (PR 116) and the stay is split there or the
 * break is deducted as an interruption. `acrossSessions` asks only whether
 * the two ends are one place (distance counting: no walk across the break).
 */
export function samePlaceGap(a, b, config, { acrossSessions = false } = {}) {
  if (!a || !b || !config?.samePlaceGapMaxMs) return false;
  const dt = b.time - a.time;
  if (!(dt > config.gapMs && dt <= config.samePlaceGapMaxMs)) return false;
  if (config.stillMps && (a.phoneConfirmedMovement || b.phoneConfirmedMovement)) return false;
  if (config.stillMps && !acrossSessions && recordingSessionChanged(a, b)) return false;
  // A display lock may be far behind the last fix before a recording gap.
  // Gap identity uses the observed endpoints, not a synthetic lock-to-raw jump.
  const raw = p => config.stillMps && Number.isFinite(p.raw_latitude) && Number.isFinite(p.raw_longitude)
    ? { latitude: p.raw_latitude, longitude: p.raw_longitude } : p;
  const apart = distanceMeters(raw(a), raw(b));
  if (!(apart > config.radiusM + 1e-8)) return true;
  // Both ends measured standing still (the phone's own speed): indoors the
  // position drifts tens of metres while the phone stays put; within
  // stillPlaceM it is the same place. 2026-10-13: an end without a measured
  // speed (and without confirmed movement, checked above) says nothing of
  // moving either, so it is as still as a measured one here.
  return !!config.stillPlaceM && quietFix(a, config) && quietFix(b, config) && apart <= config.stillPlaceM;
}

/**
 * 2026-10-13 (phone): a fix that shows no movement — no confirmed movement
 * from the detector, and measured standing still (stillFix) or without any
 * measured speed. Indoors many fixes come without a speed while the position
 * drifts tens of metres: within stillPlaceM of a place they are still that
 * place. A usable measured speed that is not stillFix is not this: it may be
 * a walk. 2026-10-15 (#200): a speed lost in its uncertainty is no usable
 * speed (measuredSpeedMps), so such a fix is quiet.
 */
export function quietFix(p, config) {
  if (!config?.stillMps || !p || p.phoneConfirmedMovement) return false;
  if (stillFix(p, config)) return true;
  // Only a recorder that measures speed (and the motion replay) can say a
  // fix came without one; older rows have no speed column at all, and their
  // movement is told by geometry alone.
  const recordsSpeed = 'raw_speed_kmh' in p || 'speed_kmh' in p || 'speed_accuracy_mps' in p;
  return recordsSpeed && p.phoneMotionState != null && measuredSpeedMps(p) == null;
}

/**
 * The fix's own measured speed in m/s (raw_speed_kmh, else speed_kmh), or
 * null when the phone did not measure one.
 *
 * 2026-10-15 (user, #200): or when its uncertainty swallows it — a speed
 * accuracy over UNCERTAIN_SPEED_MPS (1.5 m/s, stillSpeedAccuracyMps) whose
 * lower bound (speed minus accuracy) is not over 0.5 m/s, e.g. 0 km/h ± 2 m/s
 * indoors: that says nothing about standing or walking, so it is no speed,
 * the same rule as phoneReliableSpeed (PhoneMotion). A fast speed whose
 * lower bound still clears 0.5 m/s stays a speed.
 */
const UNCERTAIN_SPEED_MPS = 1.5, CLEAR_SPEED_MPS = 0.5;
export function measuredSpeedMps(p) {
  const number = value => (value == null || value === '' ? null
    : Number.isFinite(Number(value)) ? Number(value) : null);
  const kmh = number(p?.raw_speed_kmh) ?? number(p?.speed_kmh);
  if (kmh == null || kmh < 0) return null;
  const spread = number(p?.speed_accuracy_mps);
  if (spread != null && spread > UNCERTAIN_SPEED_MPS && !(kmh / 3.6 - spread > CLEAR_SPEED_MPS + 1e-6)) return null;
  return kmh / 3.6;
}

/** 判定表「缺誤差值的位置」: a fix without an accuracy counts as 10 m. */
export const accuracyOf = (p, config = HISTORY_CONFIG.dog) => (Number.isFinite(p?.accuracy) && p.accuracy >= 0
  ? p.accuracy : config.missingAccuracyM);

// Coordinate-to-speed math has sub-nanometre rounding noise at inclusive bounds.
export const atLeast = (value, threshold) => value >= threshold - 1e-8;
export const above = (value, threshold) => value > threshold + 1e-8;
