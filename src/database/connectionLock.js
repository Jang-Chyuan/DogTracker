const pending = new WeakMap();

// Runs `work` after the work queued before it on the same SQLite connection:
// migrations, downloads and display-coordinate writes never interleave.
export function withConnectionLock(db, work) {
  const key = db.lockKey || db;
  const result = (pending.get(key) || Promise.resolve()).then(work);
  pending.set(key, result.catch(() => {}));
  return result;
}
