import { createDemoDatabase } from '../src/demo/DemoDatabase';
import { createDemoRow } from '../__fixtures__/DemoRowFixtures';
import { createDemoTrackingRepository } from '../src/demo/DemoTrackingRepository';
import { mapDogStatusRow } from '../src/models/TrackingPoint';

describe('Demo database and repository isolation', () => {
  let connection;
  let database;
  beforeEach(() => {
    connection = {
      executeAsync: jest.fn(async () => ({ results: [], insertId: 41 })),
    };
    database = createDemoDatabase(connection);
  });

  test('migration is additive and repeatable without touching hardware schema or retention', async () => {
    await database.initialize();
    await database.initialize();
    const statements = connection.executeAsync.mock.calls.map(([sql]) => sql);
    expect(statements).toHaveLength(6);
    expect(statements[0]).toContain(
      'CREATE TABLE IF NOT EXISTS demo_dog_status',
    );
    expect(statements[0]).toContain('AUTOINCREMENT');
    expect(statements[1]).toContain(
      'CREATE INDEX IF NOT EXISTS idx_demo_dog_status_received_at',
    );
    expect(statements.join('\n')).not.toMatch(
      /\bdog_status\b|user_version|DELETE|TRIGGER/,
    );
  });

  test('inserts parameterized DB-shaped rows only into the Demo table', async () => {
    const row = createDemoRow(0, 1000);
    await expect(database.insertRow(row)).resolves.toBe(41);
    const [sql, values] = connection.executeAsync.mock.calls[0];
    const columns = sql
      .match(/\(([^)]+)\) VALUES/)[1]
      .split(',')
      .map(value => value.trim());
    expect(sql).toContain('INSERT INTO demo_dog_status');
    expect(columns).toHaveLength(27);
    expect(values).toEqual(columns.map(column => row[column]));
  });

  test('maps Demo rows to the same UI model, without reading the real table', async () => {
    const row = { id: 41, ...createDemoRow(0, 1000) };
    const repository = createDemoTrackingRepository(database);
    connection.executeAsync.mockResolvedValue({ rows: { _array: [row] } });
    await expect(repository.getLatest()).resolves.toEqual(mapDogStatusRow(row));
    await expect(repository.getAfterId(40, 25)).resolves.toEqual([
      mapDogStatusRow(row),
    ]);
    await expect(
      repository.getByTimeCursor(0, 2000, { receivedAt: 1000, id: 40 }, 25),
    ).resolves.toEqual([mapDogStatusRow(row)]);
    await expect(
      repository.getLatestByTimeCursor(
        0,
        2000,
        { receivedAt: 1000, id: 40 },
        25,
      ),
    ).resolves.toEqual([mapDogStatusRow(row)]);
    await expect(
      repository.getPositionContext(mapDogStatusRow(row)),
    ).resolves.toEqual([mapDogStatusRow(row)]);
    await expect(repository.getByDateRange(0, 2000, 25, 10)).resolves.toEqual([
      mapDogStatusRow(row),
    ]);
    expect(connection.executeAsync.mock.calls[1][1]).toEqual([40, 25]);
    expect(connection.executeAsync.mock.calls[2][1]).toEqual([
      2000, 1000, 1000, 40, 25,
    ]);
    expect(connection.executeAsync.mock.calls[3][1]).toEqual([
      0, 1000, 1000, 40, 25,
    ]);
    expect(connection.executeAsync.mock.calls[4][1]).toEqual([
      row.id,
      row.master_id,
      row.id,
      row.slave_id,
    ]);
    expect(connection.executeAsync.mock.calls[5][1]).toEqual([0, 2000, 25, 10]);
    for (const [sql] of connection.executeAsync.mock.calls) {
      expect(sql).toContain('FROM demo_dog_status');
      expect(sql).not.toMatch(/\bdog_status\b/);
    }
  });

  test('supports an empty table, clamps paging, and validates dates', async () => {
    await expect(
      createDemoTrackingRepository(database).getLatest(),
    ).resolves.toBeNull();
    await database.listRowsAfterId(-1, 5000);
    expect(connection.executeAsync.mock.calls[1][1]).toEqual([0, 1000]);
    await database.listRowsByDateRange(0, 10, 2.9, -1);
    expect(connection.executeAsync.mock.calls[2][1]).toEqual([0, 10, 2, 0]);
    await database.listRowsByTimeCursor(0, 10, null, null, 5000);
    expect(connection.executeAsync.mock.calls[3][1]).toEqual([0, 10, 1000]);
    await database.listLatestRowsByTimeCursor(0, 10, null, null, 5000);
    expect(connection.executeAsync.mock.calls[4][1]).toEqual([0, 10, 1000]);
    await expect(database.listRowsByDateRange(10, 0)).rejects.toThrow(
      RangeError,
    );
    await expect(database.listRowsByDateRange(NaN, 0)).rejects.toThrow(
      RangeError,
    );
    await expect(database.listRowsByTimeCursor(0, 10, 5, null)).rejects.toThrow(
      RangeError,
    );
    await expect(
      database.listLatestRowsByTimeCursor(0, 10, 11, 1),
    ).rejects.toThrow(RangeError);
    expect(connection.executeAsync).toHaveBeenCalledTimes(5);
  });
});
