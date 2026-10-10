import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase, CLOUD_BUDGET_BYTES } from '../src/cloud/CloudDatabase';

test('usage counts all accounts, preserves empty MIN, and measures reception rather than repaired track time', async () => {
  const db=createMemoryConnection();
  try {
    await createDogDatabase(db).initialize();
    const cloud=createCloudDatabase(db); await cloud.initialize();
    expect(await cloud.usage()).toEqual({rows:0,bytes:0,budget:CLOUD_BUDGET_BYTES,from:null});
    const insert=db.sqlite.prepare('INSERT INTO supabase_dog_status(received_at,track_at,owner_user_id,event_id) VALUES(?,?,?,?)');
    insert.run(50,1,'a','1'); insert.run(20,200,'b','2'); insert.run(20,500,'b','3');
    db.executeAsync.mockClear();
    expect(await cloud.usage()).toEqual({rows:3,bytes:1680,budget:CLOUD_BUDGET_BYTES,from:20});
    // Count and minimum share one database statement/snapshot during download.
    expect(db.executeAsync).toHaveBeenCalledTimes(1);
    db.sqlite.exec("DELETE FROM supabase_dog_status WHERE owner_user_id='b'");
    expect(await cloud.usage()).toMatchObject({rows:1,bytes:560,from:50});
  } finally {db.close();}
});
