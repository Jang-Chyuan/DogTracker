import { t } from '../i18n';
import { downloadMasterIncremental, listCloudMasters } from './CloudIncremental';
import { withCloudSyncSlot, cancelBackgroundSync } from './CloudSyncSlot';
import { reconcileCloudWindow } from './CloudReconcile';
import { repairCloudTrackTimes } from './CloudTrackTime';
import { isAuthFailure, isNetworkFailure } from './CloudErrors';
import { createResumeCatchUp, CATCH_UP_IDLE } from '../tracking/ResumeCatchUp';
import { cloudSyncDiagnostic } from '../logger';

// The incremental pass only looks back OVERLAP, so rows uploaded later than
// that are found by the count check instead. Sweeping every cycle would spend
// one request per hour per Master on data that rarely changes.
const SWEEP = 10 * 60 * 1000;
// A valid cloud pass can exceed the local feed's 20s UI budget. Use the
// existing download deadline for both its cancellation and return status.
const CLOUD_DOWNLOAD_TIMEOUT_MS = 120000;

// One scheduler for the whole App, independent of navigation. Its execution
// gate is enabled by foreground UI; WorkManager uses the same exclusive slot.
// Manual and automatic downloads share the same exclusive network/write slot.
export function createCloudSync({ client, database, onChange = () => {}, now = Date.now }) {
  const mapScope = {};
  let owner = null;
  let foreground = false;
  let disposed = false;
  let generation = 0;
  let interval;
  let immediate;
  let running = null;
  let controller = null;
  let manualPending = false;
  let initialAttemptStarted = false;
  let retryQueued = false;
  let sweptAt = 0;
  let failureDiagnostic = null;
  // lastDownloadAt: when the last successful live download started (what it
  // brought is current up to then); failingSince: the first failure since the
  // last success. DogFreshness judges cloud dogs by these (v3 判定表「未更新
  // （雲端的狗）」).
  // authFailed: the last pass was refused for the sign-in (401, expired JWT:
  // 判定表「使用中登入失效」); offline: it never reached Supabase (S3 can
  // say a switch needs the network).
  let state = { busy: false, mode: null, error: '', lastSuccess: null, lastDownloadAt: null,
    failingSince: null, authFailed: false, offline: false, revision: 0, mapSuccessRevision: 0, mapPending: false, mapAttempt: 0, publishedRevision: 0, publishedPending: false, catchUp: CATCH_UP_IDLE };
  const publish = patch => {
    state = { ...state, ...patch };
    if (!disposed) onChange({ ...state, owner, foreground });
  };
  const valid = version => !disposed && foreground && !!owner && version === generation;
  let publishedOperation = null;
  const publishScoped = async (version, work) => {
    if (!valid(version)) throw new Error(t("c576"));
    const operation = {};
    publishedOperation = operation;
    // Fence multi-query UI reads before native commit can become visible.
    publish({ publishedPending: true, publishedRevision: state.publishedRevision + 1 });
    try { return await work(); }
    finally {
      if (publishedOperation === operation) {
        publishedOperation = null;
        publish({ publishedPending: false, publishedRevision: state.publishedRevision + 1 });
      }
    }
  };
  const wake = () => {
    clearTimeout(immediate);
    if (!disposed && foreground && owner) immediate = setTimeout(() => { tick(); }, 0);
  };

  // The map waits for its initial cloud download and foreground return.
  // Successful sessions' ordinary 30-second polling does not show a pill.
  let resumeCatchUp;
  const resetResume = () => {
    resumeCatchUp?.close();
    resumeCatchUp = createResumeCatchUp({ now,
      timeoutMs: CLOUD_DOWNLOAD_TIMEOUT_MS,
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
    const startedAt = now();
    const attempt = state.mapAttempt + 1;
    let phase = 'initialize';
    const abort = new AbortController();
    controller = abort;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; abort.abort(); }, CLOUD_DOWNLOAD_TIMEOUT_MS);
    const check = () => { if (!valid(version) || abort.signal.aborted) throw new Error(t("c586")); };
    // Each pass reports a refusal of the sign-in on its own (authFailed).
    const showCatchUp = retryQueued || !initialAttemptStarted;
    retryQueued = false;
    initialAttemptStarted = true;
    resumeCatchUp.started(showCatchUp);
    publish({ busy: true, mode: 'auto', error: '', authFailed: false,
      mapPending: true, mapAttempt: attempt });
    running = withCloudSyncSlot(async () => {
      try {
        check();
        await database.initialize();
        check();
        phase = 'begin';
        await database.beginDownload?.(userId);
        check();
        phase = 'masters';
        const masters = await listCloudMasters(client, userId, abort.signal, check);
        const cutoff = now();
        const save = async (...args) => {
          check();
          await database.savePage(...args);
          if (valid(version)) publish({ revision: state.revision + 1 });
        };
        for (const masterId of masters) {
          check();
          phase = 'download';
          await downloadMasterIncremental({
            client, database, owner: userId, masterId, cutoff,
            signal: abort.signal, check,
            onChange: () => { if (valid(version)) publish({ revision: state.revision + 1 }); },
          });
        }
        check();
        phase = 'repair';
        await repairCloudTrackTimes({ client, database, owner: userId, signal: abort.signal, check,
          onChange: () => publish({ revision: state.revision + 1 }) });
        if (now() - sweptAt >= SWEEP) {
          // Set first: a failing count check waits for the next sweep instead of
          // repeating 24 requests per Master on every 30-second tick.
          sweptAt = now();
          for (const masterId of masters) {
            check();
            phase = 'reconcile';
            await reconcileCloudWindow({
              client, owner: userId, masterId, now: cutoff,
              database: { ...database, savePage: save },
              signal: abort.signal, isCurrent: () => valid(version),
            });
          }
        }
        check();
        phase = 'publish';
        if (database.publishDownload) await publishScoped(version, () => database.publishDownload(userId));
        check();
        publish({ mapPending: false, mapSuccessRevision: state.mapSuccessRevision + 1, lastSuccess: now(), lastDownloadAt: cutoff, failingSince: null, authFailed: false, offline: false });
        resumeCatchUp.caughtUp();
        if (failureDiagnostic) {
          cloudSyncDiagnostic('recovered', { attempt, elapsedMs: Math.max(0, now() - startedAt) });
          failureDiagnostic = null;
        }
      } catch (error) {
        if (valid(version) && (!abort.signal.aborted || timedOut)) {
          const status = error?.status ?? error?.context?.status ?? error?.cause?.status ?? error?.cause?.context?.status;
          const failureKind = timedOut ? 'timeout' : isAuthFailure(error) ? 'auth'
            : isNetworkFailure(error) ? 'network'
              : ['initialize', 'begin', 'publish'].includes(phase) ? 'storage' : 'unknown';
          // Release diagnostics carry only whitelisted metadata. Repeated
          // failures and successful polling stay quiet until the kind changes
          // or the download recovers; no account, URL, message or payload.
          const diagnostic = { attempt, phase, failureKind,
            status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null };
          if (!failureDiagnostic || ['phase', 'failureKind', 'status']
            .some(field => diagnostic[field] !== failureDiagnostic[field]))
            cloudSyncDiagnostic('failure', diagnostic);
          failureDiagnostic = diagnostic;
          publish({ error: timedOut ? t("c587") : error.message,
            failingSince: state.failingSince ?? now(), authFailed: !timedOut && isAuthFailure(error),
            offline: timedOut || isNetworkFailure(error) });
          // Initial and resumed attempts expose retry on the map. Ordinary
          // polling keeps its S3 error without starting a return indicator.
          if (resumeCatchUp.state().phase === 'idle') resumeCatchUp.caughtUp();
          else resumeCatchUp.failed();
        }
      } finally {
        clearTimeout(timeout);
        controller = null;
        running = null;
        publish({ busy: false, mode: null });
        // A user/foreground change may arrive while a canceled request drains.
        if ((retryQueued || generation !== version) && foreground && owner) wake();
      }
    });
    return running;
  }

  return {
    // Synchronous read fence: React may coalesce busy/idle updates. Failed or
    // aborted writes remain pending until a complete automatic pass succeeds.
    mapPublication() {
      return { scope: mapScope, owner, generation, attempt: state.mapAttempt, pending: state.mapPending || state.publishedPending,
        busy: state.busy, mapSuccessRevision: state.mapSuccessRevision,
        publishedRevision: state.publishedRevision, publishedPending: state.publishedPending };
    },
    setSession(session) {
      const next = session?.user.id || null;
      if (owner === next) return;
      cancelBackgroundSync();
      owner = next;
      // The old owner's already-started native transaction cannot be cancelled.
      // Keep its physical publication fence closed for the replacement owner
      // until finally settles; global retention may affect another owner's rows.
      sweptAt = 0;
      failureDiagnostic = null;
      initialAttemptStarted = false;
      retryQueued = false;
      resetResume();
      generation += 1;
      controller?.abort();
      publish({ error: '', lastSuccess: null, lastDownloadAt: null, failingSince: null, authFailed: false,
        offline: false, mapSuccessRevision: 0, mapPending: false, mapAttempt: 0, publishedRevision: 0, publishedPending: !!publishedOperation, revision: state.revision + 1, catchUp: CATCH_UP_IDLE });
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
        retryQueued = false;
        resumeCatchUp.away();
        clearTimeout(immediate);
        controller?.abort();
      }
      publish({});
    },
    // S3 「重試」: a pass now instead of at the next 30-second tick.
    retry() {
      if (disposed || !foreground || !owner) return;
      // Queue the notice with the work, not while a manual download or old
      // automatic request still owns the slot. Never abort queued history.
      retryQueued = true;
      if (!manualPending && state.mode !== 'manual' && resumeCatchUp.state().phase === 'failed')
        resumeCatchUp.retry({ deferStart: true });
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
        publish({ busy: true, mode: 'manual', mapPending: true, mapAttempt: state.mapAttempt + 1 });
        running = withCloudSyncSlot(async () => {
          if (!valid(version) || abort.signal.aborted) throw new Error('Download cancelled');
          if (database.beginDownload) await database.beginDownload(owner, 'manual');
          if (!valid(version) || abort.signal.aborted) throw new Error('Download cancelled');
          const count = await work(() => valid(version) && !abort.signal.aborted,
            commit => publishScoped(version, commit));
          if (!valid(version) || abort.signal.aborted) throw new Error(t("c576"));
          if (database.publishDownload) await publishScoped(version, () => database.publishDownload(owner, 'manual'));
          return count;
        });
        // A selected history window is not a complete live all-master pass.
        // Canceled automatic pages remain quarantined until the next auto
        // success, even when this manual window itself completes normally.
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
      retryQueued = false;
      resumeCatchUp.close();
      generation += 1;
      clearInterval(interval);
      clearTimeout(immediate);
      controller?.abort();
      return running;
    },
  };
}
