import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDemoDatabase } from '../src/demo/DemoDatabase';
import { createDemoPresetRow, createDemoSeed } from '../src/demo/DemoPresets';

let connection, database;
beforeEach(async () => {
  connection = createMemoryConnection();
  database = createDemoDatabase(connection);
  await database.initialize();
  // A separate real table verifies that Demo operations cannot alter it.
  connection.sqlite.exec(
    "CREATE TABLE dog_status (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO dog_status VALUES (42, 'hardware')",
  );
});
afterEach(() => connection.close());
const rows = () =>
  connection.sqlite.prepare('SELECT * FROM demo_dog_status ORDER BY id').all();
const seed = () => createDemoSeed(10000);

test('first initialization seeds A/B/C once, reopening preserves manually appended rows', async () => {
  await database.ensureSeed(seed());
  expect(rows().map(row => row.packet_type)).toEqual([
    'DEMO_A',
    'DEMO_B',
    'DEMO_C',
  ]);
  expect(rows().map(row => row.received_at)).toEqual([8000, 9000, 10000]);
  await database.insertRow(createDemoPresetRow('A', 11000));
  await database.initialize();
  await database.ensureSeed(createDemoSeed(20000));
  expect(rows()).toHaveLength(4);
  expect(await database.getSummary()).toEqual({ count: 4, latestPreset: 'A' });
});
test('upgrading a populated Demo DB preserves its data without appending presets', async () => {
  await database.insertRow(createDemoPresetRow('B', 1000));
  const before = rows();
  await database.ensureSeed(seed());
  expect(rows()).toEqual(before);
  expect(await database.getSummary()).toEqual({ count: 1, latestPreset: 'B' });
});
test('reset atomically replaces five rows with three and keeps IDs monotonic', async () => {
  await database.ensureSeed(seed());
  await database.insertRow(createDemoPresetRow('A', 11000));
  await database.insertRow(createDemoPresetRow('B', 12000));
  await database.resetToSeed(createDemoSeed(30000));
  expect(rows().map(row => row.id)).toEqual([6, 7, 8]);
  expect(rows().map(row => row.received_at)).toEqual([28000, 29000, 30000]);
  expect(await database.getSummary()).toEqual({ count: 3, latestPreset: 'C' });
  expect(connection.sqlite.prepare('SELECT * FROM dog_status').all()).toEqual([
    { id: 42, value: 'hardware' },
  ]);
});
test.each(['ensureSeed', 'resetToSeed'])(
  '%s rolls back the whole transaction if the second insert fails',
  async method => {
    if (method === 'resetToSeed')
      await database.insertRow(createDemoPresetRow('C', 1000));
    const before = rows();
    connection.sqlite.exec(
      "CREATE TRIGGER fail_second BEFORE INSERT ON demo_dog_status WHEN NEW.packet_type = 'DEMO_B' BEGIN SELECT RAISE(ABORT, 'injected write failure'); END",
    );
    await expect(database[method](seed())).rejects.toThrow(
      'injected write failure',
    );
    expect(rows()).toEqual(before);
    expect(
      connection.sqlite.prepare('SELECT * FROM demo_metadata').all(),
    ).toEqual([]);
    connection.sqlite.exec('DROP TRIGGER fail_second');
    await database[method](seed());
    expect(rows()).toHaveLength(3);
  },
);
test('invalid preset/time never creates a row, and preset coordinates are the approved Taoyuan points', () => {
  expect(() => createDemoPresetRow('Z', 1000)).toThrow();
  expect(() => createDemoPresetRow('A', NaN)).toThrow();
  expect(createDemoPresetRow('C', 1000)).toMatchObject({
    master_lat: 25.0181,
    master_lon: 121.3257,
    slave_lat: 25.01765,
    slave_lon: 121.3267,
  });
  const distances = new Set(seed().map(row => row.distance_meters));
  expect(distances.size).toBe(3);
});
