import { dogStatusRow, trackingPoint } from '../__fixtures__/TrackingPointFixtures';
import { createRealTrackingRepository } from '../src/repositories/RealTrackingRepository';

function createDatabase(overrides = {}) {
  return {
    getLatestStatusRow: jest.fn(async () => null),
    listStatusRowsAfterId: jest.fn(async () => []),
    listStatusRowsByTimeCursor: jest.fn(async () => []),
    listLatestStatusRowsByTimeCursor: jest.fn(async () => []),
    getLatestValidStatusRows: jest.fn(async () => []),
    listStatusRowsByDateRange: jest.fn(async () => []),
    ...overrides,
  };
}

describe('RealTrackingRepository', () => {
  test('reads and maps the latest database row', async () => {
    const database = createDatabase({
      getLatestStatusRow: jest.fn(async () => dogStatusRow),
    });
    const repository = createRealTrackingRepository(database);

    await expect(repository.getLatest()).resolves.toEqual(trackingPoint);
  });

  test('returns null when the tracking table is empty', async () => {
    const repository = createRealTrackingRepository(createDatabase());

    await expect(repository.getLatest()).resolves.toBeNull();
  });

  test('reads new rows after the current id cursor', async () => {
    const nextRow = {...dogStatusRow, id: 43};
    const database = createDatabase({
      listStatusRowsAfterId: jest.fn(async () => [dogStatusRow, nextRow]),
    });
    const repository = createRealTrackingRepository(database);

    const points = await repository.getAfterId(41, 50);

    expect(database.listStatusRowsAfterId).toHaveBeenCalledWith(41, 50);
    expect(points.map(point => point.id)).toEqual([42, 43]);
  });

  test('reads a date range for later history screens', async () => {
    const database = createDatabase({
      listStatusRowsByDateRange: jest.fn(async () => [dogStatusRow]),
    });
    const repository = createRealTrackingRepository(database);

    await expect(repository.getByDateRange(1000, 2000, 250, 25))
      .resolves.toEqual([trackingPoint]);
    expect(database.listStatusRowsByDateRange)
      .toHaveBeenCalledWith(1000, 2000, 250, 25);
  });

  test('maps time-cursor pages and bounded marker context', async () => {
    const database = createDatabase({
      listStatusRowsByTimeCursor: jest.fn(async () => [dogStatusRow]),
      listLatestStatusRowsByTimeCursor: jest.fn(async () => [dogStatusRow]),
      getLatestValidStatusRows: jest.fn(async () => [dogStatusRow]),
    });
    const repository = createRealTrackingRepository(database);
    const cursor = {receivedAt: 1500, id: 41};

    await expect(
      repository.getByTimeCursor(1000, 2000, cursor, 250),
    ).resolves.toEqual([trackingPoint]);
    await expect(
      repository.getLatestByTimeCursor(1000, 2000, cursor, 250),
    ).resolves.toEqual([trackingPoint]);
    await expect(repository.getPositionContext(trackingPoint)).resolves.toEqual(
      [trackingPoint],
    );
    expect(database.listStatusRowsByTimeCursor).toHaveBeenCalledWith(
      1000,
      2000,
      1500,
      41,
      250,
    );
    expect(database.listLatestStatusRowsByTimeCursor).toHaveBeenCalledWith(
      1000,
      2000,
      1500,
      41,
      250,
    );
    expect(database.getLatestValidStatusRows).toHaveBeenCalledWith(3, 7, 42);
  });
});
