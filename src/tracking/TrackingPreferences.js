import { getErrorMessage } from '../utils/errors';
import { DEFAULT_ALERT_PREFERENCES, normalizeAlertPreferences } from '../alerts/AlertPreferences';
import { normalizeAlertState } from '../alerts/AlertEngine';
import { ONBOARDING_DONE, ONBOARDING_SIGN_IN, ONBOARDING_STEPS } from '../app/Launch';

// Home map presets, confirmed 2026-09-16: minutes for working close to the
// dog, hours for reviewing the outing. 24 hours is the upper bound of the home
// map; older positions belong to the history page.
export const WINDOW_PRESETS = Object.freeze([1, 2, 3, 10, 30, 60, 360, 1440]);

export const DEFAULT_TRACKING_PREFERENCES = Object.freeze({
  mode: 'real',
  showMasterMarker: true,
  showSlaveMarker: true,
  showTrails: false,
  windowMinutes: 2,
  // A6 (還沒有狗) was closed with ✕: it never shows again.
  noDataCardDismissed: false,
  diagnosticsEnabled: false,
  // 設定 → 提醒 (S6): AlertPreferences.
  alerts: DEFAULT_ALERT_PREFERENCES,
  // What the alerts already said and a 暫停提醒 in force (AlertEngine
  // .persistedAlertState), so a restart neither repeats an alert nor ends a
  // pause. null until the first problem.
  alertState: null,
  // The first-launch guide (Launch.js): a phone that saved nothing yet starts
  // at D1 ('signIn'); a saved row from before the guide existed is 'done'.
  onboarding: ONBOARDING_DONE,
  // The system questions the guide has asked (D2 「全部允許」, D3 when D2 was
  // skipped): 'nearby', 'location', 'notifications', 'camera'. One refused
  // after it was asked says 「未允許」 / 「需要相機才能掃描」 with 「開系統設定 ›」,
  // never a second system question.
  askedPermissions: [],
});

export const ASKABLE_PERMISSIONS = Object.freeze(['nearby', 'location', 'notifications', 'camera']);

// Saved by versions before v3, which had a dog to follow and dogs hidden one by
// one. v3 has neither (every dog is drawn, the map never follows): the fields
// are read and dropped, never obeyed and never written again.
export const DROPPED_PREFERENCES = Object.freeze(['focusSlaveId', 'hiddenSlaveIds']);

export function validateTrackingPreferences(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('追蹤設定格式錯誤');
  const settings = { ...DEFAULT_TRACKING_PREFERENCES, ...value };
  if (!['demo', 'real'].includes(settings.mode))
    throw new Error('資料模式設定格式錯誤');
  for (const key of ['showMasterMarker', 'showSlaveMarker', 'showTrails', 'noDataCardDismissed']) {
    if (typeof settings[key] !== 'boolean')
      throw new Error('地圖顯示設定格式錯誤');
  }
  if (!WINDOW_PRESETS.includes(settings.windowMinutes))
    throw new Error('時間視窗設定格式錯誤');
  // Old per-role trail settings have different semantics; only missing new
  // fields receive defaults. Malformed saved JSON still fails explicitly.
  return {
    // Legacy saved preferences may select simulated data; always use hardware.
    mode: 'real',
    showMasterMarker: settings.showMasterMarker,
    showSlaveMarker: settings.showSlaveMarker,
    showTrails: settings.showTrails,
    windowMinutes: settings.windowMinutes,
    noDataCardDismissed: settings.noDataCardDismissed,
    diagnosticsEnabled: settings.diagnosticsEnabled === true,
    // Missing before v3 (051b); a damaged value falls back to the defaults
    // rather than failing every other preference.
    alerts: normalizeAlertPreferences(settings.alerts),
    alertState: normalizeAlertState(settings.alertState),
    onboarding: ONBOARDING_STEPS.includes(settings.onboarding) ? settings.onboarding : ONBOARDING_DONE,
    // Missing before 053; anything not a known question is dropped.
    askedPermissions: Array.isArray(settings.askedPermissions)
      ? ASKABLE_PERMISSIONS.filter(id => settings.askedPermissions.includes(id)) : [],
  };
}

// Nothing saved at all: this phone has not opened the app before.
const firstLaunch = stored => !stored || (typeof stored === 'object' && Object.keys(stored).length === 0);

// Connection lifetime is owned by the tracking session. Writes are applied to
// UI state only after SQLite succeeds and cannot outlive that owner.
export function createTrackingPreferences(database, onChange) {
  let state = {
    value: DEFAULT_TRACKING_PREFERENCES,
    ready: false,
    busy: false,
    error: null,
    recoveryAvailable: false,
  };
  let disposed = false;
  let pending = null;
  // Changes waiting for the write in flight (see save).
  let queued = null;
  let queuedRun = null;
  function update(patch) {
    state = { ...state, ...patch };
    if (!disposed) onChange(state);
  }
  function run(operation, recoveryAvailable = false) {
    if (disposed || pending) return Promise.resolve(false);
    update({ busy: true });
    pending = Promise.resolve()
      .then(operation)
      .then(value => {
        update({
          value,
          ready: true,
          error: null,
          recoveryAvailable: false,
        });
        return true;
      })
      .catch(error => {
        update({ error: getErrorMessage(error), recoveryAvailable });
        return false;
      })
      .finally(() => {
        pending = null;
        update({ busy: false });
      });
    return pending;
  }
  return {
    load: () =>
      run(async () => {
        await database.initialize();
        const stored = await database.load();
        // Nothing saved and no data from before: the first launch.
        const fresh = firstLaunch(stored) && !(await Promise.resolve(database.usedBefore?.()).catch(() => false));
        return validateTrackingPreferences(fresh ? { onboarding: ONBOARDING_SIGN_IN } : stored);
      }, true),
    save: function save(patch) {
      if (!state.ready || disposed) return Promise.resolve(false);
      if (pending) {
        // A change made while a write is in flight is merged with any other
        // waiting change and written right after it, so the last choice wins
        // instead of being dropped.
        queued = { ...queued, ...patch };
        queuedRun ??= pending.then(() => {
          const next = queued;
          queued = null;
          queuedRun = null;
          return next && !disposed ? save(next) : false;
        });
        return queuedRun;
      }
      return run(async () => {
        const next = validateTrackingPreferences({
          ...state.value,
          ...patch,
        });
        await database.save(next);
        return next;
      });
    },
    reset: () =>
      run(async () => {
        await database.initialize();
        await database.reset();
        return DEFAULT_TRACKING_PREFERENCES;
      }, true),
    close() {
      disposed = true;
      return pending || Promise.resolve();
    },
  };
}
