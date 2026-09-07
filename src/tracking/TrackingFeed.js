import {
  DEFAULT_LIVE_ROUTE_MAX_POINTS,
  DEFAULT_LIVE_ROUTE_WINDOW_MS,
} from './LiveRoutePolicy';
import { compareRouteKeys, createLiveRouteWindow } from './LiveRouteWindow';
import { toRouteSample } from './RouteSamples';

export const DEFAULT_TRACKING_POLL_INTERVAL_MS = 1000;
export const DEFAULT_TRACKING_BATCH_SIZE = 1000;
export const DEFAULT_MAX_BATCHES_PER_REFRESH = 20;
export {
  DEFAULT_LIVE_ROUTE_MAX_POINTS,
  DEFAULT_LIVE_ROUTE_WINDOW_MS,
} from './LiveRoutePolicy';

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

/**
 * Polls a local tracking repository while the App is active.
 * The cursor is kept when stopped so foreground resume can catch up by id.
 */
export function createTrackingFeed(repository, options = {}) {
  if (!repository) throw new TypeError('repository is required');

  const onRows = options.onRows || (() => {});
  // A successful empty query is still a recovery from a prior read error.
  const onSuccess = options.onSuccess || (() => {});
  const onError = options.onError || (() => {});
  const includeHistory = options.includeHistory === true;
  const onLatest = options.onLatest || (() => {});
  const onPositionContext = options.onPositionContext || (() => {});
  const onInitialSnapshotReady = options.onInitialSnapshotReady || (() => {});
  const onWindowCutoff = options.onWindowCutoff || (() => {});
  const onHistoryLoaded = options.onHistoryLoaded || (() => {});
  const onCaughtUp = options.onCaughtUp || (() => {});
  const onRefreshing = options.onRefreshing || (() => {});
  const onRoute = options.onRoute || (() => {});
  const onHistoryLoading = options.onHistoryLoading || (() => {});
  const intervalMs = options.intervalMs ?? DEFAULT_TRACKING_POLL_INTERVAL_MS;
  const batchSize = positiveInteger(
    options.batchSize,
    DEFAULT_TRACKING_BATCH_SIZE,
    DEFAULT_TRACKING_BATCH_SIZE,
  );
  const maxBatchesPerRefresh = positiveInteger(
    options.maxBatchesPerRefresh,
    DEFAULT_MAX_BATCHES_PER_REFRESH,
  );
  const historyWindowMs = positiveInteger(
    options.historyWindowMs,
    DEFAULT_LIVE_ROUTE_WINDOW_MS,
  );
  const displayMaxPoints = positiveInteger(
    options.displayMaxPoints,
    DEFAULT_LIVE_ROUTE_MAX_POINTS,
  );
  const route = includeHistory
    ? createLiveRouteWindow({ maxPoints: displayMaxPoints })
    : null;
  const timers = options.timers || { clearInterval, setInterval };
  let cursor = null;
  let timer = null;
  let generation = 0;
  let refreshTask = null;
  let historyStart = null;
  let historyEnd = null;
  let historyCursor = null;
  let snapshotId = null;
  let snapshotEnd = null;
  let historyLoaded = false;
  let initialSnapshotReady = false;
  let masterId;
  let slaveId;

  async function readChunk(chunk, refreshGeneration = generation) {
    // Ignore rows inserted after this chunk was built. Late timestamps trigger
    // a separate rebuild; they must not silently change a boundary reread.
    const result = [];
    let key = { receivedAt: chunk.last.receivedAt, id: chunk.last.id + 1 };
    while (result.length < chunk.count) {
      const rows = await repository.getLatestByTimeCursor(
        chunk.first.receivedAt,
        chunk.last.receivedAt,
        key,
        batchSize,
      );
      if (refreshGeneration !== generation) return [];
      if (!rows.length) break;
      result.push(
        ...rows.filter(
          row =>
            row.id <= chunk.maxId &&
            compareRouteKeys(row, chunk.first) >= 0 &&
            compareRouteKeys(row, chunk.last) <= 0,
        ),
      );
      const last = rows[rows.length - 1];
      key = { receivedAt: last.receivedAt, id: last.id };
      if (rows.length < batchSize || compareRouteKeys(last, chunk.first) <= 0)
        break;
    }
    return result.sort(compareRouteKeys);
  }

  async function advanceWindow(rows, refreshGeneration) {
    if (!includeHistory || rows.length === 0) return;
    let latestTime = historyEnd;
    for (const row of rows) {
      if (
        Number.isFinite(row.receivedAt) &&
        (!Number.isFinite(latestTime) || row.receivedAt > latestTime)
      )
        latestTime = row.receivedAt;
    }
    if (!Number.isFinite(latestTime) || latestTime === historyEnd) return;
    const nextStart = latestTime - historyWindowMs;
    if (
      !(await route.advanceCutoff(
        nextStart,
        chunk => readChunk(chunk, refreshGeneration),
        () => refreshGeneration === generation,
      ))
    )
      return;
    onWindowCutoff(nextStart, displayMaxPoints);
    historyEnd = latestTime;
    historyStart = nextStart;
  }

  function finishHistory() {
    if (historyLoaded) return;
    onHistoryLoaded();
    historyLoaded = true;
  }

  function finishInitialSnapshot() {
    if (initialSnapshotReady) return;
    onInitialSnapshotReady();
    initialSnapshotReady = true;
  }

  async function performRefresh(refreshGeneration) {
    const deliveredRows = [];
    try {
      onRefreshing();
      if (cursor === null) {
        const latest = await repository.getLatest();
        if (refreshGeneration !== generation) return deliveredRows;

        if (includeHistory) {
          // Show the latest status immediately, without treating it as the
          // complete route. A separate time cursor then loads the live
          // window without scanning the complete lifetime table.
          onLatest(latest);
          if (refreshGeneration !== generation) return deliveredRows;
          if (latest && repository.getPositionContext) {
            const context = await repository.getPositionContext(latest);
            if (refreshGeneration !== generation) return deliveredRows;
            onPositionContext(context);
            if (refreshGeneration !== generation) return deliveredRows;
          }
          finishInitialSnapshot();
          if (refreshGeneration !== generation) return deliveredRows;
          if (Number.isFinite(latest?.receivedAt)) {
            const nextStart = latest.receivedAt - historyWindowMs;
            await route.advanceCutoff(nextStart, readChunk);
            if (refreshGeneration !== generation) return deliveredRows;
            onWindowCutoff(nextStart, displayMaxPoints);
            historyEnd = latest.receivedAt;
            historyStart = nextStart;
            snapshotEnd = historyEnd;
            snapshotId = latest.id;
          } else {
            finishHistory();
          }
          cursor = latest?.id ?? 0;
          masterId = latest?.masterId;
          slaveId = latest?.slaveId;
        } else if (latest) {
          onRows([latest]);
          if (refreshGeneration !== generation) return deliveredRows;
          cursor = latest.id;
          deliveredRows.push(latest);
        }
        if (!includeHistory) {
          onSuccess();
          return deliveredRows;
        }
      }

      for (
        let batchIndex = 0;
        batchIndex < maxBatchesPerRefresh;
        batchIndex += 1
      ) {
        // Always poll live IDs first. Repeated history-query errors must not
        // prevent the status card/markers from discovering new data.
        const rows = await repository.getAfterId(cursor, batchSize);
        if (refreshGeneration !== generation) return deliveredRows;
        if (rows.length) {
          // Status is independent from route-boundary DB work. If that read
          // fails, keep this new status but leave the ID cursor retryable.
          onRows(rows);
          if (refreshGeneration !== generation) return deliveredRows;
          if (includeHistory) {
            const newest = rows[rows.length - 1];
            const sample = toRouteSample(newest);
            if (
              repository.getPositionContext &&
              ((newest.masterId !== masterId && !sample.master) ||
                (newest.slaveId !== slaveId && !sample.slave))
            ) {
              const context = await repository.getPositionContext(newest);
              if (refreshGeneration !== generation) return deliveredRows;
              onPositionContext(context);
            }
            masterId = newest.masterId;
            slaveId = newest.slaveId;
          }
          await advanceWindow(rows, refreshGeneration);
          if (refreshGeneration !== generation) return deliveredRows;
          if (includeHistory && !route.append(rows)) {
            // Rebuild late timestamps from raw DB data, never from a
            // compressed chunk. Tolerance must not accumulate across updates.
            route.reset();
            historyCursor = null;
            snapshotId = rows[rows.length - 1].id;
            snapshotEnd = historyEnd;
            historyLoaded = false;
            onHistoryLoading();
          }
          cursor = rows[rows.length - 1].id;
          // History mode delivers pages by callback, without accumulating
          // their full payloads in the refresh result.
          if (!includeHistory) deliveredRows.push(...rows);
        }
        const liveCaughtUp = rows.length < batchSize;
        if (liveCaughtUp) onCaughtUp();
        if (refreshGeneration !== generation) return deliveredRows;

        // A large live-time jump can move the entire remaining snapshot out
        // of the window. Do not send an out-of-range keyset cursor to SQLite.
        if (
          includeHistory &&
          !historyLoaded &&
          (snapshotEnd < historyStart ||
            historyCursor?.receivedAt < historyStart)
        )
          finishHistory();
        if (includeHistory && !historyLoaded) {
          const page = await repository.getLatestByTimeCursor(
            historyStart,
            snapshotEnd,
            historyCursor,
            batchSize,
          );
          if (refreshGeneration !== generation) return deliveredRows;
          if (page.length) {
            const snapshotRows = page.filter(row => row.id <= snapshotId);
            route.prepend(snapshotRows);
            onRows(snapshotRows);
            if (refreshGeneration !== generation) return deliveredRows;
            const last = page[page.length - 1];
            historyCursor = { receivedAt: last.receivedAt, id: last.id };
          }
          if (route.isLimited() || page.length < batchSize) finishHistory();
        }
        if (liveCaughtUp && (!includeHistory || historyLoaded)) break;
      }

      if (refreshGeneration === generation) onSuccess();
      return deliveredRows;
    } catch (error) {
      if (refreshGeneration === generation) onError(error);
      return deliveredRows;
    } finally {
      if (includeHistory && refreshGeneration === generation)
        onRoute(route.snapshot());
    }
  }

  function refresh() {
    const requestedGeneration = generation;
    if (refreshTask) {
      if (refreshTask.generation === requestedGeneration) {
        return refreshTask.promise;
      }

      return refreshTask.promise.then(() => {
        if (requestedGeneration !== generation) return [];
        return refresh();
      });
    }

    const task = {
      generation: requestedGeneration,
      promise: null,
    };
    task.promise = performRefresh(requestedGeneration).finally(() => {
      if (refreshTask === task) refreshTask = null;
    });
    refreshTask = task;
    return task.promise;
  }

  return {
    getCursor() {
      return cursor;
    },

    getWindowCutoff() {
      return historyStart;
    },

    refresh,

    start() {
      if (timer !== null) return;
      refresh();
      timer = timers.setInterval(refresh, intervalMs);
    },

    stop() {
      generation += 1;
      if (timer !== null) {
        timers.clearInterval(timer);
        timer = null;
      }
      return refreshTask?.promise || Promise.resolve([]);
    },
  };
}
