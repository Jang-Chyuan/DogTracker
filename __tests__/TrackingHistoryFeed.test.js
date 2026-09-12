import {
  createTrackingFeed,
  DEFAULT_LIVE_ROUTE_MAX_POINTS,
  DEFAULT_LIVE_ROUTE_WINDOW_MS,
} from '../src/tracking/TrackingFeed';

const row = (id, receivedAt = id * 1000) => ({ id, receivedAt });

function latestTimePage(values) {
  return async (start, end, cursor, limit) =>
    [...values]
      .filter(item => item.receivedAt >= start)
      .filter(item => item.receivedAt <= end)
      .filter(
        item =>
          !cursor ||
          item.receivedAt < cursor.receivedAt ||
          (item.receivedAt === cursor.receivedAt && item.id < cursor.id),
      )
      .sort(
        (left, right) =>
          right.receivedAt - left.receivedAt || right.id - left.id,
      )
      .slice(0, limit);
}

test('latest status is immediate and the exact live window uses its own time cursor', async () => {
  const history = [row(1), row(2), row(3), row(4), row(5)];
  const repository = {
    getLatest: jest.fn(async () => row(5)),
    getPositionContext: jest.fn(async () => []),
    getLatestByTimeCursor: jest.fn(latestTimePage(history)),
    getAfterId: jest.fn(async id => (id < 6 ? [row(6)] : [])),
  };
  const onLatest = jest.fn();
  const onInitialSnapshotReady = jest.fn();
  const onRows = jest.fn();
  const onHistoryLoaded = jest.fn();
  const onCaughtUp = jest.fn();
  const onWindowCutoff = jest.fn();
  const feed = createTrackingFeed(repository, {
    includeHistory: true,
    batchSize: 2,
    maxBatchesPerRefresh: 2,
    onLatest,
    onInitialSnapshotReady,
    onRows,
    onHistoryLoaded,
    onCaughtUp,
    onWindowCutoff,
  });

  await feed.refresh();

  expect(onLatest).toHaveBeenCalledWith(row(5));
  expect(onInitialSnapshotReady).toHaveBeenCalledTimes(1);
  expect(onWindowCutoff).toHaveBeenCalledWith(
    5000 - DEFAULT_LIVE_ROUTE_WINDOW_MS,
    DEFAULT_LIVE_ROUTE_MAX_POINTS,
  );
  expect(onRows.mock.calls).toEqual([
    [[row(6)]],
    [[row(5), row(4)]],
    [[row(3), row(2)]],
  ]);
  expect(onCaughtUp).toHaveBeenCalled();
  expect(onHistoryLoaded).not.toHaveBeenCalled();

  await feed.refresh();

  expect(repository.getLatestByTimeCursor).toHaveBeenNthCalledWith(
    3,
    6000 - DEFAULT_LIVE_ROUTE_WINDOW_MS,
    5000,
    { receivedAt: 2000, id: 2 },
    2,
  );
  expect(onRows).toHaveBeenNthCalledWith(4, [row(1)]);
  expect(onHistoryLoaded).toHaveBeenCalledTimes(1);
  expect(onInitialSnapshotReady).toHaveBeenCalledTimes(1);
  expect(onCaughtUp).toHaveBeenCalledTimes(3);
  expect(feed.getCursor()).toBe(6);
  expect(feed.getWindowCutoff()).toBe(6000 - DEFAULT_LIVE_ROUTE_WINDOW_MS);
});

test('partial history failure resumes from the delivered time and id cursor', async () => {
  const repository = {
    getLatest: jest.fn(async () => row(5)),
    getLatestByTimeCursor: jest
      .fn()
      .mockResolvedValueOnce([row(5), row(4)])
      .mockRejectedValueOnce(new Error('locked'))
      .mockResolvedValueOnce([row(3), row(2)])
      .mockResolvedValueOnce([row(1)]),
    getAfterId: jest.fn(async () => []),
  };
  const onError = jest.fn();
  const onHistoryLoaded = jest.fn();
  const onCaughtUp = jest.fn();
  const feed = createTrackingFeed(repository, {
    includeHistory: true,
    batchSize: 2,
    onError,
    onHistoryLoaded,
    onCaughtUp,
  });

  await feed.refresh();

  expect(feed.getCursor()).toBe(5);
  expect(onError).toHaveBeenCalledWith(new Error('locked'));
  expect(onHistoryLoaded).not.toHaveBeenCalled();
  expect(onCaughtUp).toHaveBeenCalledTimes(2);

  await feed.refresh();

  expect(repository.getLatestByTimeCursor).toHaveBeenNthCalledWith(
    3,
    5000 - DEFAULT_LIVE_ROUTE_WINDOW_MS,
    5000,
    { receivedAt: 4000, id: 4 },
    2,
  );
  expect(onHistoryLoaded).toHaveBeenCalledTimes(1);
  expect(onCaughtUp).toHaveBeenCalledTimes(4);
});

test('a failed marker-context read retries initialization without corrupting cursors', async () => {
  const repository = {
    getLatest: jest.fn(async () => row(5)),
    getPositionContext: jest
      .fn()
      .mockRejectedValueOnce(new Error('context locked'))
      .mockResolvedValueOnce([]),
    getLatestByTimeCursor: jest.fn(async () => [row(5)]),
    getAfterId: jest.fn(async () => []),
  };
  const onError = jest.fn();
  const onInitialSnapshotReady = jest.fn();
  const feed = createTrackingFeed(repository, {
    includeHistory: true,
    onError,
    onInitialSnapshotReady,
  });

  await feed.refresh();

  expect(onError).toHaveBeenCalledWith(new Error('context locked'));
  expect(feed.getCursor()).toBeNull();
  expect(feed.getWindowCutoff()).toBeNull();
  expect(repository.getLatestByTimeCursor).not.toHaveBeenCalled();
  expect(onInitialSnapshotReady).not.toHaveBeenCalled();

  await feed.refresh();

  expect(repository.getLatest).toHaveBeenCalledTimes(2);
  expect(repository.getLatestByTimeCursor).toHaveBeenCalledTimes(1);
  expect(feed.getCursor()).toBe(5);
  expect(onInitialSnapshotReady).toHaveBeenCalledTimes(1);
});

test('empty DB catches up once and subsequently discovers inserted rows', async () => {
  const repository = {
    getLatest: jest.fn(async () => null),
    getLatestByTimeCursor: jest.fn(async () => []),
    getAfterId: jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([row(1)]),
  };
  const onRows = jest.fn();
  const onHistoryLoaded = jest.fn();
  const onWindowCutoff = jest.fn();
  const onInitialSnapshotReady = jest.fn();
  const onRoute = jest.fn();
  const feed = createTrackingFeed(repository, {
    includeHistory: true,
    onRows,
    onHistoryLoaded,
    onWindowCutoff,
    onInitialSnapshotReady,
    onRoute,
  });

  await feed.refresh();
  expect(onRoute).toHaveBeenLastCalledWith(
    expect.objectContaining({ rawCount: 0, limited: false }),
  );
  await feed.refresh();
  expect(onRoute).toHaveBeenLastCalledWith(
    expect.objectContaining({ rawCount: 1, limited: false }),
  );

  expect(repository.getLatest).toHaveBeenCalledTimes(1);
  expect(repository.getLatestByTimeCursor).not.toHaveBeenCalled();
  expect(onRows).toHaveBeenCalledWith([row(1)]);
  expect(onWindowCutoff).toHaveBeenCalledWith(
    1000 - DEFAULT_LIVE_ROUTE_WINDOW_MS,
    DEFAULT_LIVE_ROUTE_MAX_POINTS,
  );
  expect(onHistoryLoaded).toHaveBeenCalledTimes(1);
  expect(onInitialSnapshotReady).toHaveBeenCalledTimes(1);
});

test.each(['latest read failure', 'position context failure', 'invalid time'])(
  '%s does not misreport drawing truncation and can recover',
  async scenario => {
    const onRoute = jest.fn();
    const onError = jest.fn();
    const repository = {
      getLatest: jest.fn(async () => row(1)),
      getPositionContext: jest.fn(async () => []),
      getAfterId: jest.fn(async () => []),
      getLatestByTimeCursor: jest.fn(async () => [row(1)]),
    };
    if (scenario === 'latest read failure')
      repository.getLatest.mockRejectedValueOnce(new Error('locked'));
    if (scenario === 'position context failure')
      repository.getPositionContext.mockRejectedValueOnce(new Error('locked'));
    if (scenario === 'invalid time') {
      repository.getLatest.mockResolvedValueOnce(row(1, null));
      repository.getAfterId
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([row(2)]);
    }
    const feed = createTrackingFeed(repository, {
      includeHistory: true,
      onRoute,
      onError,
    });
    await feed.refresh();
    expect(onRoute).toHaveBeenLastCalledWith(
      expect.objectContaining({ rawCount: 0, limited: false }),
    );
    expect(onError).toHaveBeenCalledTimes(scenario === 'invalid time' ? 0 : 1);
    await feed.refresh();
    expect(onRoute).toHaveBeenLastCalledWith(
      expect.objectContaining({ rawCount: 1, limited: false }),
    );
  },
);

test('time cursor preserves all rows sharing one timestamp', async () => {
  const values = [row(1, 1000), row(2, 1000), row(3, 1000)];
  const repository = {
    getLatest: jest.fn(async () => row(3, 1000)),
    getLatestByTimeCursor: jest.fn(latestTimePage(values)),
    getAfterId: jest.fn(async () => []),
  };
  const onRows = jest.fn();
  const feed = createTrackingFeed(repository, {
    includeHistory: true,
    batchSize: 2,
    onRows,
  });

  await feed.refresh();

  expect(onRows.mock.calls.flat(2).map(item => item.id)).toEqual([3, 2, 1]);
  expect(repository.getLatestByTimeCursor).toHaveBeenNthCalledWith(
    2,
    1000 - DEFAULT_LIVE_ROUTE_WINDOW_MS,
    1000,
    { receivedAt: 1000, id: 2 },
    2,
  );
});

test('backfill stops at the display/metadata budget, not a raw-row count', async () => {
  const values = Array.from({ length: 10 }, (_, index) => row(index + 1));
  const repository = {
    getLatest: jest.fn(async () => row(10)),
    getLatestByTimeCursor: jest.fn(latestTimePage(values)),
    getAfterId: jest.fn(async () => []),
  };
  const onRows = jest.fn();
  const feed = createTrackingFeed(repository, {
    includeHistory: true,
    batchSize: 2,
    displayMaxPoints: 5,
    onRows,
  });

  await feed.refresh();

  expect(onRows.mock.calls.flat(2).map(item => item.id)).toEqual([
    10, 9, 8, 7, 6, 5,
  ]);
  expect(repository.getLatestByTimeCursor).toHaveBeenCalledTimes(3);
  expect(repository.getLatestByTimeCursor.mock.calls[2][3]).toBe(2);
});

const located = (id, time = id * 1000) => ({
  ...row(id, time),
  masterId: 1,
  slaveId: 2,
  masterLat: 25,
  masterLon: 121 + id / 1000,
  slaveLat: 25 + (id % 2) / 1000,
  slaveLon: 121 + id / 1000,
});

test('persistent history errors do not block newly received statuses', async () => {
  let available = 5;
  const repository = {
    getLatest: async () => located(5),
    getLatestByTimeCursor: async () => {
      throw new Error('history locked');
    },
    getAfterId: async cursor =>
      cursor < available ? [located(available)] : [],
  };
  const onRows = jest.fn(),
    onError = jest.fn(),
    onSuccess = jest.fn();
  const feed = createTrackingFeed(repository, {
    includeHistory: true,
    onRows,
    onError,
    onSuccess,
  });
  await feed.refresh();
  available = 6;
  await feed.refresh();
  available = 7;
  await feed.refresh();
  expect(onRows.mock.calls.flat(2).map(point => point.id)).toEqual([6, 7]);
  expect(feed.getCursor()).toBe(7);
  expect(onError).toHaveBeenCalledTimes(3);
  expect(onSuccess).not.toHaveBeenCalled();
});

test('late timestamps rebuild a raw snapshot without duplicates or losing live status', async () => {
  const values = [1, 2, 3, 4, 5].map(id => located(id));
  const repository = {
    getLatest: async () => values.at(-1),
    getLatestByTimeCursor: latestTimePage(values),
    getAfterId: async cursor => values.filter(point => point.id > cursor),
  };
  let route;
  const onRows = jest.fn(),
    onHistoryLoading = jest.fn();
  const feed = createTrackingFeed(repository, {
    includeHistory: true,
    batchSize: 2,
    maxBatchesPerRefresh: 1,
    onRows,
    onHistoryLoading,
    onRoute: value => {
      route = value;
    },
  });
  await feed.refresh();
  values.push(located(6, 2500));
  for (let i = 0; i < 4; i += 1) await feed.refresh();
  expect(onHistoryLoading).toHaveBeenCalledTimes(1);
  expect(route.rawCount).toBe(6);
  expect(route.slaveSegments).toHaveLength(1);
  expect(route.slaveSegments[0].map(point => point.longitude)).toEqual(
    [1, 2, 6, 3, 4, 5].map(id => 121 + id / 1000),
  );
  expect(feed.getCursor()).toBe(6);
});

test('failed boundary reread preserves route and retries cursor, but latest status is delivered', async () => {
  const values = Array.from({ length: 11 }, (_, i) => located(i + 1));
  let locked = false;
  const repository = {
    getLatest: async () => values.at(-1),
    getLatestByTimeCursor: async (...args) => {
      if (locked && args[0] === 6000 && args[1] === 7000)
        throw new Error('boundary locked');
      return latestTimePage(values)(...args);
    },
    getAfterId: async cursor => values.filter(point => point.id > cursor),
  };
  let route;
  const onRows = jest.fn(),
    onError = jest.fn();
  const feed = createTrackingFeed(repository, {
    includeHistory: true,
    batchSize: 2,
    historyWindowMs: 8000,
    onRows,
    onError,
    onRoute: value => {
      route = value;
    },
  });
  await feed.refresh();
  const before = route;
  locked = true;
  values.push(located(15));
  await feed.refresh();
  expect(onRows).toHaveBeenLastCalledWith([located(15)]);
  expect(onError).toHaveBeenCalledWith(new Error('boundary locked'));
  expect(route).toBe(before);
  expect(feed.getCursor()).toBe(11);
  locked = false;
  await feed.refresh();
  expect(feed.getCursor()).toBe(15);
  expect(route).toMatchObject({ rawCount: 6, startAt: 7000, endAt: 15000 });
});

test('a live time jump past pending history finishes without an invalid DB cursor', async () => {
  const values = [1, 2, 3, 4, 5].map(id => located(id));
  const getPage = jest.fn(latestTimePage(values));
  let route;
  const onHistoryLoaded = jest.fn();
  const feed = createTrackingFeed(
    {
      getLatest: async () => values.at(-1),
      getLatestByTimeCursor: getPage,
      getAfterId: async cursor => values.filter(point => point.id > cursor),
    },
    {
      includeHistory: true,
      batchSize: 2,
      historyWindowMs: 4000,
      maxBatchesPerRefresh: 1,
      onHistoryLoaded,
      onRoute: value => {
        route = value;
      },
    },
  );
  await feed.refresh();
  values.push(located(6, 15000));
  await feed.refresh();
  expect(getPage).toHaveBeenCalledTimes(1);
  expect(onHistoryLoaded).toHaveBeenCalledTimes(1);
  expect(route).toMatchObject({ rawCount: 1, startAt: 15000, endAt: 15000 });
});

test('device switch with missing GPS rereads its own marker context and retries errors', async () => {
  const values = [located(1), located(2)];
  const getPositionContext = jest.fn(async latest => [latest]);
  const onPositionContext = jest.fn();
  const onError = jest.fn();
  const feed = createTrackingFeed(
    {
      getLatest: async () => values.at(-1),
      getLatestByTimeCursor: latestTimePage(values),
      getPositionContext,
      getAfterId: async cursor => values.filter(point => point.id > cursor),
    },
    { includeHistory: true, onPositionContext, onError },
  );
  await feed.refresh();
  const changed = { ...located(3), slaveId: 9, slaveLat: null };
  values.push(changed);
  getPositionContext.mockRejectedValueOnce(new Error('context busy'));
  await feed.refresh();
  expect(feed.getCursor()).toBe(2);
  expect(onError).toHaveBeenCalledWith(new Error('context busy'));
  const fallback = { ...located(1), slaveId: 9 };
  getPositionContext.mockResolvedValueOnce([fallback]);
  await feed.refresh();
  expect(feed.getCursor()).toBe(3);
  expect(onPositionContext).toHaveBeenLastCalledWith([fallback]);
  expect(getPositionContext).toHaveBeenCalledTimes(3);
});
