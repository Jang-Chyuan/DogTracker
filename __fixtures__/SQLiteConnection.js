/* eslint-env node, jest */
/* global BigInt */
// Test-only real SQLite adapter. Batch transactions mirror Nitro's native batch
// contract; Android integration tests separately exercise the actual bridge.
//
// Parameters are bound the way Android's native owner binds them
// (DogStatusStore.executeSql, CloudLatestStore.executeSql), not the way
// node:sqlite would on its own. They cross the bridge as JSON, then
// - a SELECT / PRAGMA / WITH / EXPLAIN binds EVERY parameter as TEXT
//   (rawQuery's String[]; booleans as '1'/'0'). Against a column the column's
//   affinity converts it back, but against an expression with no affinity
//   (COALESCE(a,b) >= ?, a+0 < ?, MAX(x) > ?, a CTE's computed column) the
//   comparison is INTEGER-vs-TEXT and silently wrong: such a query needs
//   CAST(? AS INTEGER) (or REAL).
// - any other statement binds typed: whole numbers as INTEGER (node:sqlite
//   alone binds every number as REAL, so 5 went into a TEXT column as '5.0'),
//   other numbers as REAL, booleans as 1/0, strings as TEXT.
// `{ binding: 'typed' }` keeps node:sqlite's own typed binding.
const { DatabaseSync } =
  require('node:module').createRequire(__filename)('node:sqlite');

const READS = new Set(['SELECT', 'PRAGMA', 'WITH', 'EXPLAIN']);

/** The statement's first word, as the native owner reads it. */
export function sqlVerb(query) {
  return String(query).trimStart().split(/\s/, 1)[0].toUpperCase();
}

/** `params` as Android's native owner binds them for `query`. */
export function androidBoundParams(query, params = []) {
  // The bridge carries JSON: undefined becomes null.
  const values = JSON.parse(JSON.stringify(params ?? []));
  if (READS.has(sqlVerb(query))) {
    return values.map(value => {
      if (value === null) return null;
      if (typeof value === 'boolean') return value ? '1' : '0';
      return typeof value === 'object' ? JSON.stringify(value) : String(value);
    });
  }
  return values.map(value => {
    if (value === null || typeof value === 'string') return value;
    if (typeof value === 'boolean') return value ? 1n : 0n;
    if (typeof value === 'number')
      return Number.isInteger(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER ? BigInt(value) : value;
    throw new Error('Unsupported SQL parameter');
  });
}

/** `params` bound with their own types (the bridge's JSON, whole numbers as INTEGER). */
export function typedBoundParams(query, params = []) {
  return androidBoundParams('INSERT', params);
}

// Every read with parameters also runs with typed binding, and a query whose
// answer depends on the binding fails (the audit of every parameter query the
// suites reach). SQLITE_BINDING_CHECK=0 turns it off; SQLITE_BINDING_LOG names
// a file that lists them (a caller may catch the error).
const checkByDefault = process.env.SQLITE_BINDING_CHECK !== '0';

export function createMemoryConnection({ binding = 'android', checkBinding = checkByDefault } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  const bind = binding === 'typed' ? (_query, params = []) => params ?? [] : androidBoundParams;
  const execute = (query, params = []) => {
    if (checkBinding && params?.length && READS.has(sqlVerb(query))) {
      const typed = JSON.stringify(sqlite.prepare(query).all(...typedBoundParams(query, params)));
      const text = JSON.stringify(sqlite.prepare(query).all(...androidBoundParams(query, params)));
      if (typed !== text) {
        if (process.env.SQLITE_BINDING_LOG) require('fs').appendFileSync(process.env.SQLITE_BINDING_LOG,
          `${JSON.stringify({ query, params })}\n`);
        throw new Error(`SQL answer depends on parameter binding: ${query}`);
      }
    }
    const results = sqlite.prepare(query).all(...bind(query, params));
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
