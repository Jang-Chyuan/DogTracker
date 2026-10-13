import { t } from '../i18n';
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
  return t("c1041", { value: (tenths / 10).toFixed(1) });
}

/** Local midnight of `now`. */
export function startOfToday(now) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start.getTime();
}

/** A confirmed permission/service problem, independent of GPS fix freshness. */
export function phoneLocationProblem(phone) {
  const permission = phone?.permission;
  const known = permission && permission !== 'checking' && !phone?.busy && !phone?.error;
  return !!(known && (permission !== 'precise' || !phone.services));
}

/**
 * What the pill shows.
 * - route: today's sum ({ count, metres }), or null until it was read once.
 * - livePhone: the recording service's live snapshot (running, position,
 *   ageSeconds), null before the first read.
 * - phone: usePhoneLocation's permission and location-service state.
 *
 * @returns {null | { text, icon: 'walk'|'walk-muted'|'walk-off', muted: boolean,
 *   recorded: boolean, label: string }}  null until the route was read.
 *   walk: phone colour; walk-muted: grey (recording off); walk-off: grey with a
 *   slash (no permission, only approximate location, or location service off).
 *   Fix age and first-fix waiting do not change this control's appearance.
 */
export function todayPill({ route, livePhone, phone }) {
  // Not shown until today's route has been read once: no 「今天 0.0 km」
  // flashing before the real number.
  if (!route) return null;
  const permission = phone?.permission;
  const permissionProblem = phoneLocationProblem(phone);
  const stopped = livePhone?.running === false;
  const recorded = (route?.count || 0) > 0;
  const icon = permissionProblem ? 'walk-off' : stopped ? 'walk-muted' : 'walk';
  // Recording off (or not allowed) and nothing recorded today: 「未記錄」.
  const unrecorded = !recorded && (permissionProblem || stopped);
  const text = unrecorded ? t('c309') : formatTodayDistance(route?.metres || 0);
  const reason = permissionProblem
    ? (permission === 'approximate' ? t('c313') : !phone.services && permission === 'precise'
      ? t("c1006") : t('c311'))
    : stopped ? t("c1043") : '';
  const spoken = unrecorded ? t("c1044") : text.replace(' km', t("c729"));
  return {
    text,
    icon,
    muted: icon !== 'walk',
    recorded,
    unrecorded,
    destination: unrecorded ? 'phone-settings' : 'history',
    label: [spoken, reason, unrecorded ? t("c1042") : null].filter(Boolean).join('，'),
  };
}

// A row stamped more than this past the phone's clock is not shown yet: it
// was recorded while the clock was set wrong (「現在」 in the future, a cursor
// past now, a drive made of minutes that have not happened). It stays in the
// database and joins the day once its time comes.
export const FUTURE_ROW_TOLERANCE_MS = 2 * 60000;

/** Rows split into those shown now and those stamped in the future. */
export function splitFutureRows(rows, now, tolerance = FUTURE_ROW_TOLERANCE_MS) {
  if (!Number.isFinite(now)) return { shown: rows, future: [] };
  const limit = now + tolerance;
  const shown = [], future = [];
  for (const row of rows) (Number(row?.time) > limit ? future : shown).push(row);
  return { shown, future };
}
