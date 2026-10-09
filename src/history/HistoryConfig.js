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
  resumeAfterMs: 1800000 };
export const HISTORY_CONFIG = Object.freeze({
  // stillMps (phone only): a fix whose own measured speed is under this, with
  // a speed accuracy within stillSpeedAccuracyMps, was taken standing still
  // (067: indoors all day the position drifts 50–110 m for minutes while the
  // speed says 0–0.9 km/h; walking measures 1 m/s and more).
  phone: Object.freeze({ ...common, maxSpeed: 50, vehicleSpeed: 5,
    enterMs: 30000, exitMs: 30000, departureMaxSpeed: 3, backtrackSpeed: 4,
    stillMps: 0.3, stillSpeedAccuracyMps: 1.5, speedBudget: true }),
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

/**
 * The fix's own measured speed in m/s (raw_speed_kmh, else speed_kmh), or
 * null when the phone did not measure one.
 */
export function measuredSpeedMps(p) {
  const number = value => (value == null || value === '' ? null
    : Number.isFinite(Number(value)) ? Number(value) : null);
  const kmh = number(p?.raw_speed_kmh) ?? number(p?.speed_kmh);
  return kmh == null || kmh < 0 ? null : kmh / 3.6;
}

/** 判定表「缺誤差值的位置」: a fix without an accuracy counts as 10 m. */
export const accuracyOf = (p, config = HISTORY_CONFIG.dog) => (Number.isFinite(p?.accuracy) && p.accuracy >= 0
  ? p.accuracy : config.missingAccuracyM);

// Coordinate-to-speed math has sub-nanometre rounding noise at inclusive bounds.
export const atLeast = (value, threshold) => value >= threshold - 1e-8;
export const above = (value, threshold) => value > threshold + 1e-8;
