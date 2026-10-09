import { t } from '../i18n';
import { downloadMasterIncremental, listCloudMasters } from './CloudIncremental';
import { withCloudSyncSlot, cancelBackgroundSync } from './CloudSyncSlot';
import { reconcileCloudWindow } from './CloudReconcile';
import { repairCloudTrackTimes } from './CloudTrackTime';
import { isAuthFailure, isNetworkFailure } from './CloudErrors';
import { createResumeCatchUp, CATCH_UP_IDLE } from '../tracking/ResumeCatchUp';

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
  // lastDownloadAt: when the last successful live download started (what it
  // brought is current up to then); failingSince: the first failure since the
  // last success. DogFreshness judges cloud dogs by these (v3 判定表「未更新
  // （雲端的狗）」).
  // authFailed: the last pass was refused for the sign-in (401, expired JWT:
  // 判定表「使用中登入失效」); offline: it never reached Supabase (S3 can
  // say a switch needs the network).
  let state = { busy: false, mode: null, error: '', lastSuccess: null, lastDownloadAt: null,
    failingSince: null, authFailed: false, offline: false, revision: 0, catchUp: CATCH_UP_IDLE };
  const publish = patch => {
    state = { ...state, ...patch };
    if (!disposed) onChange({ ...state, owner, foreground });
  };
  const valid = version => !disposed && foreground && !!owner && version === generation;
  const wake = () => {
    clearTimeout(immediate);
    if (!disposed && foreground && owner) immediate = setTimeout(() => { tick(); }, 0);
  };

  // The map's return indicator follows the actual cloud pass as well as the
  // local feed. Ordinary polling and the initial download do not show it.
  let resumeCatchUp;
  const resetResume = () => {
    resumeCatchUp?.close();
    resumeCatchUp = createResumeCatchUp({ now,
      onChange: catchUp => publish({ catchUp }),
      onRetry: () => {
        // A timed-out pass must drain before a replacement takes the slot.
        generation += 1;
        controller?.abort();
        wake();
      },
    });
  };
  resetResume();

  async function tick() {
    if (disposed || !foreground || !owner || running || manualPending) return;
    const version = generation;
    const userId = owner;
    const abort = new AbortController();
    controller = abort;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; abort.abort(); }, 120000);
    const check = () => { if (!valid(version) || abort.signal.aborted) throw new Error(t("c586")); };
    // Each pass reports a refusal of the sign-in on its own (authFailed).
    resumeCatchUp.started();
    publish({ busy: true, mode: 'auto', error: '', authFailed: false });
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
        publish({ lastSuccess: now(), lastDownloadAt: cutoff, failingSince: null, authFailed: false, offline: false });
        resumeCatchUp.caughtUp();
      } catch (error) {
        if (valid(version) && (!abort.signal.aborted || timedOut)) {
          publish({ error: timedOut ? t("c587") : error.message,
            failingSince: state.failingSince ?? now(), authFailed: !timedOut && isAuthFailure(error),
            offline: timedOut || isNetworkFailure(error) });
          // A completed initial attempt (even a failure) makes the next
          // foreground return eligible; a cold-start failure has its S3 row.
          if (resumeCatchUp.state().phase === 'idle') resumeCatchUp.caughtUp();
          else resumeCatchUp.failed();
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
      resetResume();
      generation += 1;
      controller?.abort();
      publish({ error: '', lastSuccess: null, lastDownloadAt: null, failingSince: null, authFailed: false,
        offline: false, revision: state.revision + 1, catchUp: CATCH_UP_IDLE });
      wake();
    },
    setForeground(active) {
      if (foreground === active) return;
      foreground = active;
      generation += 1;
      clearInterval(interval);
      if (active) {
        cancelBackgroundSync();
        resumeCatchUp.back();
        interval = setInterval(() => { tick(); }, 30000);
        wake();
      } else {
        resumeCatchUp.away();
        clearTimeout(immediate);
        controller?.abort();
      }
      publish({});
    },
    // S3 「重試」: a pass now instead of at the next 30-second tick.
    retry() {
      if (resumeCatchUp.state().phase === 'failed') resumeCatchUp.retry();
      else wake();
    },
    async runManual(work, abort = new AbortController()) {
      if (manualPending || state.mode === 'manual') throw new Error(t("c585"));
      const version = generation;
      manualPending = true;
      controller?.abort();
      try {
        await running;
        if (!valid(version) || abort.signal.aborted) throw new Error(t("c576"));
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
      resumeCatchUp.close();
      generation += 1;
      clearInterval(interval);
      clearTimeout(immediate);
      controller?.abort();
      return running;
    },
  };
}
