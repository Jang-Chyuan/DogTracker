import { trackingPoint } from '../__fixtures__/TrackingPointFixtures';
import { createTrackingFeed } from '../src/tracking/TrackingFeed';

function createRepository(overrides = {}) {
  return {
    getLatest: jest.fn(async () => null),
    getAfterId: jest.fn(async () => []),
    ...overrides,
  };
}

function createTimers() {
  return {
    clearInterval: jest.fn(),
    setInterval: jest.fn(() => 99),
  };
}

describe('TrackingFeed', () => {
  test('stop drains the pending query before the database owner can close', async () => {
    let resolveLatest;
    const repository = createRepository({
      getLatest: jest.fn(() => new Promise(resolve => { resolveLatest = resolve; })),
    });
    const onRows = jest.fn();
    const feed = createTrackingFeed(repository, {onRows});
    const pending = feed.refresh();
    let drained = false;
    const stopping = feed.stop().then(() => { drained = true; });
    await Promise.resolve();
    expect(drained).toBe(false);
    resolveLatest(trackingPoint);
    await Promise.all([pending, stopping]);
    expect(drained).toBe(true);
    expect(onRows).not.toHaveBeenCalled();
    expect(feed.getCursor()).toBeNull();
  });
  test('reports successful empty reads separately from new rows', async () => {
    const repository = createRepository();
    const onSuccess = jest.fn();
    const onRows = jest.fn();
    const feed = createTrackingFeed(repository, {onSuccess, onRows});

    await feed.refresh();
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onRows).not.toHaveBeenCalled();
    repository.getLatest.mockResolvedValueOnce(trackingPoint);
    await feed.refresh();
    await feed.refresh();
    expect(onSuccess).toHaveBeenCalledTimes(3);
    expect(onRows).toHaveBeenCalledTimes(1);
    expect(feed.getCursor()).toBe(42);
  });

  test('reports recovery on an empty query, but not a partially failed refresh', async () => {
    const repository = createRepository({
      getLatest: jest.fn(async () => trackingPoint),
    });
    const onSuccess = jest.fn();
    const onError = jest.fn();
    const feed = createTrackingFeed(repository, {onSuccess, onError, batchSize: 1});
    await feed.refresh();
    onSuccess.mockClear();
    repository.getAfterId
      .mockResolvedValueOnce([{...trackingPoint, id: 43}])
      .mockRejectedValueOnce(new Error('read failed'));
    await feed.refresh();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(feed.getCursor()).toBe(43);
    await feed.refresh();
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  test('a stale successful read cannot clear a newer error state after stop', async () => {
    let resolveLatest;
    const repository = createRepository({
      getLatest: jest.fn(() => new Promise(resolve => { resolveLatest = resolve; })),
    });
    const onSuccess = jest.fn();
    const feed = createTrackingFeed(repository, {onSuccess});
    const pending = feed.refresh();
    feed.stop();
    resolveLatest(null);
    await pending;
    expect(onSuccess).not.toHaveBeenCalled();
  });

  test('a delivery failure is not reported as a successful refresh', async () => {
    const onSuccess = jest.fn();
    const onError = jest.fn();
    const feed = createTrackingFeed(createRepository({
      getLatest: jest.fn(async () => trackingPoint),
    }), {
      onSuccess,
      onError,
      onRows() { throw new Error('delivery failed'); },
    });
    await feed.refresh();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(feed.getCursor()).toBeNull();
  });

  test('loads the latest row first, then queries incrementally by id', async () => {
    const nextPoint = {...trackingPoint, id: 43};
    const repository = createRepository({
      getLatest: jest.fn(async () => trackingPoint),
      getAfterId: jest.fn(async () => [nextPoint]),
    });
    const onRows = jest.fn();
    const feed = createTrackingFeed(repository, {onRows});

    await feed.refresh();
    await feed.refresh();

    expect(repository.getLatest).toHaveBeenCalledTimes(1);
    expect(repository.getAfterId).toHaveBeenCalledWith(42, 1000);
    expect(feed.getCursor()).toBe(43);
    expect(onRows).toHaveBeenNthCalledWith(1, [trackingPoint]);
    expect(onRows).toHaveBeenNthCalledWith(2, [nextPoint]);
  });

  test('starts immediately and keeps its cursor across stop and restart', async () => {
    const nextPoint = {...trackingPoint, id: 43};
    const repository = createRepository({
      getLatest: jest.fn(async () => trackingPoint),
      getAfterId: jest.fn(async () => [nextPoint]),
    });
    const timers = createTimers();
    const feed = createTrackingFeed(repository, {timers});

    feed.start();
    await feed.refresh();
    feed.stop();
    feed.start();
    await feed.refresh();

    expect(timers.setInterval).toHaveBeenCalledTimes(2);
    expect(timers.clearInterval).toHaveBeenCalledWith(99);
    expect(repository.getAfterId).toHaveBeenCalledWith(42, 1000);
  });

  test('drains multiple backlog batches in one refresh', async () => {
    const point43 = {...trackingPoint, id: 43};
    const point44 = {...trackingPoint, id: 44};
    const point45 = {...trackingPoint, id: 45};
    const repository = createRepository({
      getLatest: jest.fn(async () => trackingPoint),
      getAfterId: jest.fn()
        .mockResolvedValueOnce([point43, point44])
        .mockResolvedValueOnce([point45]),
    });
    const onRows = jest.fn();
    const feed = createTrackingFeed(repository, {batchSize: 2, onRows});

    await feed.refresh();
    await expect(feed.refresh()).resolves.toEqual([point43, point44, point45]);

    expect(repository.getAfterId).toHaveBeenNthCalledWith(1, 42, 2);
    expect(repository.getAfterId).toHaveBeenNthCalledWith(2, 44, 2);
    expect(feed.getCursor()).toBe(45);
    expect(onRows).toHaveBeenNthCalledWith(2, [point43, point44]);
    expect(onRows).toHaveBeenNthCalledWith(3, [point45]);
  });

  test('does not overlap database refreshes', async () => {
    let resolveLatest;
    const repository = createRepository({
      getLatest: jest.fn(() => new Promise(resolve => {
        resolveLatest = resolve;
      })),
    });
    const feed = createTrackingFeed(repository);

    const first = feed.refresh();
    const second = feed.refresh();
    resolveLatest(trackingPoint);

    await Promise.all([first, second]);
    expect(repository.getLatest).toHaveBeenCalledTimes(1);
  });

  test('reports read errors without advancing the cursor', async () => {
    const error = new Error('read failed');
    const repository = createRepository({
      getLatest: jest.fn(async () => {
        throw error;
      }),
    });
    const onError = jest.fn();
    const feed = createTrackingFeed(repository, {onError});

    await expect(feed.refresh()).resolves.toEqual([]);
    expect(onError).toHaveBeenCalledWith(error);
    expect(feed.getCursor()).toBeNull();
  });

  test('ignores an in-flight result after the feed is stopped', async () => {
    let resolveLatest;
    const repository = createRepository({
      getLatest: jest.fn(() => new Promise(resolve => {
        resolveLatest = resolve;
      })),
    });
    const onRows = jest.fn();
    const timers = createTimers();
    const feed = createTrackingFeed(repository, {onRows, timers});

    feed.start();
    const inFlight = feed.refresh();
    feed.stop();
    resolveLatest(trackingPoint);
    await inFlight;

    expect(onRows).not.toHaveBeenCalled();
    expect(feed.getCursor()).toBeNull();
  });

  test('refreshes immediately after restart without overlapping a stale query', async () => {
    let resolveFirstRead;
    const repository = createRepository({
      getLatest: jest.fn()
        .mockImplementationOnce(() => new Promise(resolve => {
          resolveFirstRead = resolve;
        }))
        .mockResolvedValueOnce(trackingPoint),
    });
    const onRows = jest.fn();
    const timers = createTimers();
    const feed = createTrackingFeed(repository, {onRows, timers});

    feed.start();
    const staleRead = feed.refresh();
    feed.stop();
    feed.start();
    const restartedRead = feed.refresh();

    expect(repository.getLatest).toHaveBeenCalledTimes(1);
    resolveFirstRead(trackingPoint);
    await staleRead;
    await restartedRead;

    expect(repository.getLatest).toHaveBeenCalledTimes(2);
    expect(onRows).toHaveBeenCalledTimes(1);
    expect(onRows).toHaveBeenCalledWith([trackingPoint]);
    expect(feed.getCursor()).toBe(42);
    feed.stop();
  });

  test('does not advance the cursor when delivery fails', async () => {
    const error = new Error('delivery failed');
    const onError = jest.fn();
    const feed = createTrackingFeed(createRepository({
      getLatest: jest.fn(async () => trackingPoint),
    }), {
      onError,
      onRows() {
        throw error;
      },
    });

    await expect(feed.refresh()).resolves.toEqual([]);
    expect(onError).toHaveBeenCalledWith(error);
    expect(feed.getCursor()).toBeNull();
  });
});
