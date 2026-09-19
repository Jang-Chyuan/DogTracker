import { mockDatabase } from 'react-native-nitro-sqlite';
import { createDogDatabase } from '../src/database/DogDatabase';
import { dogStatusRow } from '../__fixtures__/TrackingPointFixtures';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';

test('cloud history survives initialization and clearing BLE history', async () => {
  const connection = createMemoryConnection();
  const database = createDogDatabase(connection);
  try {
    await database.initialize();
    const columns = table => connection.sqlite
      .prepare(`PRAGMA table_info(${table})`).all();
    expect(columns('supabase_dog_status')).toEqual(columns('dog_status'));
    expect(columns('supabase_dog_status')).not.toHaveLength(0);

    await connection.executeAsync(
      'INSERT INTO dog_status (received_at, slave_id, raw_payload) VALUES (?, ?, ?)',
      [1000, 1, '{"sid":1}'],
    );
    await connection.executeAsync(
      'INSERT INTO supabase_dog_status (received_at, slave_id, raw_payload) VALUES (?, ?, ?)',
      [2000, 1, '{"sid":1,"source":"cloud"}'],
    );
    await database.initialize();
    expect(await database.listHistory()).toHaveLength(1);
    await database.deleteAll();
    expect(await database.listHistory()).toEqual([]);
    expect(connection.sqlite.prepare('SELECT * FROM supabase_dog_status').all())
      .toEqual([expect.objectContaining({
        id: 1,
        received_at: 2000,
        slave_id: 1,
        raw_payload: '{"sid":1,"source":"cloud"}',
        activity_valid: 0,
      })]);
  } finally {
    connection.close();
  }
});

describe('DogDatabase tracking reads', () => {
  beforeEach(() => {
    mockDatabase.executeAsync.mockReset();
    mockDatabase.executeAsync.mockResolvedValue({insertId: 1, results: []});
  });

  test('replaces the global trigger without an unconditional history wipe', async () => {
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

  test('fallback retention applies 10,000 rows independently to each Slave', async () => {
    mockDatabase.executeAsync.mockImplementation(async sql => ({
      results: sql.includes('SELECT DISTINCT slave_id') ? [{slave_id: 1}, {slave_id: 2}] : [],
    }));
    await createDogDatabase().initialize();
    const deletes = mockDatabase.executeAsync.mock.calls.filter(([sql]) =>
      sql.includes('DELETE FROM dog_status'),
    );
    expect(deletes.map(([, params]) => params)).toEqual([[1, 1, 10000], [2, 2, 10000]]);
    expect(deletes.every(([sql]) => sql.includes('WHERE slave_id = ?'))).toBe(true);
    expect(mockDatabase.executeAsync.mock.calls.join(' ')).not.toContain('demo_dog_status');
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
    // The cursor is split into its two halves instead of being written as one
    // OR, so each half can walk the index in order. Correctness of the split,
    // including rows sharing a timestamp, is checked against real SQLite in
    // "keyset paging returns every row exactly once, ties included".
    expect(sql).toContain('UNION ALL');
    expect(sql).not.toContain('OFFSET');
    expect(params).toEqual([1500, 42, 2000, 1000, 1500, 2000, 1000, 1000]);
  });

  test('pages newest rows backwards without OFFSET', async () => {
    mockDatabase.executeAsync.mockResolvedValue({results: [dogStatusRow]});
    const database = createDogDatabase();

    await expect(
      database.listLatestStatusRowsByTimeCursor(1000, 2000, 1500, 42, 5000),
    ).resolves.toEqual([dogStatusRow]);

    const [sql, params] = mockDatabase.executeAsync.mock.calls[0];
    expect(sql).toContain('UNION ALL');
    expect(sql).toContain('ORDER BY received_at DESC, id DESC');
    expect(sql).not.toContain('OFFSET');
    expect(params).toEqual([1500, 42, 1000, 1000, 1000, 1500, 1000, 1000]);
  });

  test('keyset paging returns every row exactly once, ties included', async () => {
    const connection = createMemoryConnection();
    const database = createDogDatabase(connection);
    try {
      await database.initialize();
      // Six dogs answering inside the same millisecond, twice: ties are what
      // the id half of the cursor exists for, and what the old single OR made
      // SQLite sort the whole window to resolve.
      const written = [];
      for (let step = 0; step < 4; step += 1) {
        for (let dog = 1; dog <= 6; dog += 1) {
          const receivedAt = 1000 + Math.floor(step / 2) * 10;
          written.push({ receivedAt, slaveId: dog });
          await connection.executeAsync(
            'INSERT INTO dog_status (received_at, slave_id) VALUES (?, ?)',
            [receivedAt, dog],
          );
        }
      }
      const ids = connection.sqlite
        .prepare('SELECT id, received_at FROM dog_status ORDER BY id').all();
      const page = async (read, cursor) =>
        (cursor ? read(1000, 1010, cursor.received_at, cursor.id, 5)
          : read(1000, 1010, null, null, 5));

      const forwards = [];
      for (let cursor = null; ;) {
        const rows = await page(database.listStatusRowsByTimeCursor, cursor);
        if (!rows.length) break;
        forwards.push(...rows);
        cursor = rows[rows.length - 1];
      }
      expect(forwards.map(row => row.id))
        .toEqual(ids.map(row => row.id));

      const backwards = [];
      for (let cursor = null; ;) {
        const rows = await page(database.listLatestStatusRowsByTimeCursor, cursor);
        if (!rows.length) break;
        backwards.push(...rows);
        cursor = rows[rows.length - 1];
      }
      expect(backwards.map(row => row.id))
        .toEqual([...ids].reverse().map(row => row.id));
      expect(written).toHaveLength(ids.length);
    } finally {
      connection.close();
    }
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
