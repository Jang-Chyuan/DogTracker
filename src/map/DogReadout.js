// What one dog row says, as plain values. Pure: no React, no clock of its own.
//
// A handler needs four things from a row: which way and how far the dog is
// from them, whether that position is current, whether the dog is moving, and
// whether its battery is about to run out. Source, Master and raw speed are
// details for the panel.

const EARTH_METRES = 6371000;
const rad = degrees => (degrees * Math.PI) / 180;

// Great-circle distance and initial bearing (0 = north, clockwise).
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

// "8 m", "120 m", "1.2 km". Five-metre steps: GPS cannot do better, and a
// number that flickers by one metre every second only distracts.
export function formatDistance(metres) {
  if (metres < 10) return `${Math.max(0, Math.round(metres))} m`;
  if (metres < 1000) return `${Math.round(metres / 5) * 5} m`;
  return `${(metres / 1000).toFixed(metres < 10000 ? 1 : 0)} km`;
}

// Moving, still or unknown. Without a current fix and a speed it is unknown —
// never "still", which would tell the handler the dog has stopped.
export const MOVING_KMH = 1;
export function movement(dog, freshness) {
  if (freshness !== 'fresh' || !Number.isFinite(dog?.speedKmh)) return 'unknown';
  // A state settled over several packets (settleMovement) wins over a single
  // reading, so a dog walking at about 1 km/h does not flicker.
  if (dog.movementState === 'moving' || dog.movementState === 'still') return dog.movementState;
  return dog.speedKmh >= MOVING_KMH ? 'moving' : 'still';
}

// Hysteresis around MOVING_KMH: start moving above 1.5 km/h, stop below
// 0.5 km/h; in between the previous state holds. GPS speed jitters by about
// half a km/h when a dog stands still.
export const START_MOVING_KMH = 1.5;
export const STOP_MOVING_KMH = 0.5;
export function settleMovement(previous, speedKmh) {
  if (!Number.isFinite(speedKmh)) return null;
  if (speedKmh >= START_MOVING_KMH) return 'moving';
  if (speedKmh <= STOP_MOVING_KMH) return 'still';
  if (previous === 'moving' || previous === 'still') return previous;
  return speedKmh >= MOVING_KMH ? 'moving' : 'still';
}

export const MOVEMENT_WORDS = { moving: '移動中', still: '靜止', unknown: '狀態未知' };

export const LOW_BATTERY = 20;
export const lowBattery = dog =>
  Number.isFinite(dog?.batteryPercentage) && dog.batteryPercentage <= LOW_BATTERY;

function clock(at) {
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

// When the position is from, in words that do not tick every second: a fix
// under two minutes old is simply current.
export function positionAge(dog, freshness, now) {
  if (!dog?.coordinate || freshness === 'gone') return '無定位';
  if (freshness === 'fresh') return '即時';
  const at = dog.lastPositionAt;
  if (freshness === 'recent') return `${Math.floor((now - at) / 60000)} 分鐘前`;
  return clock(at);
}

// Direction and distance from the phone, or why there is none.
//   { kind: 'ok', bearing, distance }  bearing already turned for the map
//   { kind: 'no-dog' }                 the dog has no position
//   { kind: 'no-phone' }               the phone has no current fix
export function fromPhone(dog, phone, mapHeading = 0) {
  if (!dog?.coordinate) return { kind: 'no-dog' };
  if (!phone) return { kind: 'no-phone' };
  const { metres, bearing } = bearingAndDistance(phone, dog.coordinate);
  // The arrow is drawn on a map that may be rotated: north on screen is the
  // map's heading, not the top of the phone. Speech uses the true bearing.
  return {
    kind: 'ok',
    bearing: (bearing - mapHeading + 360) % 360,
    compass: compassWord(bearing),
    distance: formatDistance(metres),
  };
}

// Eight compass words for TalkBack, which cannot see the arrow.
const COMPASS = ['北', '東北', '東', '東南', '南', '西南', '西', '西北'];
export function compassWord(bearing) {
  return COMPASS[Math.round((((bearing % 360) + 360) % 360) / 45) % 8];
}

// The phone fix the rows measure from: the live tracker's. Under 30 s it is
// current; up to 10 minutes it still gives a direction, and the card says how
// old it is ("手機位置 2 分鐘前", design 2); older than that it is no fix.
export const PHONE_FIX_MAX_AGE_S = 30;
export const PHONE_FIX_USABLE_S = 10 * 60;
export function phoneFix(livePhone) {
  if (!livePhone?.running || livePhone.ageSeconds == null || livePhone.ageSeconds > PHONE_FIX_USABLE_S)
    return null;
  const position = livePhone.position;
  if (!Number.isFinite(position?.latitude) || !Number.isFinite(position?.longitude)) return null;
  return { ...position, ageSeconds: livePhone.ageSeconds };
}

// What the card says once about the phone's own position, or '' when it is
// current. Minutes only: nothing on screen counts seconds.
export function phoneNote(phone) {
  if (!phone) return '手機無定位，無法顯示距離';
  if (!(phone.ageSeconds > PHONE_FIX_MAX_AGE_S)) return '';
  return `手機位置 ${Math.max(1, Math.floor(phone.ageSeconds / 60))} 分鐘前`;
}
