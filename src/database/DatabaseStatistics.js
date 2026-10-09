// Run at open, after schema migration, never on a polling path. Old Android
// SQLite accepts PRAGMA optimize even when it does not implement that pragma.
export async function optimizeDatabase(db) {
  const result = await db.executeAsync(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='sqlite_stat1'",
  );
  if (!(result.results || result.rows?._array || []).length) {
    await db.executeAsync('ANALYZE');
  } else {
    await db.executeAsync('PRAGMA optimize');
  }
}
