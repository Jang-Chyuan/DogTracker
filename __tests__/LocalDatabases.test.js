import { mockDatabase } from 'react-native-nitro-sqlite';
import { createLocalDatabases } from '../src/database/LocalDatabases';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createSettingsDatabase } from '../src/database/SettingsDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { createHistoryDatabase } from '../src/mapHistory/HistoryDatabase';
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
    const cloud = createCloudDatabase(connection);
    await cloud.initialize();
    await createHistoryDatabase(connection).load();
    const now = Date.now();
    connection.sqlite.exec(`
      INSERT INTO supabase_dog_status (received_at, track_at, slave_id, raw_payload, owner_user_id, event_id)
        VALUES (${now}, ${now}, 7, 'cloud', 'account-a', 'event-1');
      INSERT INTO cloud_sync_state VALUES ('account-a', 7, '2026-10-01T00:00:00Z', 'event-1', ${now});
      INSERT INTO cloud_sync_buckets VALUES ('account-a', 7, ${now - 3600000}, 12, ${now});
      INSERT INTO map_history_settings VALUES (1, '{"dogAliases":{"6":"豆豆"}}');
      CREATE TABLE demo_dog_status (id INTEGER PRIMARY KEY, received_at INTEGER);
      INSERT INTO demo_dog_status VALUES (1, 1000);
      CREATE INDEX idx_demo_dog_status_received_at ON demo_dog_status(received_at, id);
      CREATE TABLE demo_metadata (key TEXT PRIMARY KEY, value TEXT);
      INSERT INTO demo_metadata VALUES ('seed_v1', 'done');
    `);
    await cloud.beginDownload('account-a');
    await cloud.savePage('account-a', [{ event_id: 'staged-event', master_id: 7, slave_id: 7,
      received_at: now + 1, track_at: now + 1, track_time_version: 1,
      slave_lat: 24.9892, slave_lon: 121.3132, activity_valid: 0, battery_valid: 0 }],
    { masterId: 7, throughAt: new Date(now + 1).toISOString(), eventId: 'staged-event' });
    // Every table, including unfinished durable jobs, must survive untouched.
    const tables = connection.sqlite.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'demo_%' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    ).all().map(row => row.name);
    expect(tables).toEqual(expect.arrayContaining(['app_settings', 'cloud_sync_buckets',
      'cloud_sync_state', 'dog_status', 'map_history_settings', 'supabase_dog_status']));
    const snapshot = () => tables.map(table => connection.sqlite
      .prepare(`SELECT * FROM ${table}`).all());
    const before = snapshot();
    const seeded = ['app_settings', 'cloud_sync_buckets', 'cloud_sync_state', 'dog_status',
      'map_history_settings', 'supabase_dog_status', 'cloud_auto_supabase_dog_status',
      'cloud_auto_cloud_sync_state', 'cloud_download_jobs'];
    expect(seeded.every(table => before[tables.indexOf(table)]?.length > 0)).toBe(true);
    // Other job scopes and the transaction-only quota table legitimately start empty.
    // The complete snapshot assertion below still preserves those tables too.
    mockDatabase.executeAsync.mockReset().mockImplementation(connection.executeAsync);
    for (let attempt = 0; attempt < 2; attempt++) {
      const databases = createLocalDatabases();
      await Promise.all([databases.real.initialize(), databases.settings.initialize(),
        databases.cloud.initialize(), databases.history.load()]);
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
