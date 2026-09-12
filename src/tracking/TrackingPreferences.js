import { getErrorMessage } from '../utils/errors';

export const DEFAULT_TRACKING_PREFERENCES = Object.freeze({
  mode: 'demo',
});

export function validateTrackingPreferences(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('追蹤設定格式錯誤');
  const settings = { ...DEFAULT_TRACKING_PREFERENCES, ...value };
  if (!['demo', 'real'].includes(settings.mode))
    throw new Error('資料模式設定格式錯誤');
  return { mode: settings.mode };
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
