// 「今天 x km」 (design v3 A1/A2, 判定表「右下『今天 x km』」): how far this
// phone's own recorded route went today, and what the bottom-right pill says.
//
// Until departure detection lands (054), the range is today's whole recorded
// route. Pure functions: the hook (useTodayRoute) feeds them rows as they are
// recorded, a screen fixture feeds them invented rows.

import { distanceMeters } from './ReceiverRange';
import { PHONE_FIX_MAX_AGE_S } from '../map/MapFraming';
import { size } from '../theme/tokens';

// Where recording stopped for longer than this, the route is broken: the map
// draws no line across it (size.route.breakAfterMs) and nothing is counted.
export const ROUTE_GAP_MS = size.route.breakAfterMs;
// Faster than this between two counted points is a ride, not walking: the
// route keeps it but the distance does not (開車的段落不算距離). An interim
// rule until the driving segments of 054 replace it.
export const RIDE_SPEED_MPS = 25 / 3.6;

const valid = point => Number.isFinite(point?.latitude) && Number.isFinite(point?.longitude)
  && Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180
  && !(point.latitude === 0 && point.longitude === 0) && Number.isFinite(point?.time);

/** Nothing recorded yet. `day` is the local midnight the sum belongs to. */
export function emptyRouteDistance(day = null) {
  return Object.freeze({ day, metres: 0, count: 0, anchor: null, last: null });
}

/**
 * Adds recorded points (oldest first) to a running sum. A move counts once it
 * leaves the last counted point by more than the larger of the two fixes'
 * accuracy ("移動小於定位誤差的不算"), so standing still does not add up
 * jitter; a break longer than ROUTE_GAP_MS starts over from the next point.
 */
export function addRoutePoints(state, points) {
  let { metres, count, anchor, last } = state;
  for (const point of points || []) {
    if (!valid(point)) continue;
    if (last && point.time < last.time) continue;
    count += 1;
    const accuracy = Number.isFinite(point.accuracy) && point.accuracy > 0 ? point.accuracy : 0;
    const here = { latitude: point.latitude, longitude: point.longitude, time: point.time, accuracy };
    if (!anchor || point.time - last.time > ROUTE_GAP_MS) {
      anchor = here;
    } else {
      const moved = distanceMeters(anchor, here);
      if (moved > Math.max(anchor.accuracy, accuracy)) {
        const seconds = (here.time - anchor.time) / 1000;
        if (!(seconds > 0 && moved / seconds > RIDE_SPEED_MPS)) metres += moved;
        anchor = here;
      }
    }
    last = here;
  }
  return Object.freeze({ day: state.day, metres, count, anchor, last });
}

/** 「今天 2.7 km」: tenths of a kilometre, rounded down (每 0.1 km 更新). */
export function formatTodayDistance(metres) {
  const tenths = Math.floor(Math.max(0, metres || 0) / 100);
  return `今天 ${(tenths / 10).toFixed(1)} km`;
}

/** Local midnight of `now`. */
export function startOfToday(now) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start.getTime();
}

/**
 * What the pill shows.
 * - route: today's sum ({ count, metres }), or null while it is still read.
 * - livePhone: the recording service's live snapshot (running, position,
 *   ageSeconds), null before the first read.
 * - phone: usePhoneLocation's permission and location-service state.
 * - now, waitingSince: since when recording has run without any fix yet
 *   (null: it has one); the slash waits 10 minutes for a first fix too.
 *
 * @returns {{ text, icon: 'walk'|'walk-muted'|'walk-off', muted: boolean,
 *   recorded: boolean, label: string }}
 *   walk: phone colour; walk-muted: grey (recording off); walk-off: grey with a
 *   slash (no permission, only approximate location, location service off, or
 *   recording without a fix for over 10 minutes).
 */
export function todayPill({ route, livePhone, phone, now = null, waitingSince = null }) {
  const permission = phone?.permission;
  const known = permission && permission !== 'checking' && !phone?.busy;
  const permissionProblem = known && (permission !== 'precise' || !phone.services);
  const recording = !!livePhone?.running;
  const fixAge = Number.isFinite(livePhone?.ageSeconds) ? livePhone.ageSeconds : null;
  // Not before the first live read (livePhone null): no slash flashes at start.
  const noFix = recording && (livePhone.position && fixAge != null ? fixAge > PHONE_FIX_MAX_AGE_S
    : Number.isFinite(now) && Number.isFinite(waitingSince) && now - waitingSince > PHONE_FIX_MAX_AGE_S * 1000);
  const recorded = (route?.count || 0) > 0;
  const icon = permissionProblem || noFix ? 'walk-off' : livePhone && !recording ? 'walk-muted' : 'walk';
  // Recording off (or not allowed) and nothing recorded today: 「未記錄」.
  const unrecorded = !recorded && (permissionProblem || (!!livePhone && !recording));
  const text = unrecorded ? '未記錄' : formatTodayDistance(route?.metres || 0);
  const reason = permissionProblem
    ? (permission === 'approximate' ? '只給了大概位置' : !phone.services && permission === 'precise'
      ? '定位服務關著' : '沒有定位權限')
    : noFix ? '手機沒有定位' : livePhone && !recording ? '位置記錄關閉' : '';
  const spoken = unrecorded ? '今天未記錄' : text.replace(' km', ' 公里');
  return {
    text,
    icon,
    muted: icon !== 'walk',
    recorded,
    label: [spoken, reason].filter(Boolean).join('，'),
  };
}
