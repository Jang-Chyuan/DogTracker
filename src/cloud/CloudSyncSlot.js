// Both UI and Headless JS share this runtime and the native SQLite owner.
let tail = Promise.resolve();
let backgroundAbort;

export function withCloudSyncSlot(work) {
  const result = tail.then(work);
  tail = result.catch(() => {});
  return result;
}

export function registerBackgroundSync(abort) {
  backgroundAbort?.abort();
  backgroundAbort = abort;
  return () => { if (backgroundAbort === abort) backgroundAbort = null; };
}

export function cancelBackgroundSync() { backgroundAbort?.abort(); }
