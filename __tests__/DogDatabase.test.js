import { mockDatabase } from 'react-native-nitro-sqlite';
import { createDogDatabase } from '../src/database/DogDatabase';
import { dogStatusRow } from '../__fixtures__/TrackingPointFixtures';

describe('DogDatabase tracking reads', () => {
  beforeEach(() => {
    mockDatabase.executeAsync.mockReset();
    mockDatabase.executeAsync.mockResolvedValue({insertId: 1, results: []});
  });

  test('removes legacy App-owned retention without deleting tracking rows', async () => {
    const database = createDogDatabase();

    await database.initialize();

    const statements = mockDatabase.executeAsync.mock.calls.map(([sql]) =>
      sql.replace(/\s+/g, ' ').trim(),
    );
    expect(statements).toContain(
      'DROP TRIGGER IF EXISTS trim_dog_status_after_insert',
    );
    expect(statements).toContain(
      'CREATE INDEX IF NOT EXISTS idx_dog_status_received_at_id ON dog_status(received_at, id)',
    );
    expect(statements).toContain(
      'DROP INDEX IF EXISTS idx_dog_status_received_at',
    );
    expect(statements.join('\n')).not.toMatch(
      /CREATE TRIGGER|DELETE FROM dog_status|LIMIT 10000/,
    );
  });

  test('reads the latest dog_status row', async () => {
    mockDatabase.executeAsync.mockResolvedValueOnce({results: [dogStatusRow]});
    const database = createDogDatabase();

    await expect(database.getLatestStatusRow()).resolves.toEqual(dogStatusRow);
    expect(mockDatabase.executeAsync.mock.calls[0][0])
      .toContain('ORDER BY id DESC');
  });

  test('reads rows after a bounded id cursor', async () => {
    mockDatabase.executeAsync.mockResolvedValueOnce({results: [dogStatusRow]});
    const database = createDogDatabase();

    await expect(database.listStatusRowsAfterId(-10, 5000))
      .resolves.toEqual([dogStatusRow]);
    expect(mockDatabase.executeAsync.mock.calls[0][0]).toContain('WHERE id > ?');
    expect(mockDatabase.executeAsync.mock.calls[0][1]).toEqual([0, 1000]);
  });

  test('reads rows inside an inclusive date range', async () => {
    mockDatabase.executeAsync.mockResolvedValueOnce({
      rows: {_array: [dogStatusRow]},
    });
    const database = createDogDatabase();

    await expect(database.listStatusRowsByDateRange(1000, 2000, 250, 25))
      .resolves.toEqual([dogStatusRow]);
    expect(mockDatabase.executeAsync.mock.calls[0][1])
      .toEqual([1000, 2000, 250, 25]);
  });

  test('pages a time range by timestamp and id without OFFSET', async () => {
    mockDatabase.executeAsync.mockResolvedValue({results: [dogStatusRow]});
    const database = createDogDatabase();

    await expect(
      database.listStatusRowsByTimeCursor(1000, 2000, 1500, 42, 5000),
    ).resolves.toEqual([dogStatusRow]);

    const [sql, params] = mockDatabase.executeAsync.mock.calls[0];
    expect(sql).toContain('(received_at > ? OR (received_at = ? AND id > ?))');
    expect(sql).not.toContain('OFFSET');
    expect(params).toEqual([2000, 1500, 1500, 42, 1000]);
  });

  test('pages newest rows backwards without OFFSET', async () => {
    mockDatabase.executeAsync.mockResolvedValue({results: [dogStatusRow]});
    const database = createDogDatabase();

    await expect(
      database.listLatestStatusRowsByTimeCursor(1000, 2000, 1500, 42, 5000),
    ).resolves.toEqual([dogStatusRow]);

    const [sql, params] = mockDatabase.executeAsync.mock.calls[0];
    expect(sql).toContain('(received_at < ? OR (received_at = ? AND id < ?))');
    expect(sql).toContain('ORDER BY received_at DESC, id DESC');
    expect(sql).not.toContain('OFFSET');
    expect(params).toEqual([1000, 1500, 1500, 42, 1000]);
  });

  test('loads bounded marker fallback rows for the active device IDs', async () => {
    mockDatabase.executeAsync.mockResolvedValue({results: [dogStatusRow]});
    const database = createDogDatabase();

    await expect(database.getLatestValidStatusRows(3, 7, 42)).resolves.toEqual([
      dogStatusRow,
    ]);
    const [sql, params] = mockDatabase.executeAsync.mock.calls[0];
    expect(sql.match(/LIMIT 1/g)).toHaveLength(2);
    expect(params).toEqual([42, 3, 42, 7]);
  });

  test('rejects an invalid date range', async () => {
    const database = createDogDatabase();

    await expect(database.listStatusRowsByDateRange(2000, 1000))
      .rejects.toThrow(RangeError);
    expect(mockDatabase.executeAsync).not.toHaveBeenCalled();
  });

  test('rejects incomplete and invalid time cursors', async () => {
    const database = createDogDatabase();

    await expect(
      database.listStatusRowsByTimeCursor(2000, 1000),
    ).rejects.toThrow(RangeError);
    await expect(
      database.listStatusRowsByTimeCursor(1000, 2000, 1500, null),
    ).rejects.toThrow(RangeError);
    await expect(
      database.listLatestStatusRowsByTimeCursor(1000, 2000, 999, 42),
    ).rejects.toThrow(RangeError);
    expect(mockDatabase.executeAsync).not.toHaveBeenCalled();
  });
});
