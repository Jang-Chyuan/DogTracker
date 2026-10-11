import { t } from '../i18n';
import { cloudSyncDiagnostic } from '../logger';
import { downloadMasterIncremental, listCloudMasters } from './CloudIncremental';
import { withCloudSyncSlot, withLatestSyncSlot, cancelBackgroundSync } from './CloudSyncSlot';
import { reconcileCloudWindow } from './CloudReconcile';
import { repairCloudTrackTimes } from './CloudTrackTime';
import { isAuthFailure, isNetworkFailure } from './CloudErrors';
import { createResumeCatchUp, CATCH_UP_IDLE } from '../tracking/ResumeCatchUp';
import { createLatestReadinessGate, createMapReadback } from './CloudMapReadback';

const DOWNLOAD_MS = 120000, CONTEXT_MS = 10000, SWEEP_MS = 600000;

// Requires a genuinely independent latest native file, worker, monitor and JS
// lock. An archive operation already inside native SQL remains owned/draining;
// it can no longer prevent the next foreground latest attempt from starting.
export function createIndependentCloudSync({ client, database, onChange, now, downloadLatest, downloadContext }) {
  if (!database.latestStorageIsolated) throw new Error('Independent latest storage is required');
  const scope = {};
  let owner = null, foreground = false, sessionKnown = false, disposed = false, generation = 0;
  let latestRunning = null, archiveRunning = null, manualRunning = null;
  let latestAbort = null, archiveAbort = null, manualAbort = null, archiveRequest = null;
  let readback = null, readbackStartedAt = null, interval, immediate, publishedOperation = null;
  let initialStarted = false, retryQueued = false, sweptAt = 0, failureDiagnostic = null;
  let archiveAuthority = null, archiveAuthorityVersion = 0;
  let deleting = false;
  let state = { latestFirst: true, snapshotPending: false, snapshotRevision: 0, snapshotCutoff: null, snapshotBaseRevision: null,
    archivePending: false, archiveRevision: 0, archiveCutoff: null, archiveError: '', contextPending: false,
    busy: false, mode: null, error: '', lastSuccess: null, lastDownloadAt: null, failingSince: null,
    authFailed: false, offline: false, revision: 0, mapSuccessRevision: 0, mapPending: false, mapAttempt: 0,
    dataRevision: null, publishedRevision: 0, publishedPending: false, catchUp: CATCH_UP_IDLE };
  const valid = version => !disposed && foreground && !!owner && version === generation;
  const readiness = createLatestReadinessGate(() => ({ owner, generation, ready: sessionKnown && (!owner ||
    !disposed && foreground && (readback?.acknowledged() && readback.value.owner === owner
      && readback.value.generation === generation && readback.value.attempt === state.mapAttempt
      || !state.snapshotPending && !!state.error)) }));
  const releaseReadiness = database.installLatestReadinessGate?.(readiness);
  const publish = patch => {
    state = { ...state, ...patch };
    readiness.notify();
    if (!disposed) onChange({ ...state, owner, foreground });
  };
  const releaseDeletion = database.installDeletionFence?.(() => {
    deleting = true; generation++; readback = null; archiveRequest = null;
    latestAbort?.abort(); archiveAbort?.abort(); manualAbort?.abort();
    publish({ mapPending: true, snapshotPending: true });
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
    if (accepted && !before) {
      cloudSyncDiagnostic('latest-applied', { attempt: value.attempt,
        elapsedMs: Math.max(0, now() - readbackStartedAt), revision: value.revision });
      publish({});
    }
    return accepted;
  };
  const publishScoped = async (version, work, authorized = () => true) => {
    if (!valid(version) || !authorized()) throw new Error(t('c576'));
    const operation = {}; publishedOperation = operation;
    publish({ publishedPending: true, publishedRevision: state.publishedRevision + 1 });
    let result;
    try { result = await work(); return result; }
    finally {
      if (publishedOperation === operation) {
        publishedOperation = null;
        publish({ publishedPending: false, publishedRevision: state.publishedRevision + 1,
          dataRevision: valid(version) && authorized() && Number.isSafeInteger(result?.dataRevision) && result.dataRevision >= 0 ? result.dataRevision : null });
      }
    }
  };
  const reportLatestFailure = (error, timedOut, attempt, phase) => {
    const status = error?.status ?? error?.context?.status ?? error?.cause?.status ?? error?.cause?.context?.status;
    const diagnostic = { attempt, phase, failureKind: timedOut ? 'timeout' : isAuthFailure(error) ? 'auth'
      : isNetworkFailure(error) ? 'network' : ['initialize', 'publish'].includes(phase) ? 'storage' : 'unknown',
    status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null };
    if (!failureDiagnostic || ['phase', 'failureKind', 'status'].some(key => diagnostic[key] !== failureDiagnostic[key]))
      cloudSyncDiagnostic('failure', diagnostic);
    failureDiagnostic = diagnostic;
    publish({ error: timedOut ? t('c587') : error.message, failingSince: state.failingSince ?? now(),
      authFailed: !timedOut && isAuthFailure(error), offline: timedOut || isNetworkFailure(error) });
    if (catchUp.state().phase === 'idle') catchUp.caughtUp(); else catchUp.failed();
  };

  function tick() {
    if (disposed || deleting || !foreground || !owner || latestRunning) return latestRunning;
    const version = generation, userId = owner, startedAt = now(), attempt = state.mapAttempt + 1;
    const abort = new AbortController(); latestAbort = abort;
    let timedOut = false, phase = 'initialize', committed = false;
    const timeout = setTimeout(() => { timedOut = true; abort.abort(); }, DOWNLOAD_MS);
    const check = () => { if (!valid(version) || abort.signal.aborted) throw new Error(t('c576')); };
    const timings = { slotWaitMs: 0, initializeMs: 0, archiveProofMs: 0, latestCacheReadMs: 0,
      mastersMs: 0, latestHTTPMs: 0, snapshotCommitMs: 0 };
    readback = null; readbackStartedAt = startedAt;
    catchUp.started(retryQueued || !initialStarted); retryQueued = false; initialStarted = true;
    publish({ busy: true, mode: manualRunning ? 'manual' : 'auto', error: '', authFailed: false,
      snapshotPending: true, mapPending: true, mapAttempt: attempt });
    latestRunning = withLatestSyncSlot(async () => {
      timings.slotWaitMs = Math.max(0, now() - startedAt);
      const networkAbort = new AbortController(), cancel = () => networkAbort.abort();
      abort.signal.addEventListener('abort', cancel, { once: true });
      let networkPhase = 'masters';
      const canceled = new Promise(resolve => networkAbort.signal.addEventListener('abort', () =>
        resolve({ error: new Error(t('c576')), phase: networkPhase }), { once: true }));
      const networkCheck = () => { check(); if (networkAbort.signal.aborted) throw new Error(t('c576')); };
      const fetchLatest = () => {
        networkPhase = 'masters';
        const network = (async () => {
          let at = now(); const masters = await listCloudMasters(client, userId, networkAbort.signal, networkCheck);
          timings.mastersMs += Math.max(0, now() - at); networkCheck();
          const cutoff = now(); networkPhase = 'download'; at = now();
          const snapshot = await downloadLatest({ client, masterIds: masters, cutoff, signal: networkAbort.signal, check: networkCheck });
          timings.latestHTTPMs += Math.max(0, now() - at); networkCheck(); return { masters, cutoff, snapshot };
        })().then(value => ({ value }), error => ({ error, phase: networkPhase }));
        return Promise.race([network, canceled]);
      };
      try {
        check(); const prefetched = fetchLatest();
        let at = now(); await database.initializeLatest(); timings.initializeMs = Math.max(0, now() - at); check();
        at = now(); const cached = await database.readLatestSnapshot(userId, { metadataOnly: true });
        timings.latestCacheReadMs = Math.max(0, now() - at); check();
        publish({ snapshotBaseRevision: cached?.revision ?? null });
        let outcome = await prefetched;
        if (outcome.value && now() - outcome.value.cutoff >= 30000) { check(); outcome = await fetchLatest(); }
        if (Object.prototype.hasOwnProperty.call(outcome, 'error')) { phase = outcome.phase; throw outcome.error; }
        const { masters, cutoff, snapshot } = outcome.value; check(); phase = 'publish'; at = now();
        const revision = await database.publishLatestSnapshot(userId, { ...snapshot, masterIds: masters }, () => valid(version) && !abort.signal.aborted);
        const value = await database.readLatestSnapshot(userId, { positionsOnly: true }); check();
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
          failingSince: null, authFailed: false, offline: false });
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
          reportLatestFailure(error, timedOut, attempt, phase);
          // Offline archive proof is independent work too; it must not retain
          // the latest slot while an earlier native archive transaction drains.
          archiveRequest = { version, userId, offline: true };
          startArchive();
        }
      } finally {
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
          const timer = setTimeout(cancel, CONTEXT_MS);
          let stop; const canceled = new Promise((_, reject) => { stop = () => reject(new Error(t('c576'))); });
          contextAbort.signal.addEventListener('abort', stop, { once: true });
          publish({ contextPending: true });
          try {
            const context = await Promise.race([downloadContext({ client, masterIds: masters, snapshot,
              signal: contextAbort.signal, check: () => { if (!contextCurrent() || contextAbort.signal.aborted) throw new Error(t('c576')); } }), canceled]);
            if (contextCurrent()) {
              await database.publishLatestSnapshot(userId, { ...context, masterIds: masters }, contextCurrent);
              if (contextCurrent()) publish({ snapshotRevision: state.snapshotRevision + 1 });
            }
          } catch { check(); }
          finally {
            clearTimeout(timer); abort.signal.removeEventListener('abort', cancel);
            contextAbort.signal.removeEventListener('abort', stop); contextAbort.abort();
            if (valid(version)) publish({ contextPending: false });
          }
        }
        check(); await database.beginDownload?.(userId); check();
        for (const masterId of masters) {
          check(); await downloadMasterIncremental({ client, database, owner: userId, masterId, cutoff,
            signal: abort.signal, check, onChange: () => { if (valid(version)) publish({ revision: state.revision + 1 }); } });
        }
        check(); await repairCloudTrackTimes({ client, database, owner: userId, signal: abort.signal, check,
          onChange: () => { if (valid(version)) publish({ revision: state.revision + 1 }); } });
        if (now() - sweptAt >= SWEEP_MS) {
          sweptAt = now();
          for (const masterId of masters) {
            check(); await reconcileCloudWindow({ client, owner: userId, masterId, now: cutoff,
              database: { ...database, savePage: async (...args) => { check(); await database.savePage(...args); if (valid(version)) publish({ revision: state.revision + 1 }); } },
              signal: abort.signal, isCurrent: () => valid(version) });
          }
        }
        check(); const material = await publishScoped(version, () => database.publishDownload(userId, 'auto', cutoff,
          () => valid(version) && authorized() && !abort.signal.aborted), authorized); check();
        publish({ archiveRevision: state.archiveRevision + 1, archiveCutoff: cutoff, archiveError: '',
          ...(Number.isSafeInteger(material?.dataRevision) ? { dataRevision: material.dataRevision } : {}) });
        cloudSyncDiagnostic('archive-published', { attempt, elapsedMs: Math.max(0, now() - startedAt), revision: state.archiveRevision });
      } catch (error) {
        if (valid(version) && (!abort.signal.aborted || timedOut)) publish({ archiveError: t('c211'),
          ...(!timedOut && isAuthFailure(error) ? { authFailed: true } : {}) });
      } finally {
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
    historyPublication: () => ({ scope, owner, generation, latestFirst: true, ...(releaseReadiness ? { latestReadReady: readiness.ready() } : {}),
      attempt: state.mapAttempt, pending: state.publishedPending, busy: false, mapSuccessRevision: state.archiveRevision,
      dataRevision: state.dataRevision, publishedRevision: state.publishedRevision, publishedPending: state.publishedPending,
      archiveRevision: state.archiveRevision, archiveCutoff: state.archiveCutoff, archiveError: state.archiveError }),
    setSession(session) {
      const next = session?.user.id || null; sessionKnown = true;
      if (next === owner) { readiness.notify(); return; }
      cancelBackgroundSync(); latestAbort?.abort(); archiveAbort?.abort(); manualAbort?.abort();
      owner = next; generation++; readback = null; archiveRequest = null; sweptAt = 0;
      archiveAuthority = null; archiveAuthorityVersion++;
      initialStarted = retryQueued = false; failureDiagnostic = null; resetCatchUp();
      publish({ error: '', lastSuccess: null, lastDownloadAt: null, failingSince: null, authFailed: false, offline: false,
        snapshotPending: false, snapshotRevision: 0, snapshotCutoff: null, snapshotBaseRevision: null, contextPending: false,
        archivePending: false, archiveRevision: 0, archiveCutoff: null, archiveError: '', mapSuccessRevision: 0, mapPending: false,
        mapAttempt: 0, dataRevision: null, publishedRevision: 0, publishedPending: !!publishedOperation, revision: state.revision + 1, catchUp: CATCH_UP_IDLE });
      wake();
    },
    setForeground(active) {
      if (foreground === active) return;
      foreground = active; generation++; clearInterval(interval);
      latestAbort?.abort(); archiveAbort?.abort(); manualAbort?.abort(); archiveRequest = null;
      if (active) { cancelBackgroundSync(); catchUp.back(); interval = setInterval(tick, 30000); wake(); }
      else { retryQueued = false; catchUp.away(); clearTimeout(immediate); }
      publish({});
    },
    retry() {
      if (disposed || !foreground || !owner) return;
      retryQueued = true;
      if (catchUp.state().phase === 'failed') catchUp.retry({ deferStart: true }); else wake();
    },
    async runManual(work, abort = new AbortController()) {
      if (deleting) throw new Error(t('c576'));
      if (manualRunning) throw new Error(t('c585'));
      const version = generation;
      if (releaseReadiness && !readiness.ready() && !await readiness.wait(abort.signal)) throw new Error(t('c576'));
      if (!valid(version) || abort.signal.aborted) throw new Error(t('c576'));
      if (manualRunning) throw new Error(t('c585'));
      archiveAbort?.abort(); archiveRequest = null; manualAbort = abort;
      // Assign immediately to reserve the manual lane while its old native
      // archive drains. Latest work never borrows this promise or slot.
      manualRunning = (async () => {
        await archiveRunning;
        if (!valid(version) || abort.signal.aborted) throw new Error(t('c576'));
        publish({ archivePending: true, busy: true, mode: 'manual' });
        return withCloudSyncSlot(async () => {
          if (!valid(version) || abort.signal.aborted) throw new Error(t('c576'));
          await database.beginDownload?.(owner, 'manual');
          if (!valid(version) || abort.signal.aborted) throw new Error(t('c576'));
          const count = await work(() => valid(version) && !abort.signal.aborted, commit => publishScoped(version, commit));
          if (!valid(version) || abort.signal.aborted) throw new Error(t('c576'));
          await publishScoped(version, () => database.publishDownload(owner, 'manual')); return count;
        });
      })();
      try { return await manualRunning; }
      finally {
        manualRunning = null; manualAbort = null;
        if (valid(version)) publish({ archivePending: false, revision: state.revision + 1 });
        updateBusy(); startArchive();
      }
    },
    dispose() {
      disposed = true; generation++; readiness.close(); releaseReadiness?.(); releaseDeletion?.(); catchUp.close();
      clearInterval(interval); clearTimeout(immediate); archiveRequest = null;
      latestAbort?.abort(); archiveAbort?.abort(); manualAbort?.abort();
      return Promise.allSettled([latestRunning, archiveRunning, manualRunning]);
    },
  };
}
