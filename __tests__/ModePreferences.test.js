import { createTrackingPreferences } from '../src/tracking/TrackingPreferences';
import { createSettingsDatabase } from '../src/database/SettingsDatabase';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { DEFAULT_ALERT_PREFERENCES } from '../src/alerts/AlertPreferences';

test('mode defaults to real, persists in SQLite and is restored by a new controller', async () => {
  const connection = createMemoryConnection();
  try {
    const changed = jest.fn();
    const database = createSettingsDatabase(connection);
    const first = createTrackingPreferences(database, changed);
    await first.load();
    expect(changed.mock.calls.at(-1)[0].value.mode).toBe('real');
    await first.save({ mode: 'real' });
    await first.close();
    const second = createTrackingPreferences(database, changed);
    await second.load();
    expect(changed.mock.calls.at(-1)[0].value.mode).toBe('real');
    expect(await second.save({ mode: 'invalid' })).toBe(false);
    expect(changed.mock.calls.at(-1)[0].value.mode).toBe('real');
    await second.close();
  } finally {
    connection.close();
  }
});
test('corrupt saved settings are reported, not overwritten with first-use defaults', async () => {
  const connection = createMemoryConnection();
  try {
    const database = createSettingsDatabase(connection);
    await database.initialize();
    connection.sqlite.exec(
      "INSERT INTO app_settings VALUES ('map_preferences', 'not json')",
    );
    const changed = jest.fn();
    const controller = createTrackingPreferences(database, changed);
    expect(await controller.load()).toBe(false);
    expect(changed.mock.calls.at(-1)[0].ready).toBe(false);
    expect(await controller.save({ mode: 'real' })).toBe(false);
    expect(
      connection.sqlite.prepare('SELECT value FROM app_settings').get().value,
    ).toBe('not json');
    await controller.close();
  } finally {
    connection.close();
  }
});

test('legacy stored demo mode loads as real while preserving every other preference', async () => {
  const connection = createMemoryConnection();
  try {
    const database = createSettingsDatabase(connection);
    await database.initialize();
    const stored = {
      mode: 'demo',
      showMasterMarker: false,
      showSlaveMarker: false,
      showTrails: true,
      windowMinutes: 360,
      focusSlaveId: 7,
      hiddenSlaveIds: [4, 6],
    };
    await database.save(stored);
    const changed = jest.fn();
    const controller = createTrackingPreferences(database, changed);
    expect(await controller.load()).toBe(true);
    // The followed and hidden dogs of older versions are dropped (v3).
    const { focusSlaveId, hiddenSlaveIds, ...kept } = stored;
    expect(focusSlaveId).toBe(7);
    expect(hiddenSlaveIds).toEqual([4, 6]);
    expect(changed.mock.calls.at(-1)[0].value).toEqual({ ...kept, mode: 'real', noDataCardDismissed: false, alerts: DEFAULT_ALERT_PREFERENCES,
      onboarding: 'done', askedPermissions: [] });
    // Loading only normalizes in memory; the next successful save persists it.
    expect(await database.load()).toEqual(stored);
    expect(await controller.save({})).toBe(true);
    expect(await database.load()).toEqual({ ...kept, mode: 'real', noDataCardDismissed: false, alerts: DEFAULT_ALERT_PREFERENCES,
      onboarding: 'done', askedPermissions: [] });
    await controller.close();
  } finally {
    connection.close();
  }
});
