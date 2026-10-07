// Which way and how far a dog is from the phone, as plain values. Pure: no
// React, no clock of its own. (From PR #40's dog rows; the card A3 uses it.)

const EARTH_METRES = 6371000;
const rad = degrees => (degrees * Math.PI) / 180;

/** Great-circle distance (m) and initial bearing (degrees, 0 = north, clockwise). */
export function bearingAndDistance(from, to) {
  const φ1 = rad(from.latitude);
  const φ2 = rad(to.latitude);
  const Δφ = rad(to.latitude - from.latitude);
  const Δλ = rad(to.longitude - from.longitude);
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const metres = 2 * EARTH_METRES * Math.asin(Math.min(1, Math.sqrt(a)));
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const bearing = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return { metres, bearing };
}

/**
 * 「8 m」「120 m」「1.2 km」. Five-metre steps under a kilometre: GPS cannot do
 * better, and a number that flickers by one metre every second only
 * distracts.
 */
export function formatDistance(metres) {
  if (metres < 10) return `${Math.max(0, Math.round(metres))} m`;
  if (metres < 1000) {
    const rounded = Math.round(metres / 5) * 5;
    return rounded >= 1000 ? '1.0 km' : `${rounded} m`;
  }
  return `${(metres / 1000).toFixed(metres < 9950 ? 1 : 0)} km`;
}

// Eight compass words for TalkBack, which cannot see the arrow.
const COMPASS = ['北', '東北', '東', '東南', '南', '西南', '西', '西北'];
export function compassWord(bearing) {
  return COMPASS[Math.round((((bearing % 360) + 360) % 360) / 45) % 8];
}
