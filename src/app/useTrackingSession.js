import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { createLocalDatabases } from '../database/LocalDatabases';
import { databaseSessions } from '../database/DatabaseSession';
import { createDemoTrackingRepository } from '../demo/DemoTrackingRepository';
import { createDemoPresetRow, createDemoSeed } from '../demo/DemoPresets';
import {
  createTrackingPreferences,
  DEFAULT_TRACKING_PREFERENCES,
} from '../tracking/TrackingPreferences';
import { createRealTrackingRepository } from '../repositories/RealTrackingRepository';
import { createTrackingFeed } from '../tracking/TrackingFeed';
import { getErrorMessage } from '../utils/errors';
import { emptyTrackingPoint } from '../models/TrackingPoint';

function isForeground(state) {
  return state === 'active' || state === 'unknown' || state == null;
}

// App composition only: data adapters and renderers do not know about mode UI,
// BLE state, or each other's physical tables.
export function useTrackingSession(createDatabases = createLocalDatabases) {
  const controlsRef = useRef(null);
  // Stable diagnostics adapter; it borrows this owner's real DB and cannot
  // open/close another Nitro connection or access Demo/settings tables.
  const [hardwareDatabase] = useState(() => ({
    initialize: () => controlsRef.current?.initializeReal() ?? Promise.reject(new Error('Tracking session is closed')),
    listHistory: limit => controlsRef.current?.listRealHistory(limit) ?? Promise.reject(new Error('Tracking session is closed')),
    saveStatus: (status, payload) => controlsRef.current?.saveRealStatus(status, payload) ?? Promise.reject(new Error('Tracking session is closed')),
  }));
  const [mode, setMode] = useState(DEFAULT_TRACKING_PREFERENCES.mode);
  const [points, setPoints] = useState({
    real: emptyTrackingPoint,
    demo: emptyTrackingPoint,
  });
  const [ready, setReady] = useState({ real: false, demo: false });
  const [preferences, setPreferences] = useState({
    value: DEFAULT_TRACKING_PREFERENCES,
    ready: false,
    busy: false,
    error: null,
    recoveryAvailable: false,
  });
  const [errors, setErrors] = useState({ real: null, demo: null });
  const [realWriteError, setRealWriteError] = useState(null);
  const [nativeWriteError, setNativeWriteError] = useState(null);
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoError, setDemoError] = useState(null);
  const [demoSummary, setDemoSummary] = useState(null);
  const [demoSummaryError, setDemoSummaryError] = useState(null);
  const [foreground, setForeground] = useState(() =>
    isForeground(AppState.currentState),
  );

  useEffect(() => {
    let disposed = false;
    // Disable old controls while waiting for the prior owner or a failed reopen.
    setMode(DEFAULT_TRACKING_PREFERENCES.mode);
    setPoints({ real: emptyTrackingPoint, demo: emptyTrackingPoint });
    setReady({ real: false, demo: false });
    setPreferences({
      value: DEFAULT_TRACKING_PREFERENCES,
      ready: false,
      busy: false,
      error: null,
      recoveryAvailable: false,
    });
    setErrors({ real: null, demo: null });
    setRealWriteError(null);
    setNativeWriteError(null);
    setDemoBusy(false);
    setDemoError(null);
    setDemoSummary(null);
    setDemoSummaryError(null);
    // The shared owner covers full remounts as well as replays of this effect.
    const lifecycle = databaseSessions.open(() => {
      if (disposed) return;
      const databases = createDatabases();
      let active = isForeground(AppState.currentState);
      setForeground(active);
      let selectedMode = DEFAULT_TRACKING_PREFERENCES.mode;
      let modeLoaded = false;
      let busy = false;
      let resettingDemo = false;
      // Writes and their error callbacks belong to this owner, never its replay.
      const realWrites = new Set();
      const commands = new Set();
      const initialized = { real: false, demo: false };
      const reportedReadErrors = { real: null, demo: null };
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
          console.error(`${source} SQLite:`, error);
        }
      };
      const createFeed = (source, repository) =>
        createTrackingFeed(repository, {
          onRows(rows) {
            if (!disposed)
              setPoints(current => ({
                ...current,
                [source]: rows[rows.length - 1],
              }));
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
        demo: createDemoTrackingRepository(databases.demo),
      };
      const feeds = {
        real: createFeed('real', repositories.real),
        demo: createFeed('demo', repositories.demo),
      };

      function resumeFeed() {
        if (selectedMode === 'demo' && resettingDemo) return;
        if (!disposed && modeLoaded && active && initialized[selectedMode])
          feeds[selectedMode].start();
      }

      const trackingPreferences = createTrackingPreferences(
        databases.settings,
        state => {
          if (disposed) return;
          setPreferences(state);
          // Never read one source while asynchronously restoring another source.
          if (
            state.ready &&
            (!modeLoaded || state.value.mode !== selectedMode)
          ) {
            modeLoaded = true;
            selectMode(state.value.mode);
          }
        },
      );
      trackingPreferences.load();

      async function refreshDemoSummary() {
        try {
          const summary = await databases.demo.getSummary();
          if (!disposed) {
            setDemoSummary(summary);
            setDemoSummaryError(null);
          }
        } catch (error) {
          // A read error after a committed write is not a failed write. Do not
          // invite a duplicate insert by reporting that the command failed.
          if (!disposed) setDemoSummaryError(getErrorMessage(error));
        }
      }

      const initialization = {};
      for (const source of ['real', 'demo']) {
        initialization[source] = Promise.resolve().then(async () => {
          await databases[source].initialize();
          if (source === 'demo') {
            await databases.demo.ensureSeed(createDemoSeed());
            await refreshDemoSummary();
          }
        });
        initialization[source]
          .then(() => {
            if (disposed) return;
            initialized[source] = true;
            setReady(current => ({ ...current, [source]: true }));
            if (source === selectedMode) resumeFeed();
          })
          .catch(error => reportError(source, error));
      }
      const subscription = AppState.addEventListener('change', state => {
        active = isForeground(state);
        if (!disposed) setForeground(active);
        if (active) resumeFeed();
        else {
          feeds.real.stop();
          feeds.demo.stop();
        }
      });

      function runCommand(label, command, requiresDemo = true) {
        if (busy || disposed || (requiresDemo && !initialized.demo))
          return Promise.resolve(false);
        busy = true;
        setDemoBusy(true);
        const task = (async () => {
          try {
            const result = await command();
            return result !== false && !disposed;
          } catch (error) {
            if (!disposed)
              setDemoError(`${label}失敗：${getErrorMessage(error)}`);
            console.error('Demo 操作失敗:', error);
            return false;
          } finally {
            busy = false;
            if (!disposed) setDemoBusy(false);
          }
        })();
        commands.add(task);
        task.finally(() => commands.delete(task));
        return task;
      }

      function selectMode(source) {
        feeds.real.stop();
        feeds.demo.stop();
        selectedMode = source;
        setMode(source);
        resumeFeed();
      }

      controlsRef.current = {
        initializeReal: () => initialization.real,
        listRealHistory(limit) {
          const task = initialization.real.then(() => databases.real.listHistory(limit));
          commands.add(task);
          return task.finally(() => commands.delete(task));
        },
        saveTrackingPreferences: trackingPreferences.save,
        retryTrackingPreferences: trackingPreferences.load,
        resetTrackingPreferences: trackingPreferences.reset,
        setDemoMode: enabled =>
          runCommand(
            '切換模式',
            () => {
              if (typeof enabled !== 'boolean')
                throw new TypeError('Demo 模式必須是開或關');
              return trackingPreferences.save({
                mode: enabled ? 'demo' : 'real',
              });
            },
            false,
          ),
        refreshDemoSummary: () =>
          runCommand('讀取 Demo 筆數', refreshDemoSummary),
        appendDemo: key =>
          runCommand('寫入 Demo', async () => {
            await databases.demo.insertRow(createDemoPresetRow(key));
            if (!disposed) setDemoError(null);
            await refreshDemoSummary();
            // Point/route updates still come from the repository feed, not rows
            // returned by the write command. Its regular poll is the only reader.
          }),
        saveRealStatus(status, payload) {
          // A Demo migration/read failure must not block the hardware writer.
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
        resetDemo: () =>
          runCommand('重設 Demo', async () => {
            setDemoError(null);
            resettingDemo = true;
            await feeds.demo.stop();
            try {
              await databases.demo.resetToSeed(createDemoSeed());
              if (!disposed) {
                setDemoError(null);
                setPoints(current => ({
                  ...current,
                  demo: emptyTrackingPoint,
                }));
                // Replace this source's cursor only after the atomic reset
                // commits. Old queries cannot repopulate pre-reset markers.
                feeds.demo = createFeed('demo', repositories.demo);
              }
              await refreshDemoSummary();
            } finally {
              resettingDemo = false;
              resumeFeed();
            }
          }),
      };

      return () => {
        subscription.remove();
        // Never close the shared connection while an owned query/write is pending.
        return Promise.allSettled([
          initialization.real,
          initialization.demo,
          feeds.real.stop(),
          feeds.demo.stop(),
          trackingPreferences.close(),
          ...realWrites,
          ...commands,
        ]).then(() => databases.close());
      };
    });
    lifecycle.ready.catch(error => {
      const message = getErrorMessage(error);
      if (!disposed) setErrors({ real: message, demo: message });
      console.error('SQLite 開啟失敗:', error);
    });
    return () => {
      disposed = true;
      controlsRef.current = null;
      lifecycle.close().catch(error => {
        console.error('SQLite 關閉失敗:', error);
      });
    };
  }, [createDatabases]);

  return {
    hardwareDatabase,
    mode,
    point: points[mode],
    demoPoint: points.demo,
    preferences,
    saveTrackingPreferences: patch =>
      controlsRef.current?.saveTrackingPreferences(patch),
    retryTrackingPreferences: () =>
      controlsRef.current?.retryTrackingPreferences(),
    resetTrackingPreferences: () =>
      controlsRef.current?.resetTrackingPreferences(),
    ready,
    errors,
    realWriteError: [nativeWriteError, realWriteError].filter(Boolean).join('\n') || null,
    reportNativeWriteError: setNativeWriteError,
    demoBusy,
    demoError,
    demoSummary,
    demoSummaryError,
    foreground,
    saveRealStatus(status, payload) {
      if (!controlsRef.current)
        return Promise.reject(new Error('Tracking session is closed'));
      return controlsRef.current.saveRealStatus(status, payload);
    },
    resetDemo: () => controlsRef.current?.resetDemo(),
    setDemoMode: enabled =>
      controlsRef.current?.setDemoMode(enabled) ?? Promise.resolve(false),
    appendDemo: key =>
      controlsRef.current?.appendDemo(key) ?? Promise.resolve(false),
    refreshDemoSummary: () =>
      controlsRef.current?.refreshDemoSummary() ?? Promise.resolve(false),
  };
}
