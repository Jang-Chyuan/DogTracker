import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { createHistoryDatabase } from '../src/mapHistory/HistoryDatabase';

test('BLE slave/master index preserves duplicate elimination, order, invalid filtering and cloud owner isolation', async () => {
  const db=createMemoryConnection();
  try {
    await createDogDatabase(db).initialize();
    await createCloudDatabase(db).initialize();
    const insert=db.sqlite.prepare('INSERT INTO dog_status(received_at,slave_id,master_id) VALUES (1,?,?)');
    for (const pair of [[6,3],[4,9],[4,2],[6,3],[null,3],[4,null],[0,2]]) insert.run(...pair);
    const history=createHistoryDatabase(db);
    expect(await history.listDevices('ble')).toEqual([
      {master:2,slave:4},{master:9,slave:4},{master:3,slave:6},
    ]);
    db.sqlite.exec("INSERT INTO supabase_dog_status(received_at,slave_id,master_id,owner_user_id,event_id) VALUES(1,8,1,'a','1'),(1,9,2,'b','2')");
    expect(await history.listDevices('cloud','a')).toEqual([{master:1,slave:8}]);
    expect(await history.listDevices('cloud')).toEqual([]);
    // The existing SQL still caps candidate pairs before invalid-row filtering.
    db.sqlite.exec('DELETE FROM dog_status');
    for(let slave=70;slave>=1;slave-=1) insert.run(slave,1);
    expect(await history.listDevices('ble')).toEqual(Array.from({length:60},(_,i)=>({master:1,slave:i+1})));
  } finally {db.close();}
});
