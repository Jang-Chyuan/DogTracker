// What the user chose on 設定 → 提醒 (design v3 S6; 「每一種提醒」「提醒的規則」
// tables). Pure: saved with the tracking preferences (`alerts`), read by the
// S6 page, the S1 提醒 row, and — from 058 on — by whatever sends the
// alerts. This module sends nothing.
//
// - The dog alerts (沒有新位置、不在接收範圍、電量低) and 接收器電量低 can be
//   switched off one by one; all on by default.
// - 接收器斷線 and 位置存不進手機 always alert (「一定提醒（不能關）」): they
//   have no setting, so nothing saved can switch them off.
// - 震動 and 聲音 are shared by every alert; 聲音 is off by default and, when
//   on, follows the phone's notification volume.

export const DEFAULT_ALERT_PREFERENCES = Object.freeze({
  dogStale: true,
  dogOutOfRange: true,
  dogBattery: true,
  receiverBattery: true,
  vibrate: true,
  sound: false,
});

export const ALERT_PREFERENCE_KEYS = Object.freeze(Object.keys(DEFAULT_ALERT_PREFERENCES));

/**
 * The saved value made whole: every known key a boolean (a missing or
 * malformed one takes its default), unknown keys dropped. Never throws, so a
 * damaged value can not keep the app's other preferences from loading.
 */
export function normalizeAlertPreferences(value) {
  const saved = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const result = {};
  for (const key of ALERT_PREFERENCE_KEYS) {
    result[key] = typeof saved[key] === 'boolean' ? saved[key] : DEFAULT_ALERT_PREFERENCES[key];
  }
  return result;
}

/** The preferences with `patch` applied (unknown keys ignored). */
export function changeAlertPreferences(preferences, patch) {
  return normalizeAlertPreferences({ ...normalizeAlertPreferences(preferences), ...patch });
}

// Each alert by the event 058 raises, and the setting that switches it off
// (null: always alerts).
const ALERT_SETTING = Object.freeze({
  'dog-stale': 'dogStale',
  'dog-out-of-range': 'dogOutOfRange',
  'dog-battery': 'dogBattery',
  'receiver-battery': 'receiverBattery',
  'receiver-disconnected': null,
  storage: null,
});

export const ALERT_KINDS = Object.freeze(Object.keys(ALERT_SETTING));

/**
 * Whether an alert of this kind is to be raised. 接收器斷線 and 位置存不進手機
 * always are; an unknown kind is (an alert never goes missing by a typo).
 */
export function alertEnabled(preferences, kind) {
  const key = ALERT_SETTING[kind];
  if (!key) return true;
  return normalizeAlertPreferences(preferences)[key];
}

/** How an alert that is raised gets the user's attention. */
export function alertDelivery(preferences) {
  const { vibrate, sound } = normalizeAlertPreferences(preferences);
  return { vibrate, sound };
}

// The groups of S6 that hold more than one switch.
export const DOG_ALERTS = Object.freeze([
  { key: 'dogStale', title: '沒有新位置' },
  { key: 'dogOutOfRange', title: '不在接收範圍' },
  { key: 'dogBattery', title: '電量低' },
]);

/** 「全部開／部分開／全部關」 for a group of switches (c300). */
export function groupStatus(preferences, keys) {
  const values = keys.map(key => normalizeAlertPreferences(preferences)[key]);
  if (values.every(Boolean)) return '全部開';
  if (values.some(Boolean)) return '部分開';
  return '全部關';
}

/**
 * The S1 提醒 row's status (c193, accepted suggestion 「震動」): how alerts
 * arrive — 「震動」, 「聲音」, both, or 「關」 when neither — and, when some
 * alert that can be switched off is off, a second line 「部分開」.
 */
export function alertsHomeStatus(preferences) {
  const value = normalizeAlertPreferences(preferences);
  const how = [value.vibrate && '震動', value.sound && '聲音'].filter(Boolean).join('、') || '關';
  const optional = [...DOG_ALERTS.map(alert => alert.key), 'receiverBattery'];
  return optional.every(key => value[key]) ? [how] : [how, '部分開'];
}

/**
 * S6. { dogs: { status, items: [{ key, title, on }] }, receiverBattery,
 * vibrate, sound, notifications: { denied, detail, status, action } }.
 * `permissions` is usePhonePermissions' answer.
 */
export function alertsPage(preferences, permissions = {}) {
  const value = normalizeAlertPreferences(preferences);
  const denied = !!permissions.notificationsDenied;
  return {
    dogs: {
      status: groupStatus(value, DOG_ALERTS.map(alert => alert.key)),
      items: DOG_ALERTS.map(alert => ({ ...alert, on: value[alert.key] })),
    },
    receiverBattery: value.receiverBattery,
    vibrate: value.vibrate,
    sound: value.sound,
    notifications: denied
      ? { denied: true, detail: '未允許', status: null, action: '開系統設定 ›' }
      : { denied: false, detail: null, status: '已允許', action: null },
  };
}
