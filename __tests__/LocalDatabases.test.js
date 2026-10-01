import { mockDatabase } from 'react-native-nitro-sqlite';
import { createLocalDatabases } from '../src/database/LocalDatabases';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createSettingsDatabase } from '../src/database/SettingsDatabase';
import { trackingPoint } from '../__fixtures__/TrackingPointFixtures';

test('every table migration waits for the shared SQLite lock configuration', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  mockDatabase.executeAsync.mockReset().mockImplementation(async sql =>
    sql === 'PRAGMA busy_timeout=5000' ? gate : { results: [] },
  );
  const databases = createLocalDatabases();
  const pending = Promise.all([
    databases.real.initialize(), databases.settings.initialize(), databases.cloud.initialize(),
  ]);
  await Promise.resolve();
  expect(mockDatabase.executeAsync.mock.calls).toEqual([['PRAGMA busy_timeout=5000']]);
  release({ results: [] });
  await pending;
  expect(mockDatabase.executeAsync.mock.calls.some(([sql]) => sql.includes('CREATE TABLE'))).toBe(true);
  databases.close();
});

test('configuration failure blocks all migrations and leaves close with the owner', async () => {
  mockDatabase.executeAsync.mockReset().mockRejectedValue(new Error('SQLite unavailable'));
  mockDatabase.close.mockClear();
  const databases = createLocalDatabases();
  const results = await Promise.allSettled([
    databases.real.initialize(), databases.settings.initialize(), databases.cloud.initialize(),
  ]);
  expect(results.every(result => result.status === 'rejected')).toBe(true);
  expect(mockDatabase.executeAsync).toHaveBeenCalledTimes(1);
  expect(mockDatabase.close).not.toHaveBeenCalled();
  databases.close();
  expect(mockDatabase.close).toHaveBeenCalledTimes(1);
});

test('opening drops obsolete demo objects, preserves real data and is safe to repeat', async () => {
  const connection = createMemoryConnection();
  try {
    const real = createDogDatabase(connection);
    const settings = createSettingsDatabase(connection);
    await real.initialize();
    await real.saveStatus(trackingPoint, 'hardware');
    await settings.initialize();
    await settings.save({ mode: 'real', showTrails: true });
    connection.sqlite.exec(`
      INSERT INTO supabase_dog_status (received_at, slave_id, raw_payload)
        VALUES (1000, 7, 'cloud');
      CREATE TABLE demo_dog_status (id INTEGER PRIMARY KEY, received_at INTEGER);
      INSERT INTO demo_dog_status VALUES (1, 1000);
      CREATE INDEX idx_demo_dog_status_received_at ON demo_dog_status(received_at, id);
      CREATE TABLE demo_metadata (key TEXT PRIMARY KEY, value TEXT);
      INSERT INTO demo_metadata VALUES ('seed_v1', 'done');
    `);
    const tables = ['dog_status', 'supabase_dog_status', 'app_settings'];
    const snapshot = () => tables.map(table => connection.sqlite
      .prepare(`SELECT * FROM ${table}`).all());
    const before = snapshot();
    mockDatabase.executeAsync.mockReset().mockImplementation(connection.executeAsync);
    for (let attempt = 0; attempt < 2; attempt++) {
      const databases = createLocalDatabases();
      await Promise.all([databases.real.initialize(), databases.settings.initialize()]);
      expect(connection.sqlite.prepare(
        "SELECT name FROM sqlite_master WHERE name IN ('demo_dog_status', 'demo_metadata', 'idx_demo_dog_status_received_at')",
      ).all()).toEqual([]);
      expect(snapshot()).toEqual(before);
      databases.close();
    }
  } finally {
    mockDatabase.executeAsync.mockReset().mockResolvedValue({ results: [] });
    connection.close();
  }
});
