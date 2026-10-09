import { optimizeDatabase } from '../src/database/DatabaseStatistics';

const fakeDb = hasStats => {
  const calls = [];
  return {
    calls,
    executeAsync: async sql => {
      calls.push(sql);
      return { results: sql.includes('sqlite_stat1') && hasStats ? [{ name: 'sqlite_stat1' }] : [] };
    },
  };
};

test('the first ANALYZE is sampled (it holds the shared database lock)', async () => {
  const db = fakeDb(false);
  await optimizeDatabase(db);
  expect(db.calls.slice(1)).toEqual(['PRAGMA analysis_limit=400', 'ANALYZE']);
});

test('later opens only run PRAGMA optimize', async () => {
  const db = fakeDb(true);
  await optimizeDatabase(db);
  expect(db.calls.slice(1)).toEqual(['PRAGMA optimize']);
});
