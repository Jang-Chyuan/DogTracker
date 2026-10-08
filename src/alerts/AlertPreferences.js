// What the user chose on 設定 → 提醒 (design v3 S6; 「每一種提醒」「提醒的規則」
// tables). Pure: saved with the tracking preferences (`alerts`), read by the
// S6 page, the S1 提醒 row, and — from 058 on — by whatever sends the
// alerts. This module sends nothing.
//
// - Every alert category can be switched off; all on by default. The
//   receiver disconnect/storage row shares one notification switch.
// - These preferences control notification delivery only, never in-app warnings.
// - 震動 and 聲音 are shared by every alert; 聲音 is off by default and, when
//   on, follows the phone's notification volume.

export const DEFAULT_ALERT_PREFERENCES = Object.freeze({
  dogStale: true,
  dogOutOfRange: true,
  dogBattery: true,
  receiverBattery: true,
  receiverDisconnectedStorage: true,
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

// Each notification kind and the setting that switches its delivery off.
const ALERT_SETTING = Object.freeze({
  'dog-stale': 'dogStale',
  'dog-out-of-range': 'dogOutOfRange',
  'dog-battery': 'dogBattery',
  'receiver-battery': 'receiverBattery',
  'receiver-disconnected': 'receiverDisconnectedStorage',
  storage: 'receiverDisconnectedStorage',
});

export const ALERT_KINDS = Object.freeze(Object.keys(ALERT_SETTING));

/** Whether to deliver a notification; unknown kinds retain the safe default. */
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
 * category is off, a second line 「部分開」; all categories off: 「全部關閉」.
 */
export function alertsHomeStatus(preferences) {
  const value = normalizeAlertPreferences(preferences);
  const how = [value.vibrate && '震動', value.sound && '聲音'].filter(Boolean).join('、') || '關';
  const categories = [...new Set(Object.values(ALERT_SETTING))];
  if (categories.every(key => !value[key])) return ['全部關閉'];
  return categories.every(key => value[key]) ? [how] : [how, '部分開'];
}

/**
 * S6. { dogs: { status, items: [{ key, title, on }] }, receiverBattery, receiverDisconnectedStorage,
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
    receiverDisconnectedStorage: value.receiverDisconnectedStorage,
    vibrate: value.vibrate,
    sound: value.sound,
    notifications: denied
      ? { denied: true, detail: '未允許', status: null, action: '開系統設定 ›' }
      : { denied: false, detail: null, status: '已允許', action: null },
  };
}
