import {
  createTrackingFeed,
  DEFAULT_LIVE_ROUTE_MAX_POINTS,
  DEFAULT_LIVE_ROUTE_WINDOW_MS,
} from '../src/tracking/TrackingFeed';

const BASE_TIME = 1700000000000;

function createPoint(id, stepMs) {
  return {
    id,
    receivedAt: BASE_TIME + id * stepMs,
    masterId: 3,
    slaveId: 7,
    masterLat: 24.95 + id / 100000000,
    masterLon: 121.2 + id / 100000000,
    slaveLat: 24.951 + id / 100000000,
    slaveLon: 121.201 + id / 100000000,
  };
}

function createLargeRepository(initialLatestId, stepMs) {
  let availableId = initialLatestId;
  return {
    getLatest: jest.fn(async () => createPoint(availableId, stepMs)),
    getPositionContext: jest.fn(async latest => [latest]),
    getLatestByTimeCursor: jest.fn(async (startAt, endAt, cursor, limit) => {
      const firstId = cursor
        ? cursor.id - 1
        : Math.min(availableId, Math.floor((endAt - BASE_TIME) / stepMs));
      const timeBoundaryId = Math.max(
        1,
        Math.ceil((startAt - BASE_TIME) / stepMs),
      );
      const lastId = Math.max(timeBoundaryId, firstId - limit + 1);
      if (firstId < timeBoundaryId) return [];
      return Array.from({ length: firstId - lastId + 1 }, (_, index) =>
        createPoint(firstId - index, stepMs),
      );
    }),
    getAfterId: jest.fn(async (cursor, limit) => {
      const lastId = Math.min(availableId, cursor + limit);
      if (lastId <= cursor) return [];
      return Array.from({ length: lastId - cursor }, (_, index) =>
        createPoint(cursor + index + 1, stepMs),
      );
    }),
    setAvailableId(nextId) {
      availableId = nextId;
    },
  };
}

function createRouteHarness(repository) {
  let route;
  let delivered = 0;
  const feed = createTrackingFeed(repository, {
    includeHistory: true,
    onRoute(nextRoute) {
      route = nextRoute;
    },
    onRows(rows) {
      delivered += rows.length;
    },
  });
  function currentRoute() {
    return route;
  }
  return {
    feed,
    getRoute: currentRoute,
    getDelivered: () => delivered,
  };
}

test('100,000 lifetime rows at one per minute retain the complete latest 24 hours', async () => {
  const repository = createLargeRepository(100000, 60 * 1000);
  const harness = createRouteHarness(repository);

  await harness.feed.refresh();

  const route = harness.getRoute();
  expect(repository.getLatestByTimeCursor).toHaveBeenCalledTimes(2);
  expect(route.rawCount).toBe(1441);
  expect(route.startAt).toBe(createPoint(98560, 60000).receivedAt);
  expect(route.endAt).toBe(createPoint(100000, 60000).receivedAt);
  expect(route.slavePointCount).toBeLessThan(10);
  expect(route.limited).toBe(false);
});

test('full 24h at 1 Hz streams 86,401 raw rows with <=2,000 raw geometry samples retained', async () => {
  const repository = createLargeRepository(100000, 1000);
  const harness = createRouteHarness(repository);

  for (let index = 0; index < 5; index += 1) {
    await expect(harness.feed.refresh()).resolves.toEqual([]);
    expect(harness.getRoute().rawBufferCount).toBeLessThanOrEqual(2000);
  }
  expect(repository.getLatestByTimeCursor).toHaveBeenCalledTimes(87);
  expect(harness.getDelivered()).toBe(86401);
  expect(harness.getRoute().rawCount).toBe(86401);
  expect(harness.getRoute().startAt).toBe(createPoint(13600, 1000).receivedAt);
  expect(harness.getRoute().endAt).toBe(createPoint(100000, 1000).receivedAt);

  repository.setAvailableId(107200);
  await harness.feed.refresh();

  const route = harness.getRoute();
  expect(route.rawCount).toBe(86401);
  expect(route.startAt).toBe(createPoint(20800, 1000).receivedAt);
  expect(route.endAt).toBe(createPoint(107200, 1000).receivedAt);
  expect(route.rawBufferCount).toBeLessThanOrEqual(2000);
  expect(harness.getDelivered()).toBe(86401 + 7200);
  expect(route.masterPointCount).toBeLessThan(DEFAULT_LIVE_ROUTE_MAX_POINTS);
  expect(route.endAt - route.startAt).toBe(DEFAULT_LIVE_ROUTE_WINDOW_MS);
  expect(route.limited).toBe(false);
});
