/* eslint-env node, jest */
// Test-only real SQLite adapter. Batch transactions mirror Nitro's native batch
// contract; Android integration tests separately exercise the actual bridge.
const { DatabaseSync } =
  require('node:module').createRequire(__filename)('node:sqlite');

export function createMemoryConnection() {
  const sqlite = new DatabaseSync(':memory:');
  const execute = (query, params = []) => {
    const results = sqlite.prepare(query).all(...params);
    return {
      results,
      insertId: Number(
        sqlite.prepare('SELECT last_insert_rowid() AS id').get().id,
      ),
    };
  };
  return {
    sqlite,
    executeAsync: jest.fn(async (query, params) => execute(query, params)),
    executeBatchAsync: jest.fn(async commands => {
      sqlite.exec('BEGIN EXCLUSIVE TRANSACTION');
      try {
        for (const { query, params } of commands) execute(query, params);
        sqlite.exec('COMMIT');
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    }),
    close: jest.fn(() => sqlite.close()),
  };
}
