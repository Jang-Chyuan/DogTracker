import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';

test('one migration per open handle; concurrent and repeated sync ticks do no SQL', async () => {
  const db = createMemoryConnection();
  try {
    await createDogDatabase(db).initialize();
    const a = createCloudDatabase(db), b = createCloudDatabase(db);
    const first = a.initialize();
    expect(b.initialize()).toBe(first);
    await first;
    db.executeAsync.mockClear();
    await Promise.all([a.initialize(), b.initialize()]);
    expect(db.executeAsync).not.toHaveBeenCalled();
    await createCloudDatabase({ ...db }).initialize();
    expect(db.executeAsync).toHaveBeenCalledWith('PRAGMA table_info(supabase_dog_status)');
  } finally { db.close(); }
});

test('failed migration is retried, not cached as a successful open', async () => {
  const db = createMemoryConnection();
  try {
    await createDogDatabase(db).initialize();
    db.executeAsync.mockRejectedValueOnce(new Error('busy'));
    const cloud = createCloudDatabase(db);
    await expect(cloud.initialize()).rejects.toThrow('busy');
    await expect(cloud.initialize()).resolves.toBeUndefined();
    db.executeAsync.mockClear();
    await cloud.initialize();
    expect(db.executeAsync).not.toHaveBeenCalled();
  } finally { db.close(); }
});

test('UI and background wrappers of one native owner share migration and never rerun published maintenance', async () => {
  const db = createMemoryConnection();
  const nativeOwner = {};
  try {
    await createDogDatabase(db).initialize();
    const ui = createCloudDatabase({ ...db, lockKey: nativeOwner });
    const headless = createCloudDatabase({ ...db, lockKey: nativeOwner });
    const ready = ui.initialize();
    expect(headless.initialize()).toBe(ready);
    await ready;
    db.executeAsync.mockClear();
    db.executeBatchAsync.mockClear();
    const laterBackground = createCloudDatabase({ ...db, lockKey: nativeOwner });
    await laterBackground.initialize();
    expect(db.executeAsync).not.toHaveBeenCalled();
    expect(db.executeBatchAsync).not.toHaveBeenCalled();
    await laterBackground.beginDownload('anonymous-owner');
    expect(db.executeAsync.mock.calls.some(([sql]) => /^UPDATE supabase_dog_status|^DELETE FROM supabase_dog_status/.test(sql))).toBe(false);
  } finally { db.close(); }
});
