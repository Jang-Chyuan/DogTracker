// v3 stops.txt and spec.txt 判定表. Times are UTC milliseconds; day bounds
// are supplied by the caller in the phone's current timezone (including DST).
const common = { radiusM: 25, leaveMs: 20000, stayMs: 180000, stayRatio: 3,
  minVisits: 5, gapMs: 180000, mergeGapMs: 600000, maxVehicleGapMs: 1800000,
  accuracyM: 50, stayAccuracyM: 25, exitSpeed: 4, departureMinSpeed: 0.3 };
export const HISTORY_CONFIG = Object.freeze({
  phone: Object.freeze({ ...common, maxSpeed: 50, vehicleSpeed: 5,
    enterMs: 30000, exitMs: 30000, departureMaxSpeed: 3, backtrackSpeed: 4 }),
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

// Coordinate-to-speed math has sub-nanometre rounding noise at inclusive bounds.
export const atLeast = (value, threshold) => value >= threshold - 1e-8;
export const above = (value, threshold) => value > threshold + 1e-8;
