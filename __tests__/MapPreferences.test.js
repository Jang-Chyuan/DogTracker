import {
  createTrackingPreferences,
  DEFAULT_TRACKING_PREFERENCES,
  validateTrackingPreferences,
} from '../src/tracking/TrackingPreferences';
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
test('first use defaults to Demo, visible markers and hidden paths', async () => {
  const { controller, state } = setup();
  await controller.load();
  expect(state()).toMatchObject({
    ready: true,
    value: {
      mode: 'demo',
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
  expect(state().value).toEqual(DEFAULT_TRACKING_PREFERENCES);
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
  expect(await controller.save({ mode: 'demo' })).toBe(false);
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
test('all four settings survive a new controller and share no tracking-row writes', async () => {
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
    expect(await controller.save({ mode: 'demo' })).toBe(false);
    expect(
      connection.sqlite.prepare('SELECT value FROM app_settings').get().value,
    ).toBe('{bad json');
    await controller.close();
  } finally {
    connection.close();
  }
});
