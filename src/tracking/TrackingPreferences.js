import { getErrorMessage } from '../utils/errors';

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
});

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
  };
}

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
        return validateTrackingPreferences(await database.load());
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
