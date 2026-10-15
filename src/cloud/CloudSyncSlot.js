// Both UI and Headless JS share this runtime and the native SQLite owner.
let tail = Promise.resolve();
let latestTail = Promise.resolve();
let backgroundAbort;

// With `signal`, a caller still waiting for its turn gives up when it aborts:
// it rejects at once and never runs `work`. Callers behind it keep their order.
export function withCloudSyncSlot(work, { signal } = {}) {
  if (!signal) {
    const result = tail.then(work);
    tail = result.catch(() => {});
    return result;
  }
  const previous = tail;
  let finished;
  tail = new Promise(resolve => { finished = resolve; });
  return new Promise((resolve, reject) => {
    const giveUp = () => reject(new Error('Cloud sync slot wait cancelled'));
    if (signal.aborted) giveUp();
    else signal.addEventListener('abort', giveUp, { once: true });
    previous.then(async () => {
      signal.removeEventListener('abort', giveUp);
      try {
        if (signal.aborted) { giveUp(); return; }
        resolve(await work());
      } catch (error) { reject(error); } finally { finished(); }
    });
  });
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
