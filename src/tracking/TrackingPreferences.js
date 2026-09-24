import { getErrorMessage } from '../utils/errors';

// Home map presets, confirmed 2026-09-16: minutes for working close to the
// dog, hours for reviewing the outing. 24 hours is the upper bound of the home
// map; older positions belong to the history page.
export const WINDOW_PRESETS = Object.freeze([1, 2, 3, 10, 30, 60, 360, 1440]);

export const DEFAULT_TRACKING_PREFERENCES = Object.freeze({
  mode: 'demo',
  showMasterMarker: true,
  showSlaveMarker: true,
  showTrails: false,
  windowMinutes: 2,
  // Which dog the map camera follows; null follows every visible device.
  focusSlaveId: null,
  // Dogs the user hid one by one; the list still shows them.
  hiddenSlaveIds: [],
});

export function validateTrackingPreferences(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('追蹤設定格式錯誤');
  const settings = { ...DEFAULT_TRACKING_PREFERENCES, ...value };
  if (!['demo', 'real'].includes(settings.mode))
    throw new Error('資料模式設定格式錯誤');
  for (const key of ['showMasterMarker', 'showSlaveMarker', 'showTrails']) {
    if (typeof settings[key] !== 'boolean')
      throw new Error('地圖顯示設定格式錯誤');
  }
  if (!WINDOW_PRESETS.includes(settings.windowMinutes))
    throw new Error('時間視窗設定格式錯誤');
  // A dog that is not on the map is not an error: the selection is kept so the
  // camera follows it again when that dog reports, but it must be an id.
  if (settings.focusSlaveId !== null &&
    !(Number.isInteger(settings.focusSlaveId) && settings.focusSlaveId >= 0))
    throw new Error('跟隨的狗設定格式錯誤');
  if (!Array.isArray(settings.hiddenSlaveIds) ||
    !settings.hiddenSlaveIds.every(id => Number.isInteger(id) && id >= 0))
    throw new Error('隱藏的狗設定格式錯誤');
  // Old per-role trail settings have different semantics; only missing new
  // fields receive defaults. Malformed saved JSON still fails explicitly.
  return {
    mode: settings.mode,
    showMasterMarker: settings.showMasterMarker,
    showSlaveMarker: settings.showSlaveMarker,
    showTrails: settings.showTrails,
    windowMinutes: settings.windowMinutes,
    focusSlaveId: settings.focusSlaveId,
    // Stored sorted and without repeats, so the saved value cannot grow every
    // time the same dog is hidden.
    hiddenSlaveIds: [...new Set(settings.hiddenSlaveIds)].sort((a, b) => a - b),
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
    save: patch =>
      state.ready
        ? run(async () => {
            const next = validateTrackingPreferences({
              ...state.value,
              ...patch,
            });
            await database.save(next);
            return next;
          })
        : Promise.resolve(false),
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
