// Both UI and Headless JS share this runtime and the native SQLite owner.
let tail = Promise.resolve();
let latestTail = Promise.resolve();
let backgroundAbort;

export function withCloudSyncSlot(work) {
  const result = tail.then(work);
  tail = result.catch(() => {});
  return result;
}

// Only callers using the separate native latest file/worker may use this slot.
// Archive/manual/headless work retains the original slot and native drain.
export function withLatestSyncSlot(work) {
  const result = latestTail.then(work);
  latestTail = result.catch(() => {});
  return result;
}

export function registerBackgroundSync(abort) {
  backgroundAbort?.abort();
  backgroundAbort = abort;
  return () => { if (backgroundAbort === abort) backgroundAbort = null; };
}

export function cancelBackgroundSync() { backgroundAbort?.abort(); }
