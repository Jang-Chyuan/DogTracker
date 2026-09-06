export const DEFAULT_TRACKING_POLL_INTERVAL_MS = 1000;
export const DEFAULT_TRACKING_BATCH_SIZE = 1000;
export const DEFAULT_MAX_BATCHES_PER_REFRESH = 20;

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
  const timers = options.timers || { clearInterval, setInterval };
  let cursor = null;
  let timer = null;
  let generation = 0;
  let refreshTask = null;

  async function performRefresh(refreshGeneration) {
    const deliveredRows = [];
    try {
      if (cursor === null) {
        const latest = await repository.getLatest();
        if (refreshGeneration !== generation) return deliveredRows;

        if (latest) {
          onRows([latest]);
          if (refreshGeneration !== generation) return deliveredRows;
          cursor = latest.id;
          deliveredRows.push(latest);
        }
        onSuccess();
        return deliveredRows;
      }

      for (
        let batchIndex = 0;
        batchIndex < maxBatchesPerRefresh;
        batchIndex += 1
      ) {
        const rows = await repository.getAfterId(cursor, batchSize);
        if (refreshGeneration !== generation) return deliveredRows;
        if (rows.length === 0) break;

        onRows(rows);
        if (refreshGeneration !== generation) return deliveredRows;
        cursor = rows[rows.length - 1].id;
        deliveredRows.push(...rows);

        if (rows.length < batchSize) break;
      }

      if (refreshGeneration === generation) onSuccess();
      return deliveredRows;
    } catch (error) {
      if (refreshGeneration === generation) onError(error);
      return deliveredRows;
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
