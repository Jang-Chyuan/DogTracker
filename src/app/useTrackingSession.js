import { startupPhase, markStartupPhase } from '../diagnostics/StartupPhases';
import { t } from '../i18n';
import { logger } from '../logger';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { createLocalDatabases } from '../database/LocalDatabases';
import { CLOUD_DATABASE_METHODS } from '../cloud/CloudDatabase';
import { HISTORY_DATABASE_METHODS } from '../mapHistory/HistoryDatabase';
import { databaseSessions } from '../database/DatabaseSession';
import {
  createTrackingPreferences,
  DEFAULT_TRACKING_PREFERENCES,
} from '../tracking/TrackingPreferences';
import { createRealTrackingRepository } from '../repositories/RealTrackingRepository';
import { createTrackingFeed } from '../tracking/TrackingFeed';
import { selectStatusRows } from '../tracking/RouteSamples';
import { getErrorMessage } from '../utils/errors';
import {
  createTrackingSourceState,
  trackingSourceReducer,
} from '../tracking/TrackingSourceState';
import { CATCH_UP_IDLE, createResumeCatchUp } from '../tracking/ResumeCatchUp';

function isForeground(state) {
  return state === 'active' || state === 'unknown' || state == null;
}

// App composition only: data adapters and renderers do not know about the UI,
// BLE state, or each other's physical tables.
export function useTrackingSession(createDatabases = createLocalDatabases) {
  const controlsRef = useRef(null);
  const [cloudControlsReady, setCloudControlsReady] = useState(false);
  const latestPriority = useRef(null);
  const deletionFence = useRef(null);
  const [historyDatabase] = useState(() => Object.fromEntries(
    HISTORY_DATABASE_METHODS.map(method => [method, (...args) =>
      controlsRef.current?.historyCommand(method, args) ?? Promise.reject(new Error(t("c487")))]),
  ));
  const [cloudDatabase] = useState(() => ({ latestStorageIsolated: createDatabases.latestStorageIsolated === true,
    ...Object.fromEntries(
    CLOUD_DATABASE_METHODS.map(method => [method,
      (...args) => controlsRef.current?.cloudCommand(method, args) ??
        Promise.reject(new Error(t("c487"))),
    ]),
  ),
  // A manual history download's own commands (runManual, HistoryCloud): its
  // lease was admitted through the archive-priority gate when it started, and
  // it keeps running across a leave/return of the app. Its later commands
  // must not wait at that gate again: in the background the gate is never
  // ready, so they used to fail with 「下載已取消」 after its 10-second budget
  // or at the return, with the lease still valid (#192). `isCurrent` is the
  // lease; a command after it ended is refused.
  leasedCommands(isCurrent) {
    return Object.fromEntries(CLOUD_DATABASE_METHODS.map(method => [method,
      (...args) => controlsRef.current?.cloudCommand(method, args, isCurrent) ??
        Promise.reject(new Error(t("c487")))]));
  }, installLatestReadinessGate(gate) {
    const previous = latestPriority.current;
    latestPriority.current = gate;
    if (previous !== gate) previous?.close();
    return () => { if (latestPriority.current === gate) latestPriority.current = null; };
  }, installDeletionFence(fence) {
    deletionFence.current = fence;
    return () => { if (deletionFence.current === fence) deletionFence.current = null; };
  } }));
  // Stable diagnostics adapter; it borrows this owner's real DB and cannot
  // open/close another Nitro connection or access settings tables.
  const [hardwareDatabase] = useState(() => ({
    initialize: () => controlsRef.current?.initializeReal() ?? Promise.reject(new Error('Tracking session is closed')),
    listHistory: limit => controlsRef.current?.listRealHistory(limit) ?? Promise.reject(new Error('Tracking session is closed')),
    saveStatus: (status, payload) => controlsRef.current?.saveRealStatus(status, payload) ?? Promise.reject(new Error('Tracking session is closed')),
  }));
  const mode = 'real';
  const [trackingSources, setTrackingSources] = useState(createTrackingSourceState);
  // Empty feed polls still report refreshing/caught-up/the same route. Keep
  // every action in the pure reducer, but let useState's eager identity check
  // skip scheduling the App when that reducer returns the current state.
  const dispatchTracking = useCallback(action => {
    setTrackingSources(current => trackingSourceReducer(current, action));
  }, []);
  const [preferences, setPreferences] = useState({
    value: DEFAULT_TRACKING_PREFERENCES,
    ready: false,
    busy: false,
    error: null,
    recoveryAvailable: false,
  });
  const [errors, setErrors] = useState({ real: null });
  const [realWriteError, setRealWriteError] = useState(null);
  const [nativeWriteError, setNativeWriteError] = useState(null);
  const [foreground, setForeground] = useState(() =>
    isForeground(AppState.currentState),
  );
  // 070: 正在更新狗的位置 while a return to the app catches the feed up.
  const [catchUp, setCatchUp] = useState(CATCH_UP_IDLE);

  useEffect(() => {
    let disposed = false;
    const archiveWaiting = new AbortController();
    setCloudControlsReady(false);
    // Disable old controls while waiting for the prior owner or a failed reopen.
    dispatchTracking({ type: 'reset-all' });
    setPreferences({
      value: DEFAULT_TRACKING_PREFERENCES,
      ready: false,
      busy: false,
      error: null,
      recoveryAvailable: false,
    });
    setErrors({ real: null });
    setRealWriteError(null);
    setNativeWriteError(null);
    setCatchUp(CATCH_UP_IDLE);
    // The shared owner covers full remounts as well as replays of this effect.
    const lifecycle = databaseSessions.open(() => {
      if (disposed) return;
      const databases = createDatabases();
      let active = isForeground(AppState.currentState);
      setForeground(active);
      let preferencesLoaded = false;
      // Writes and their error callbacks belong to this owner, never its replay.
      const realWrites = new Set();
      const commands = new Set();
      const initialized = { real: false };
      // Local latest/context display takes this same connection lock. Let its
      // first attempt finish before cloud migrations can monopolize that lock;
      // the full route/backfill is deliberately outside this startup barrier.
      let finishInitialLocalAttempt;
      const initialLocalAttempt = new Promise(resolve => { finishInitialLocalAttempt = resolve; });
      // A background-only session does not run the foreground feed. Do not
      // make background cloud work depend on a snapshot it cannot start.
      if (!active) finishInitialLocalAttempt();
      const reportedReadErrors = { real: null };
      const reportError = (source, error) => {
        const message = getErrorMessage(error);
        if (!disposed)
          setErrors(current =>
            current[source] === message
              ? current
              : { ...current, [source]: message },
          );
        if (reportedReadErrors[source] !== message) {
          reportedReadErrors[source] = message;
          logger.error(`${source} SQLite:`, error);
        }
      };
      // 重試 restarts the feed: stop() drops the callbacks of the read that
      // failed, so its late answer cannot end the new attempt.
      const resumeCatchUp = createResumeCatchUp({
        onChange: state => {
          if (!disposed) setCatchUp(state);
        },
        onRetry: () => {
          feeds.real.stop();
          resumeFeed();
        },
      });
      let liveReadCaughtUp = false;
      const createFeed = (source, repository) =>
        createTrackingFeed(repository, {
          includeHistory: true,
          onRefreshing() {
            liveReadCaughtUp = false;
            if (!disposed) dispatchTracking({ type: 'refreshing', source });
          },
          onCaughtUp() {
            liveReadCaughtUp = true;
            if (!disposed) dispatchTracking({ type: 'caught-up', source });
          },
          onLatest(point) {
            if (!disposed) dispatchTracking({ type: 'latest', source, point });
          },
          onPositionContext(rows) {
            if (!disposed)
              dispatchTracking({ type: 'position-context', source, rows });
          },
          onInitialSnapshotReady() {
            if (!disposed) {
              dispatchTracking({ type: 'initial-snapshot-ready', source });
              markStartupPhase('initial-snapshot-publish');
              finishInitialLocalAttempt();
            }
          },
          onRoute(route) {
            if (!disposed)
              dispatchTracking({
                type: 'route',
                source,
                route,
              });
          },
          onHistoryLoading() {
            if (!disposed)
              dispatchTracking({ type: 'history-loading', source });
          },
          onHistoryLoaded() {
            if (!disposed) dispatchTracking({ type: 'history-loaded', source });
          },
          onRows(rows) {
            if (!disposed)
              dispatchTracking({
                type: 'rows',
                source,
                rows: selectStatusRows(rows),
              });
          },
          onSuccess() {
            if (liveReadCaughtUp) resumeCatchUp.caughtUp();
            reportedReadErrors[source] = null;
            if (!disposed) {
              setErrors(current =>
                current[source] === null
                  ? current
                  : { ...current, [source]: null },
              );
            }
          },
          onError: error => {
            resumeCatchUp.failed();
            reportError(source, error);
            // A real local read failure keeps the original error/ready gates.
            // It must not prevent the independent cloud error/retry path.
            if (!disposed) finishInitialLocalAttempt();
          },
        });
      const repositories = {
        real: createRealTrackingRepository(databases.real),
      };
      const feeds = {
        real: createFeed('real', repositories.real),
      };

      function resumeFeed() {
        if (!disposed && preferencesLoaded && active && initialized.real)
          feeds.real.start();
      }

      const trackingPreferences = createTrackingPreferences(
        databases.settings,
        state => {
          if (disposed) return;
          setPreferences(state);
          // A failed preference load cannot start the local feed. Release the
          // independent cloud path without inventing preference/snapshot readiness.
          if (!state.ready && state.error != null) finishInitialLocalAttempt();
          if (state.ready && !preferencesLoaded) {
            preferencesLoaded = true;
            dispatchTracking({ type: 'refreshing', source: 'real' });
            feeds.real.stop();
            resumeFeed();
          }
        },
      );
      trackingPreferences.load();

      const initialization = {};
      for (const source of ['real']) {
        initialization[source] = Promise.resolve().then(async () => {
          await startupPhase('real-initialize', () => databases[source].initialize());
        });
        initialization[source]
          .then(() => {
            if (disposed) return;
            initialized[source] = true;
            dispatchTracking({ type: 'ready', source });
            resumeFeed();
          })
          .catch(error => reportError(source, error));
      }
      const subscription = AppState.addEventListener('change', state => {
        const wasActive = active;
        active = isForeground(state);
        if (!disposed) setForeground(active);
        if (active) {
          if (!wasActive) resumeCatchUp.back();
          resumeFeed();
        } else {
          if (wasActive) {
            // A poll that finished before the app went away must not end the
            // next catch-up: only a read after the return counts.
            liveReadCaughtUp = false;
            resumeCatchUp.away();
          }
          if (!disposed) {
            dispatchTracking({ type: 'refreshing', source: 'real' });
          }
          feeds.real.stop();
          finishInitialLocalAttempt();
        }
      });

      let cloudInitialization, latestInitialization;
      async function awaitArchivePriority(expectedOwner = undefined) {
        if (disposed) throw new Error(t("c483"));
        const gate = latestPriority.current;
        if (gate && (!await gate.wait(archiveWaiting.signal, expectedOwner) || latestPriority.current !== gate || !gate.ready()))
          throw new Error(t("c576"));
        if (disposed) throw new Error(t("c483"));
      }
      function initializeLatest() {
        if (!databases.cloud) return Promise.reject(new Error(t("c486")));
        if (!latestInitialization) {
          // Independent latest schema must not queue behind the archive/local
          // native worker. Map/Splash still require their existing real local,
          // preference, receiver and framing conditions independently.
          const local = databases.cloud.latestStorageIsolated ? Promise.resolve()
            : initialization.real.then(() => initialLocalAttempt);
          const task = local.then(() => {
            if (disposed) throw new Error(t("c483"));
            return (databases.cloud.initializeLatest ?? databases.cloud.initialize)();
          });
          latestInitialization = task;
          task.catch(() => { if (latestInitialization === task) latestInitialization = null; });
        }
        return latestInitialization;
      }
      function initializeCloud() {
        if (!databases.cloud) return Promise.reject(new Error(t("c486")));
        if (!cloudInitialization) {
          const task = initialization.real.then(() => initialLocalAttempt).then(async () => {
            if (disposed) throw new Error(t("c483"));
            await awaitArchivePriority();
            return startupPhase('history-cloud-initialize', () => databases.cloud.initialize());
          });
          cloudInitialization = task;
          task.catch(() => { if (cloudInitialization === task) cloudInitialization = null; });
        }
        return cloudInitialization;
      }
      controlsRef.current = {
        historyCommand(method, args) {
          const task = startupPhase('history-real-wait', () => initialization.real).then(async () => {
            if (disposed || !databases.history) throw new Error(t("c485"));
            // Only dog history reads this account's cloud rows. My route keeps
            // its account-scoped UI identity but needs local phone tables only.
            if (['historyDayRows', 'historyDays', 'historyDogs'].includes(method) && args[0]?.owner && args[0]?.subject !== 'phone') {
              await startupPhase('history-cloud-wait', initializeCloud);
              await awaitArchivePriority(args[0].owner);
            }
            return databases.history[method](...args);
          });
          commands.add(task);
          return task.finally(() => commands.delete(task));
        },
        cloudCommand(method, args, lease = null) {
          const latest = ['initializeLatest', 'readLatestSnapshot', 'publishLatestSnapshot'].includes(method);
          const local = ['loadRangeState', 'saveRangeState'].includes(method)
            || (['latestStatusRows', 'holdRows'].includes(method) && !args[0]);
          const readiness = latest ? initializeLatest : local
            ? () => initialization.real.then(() => initialLocalAttempt).then(initializeLatest) : initializeCloud;
          const task = readiness().then(async () => {
            if (lease) { if (!lease()) throw new Error(t("c576")); }
            else if (!latest && !local) await awaitArchivePriority(typeof args[0] === 'string' ? args[0] : undefined);
            if (disposed) throw new Error(t("c483"));
            return ['initialize', 'initializeLatest'].includes(method) ? undefined : databases.cloud[method](...args);
          });
          commands.add(task);
          return task.finally(() => commands.delete(task));
        },
        initializeReal: () => initialization.real,
        listRealHistory(limit) {
          const task = initialization.real.then(() => databases.real.listHistory(limit));
          commands.add(task);
          return task.finally(() => commands.delete(task));
        },
        // 刪除全部狗資料 (S7): rows still to upload, and the deletion itself
        // (DogDataStore). App starts every reader over afterwards.
        countUnsentUploads() {
          const task = initialization.real.then(() => databases.dogData?.unsent() ?? 0);
          commands.add(task);
          return task.finally(() => commands.delete(task));
        },
        deleteDogData(options) {
          const task = initialization.real.then(() => {
            if (disposed) throw new Error(t("c483"));
            if (!databases.dogData) throw new Error(t("c484"));
            return databases.dogData.deleteAll({ ...options, beforeDelete: () => deletionFence.current?.() });
          });
          commands.add(task);
          return task.finally(() => commands.delete(task));
        },
        saveTrackingPreferences: trackingPreferences.save,
        retryTrackingPreferences: trackingPreferences.load,
        resetTrackingPreferences: trackingPreferences.reset,
        retryCatchUp: resumeCatchUp.retry,
        saveRealStatus(status, payload) {
          const task = initialization.real
            .then(() => databases.real.saveStatus(status, payload))
            .then(
              insertId => {
                if (!disposed) setRealWriteError(null);
                return insertId;
              },
              error => {
                if (!disposed) setRealWriteError(getErrorMessage(error));
                throw error;
              },
            );
          realWrites.add(task);
          return task.finally(() => realWrites.delete(task));
        },
      };
      // Admit the independent latest engine only once its real command owner
      // exists. Local migrations retain their own readiness / Splash gates.
      setCloudControlsReady(true);

      return () => {
        subscription.remove();
        resumeCatchUp.close();
        // Cancel startup waiters before draining commands. Their disposed guard
        // rejects without launching migrations, while native reads still drain.
        finishInitialLocalAttempt();
        // Never close the shared connection while an owned query/write is pending.
        return Promise.allSettled([
          initialization.real,
          feeds.real.stop(),
          trackingPreferences.close(),
          ...realWrites,
          ...commands,
        ]).then(() => databases.close());
      };
    });
    lifecycle.ready.catch(error => {
      const message = getErrorMessage(error);
      if (!disposed) setErrors({ real: message });
      logger.error(t("c488"), error);
    });
    return () => {
      disposed = true;
      archiveWaiting.abort();
      controlsRef.current = null;
      lifecycle.close().catch(error => {
        logger.error(t("c489"), error);
      });
    };
  }, [createDatabases, dispatchTracking]);

  return {
    cloudDatabase,
    cloudReady: cloudDatabase.latestStorageIsolated ? cloudControlsReady : trackingSources.real.ready,
    historyDatabase,
    hardwareDatabase,
    mode,
    caughtUp: trackingSources[mode].caughtUp,
    point: trackingSources[mode].point,
    route: trackingSources[mode].route,
    positionSamples: trackingSources[mode].positionSamples,
    historyLoaded: trackingSources[mode].historyLoaded,
    initialSnapshotReady: trackingSources[mode].initialSnapshotReady,
    preferences,
    countUnsentUploads: () => controlsRef.current?.countUnsentUploads()
      ?? Promise.reject(new Error(t("c487"))),
    deleteDogData: options => controlsRef.current?.deleteDogData(options)
      ?? Promise.reject(new Error(t("c487"))),
    saveTrackingPreferences: patch =>
      controlsRef.current?.saveTrackingPreferences(patch),
    retryTrackingPreferences: () =>
      controlsRef.current?.retryTrackingPreferences(),
    catchUp,
    retryCatchUp: () => controlsRef.current?.retryCatchUp(),
    resetTrackingPreferences: () =>
      controlsRef.current?.resetTrackingPreferences(),
    ready: {
      real: trackingSources.real.ready,
    },
    errors,
    realWriteError: [nativeWriteError, realWriteError].filter(Boolean).join('\n') || null,
    reportNativeWriteError: setNativeWriteError,
    foreground,
    saveRealStatus(status, payload) {
      if (!controlsRef.current)
        return Promise.reject(new Error('Tracking session is closed'));
      return controlsRef.current.saveRealStatus(status, payload);
    },
  };
}
