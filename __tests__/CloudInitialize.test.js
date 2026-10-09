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
