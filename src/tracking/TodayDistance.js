// 「今天 x km」 (design v3 A1/A2, 判定表「右下『今天 x km』」): how far this
// phone's own recorded route went today, and what the bottom-right pill says.
//
// stops.txt: the pill is my route's range for today — from the departure
// detection (or the whole day before departure), the same number as the history
// summary; driving is not counted, nor moves inside the fixes' accuracy. The
// rows go through the same history logic (src/history) as the list.
// Pure functions: the hook (useTodayRoute) feeds them rows as they are
// recorded, a screen fixture feeds them invented rows.

import { historyTimeline } from '../history/HistoryTimeline';
import { phoneHistoryRow } from '../history/HistoryRows';
import { PHONE_FIX_MAX_AGE_S } from '../map/MapFraming';

const valid = point => Number.isFinite(point?.latitude) && Number.isFinite(point?.longitude)
  && Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180
  && !(point.latitude === 0 && point.longitude === 0) && Number.isFinite(point?.time);

/** Next local midnight after `dayStart`. */
export function endOfDay(dayStart) {
  const end = new Date(dayStart);
  end.setDate(end.getDate() + 1);
  return end.getTime();
}

/**
 * Today's route of this phone: `rows` are its myLocationTracker rows of
 * today ({ time, latitude, longitude, accuracy }, any order). `recording`
 * false fixes the end at the last fix (判定表「記錄已關閉…但今天有路線」);
 * `state` is the previous answer's, so stays already marked stay.
 * @returns {{ count, metres, status, range, state }} status is the departure
 *   detection's: 'not-departed' | 'confirming' | 'confirmed'.
 */
export function todayRouteDistance(rows, { now, dayStart = startOfToday(now), recording = true, state = null } = {}) {
  const today = (rows || []).filter(row => valid(row) && row.time >= dayStart && row.time <= now);
  if (!today.length) return { count: 0, metres: 0, status: 'not-departed', range: null, state: null };
  const model = historyTimeline(today.map(phoneHistoryRow), {
    subject: 'phone', source: 'all', dayStart, dayEnd: endOfDay(dayStart), today: true, now,
    following: recording, state,
  });
  return { count: today.length, metres: model.distanceM, status: model.departure.status,
    range: model.range, state: model.state };
}

/** 「今天 2.7 km」: tenths of a kilometre, rounded (判定表「距離的四捨五入」). */
export function formatTodayDistance(metres) {
  const tenths = Math.round(Math.max(0, metres || 0) / 100);
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
 * - route: today's sum ({ count, metres }), or null until it was read once.
 * - livePhone: the recording service's live snapshot (running, position,
 *   ageSeconds), null before the first read.
 * - phone: usePhoneLocation's permission and location-service state.
 * - now, waitingSince: since when recording has run without any fix yet
 *   (null: it has one); the slash waits 10 minutes for a first fix too.
 *
 * @returns {null | { text, icon: 'walk'|'walk-muted'|'walk-off', muted: boolean,
 *   recorded: boolean, label: string }}  null until the route was read.
 *   walk: phone colour; walk-muted: grey (recording off); walk-off: grey with a
 *   slash (no permission, only approximate location, location service off, or
 *   recording without a fix for over 10 minutes).
 */
export function todayPill({ route, livePhone, phone, now = null, waitingSince = null }) {
  // Not shown until today's route has been read once: no 「今天 0.0 km」
  // flashing before the real number.
  if (!route) return null;
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
    unrecorded,
    destination: unrecorded ? 'phone-settings' : 'history',
    label: [spoken, reason, unrecorded ? '點兩下到手機設定' : null].filter(Boolean).join('，'),
  };
}
