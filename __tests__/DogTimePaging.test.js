import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';

test('both time directions match a full ordered scan across large ties and clock reversals', async () => {
  const db = createMemoryConnection();
  try {
    const dog = createDogDatabase(db); await dog.initialize();
    const insert = db.sqlite.prepare('INSERT INTO dog_status(received_at,master_id,slave_id) VALUES (?,5,4)');
    for (let i = 0; i < 3500; i++) insert.run(i < 2200 ? 1500 : 1000 + (i % 1100));
    for (const desc of [false,true]) {
      const read = desc ? dog.listLatestStatusRowsByTimeCursor : dog.listStatusRowsByTimeCursor;
      let key = [null,null]; const found = [];
      for (;;) {
        const page = await read(1200,1900,...key,1000);
        found.push(...page.map(r => r.id));
        if (page.length < 1000) break;
        const last = page.at(-1); key = [last.received_at,last.id];
      }
      const direction = desc ? 'DESC' : 'ASC';
      const expected = db.sqlite.prepare(`SELECT id FROM dog_status WHERE received_at BETWEEN 1200 AND 1900
        ORDER BY received_at ${direction},id ${direction}`).all().map(r => r.id);
      expect(found).toEqual(expected);
      db.sqlite.exec('ANALYZE');
    }
  } finally { db.close(); }
});
