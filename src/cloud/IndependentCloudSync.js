import { downloadCloudLatest, downloadCloudLatestContext } from './CloudLatest';
import { t } from '../i18n';
import { cloudSyncDiagnostic } from '../logger';
import { downloadMasterIncremental, listCloudMasters } from './CloudIncremental';
import { withCloudSyncSlot, withLatestSyncSlot, cancelBackgroundSync } from './CloudSyncSlot';
import { reconcileCloudWindow } from './CloudReconcile';
import { repairCloudTrackTimes } from './CloudTrackTime';
import { isAuthFailure, isNetworkFailure } from './CloudErrors';
import { createCloudSessionGate } from './CloudSession';
import { createResumeCatchUp, CATCH_UP_IDLE } from '../tracking/ResumeCatchUp';
import { createLatestReadinessGate, createMapReadback } from './CloudMapReadback';
import { beginCloudAttemptDiagnostic } from '../diagnostics/CloudAttemptDiagnostics';
import { contextFailureKind } from './CloudErrors';
import { createMalformedFields } from '../models/MalformedFields';

const DOWNLOAD_MS = 120000, CONTEXT_MS = 10000, SWEEP_MS = 600000;
// Supabase answered but refused or failed the request (429, 5xx): it is up and
// struggling, so the automatic attempts space out (1, 2, 4, then every 5 min)
// instead of repeating every 30 s. No network keeps the 30 s cadence: those
// attempts cost the server nothing and the map recovers as soon as it can.
// A success, 重試, a return to the app or another account starts over.
export const SERVER_BACKOFF_FIRST_MS = 60000, SERVER_BACKOFF_MAX_MS = 300000;
const failureStatus = error => {
  const status = error?.status ?? error?.context?.status ?? error?.cause?.status ?? error?.cause?.context?.status;
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
};
const serverTrouble = status => status === 429 || status >= 500;

// Requires a genuinely independent latest native file, worker, monitor and JS
// lock. An archive operation already inside native SQL remains owned/draining;
// it can no longer prevent the next foreground latest attempt from starting.
export function createIndependentCloudSync({ client, database, onChange = () => {}, now = Date.now, downloadLatest = downloadCloudLatest,
  downloadContext = downloadCloudLatestContext }) {
  if (!database.latestStorageIsolated) throw new Error('Independent latest storage is required');
  const scope = {};
  let owner = null, foreground = false, sessionKnown = false, disposed = false, generation = 0;
  // Changes with every generation change except a foreground leave/return
  // (setForeground): an account switch, a deletion or disposal. History may
  // keep the same account's verified view across a resume, never across these.
  let lineage = 0;
  let latestRunning = null, archiveRunning = null, manualRunning = null;
  let latestAbort = null, archiveAbort = null, manualAbort = null, archiveRequest = null;
  let readback = null, readbackStartedAt = null, interval, immediate, publishedOperation = null;
  let initialStarted = false, retryQueued = false, sweptAt = 0, failureDiagnostic = null;
  let archiveAuthority = null, archiveAuthorityVersion = 0;
  let deleting = false;
  let backoffMs = 0, backoffUntil = 0;
  const resetBackoff = () => { backoffMs = 0; backoffUntil = 0; };
  // The first map ACK of a foreground generation opens archive priority. A
  // later 30-second latest attempt must not close it again: archive/manual
  // commands and history readers already admitted would otherwise wait out
  // (and fail on) the gate's 10-second budget behind every routine refresh.
  let admitted = null;
  let state = { latestFirst: true, snapshotPending: false, snapshotRevision: 0, snapshotCutoff: null, snapshotBaseRevision: null,
    archivePending: false, archiveRevision: 0, archiveCutoff: null, archiveError: '', contextPending: false,
    busy: false, mode: null, error: '', lastSuccess: null, lastDownloadAt: null, failingSince: null,
    authFailed: false, offline: false, revision: 0, mapSuccessRevision: 0, mapPending: false, mapAttempt: 0,
    dataRevision: null, publishedRevision: 0, publishedPending: false, catchUp: CATCH_UP_IDLE };
  const valid = version => !disposed && foreground && !!owner && version === generation;
  const readiness = createLatestReadinessGate(() => ({ owner, generation, ready: sessionKnown && (!owner ||
    !disposed && foreground && (readback?.acknowledged() && readback.value.owner === owner
      && readback.value.generation === generation && readback.value.attempt === state.mapAttempt
      || admitted?.owner === owner && admitted.generation === generation
      || !state.snapshotPending && !!state.error)) }));
  const releaseReadiness = database.installLatestReadinessGate?.(readiness);
  const publish = patch => {
    state = { ...state, ...patch };
    readiness.notify();
    if (!disposed) onChange({ ...state, owner, foreground });
  };
  const releaseDeletion = database.installDeletionFence?.(() => {
    deleting = true; generation++; lineage++; readback = null; archiveRequest = null;
    latestAbort?.abort(); archiveAbort?.abort(); manualAbort?.abort();
    publish({ mapPending: true, snapshotPending: true });
    return { failed() {
      // Keep deletion blocked until S7 retries; expose a truthful failure rather
      // than an endless update indicator if the user closes the dialog.
      catchUp.started(true); catchUp.failed();
      publish({ mapPending: false, snapshotPending: false, error: t('c1275'),
        failingSince: state.failingSince ?? now() });
    } };
  });
  const updateBusy = () => publish({ busy: !!(latestRunning || archiveRunning || manualRunning),
    mode: manualRunning ? 'manual' : latestRunning || archiveRunning ? 'auto' : null });
  const wake = () => {
    clearTimeout(immediate);
    if (!disposed && foreground && owner) immediate = setTimeout(() => { tick(); }, 0);
  };
  let catchUp;
  const resetCatchUp = () => {
    catchUp?.close();
    catchUp = createResumeCatchUp({ now, timeoutMs: DOWNLOAD_MS, onChange: value => publish({ catchUp: value }),
      onRetry: () => { generation++; latestAbort?.abort(); archiveAbort?.abort(); wake(); } });
  };
  resetCatchUp();
  const acknowledgeMapRead = value => {
    const before = readback?.acknowledged(), accepted = readback?.acknowledge(value) ?? false;
    if (accepted) admitted = { owner: value.owner, generation: value.generation };
    if (accepted && !before) {
      cloudSyncDiagnostic('latest-applied', { attempt: value.attempt,
        elapsedMs: Math.max(0, now() - readbackStartedAt), revision: value.revision });
      publish({});
    }
    return accepted;
  };
  // `current()`: the lease the publication belongs to, checked before and
  // after it (and by the work itself inside the native lock). The automatic
  // archive's is its generation; a manual download's its lineage (runManual).
  const publishScoped = async (current, work, authorized = () => true) => {
    if (!current() || !authorized()) throw new Error(t('c576'));
    const operation = {}; publishedOperation = operation;
    publish({ publishedPending: true, publishedRevision: state.publishedRevision + 1 });
    let result;
    try { result = await work(); return result; }
    finally {
      if (publishedOperation === operation) {
        publishedOperation = null;
        publish({ publishedPending: false, publishedRevision: state.publishedRevision + 1,
          dataRevision: current() && authorized() && Number.isSafeInteger(result?.dataRevision) && result.dataRevision >= 0 ? result.dataRevision : null });
      }
    }
  };
  const reportLatestFailure = (error, timedOut, attempt, phase) => {
    const status = failureStatus(error);
    const diagnostic = { attempt, phase, failureKind: timedOut ? 'timeout' : isAuthFailure(error) ? 'auth'
      : isNetworkFailure(error) ? 'network' : ['initialize', 'publish'].includes(phase) ? 'storage' : 'unknown',
    status };
    if (!timedOut && serverTrouble(status)) {
      backoffMs = backoffMs ? Math.min(SERVER_BACKOFF_MAX_MS, backoffMs * 2) : SERVER_BACKOFF_FIRST_MS;
      backoffUntil = now() + backoffMs;
    } else resetBackoff();
    if (!failureDiagnostic || ['phase', 'failureKind', 'status'].some(key => diagnostic[key] !== failureDiagnostic[key]))
      cloudSyncDiagnostic('failure', diagnostic);
    failureDiagnostic = diagnostic;
    publish({ error: timedOut ? t('c587') : error.message, failingSince: state.failingSince ?? now(),
      authFailed: !timedOut && isAuthFailure(error), offline: timedOut || isNetworkFailure(error) });
    if (catchUp.state().phase === 'idle') catchUp.caughtUp(); else catchUp.failed();
  };

  function tick() {
    if (disposed || deleting || !foreground || !owner || latestRunning) return latestRunning;
    if (!retryQueued && now() < backoffUntil) return null;
    const version = generation, userId = owner, startedAt = now(), attempt = state.mapAttempt + 1;
    const observation = beginCloudAttemptDiagnostic(attempt);
    const abort = new AbortController(); latestAbort = abort;
    let timedOut = false, phase = 'initialize', committed = false;
    const timeout = setTimeout(() => { timedOut = true; abort.abort(); }, DOWNLOAD_MS);
    const check = () => { if (!valid(version) || abort.signal.aborted) throw new Error(t('c576')); };
    // The attempt's native latest-store calls end with the attempt: a call
    // that never answers no longer keeps latestRunning (and with it every
    // later attempt) forever, unseen by the 120 s timeout, which only aborts
    // (audit B F11). The native call itself still drains in its own lock;
    // a publication checks the attempt's lease inside it, so a late one
    // cannot land for an attempt that has ended.
    const bounded = promise => {
      if (abort.signal.aborted) { Promise.resolve(promise).catch(() => {}); return Promise.reject(new Error(t('c576'))); }
      let stop;
      const stopped = new Promise((_, reject) => {
        stop = () => reject(new Error(t('c576')));
        abort.signal.addEventListener('abort', stop, { once: true });
      });
      Promise.resolve(promise).catch(() => {});
      return Promise.race([promise, stopped]).finally(() => abort.signal.removeEventListener('abort', stop));
    };
    const timings = { slotWaitMs: 0, initializeMs: 0, archiveProofMs: 0, latestCacheReadMs: 0,
      mastersMs: 0, latestHTTPMs: 0, snapshotCommitMs: 0, sessionMs: 0 };
    readback = null; readbackStartedAt = startedAt;
    catchUp.started(retryQueued || !initialStarted); retryQueued = false; initialStarted = true;
    // The last failure (error, authFailed) stays until an attempt succeeds:
    // clearing it here made every failing attempt a new refusal, and
    // useCloudSync asked AuthProvider to refresh again every 30 s.
    publish({ busy: true, mode: manualRunning ? 'manual' : 'auto', mapAttempt: attempt });
    // snapshotPending / mapPending mark only the moment the latest store
    // changes (publish → readback), not the session wait or the HTTP: the map
    // holds its cloud dogs while they are pending, and an attempt on a slow
    // or dead network lasts up to DOWNLOAD_MS (the session wait alone up to
    // 65 s). Until the publish the store still holds the accepted snapshot,
    // so readers may keep reading it.
    latestRunning = withLatestSyncSlot(async () => {
      timings.slotWaitMs = Math.max(0, now() - startedAt);
      const networkAbort = new AbortController(), cancel = () => networkAbort.abort();
      observation?.bind(networkAbort.signal);
      abort.signal.addEventListener('abort', cancel, { once: true });
      let networkPhase = 'masters';
      const canceled = new Promise(resolve => networkAbort.signal.addEventListener('abort', () =>
        resolve({ error: new Error(t('c576')), phase: networkPhase }), { once: true }));
      const networkCheck = () => { check(); if (networkAbort.signal.aborted) throw new Error(t('c576')); };
      // A resume after the access token expired must not send its first
      // request before the SDK holds a session again (CloudSession.js).
      const session = createCloudSessionGate({ auth: client.auth, owner: userId,
        signal: networkAbort.signal, check: networkCheck, now });
      const fetchLatest = () => {
        networkPhase = 'masters';
        const network = (async () => {
          // The session gate's wait (CloudSession) is its own number, not
          // part of the membership request's: a slow 「masters」 stage is then
          // either the request itself or this wait, never a guess.
          let at = now(); await session.ready();
          timings.sessionMs += Math.max(0, now() - at); at = now();
          const masters = await session.retryRefused(() => listCloudMasters(client, userId, networkAbort.signal, networkCheck));
          timings.mastersMs += Math.max(0, now() - at); networkCheck();
          const cutoff = now(); networkPhase = 'download'; at = now();
          const snapshot = await session.retryRefused(() => downloadLatest({ client, masterIds: masters, cutoff,
            signal: networkAbort.signal, check: networkCheck }));
          timings.latestHTTPMs += Math.max(0, now() - at); networkCheck(); return { masters, cutoff, snapshot };
        })().then(value => ({ value }), error => ({ error, phase: networkPhase }));
        return Promise.race([network, canceled]);
      };
      try {
        check(); const prefetched = fetchLatest();
        let at = now(); await bounded(database.initializeLatest()); timings.initializeMs = Math.max(0, now() - at); check();
        at = now(); const cached = await bounded(database.readLatestSnapshot(userId, { metadataOnly: true }));
        timings.latestCacheReadMs = Math.max(0, now() - at); check();
        publish({ snapshotBaseRevision: cached?.revision ?? null });
        let outcome = await prefetched;
        if (outcome.value && now() - outcome.value.cutoff >= 30000) { check(); outcome = await fetchLatest(); }
        if (Object.prototype.hasOwnProperty.call(outcome, 'error')) { phase = outcome.phase; throw outcome.error; }
        const { masters, cutoff, snapshot } = outcome.value; check(); phase = 'publish'; at = now();
        publish({ snapshotPending: true, mapPending: true });
        const revision = await bounded(database.publishLatestSnapshot(userId, { ...snapshot, masterIds: masters }, () => valid(version) && !abort.signal.aborted));
        const value = await bounded(database.readLatestSnapshot(userId, { positionsOnly: true })); check();
        if (!value?.verified || value.revision !== revision || value.cutoff !== cutoff) throw new Error(t('c588'));
        const authority = [...masters].sort((left, right) => left - right).join(',');
        if (archiveAuthority !== authority) {
          archiveAuthority = authority; archiveAuthorityVersion++; archiveAbort?.abort();
        }
        const accepted = createMapReadback(value, { owner: userId, scope, generation: version, attempt,
          revision: state.mapSuccessRevision + 1 }, () => valid(version) && state.mapAttempt === attempt && !abort.signal.aborted);
        readback = accepted; timings.snapshotCommitMs = Math.max(0, now() - at); committed = true;
        publish({ snapshotPending: false, mapPending: false, snapshotRevision: state.snapshotRevision + 1, snapshotCutoff: cutoff,
          mapSuccessRevision: state.mapSuccessRevision + 1, lastSuccess: now(), lastDownloadAt: cutoff,
          failingSince: null, error: '', authFailed: false, offline: false });
        resetBackoff();
        cloudSyncDiagnostic('latest-published', { attempt, elapsedMs: Math.max(0, now() - startedAt), revision: state.snapshotRevision, ...timings });
        catchUp.caughtUp();
        if (failureDiagnostic) { cloudSyncDiagnostic('recovered', { attempt, elapsedMs: Math.max(0, now() - startedAt) }); failureDiagnostic = null; }
        if (!await accepted.wait(abort.signal, CONTEXT_MS)) return;
        check(); if (readback !== accepted) throw new Error(t('c576'));
        // Transfer an immutable request. Do not return/await archiveRunning:
        // that would retain this latest slot until native archive drain.
        archiveRequest = { version, userId, attempt, masters, cutoff, snapshot, accepted, startedAt,
          authorityVersion: archiveAuthorityVersion };
        startArchive();
      } catch (error) {
        if (!committed && valid(version) && (!abort.signal.aborted || timedOut)) {
          observation?.finish(1, phase, timedOut ? 'timeout' : isAuthFailure(error) ? 'auth'
            : isNetworkFailure(error) ? 'network' : ['initialize', 'publish'].includes(phase) ? 'storage' : 'unknown', foreground);
          reportLatestFailure(error, timedOut, attempt, phase);
          // Offline archive proof is independent work too; it must not retain
          // the latest slot while an earlier native archive transaction drains.
          // An archive pass an earlier success queued (still waiting for a
          // running archive or manual download) stays queued: replacing it
          // with this offline proof skipped that pass until the next success
          // (audit B F12). It reads the archive publication too.
          if (!archiveRequest || archiveRequest.offline || !valid(archiveRequest.version))
            archiveRequest = { version, userId, offline: true };
          startArchive();
        }
      } finally {
        observation?.finish(committed ? 0 : 2, phase, '', foreground);
        abort.signal.removeEventListener('abort', cancel); networkAbort.abort(); clearTimeout(timeout);
        latestAbort = null; latestRunning = null;
        publish({ snapshotPending: false, mapPending: false }); updateBusy();
        if ((retryQueued || generation !== version) && foreground && owner) wake();
      }
    });
    return latestRunning;
  }

  function startArchive() {
    if (deleting || archiveRunning || manualRunning || !archiveRequest || !valid(archiveRequest.version)) return;
    const request = archiveRequest; archiveRequest = null;
    const { version, userId, attempt, masters, cutoff, snapshot, accepted, startedAt } = request;
    const abort = new AbortController(); archiveAbort = abort;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; abort.abort(); }, DOWNLOAD_MS);
    const authorized = () => request.offline || request.authorityVersion === archiveAuthorityVersion;
    const check = () => { if (!valid(version) || !authorized() || abort.signal.aborted) throw new Error(t('c576')); };
    const contextCurrent = () => valid(version) && !abort.signal.aborted && state.mapAttempt === attempt && readback === accepted;
    publish({ archivePending: true, busy: true, mode: 'auto' });
    // Fields of this pass read as unknown (MalformedFields): one line for it.
    const malformed = createMalformedFields();
    archiveRunning = withCloudSyncSlot(async () => {
      try {
        check();
        const archive = await database.readArchivePublication?.(userId); check();
        if (archive?.owner === userId && Number.isSafeInteger(archive.cutoff) && archive.cutoff >= 0
          && Number.isSafeInteger(archive.revision) && archive.revision > 0)
          publish({ archiveRevision: archive.revision, archiveCutoff: archive.cutoff });
        if (request.offline) return;
        if (contextCurrent()) {
          const contextAbort = new AbortController(), cancel = () => contextAbort.abort();
          abort.signal.addEventListener('abort', cancel, { once: true });
          let contextTimedOut = false, contextPublishing = false;
          const contextStartedAt = now(), progress = { requests: 0, completedDogs: 0 };
          const contextDogs = Array.isArray(snapshot?.dogs) ? snapshot.dogs.length : 0;
          const timer = setTimeout(() => { contextTimedOut = true; cancel(); }, CONTEXT_MS);
          let stop; const canceled = new Promise((_, reject) => { stop = () => reject(new Error(t('c576'))); });
          contextAbort.signal.addEventListener('abort', stop, { once: true });
          publish({ contextPending: true });
          try {
            const context = await Promise.race([downloadContext({ client, masterIds: masters, snapshot, progress,
              signal: contextAbort.signal, check: () => { if (!contextCurrent() || contextAbort.signal.aborted) throw new Error(t('c576')); } }), canceled]);
            if (contextCurrent()) {
              contextPublishing = true;
              await database.publishLatestSnapshot(userId, { ...context, masterIds: masters }, contextCurrent);
              if (contextCurrent()) {
                publish({ snapshotRevision: state.snapshotRevision + 1 });
                cloudSyncDiagnostic('context-published', { attempt, elapsedMs: Math.max(0, now() - contextStartedAt), dogs: contextDogs });
              }
            }
          } catch (error) {
            check();
            // Cancellation by a newer latest attempt is not a context failure.
            if (contextCurrent()) cloudSyncDiagnostic('context-failed', { attempt, elapsedMs: Math.max(0, now() - contextStartedAt),
              failureKind: contextFailureKind(error, contextTimedOut, contextPublishing),
              dogs: contextDogs, completedDogs: progress.completedDogs, requests: progress.requests });
          } finally {
            clearTimeout(timer); abort.signal.removeEventListener('abort', cancel);
            contextAbort.signal.removeEventListener('abort', stop); contextAbort.abort();
            if (valid(version)) publish({ contextPending: false });
          }
        }
        check(); await database.beginDownload?.(userId); check();
        for (const masterId of masters) {
          check(); await downloadMasterIncremental({ client, database, owner: userId, masterId, cutoff,
            signal: abort.signal, check, malformed, onChange: () => { if (valid(version)) publish({ revision: state.revision + 1 }); } });
        }
        check(); await repairCloudTrackTimes({ client, database, owner: userId, signal: abort.signal, check,
          onChange: () => { if (valid(version)) publish({ revision: state.revision + 1 }); } });
        if (now() - sweptAt >= SWEEP_MS) {
          sweptAt = now();
          for (const masterId of masters) {
            check(); await reconcileCloudWindow({ client, owner: userId, masterId, now: cutoff,
              database: { ...database, savePage: async (...args) => { check(); await database.savePage(...args); if (valid(version)) publish({ revision: state.revision + 1 }); } },
              signal: abort.signal, isCurrent: () => valid(version), malformed });
          }
        }
        check(); const material = await publishScoped(() => valid(version), () => database.publishDownload(userId, 'auto', cutoff,
          () => valid(version) && authorized() && !abort.signal.aborted), authorized); check();
        publish({ archiveRevision: state.archiveRevision + 1, archiveCutoff: cutoff, archiveError: '',
          ...(Number.isSafeInteger(material?.dataRevision) ? { dataRevision: material.dataRevision } : {}) });
        cloudSyncDiagnostic('archive-published', { attempt, elapsedMs: Math.max(0, now() - startedAt), revision: state.archiveRevision });
      } catch (error) {
        if (valid(version) && (!abort.signal.aborted || timedOut)) publish({ archiveError: t('c211'),
          ...(!timedOut && isAuthFailure(error) ? { authFailed: true } : {}) });
      } finally {
        malformed.report('archive');
        clearTimeout(timeout); archiveRunning = null; archiveAbort = null;
        if (valid(version)) publish({ archivePending: false, contextPending: false }); updateBusy();
        startArchive();
      }
    });
  }

  return {
    mapPublication: () => ({ scope, owner, generation, attempt: state.mapAttempt, pending: state.mapPending, busy: state.snapshotPending,
      snapshotBaseRevision: state.snapshotBaseRevision, mapSuccessRevision: state.mapSuccessRevision,
      publishedRevision: state.publishedRevision, publishedPending: state.publishedPending,
      readback: readback?.value ?? null, acknowledgeMapRead, bootstrapAllowed: !state.snapshotPending && !!(state.error || state.authFailed || state.offline) }),
    historyPublication: () => ({ scope, owner, generation, lineage, latestFirst: true, ...(releaseReadiness ? { latestReadReady: readiness.ready() } : {}),
      attempt: state.mapAttempt, pending: state.publishedPending, busy: false, mapSuccessRevision: state.archiveRevision,
      dataRevision: state.dataRevision, publishedRevision: state.publishedRevision, publishedPending: state.publishedPending,
      archiveRevision: state.archiveRevision, archiveCutoff: state.archiveCutoff, archiveError: state.archiveError }),
    setSession(session) {
      const next = session?.user.id || null; sessionKnown = true;
      if (next === owner) { readiness.notify(); return; }
      cancelBackgroundSync(); latestAbort?.abort(); archiveAbort?.abort(); manualAbort?.abort();
      owner = next; generation++; lineage++; readback = null; archiveRequest = null; sweptAt = 0;
      archiveAuthority = null; archiveAuthorityVersion++;
      initialStarted = retryQueued = false; failureDiagnostic = null; resetCatchUp(); resetBackoff();
      publish({ error: '', lastSuccess: null, lastDownloadAt: null, failingSince: null, authFailed: false, offline: false,
        snapshotPending: false, snapshotRevision: 0, snapshotCutoff: null, snapshotBaseRevision: null, contextPending: false,
        archivePending: false, archiveRevision: 0, archiveCutoff: null, archiveError: '', mapSuccessRevision: 0, mapPending: false,
        mapAttempt: 0, dataRevision: null, publishedRevision: 0, publishedPending: !!publishedOperation, revision: state.revision + 1, catchUp: CATCH_UP_IDLE });
      wake();
    },
    setForeground(active) {
      if (foreground === active) return;
      foreground = active; generation++; clearInterval(interval);
      // A manual history download keeps running (runManual: its lease is the
      // lineage, which a leave/return does not change).
      latestAbort?.abort(); archiveAbort?.abort(); archiveRequest = null;
      if (active) { resetBackoff(); cancelBackgroundSync(); catchUp.back(); interval = setInterval(tick, 30000); wake(); }
      else { retryQueued = false; catchUp.away(); clearTimeout(immediate); }
      publish({});
    },
    retry() {
      if (disposed || !foreground || !owner) return;
      retryQueued = true;
      if (catchUp.state().phase === 'failed') catchUp.retry({ deferStart: true }); else wake();
    },
    // A manual history download (HistoryCloud) belongs to the account's
    // lineage, not to the generation: a leave/return of the app (a permission
    // dialog, a share sheet, the home button) or 重試 on the catch-up pill
    // bumps the generation and used to abort it, throwing away what it had
    // downloaded (2026-10-15, audit B F10). It now keeps going through those;
    // an account switch, a deletion or disposal (lineage++, manualAbort)
    // still ends it, and every publication is checked against the lineage
    // inside the native lock, so nothing is published for another account
    // or after a deletion.
    async runManual(work, abort = new AbortController()) {
      if (deleting) throw new Error(t('c576'));
      if (manualRunning) throw new Error(t('c585'));
      const lease = lineage, leaseOwner = owner;
      const current = () => !disposed && !deleting && !!owner && owner === leaseOwner
        && lineage === lease && !abort.signal.aborted;
      // Started from the screen, so in front; the readiness wait ends early
      // when the generation changes (a resume): wait again then, as long as
      // the lease holds.
      let ready = !releaseReadiness || readiness.ready();
      for (let waits = 0; !ready && waits < 3 && current() && foreground; waits++) {
        const before = generation;
        ready = await readiness.wait(abort.signal);
        if (!ready && generation === before) break;
      }
      if (!ready || !current() || !foreground) throw new Error(t('c576'));
      if (manualRunning) throw new Error(t('c585'));
      archiveAbort?.abort(); archiveRequest = null; manualAbort = abort;
      // Assign immediately to reserve the manual lane while its old native
      // archive drains. Latest work never borrows this promise or slot.
      // The lease's own commands skip the session's archive-priority gate
      // (useTrackingSession.leasedCommands): admitted above, they keep going
      // in the background, where that gate is never ready.
      const leased = database.leasedCommands?.(current) ?? database;
      manualRunning = (async () => {
        await archiveRunning;
        if (!current()) throw new Error(t('c576'));
        publish({ archivePending: true, busy: true, mode: 'manual' });
        return withCloudSyncSlot(async () => {
          if (!current()) throw new Error(t('c576'));
          await leased.beginDownload?.(owner, 'manual');
          if (!current()) throw new Error(t('c576'));
          const count = await work(current, commit => publishScoped(current, commit), leased);
          if (!current()) throw new Error(t('c576'));
          // Re-checked inside the native lock, like the automatic publication.
          await publishScoped(current, () => leased.publishDownload(owner, 'manual', null, current)); return count;
        });
      })();
      try { return await manualRunning; }
      finally {
        manualRunning = null; if (manualAbort === abort) manualAbort = null;
        if (!disposed && lineage === lease) publish({ archivePending: false, revision: state.revision + 1 });
        updateBusy(); startArchive();
      }
    },
    dispose() {
      disposed = true; generation++; lineage++; readiness.close(); releaseReadiness?.(); releaseDeletion?.(); catchUp.close();
      clearInterval(interval); clearTimeout(immediate); archiveRequest = null;
      latestAbort?.abort(); archiveAbort?.abort(); manualAbort?.abort();
      return Promise.allSettled([latestRunning, archiveRunning, manualRunning]);
    },
  };
}
