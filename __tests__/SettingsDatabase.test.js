import { createSettingsDatabase } from '../src/database/SettingsDatabase';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';

test('saving preferences repeatedly replaces only their key and survives reopening', async () => {
  const connection = createMemoryConnection();
  try {
    const database = createSettingsDatabase(connection);
    await database.initialize();
    await connection.executeAsync(
      'INSERT INTO app_settings (key, value) VALUES (?, ?)',
      ['unrelated', 'keep'],
    );
    await database.save({ mode: 'demo' });
    await database.save({ mode: 'real' });
    const reopened = createSettingsDatabase(connection);
    await reopened.initialize();
    await expect(reopened.load()).resolves.toEqual({ mode: 'real' });
    expect(connection.sqlite.prepare('SELECT key, value FROM app_settings ORDER BY key').all())
      .toEqual([
        { key: 'map_preferences', value: '{"mode":"real"}' },
        { key: 'unrelated', value: 'keep' },
      ]);
  } finally {
    connection.close();
  }
});
