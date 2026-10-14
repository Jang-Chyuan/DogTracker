import {
  createTrackingPreferences,
  DEFAULT_TRACKING_PREFERENCES,
  validateTrackingPreferences,
  DROPPED_PREFERENCES,
  WINDOW_PRESETS,
} from '../src/tracking/TrackingPreferences';
import { DEFAULT_ALERT_PREFERENCES } from '../src/alerts/AlertPreferences';
import { createSettingsDatabase } from '../src/database/SettingsDatabase';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';

function setup() {
  const database = {
    initialize: jest.fn(async () => {}),
    load: jest.fn(async () => ({})),
    save: jest.fn(async () => {}),
    reset: jest.fn(async () => {}),
  };
  const changed = jest.fn();
  return {
    database,
    changed,
    controller: createTrackingPreferences(database, changed),
    state: () => changed.mock.calls.at(-1)[0],
  };
}
test('first use defaults to real, visible markers and hidden paths', async () => {
  const { controller, state } = setup();
  await controller.load();
  expect(state()).toMatchObject({
    ready: true,
    value: {
      mode: 'real',
      showMasterMarker: true,
      showSlaveMarker: true,
      showTrails: false,
    },
    error: null,
  });
});
test('failed writes preserve every prior value and a successful retry applies the change', async () => {
  const { database, controller, state } = setup();
  await controller.load();
  database.save.mockRejectedValueOnce(new Error('locked'));
  expect(
    await controller.save({ showSlaveMarker: false, showTrails: true }),
  ).toBe(false);
  // Nothing saved before: the first-launch guide starts at D1.
  expect(state().value).toEqual({ ...DEFAULT_TRACKING_PREFERENCES, onboarding: 'signIn' });
  expect(state().error).toBe('locked');
  expect(
    await controller.save({ showSlaveMarker: false, showTrails: true }),
  ).toBe(true);
  expect(state().value).toMatchObject({
    showSlaveMarker: false,
    showTrails: true,
  });
});
test('failed loads are not first-use defaults and cannot overwrite stored settings', async () => {
  const { database, controller, state } = setup();
  database.load.mockRejectedValueOnce(new Error('read failed'));
  expect(await controller.load()).toBe(false);
  expect(state().ready).toBe(false);
  expect(await controller.save({ mode: 'real' })).toBe(false);
  expect(database.save).not.toHaveBeenCalled();
  database.load.mockResolvedValue({
    mode: 'real',
    showMasterMarker: false,
    showSlaveMarker: false,
    showTrails: true,
  });
  await controller.load();
  expect(state().value).toEqual({
    mode: 'real',
    showMasterMarker: false,
    showSlaveMarker: false,
    showTrails: true,
    windowMinutes: 2,
    noDataCardDismissed: false, waitingLocationSources: null,
    diagnosticsEnabled: false,
    alerts: DEFAULT_ALERT_PREFERENCES,
    // Saved before the first-launch guide existed: it counts as passed.
    onboarding: 'done',
    askedPermissions: [],
  });
});
test('close drains the pending write and does not publish its result to an unmounted owner', async () => {
  const { database, controller, changed } = setup();
  await controller.load();
  let finish;
  database.save.mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  const saving = controller.save({ showTrails: true });
  await Promise.resolve();
  const close = controller.close();
  const calls = changed.mock.calls.length;
  expect(await controller.save({ mode: 'real' })).toBe(false);
  finish();
  await close;
  await saving;
  expect(changed).toHaveBeenCalledTimes(calls);
});
test.each([
  null,
  [],
  { mode: 'invalid' },
  { mode: null },
  { showMasterMarker: 1 },
  { showSlaveMarker: 'false' },
  { showTrails: null },
])('rejects invalid new settings %p', value =>
  expect(() => validateTrackingPreferences(value)).toThrow(),
);
test('old per-Master route and stale settings do not become new marker/path semantics', () => {
  expect(
    validateTrackingPreferences({ showMasterTrail: true, staleMinutes: 10 }),
  ).toEqual(DEFAULT_TRACKING_PREFERENCES);
});
test('every setting survives a new controller and shares no tracking-row writes', async () => {
  const connection = createMemoryConnection();
  try {
    const database = createSettingsDatabase(connection),
      changed = jest.fn();
    const first = createTrackingPreferences(database, changed);
    await first.load();
    const value = {
      mode: 'real',
      showMasterMarker: false,
      showSlaveMarker: true,
      showTrails: true,
      windowMinutes: 30,
      noDataCardDismissed: false, waitingLocationSources: { receiver: 'AA:7',
        sources: { 4: { firstAt: 1000, fixed: false } }, dismissed: ['4'], paused: false, since: null },
      diagnosticsEnabled: true,
      // S6: 不在接收範圍 and 接收器電量低 off, 聲音 on.
      alerts: { ...DEFAULT_ALERT_PREFERENCES, dogOutOfRange: false, receiverBattery: false, sound: true },
      // D1 passed (「稍後再說」), D2 asked, the camera not yet.
      onboarding: 'done',
      askedPermissions: ['nearby', 'location', 'camera'],
    };
    await first.save(value);
    await first.close();
    const second = createTrackingPreferences(database, changed);
    await second.load();
    expect(changed.mock.calls.at(-1)[0].value).toEqual(value);
    expect(
      connection.sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all(),
    ).toEqual([{ name: 'app_settings' }]);
    await second.close();
  } finally {
    connection.close();
  }
});
test('corrupt JSON reports an error and never overwrites the saved value', async () => {
  const connection = createMemoryConnection();
  try {
    const database = createSettingsDatabase(connection);
    await database.initialize();
    connection.sqlite.exec(
      "INSERT INTO app_settings VALUES ('map_preferences', '{bad json')",
    );
    const changed = jest.fn(),
      controller = createTrackingPreferences(database, changed);
    expect(await controller.load()).toBe(false);
    expect(changed.mock.calls.at(-1)[0]).toMatchObject({
      ready: false,
      recoveryAvailable: true,
    });
    expect(await controller.save({ mode: 'real' })).toBe(false);
    expect(
      connection.sqlite.prepare('SELECT value FROM app_settings').get().value,
    ).toBe('{bad json');
    await controller.close();
  } finally {
    connection.close();
  }
});

test('the home window only accepts the confirmed presets and survives a reload', () => {
  expect(validateTrackingPreferences({}).windowMinutes).toBe(2);
  for (const minutes of WINDOW_PRESETS) {
    expect(validateTrackingPreferences({ windowMinutes: minutes }).windowMinutes).toBe(minutes);
  }
  // A window the map cannot honour must fail loudly rather than silently
  // falling back: the home map is capped at 24 hours.
  for (const invalid of [0, -10, 5, 2880, '10', null]) {
    expect(() => validateTrackingPreferences({ windowMinutes: invalid })).toThrow('時間視窗');
  }
});

test('the followed dog and hidden dogs of older versions are read and dropped (v3)', () => {
  // v3 draws every dog and never follows one: whatever an older version
  // stored, even a malformed value, is neither obeyed nor an error.
  for (const stored of [{ focusSlaveId: 4, hiddenSlaveIds: [6, 2] }, { focusSlaveId: 'x', hiddenSlaveIds: null }]) {
    const value = validateTrackingPreferences(stored);
    expect(value).toEqual(DEFAULT_TRACKING_PREFERENCES);
    for (const key of DROPPED_PREFERENCES) expect(value).not.toHaveProperty(key);
  }
});

test('changes made while a write is in flight are written after it; the last choice wins', async () => {
  const { database, controller, state } = setup();
  await controller.load();
  let finish;
  database.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const first = controller.save({ showTrails: true });
  await Promise.resolve();
  // Two quick taps while the first write is still on disk.
  const second = controller.save({ showMasterMarker: false });
  const third = controller.save({ showTrails: false });
  finish();
  expect(await first).toBe(true);
  expect(await second).toBe(true);
  expect(await third).toBe(true);
  expect(state().value).toMatchObject({ showMasterMarker: false, showTrails: false });
  expect(database.save).toHaveBeenCalledTimes(2);
});

test('alert settings (S6): missing before v3 → the defaults; damaged → the defaults, nothing else lost', () => {
  const old = { mode: 'real', showMasterMarker: true, showSlaveMarker: true, showTrails: false, windowMinutes: 10 };
  expect(validateTrackingPreferences(old).alerts).toEqual(DEFAULT_ALERT_PREFERENCES);
  const damaged = validateTrackingPreferences({ ...old, alerts: { sound: 'yes', dogStale: false, extra: 1 } });
  expect(damaged.windowMinutes).toBe(10);
  expect(damaged.alerts).toEqual({ ...DEFAULT_ALERT_PREFERENCES, dogStale: false });
  expect(validateTrackingPreferences({ ...old, alerts: [true] }).alerts).toEqual(DEFAULT_ALERT_PREFERENCES);
});

test('the first-launch guide: nothing saved starts at D1; it is kept until passed, then stays passed', async () => {
  const connection = createMemoryConnection();
  try {
    const database = createSettingsDatabase(connection), changed = jest.fn();
    const first = createTrackingPreferences(database, changed);
    await first.load();
    expect(changed.mock.calls.at(-1)[0].value.onboarding).toBe('signIn');
    // Another setting saved before D1 is passed keeps the step.
    await first.save({ windowMinutes: 10 });
    await first.close();
    const second = createTrackingPreferences(database, changed);
    await second.load();
    expect(changed.mock.calls.at(-1)[0].value.onboarding).toBe('signIn');
    await second.save({ onboarding: 'done' });
    await second.close();
    const third = createTrackingPreferences(database, changed);
    await third.load();
    expect(changed.mock.calls.at(-1)[0].value).toMatchObject({ onboarding: 'done', windowMinutes: 10 });
    // A damaged value never sends anyone back to D1.
    expect(validateTrackingPreferences({ onboarding: 'D7' }).onboarding).toBe('done');
    // Every step of the guide is kept as saved (中途退出下次從那步繼續).
    for (const step of ['signIn', 'permissions', 'receiver', 'paired', 'done']) {
      expect(validateTrackingPreferences({ onboarding: step }).onboarding).toBe(step);
    }
    expect(validateTrackingPreferences({ askedPermissions: ['camera', 'gps', 'nearby'] }).askedPermissions)
      .toEqual(['nearby', 'camera']);
    expect(validateTrackingPreferences({ askedPermissions: 'yes' }).askedPermissions).toEqual([]);
  } finally {
    connection.close();
  }
});

test('a slow or failed start never sends a phone back to D1: only a sure first launch opens the guide', async () => {
  // Nothing saved and no dog data: the first launch.
  const fresh = setup();
  fresh.database.usedBefore = jest.fn(async () => false);
  await fresh.controller.load();
  expect(fresh.state().value.onboarding).toBe('signIn');
  // Nothing saved, and whether the phone was used before cannot be read
  // (busy, timed out): not a first launch.
  const unknown = setup();
  unknown.database.usedBefore = jest.fn(async () => { throw new Error('database is locked'); });
  await unknown.controller.load();
  expect(unknown.state()).toMatchObject({ ready: true, value: { onboarding: 'done' } });
  // The saved preferences cannot be read: an error, never the guide's D1
  // (App then opens the map: Launch.launchScreen).
  const failed = setup();
  failed.database.load.mockRejectedValueOnce(new Error('timed out'));
  failed.database.usedBefore = jest.fn(async () => false);
  expect(await failed.controller.load()).toBe(false);
  expect(failed.state()).toMatchObject({ ready: false, error: 'timed out' });
  expect(failed.database.usedBefore).not.toHaveBeenCalled();
  // A read that only answers late still answers what was saved; nothing is
  // ready before it.
  const slow = setup();
  let answer;
  slow.database.load.mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
  const loading = slow.controller.load();
  for (let turn = 0; !answer && turn < 20; turn += 1) await Promise.resolve();
  expect(slow.changed.mock.calls.some(([state]) => state.ready)).toBe(false);
  answer({ mode: 'real', windowMinutes: 2, onboarding: 'done' });
  await loading;
  expect(slow.state()).toMatchObject({ ready: true, value: { onboarding: 'done' } });
});

test('usedBefore: a table not created yet is nothing there; any other failure counts as used', async () => {
  const query = jest.fn();
  const database = createSettingsDatabase({ executeAsync: query });
  query.mockRejectedValue(new Error('no such table: dog_status (code 1 SQLITE_ERROR)'));
  await expect(database.usedBefore()).resolves.toBe(false);
  query.mockReset().mockResolvedValueOnce({ results: [] }).mockResolvedValueOnce({ results: [{ found: 1 }] });
  await expect(database.usedBefore()).resolves.toBe(true);
  query.mockReset().mockRejectedValue(new Error('database is locked (code 5 SQLITE_BUSY)'));
  await expect(database.usedBefore()).resolves.toBe(true);
});
