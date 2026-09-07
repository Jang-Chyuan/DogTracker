import { createTrackingPreferences } from '../src/tracking/TrackingPreferences';
import { createSettingsDatabase } from '../src/database/SettingsDatabase';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';

test('mode defaults to Demo, persists in SQLite and is restored by a new controller', async () => {
  const connection = createMemoryConnection();
  try {
    const changed = jest.fn();
    const database = createSettingsDatabase(connection);
    const first = createTrackingPreferences(database, changed);
    await first.load();
    expect(changed.mock.calls.at(-1)[0].value.mode).toBe('demo');
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
    expect(await controller.save({ mode: 'demo' })).toBe(false);
    expect(
      connection.sqlite.prepare('SELECT value FROM app_settings').get().value,
    ).toBe('not json');
    await controller.close();
  } finally {
    connection.close();
  }
});
