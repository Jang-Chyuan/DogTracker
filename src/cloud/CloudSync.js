import { downloadMasterIncremental, listCloudMasters } from './CloudIncremental';
import { withCloudSyncSlot, cancelBackgroundSync } from './CloudSyncSlot';
import { reconcileCloudWindow } from './CloudReconcile';
import { repairCloudTrackTimes } from './CloudTrackTime';

// The incremental pass only looks back OVERLAP, so rows uploaded later than
// that are found by the count check instead. Sweeping every cycle would spend
// one request per hour per Master on data that rarely changes.
const SWEEP = 10 * 60 * 1000;

// One scheduler for the whole App, independent of navigation. Its execution
// gate is enabled by foreground UI; WorkManager uses the same exclusive slot.
// Manual and automatic downloads share the same exclusive network/write slot.
export function createCloudSync({ client, database, onChange = () => {}, now = Date.now }) {
  let owner = null;
  let foreground = false;
  let disposed = false;
  let generation = 0;
  let interval;
  let immediate;
  let running = null;
  let controller = null;
  let manualPending = false;
  let sweptAt = 0;
  let state = { busy: false, mode: null, error: '', lastSuccess: null, revision: 0 };
  const publish = patch => {
    state = { ...state, ...patch };
    if (!disposed) onChange({ ...state, owner, foreground });
  };
  const valid = version => !disposed && foreground && !!owner && version === generation;
  const wake = () => {
    clearTimeout(immediate);
    if (!disposed && foreground && owner) immediate = setTimeout(() => { tick(); }, 0);
  };

  async function tick() {
    if (disposed || !foreground || !owner || running || manualPending) return;
    const version = generation;
    const userId = owner;
    const abort = new AbortController();
    controller = abort;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; abort.abort(); }, 120000);
    const check = () => { if (!valid(version) || abort.signal.aborted) throw new Error('同步已取消'); };
    publish({ busy: true, mode: 'auto', error: '' });
    running = withCloudSyncSlot(async () => {
      try {
        check();
        await database.initialize();
        check();
        const masters = await listCloudMasters(client, userId, abort.signal, check);
        const cutoff = now();
        const save = async (...args) => {
          check();
          await database.savePage(...args);
          if (valid(version)) publish({ revision: state.revision + 1 });
        };
        for (const masterId of masters) {
          check();
          await downloadMasterIncremental({
            client, database, owner: userId, masterId, cutoff,
            signal: abort.signal, check,
            onChange: () => { if (valid(version)) publish({ revision: state.revision + 1 }); },
          });
        }
        check();
        await repairCloudTrackTimes({ client, database, owner: userId, signal: abort.signal, check,
          onChange: () => publish({ revision: state.revision + 1 }) });
        if (now() - sweptAt >= SWEEP) {
          // Set first: a failing count check waits for the next sweep instead of
          // repeating 24 requests per Master on every 30-second tick.
          sweptAt = now();
          for (const masterId of masters) {
            check();
            await reconcileCloudWindow({
              client, owner: userId, masterId, now: cutoff,
              database: { ...database, savePage: save },
              signal: abort.signal, isCurrent: () => valid(version),
            });
          }
        }
        check();
        publish({ lastSuccess: now() });
      } catch (error) {
        if (valid(version) && (!abort.signal.aborted || timedOut)) {
          publish({ error: timedOut ? '同步逾時，已儲存批次保留，稍後重試' : error.message });
        }
      } finally {
        clearTimeout(timeout);
        controller = null;
        running = null;
        publish({ busy: false, mode: null });
        // A user/foreground change may arrive while a canceled request drains.
        if (generation !== version && foreground && owner) wake();
      }
    });
    return running;
  }

  return {
    setSession(session) {
      const next = session?.user.id || null;
      if (owner === next) return;
      cancelBackgroundSync();
      owner = next;
      sweptAt = 0;
      generation += 1;
      controller?.abort();
      publish({ error: '', lastSuccess: null, revision: state.revision + 1 });
      wake();
    },
    setForeground(active) {
      if (foreground === active) return;
      foreground = active;
      generation += 1;
      clearInterval(interval);
      if (active) {
        cancelBackgroundSync();
        interval = setInterval(() => { tick(); }, 30000);
        wake();
      } else {
        clearTimeout(immediate);
        controller?.abort();
      }
      publish({});
    },
    async runManual(work, abort = new AbortController()) {
      if (manualPending || state.mode === 'manual') throw new Error('已有下載進行中');
      const version = generation;
      manualPending = true;
      controller?.abort();
      try {
        await running;
        if (!valid(version) || abort.signal.aborted) throw new Error('下載已取消');
        controller = abort;
        publish({ busy: true, mode: 'manual' });
        running = withCloudSyncSlot(() => {
          if (!valid(version) || abort.signal.aborted) throw new Error('Download cancelled');
          return work(() => valid(version) && !abort.signal.aborted);
        });
        return await running;
      } finally {
        manualPending = false;
        controller = null;
        running = null;
        publish({ busy: false, mode: null, revision: state.revision + 1 });
        wake();
      }
    },
    dispose() {
      disposed = true;
      generation += 1;
      clearInterval(interval);
      clearTimeout(immediate);
      controller?.abort();
      return running;
    },
  };
}
