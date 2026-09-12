import { mockDatabase } from 'react-native-nitro-sqlite';
import { createLocalDatabases } from '../src/database/LocalDatabases';

test('every table migration waits for the shared SQLite lock configuration', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  mockDatabase.executeAsync.mockReset().mockImplementation(async sql =>
    sql === 'PRAGMA busy_timeout=5000' ? gate : { results: [] },
  );
  const databases = createLocalDatabases();
  const pending = Promise.all([
    databases.real.initialize(), databases.demo.initialize(), databases.settings.initialize(),
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
    databases.real.initialize(), databases.demo.initialize(), databases.settings.initialize(),
  ]);
  expect(results.every(result => result.status === 'rejected')).toBe(true);
  expect(mockDatabase.executeAsync).toHaveBeenCalledTimes(1);
  expect(mockDatabase.close).not.toHaveBeenCalled();
  databases.close();
  expect(mockDatabase.close).toHaveBeenCalledTimes(1);
});
