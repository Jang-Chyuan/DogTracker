import { t } from '../i18n';
import { logger } from '../logger';
import { useEffect, useReducer, useRef, useState } from 'react';
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

function isForeground(state) {
  return state === 'active' || state === 'unknown' || state == null;
}

// App composition only: data adapters and renderers do not know about the UI,
// BLE state, or each other's physical tables.
export function useTrackingSession(createDatabases = createLocalDatabases) {
  const controlsRef = useRef(null);
  const [historyDatabase] = useState(() => Object.fromEntries(
    HISTORY_DATABASE_METHODS.map(method => [method, (...args) =>
      controlsRef.current?.historyCommand(method, args) ?? Promise.reject(new Error(t("c487")))]),
  ));
  const [cloudDatabase] = useState(() => Object.fromEntries(
    CLOUD_DATABASE_METHODS.map(method => [method,
      (...args) => controlsRef.current?.cloudCommand(method, args) ??
        Promise.reject(new Error(t("c487"))),
    ]),
  ));
  // Stable diagnostics adapter; it borrows this owner's real DB and cannot
  // open/close another Nitro connection or access settings tables.
  const [hardwareDatabase] = useState(() => ({
    initialize: () => controlsRef.current?.initializeReal() ?? Promise.reject(new Error('Tracking session is closed')),
    listHistory: limit => controlsRef.current?.listRealHistory(limit) ?? Promise.reject(new Error('Tracking session is closed')),
    saveStatus: (status, payload) => controlsRef.current?.saveRealStatus(status, payload) ?? Promise.reject(new Error('Tracking session is closed')),
  }));
  const mode = 'real';
  const [trackingSources, dispatchTracking] = useReducer(
    trackingSourceReducer,
    undefined,
    createTrackingSourceState,
  );
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

  useEffect(() => {
    let disposed = false;
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
      const createFeed = (source, repository) =>
        createTrackingFeed(repository, {
          includeHistory: true,
          onRefreshing() {
            if (!disposed) dispatchTracking({ type: 'refreshing', source });
          },
          onCaughtUp() {
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
            if (!disposed)
              dispatchTracking({ type: 'initial-snapshot-ready', source });
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
            reportedReadErrors[source] = null;
            if (!disposed) {
              setErrors(current =>
                current[source] === null
                  ? current
                  : { ...current, [source]: null },
              );
            }
          },
          onError: error => reportError(source, error),
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
          await databases[source].initialize();
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
        active = isForeground(state);
        if (!disposed) setForeground(active);
        if (active) resumeFeed();
        else {
          if (!disposed) {
            dispatchTracking({ type: 'refreshing', source: 'real' });
          }
          feeds.real.stop();
        }
      });

      let cloudInitialization;
      controlsRef.current = {
        historyCommand(method, args) {
          const task = initialization.real.then(async () => {
            if (disposed || !databases.history) throw new Error(t("c485"));
            // A day read of an account's cloud rows waits for the cloud table's migrations.
            if (['historyDayRows', 'historyDays'].includes(method) && args[0]?.owner) {
              if (!cloudInitialization) cloudInitialization = databases.cloud.initialize().catch(error => { cloudInitialization = null; throw error; });
              await cloudInitialization;
            }
            return databases.history[method](...args);
          });
          commands.add(task);
          return task.finally(() => commands.delete(task));
        },
        cloudCommand(method, args) {
          if (!databases.cloud) return Promise.reject(new Error(t("c486")));
          if (!cloudInitialization) {
            cloudInitialization = initialization.real.then(() => databases.cloud.initialize());
            cloudInitialization.catch(() => { cloudInitialization = null; });
          }
          const task = cloudInitialization.then(() => {
            if (disposed) throw new Error(t("c483"));
            return method === 'initialize' ? undefined : databases.cloud[method](...args);
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
            return databases.dogData.deleteAll(options);
          });
          commands.add(task);
          return task.finally(() => commands.delete(task));
        },
        saveTrackingPreferences: trackingPreferences.save,
        retryTrackingPreferences: trackingPreferences.load,
        resetTrackingPreferences: trackingPreferences.reset,
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

      return () => {
        subscription.remove();
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
      controlsRef.current = null;
      lifecycle.close().catch(error => {
        logger.error(t("c489"), error);
      });
    };
  }, [createDatabases]);

  return {
    cloudDatabase,
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
