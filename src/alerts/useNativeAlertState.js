import { useEffect, useState } from 'react';
import { loadAlertState } from './AlertNotifications';
import { normalizeAlertState } from './AlertEngine';

// While in front the app checks this often whether the background check or
// the notification's 「暫停提醒 30 分」 moved the alert state on.
export const NATIVE_STATE_CHECK_MS = 5000;

/**
 * The alert state kept natively (AlertNotifications): { ready, revision,
 * state }. Read when the app comes to the front and every few seconds while it
 * is there; `revision` changes only when the native side wrote a newer state,
 * which the alert engine then starts from (App keys its source on it).
 */
export function useNativeAlertState(active, { period = NATIVE_STATE_CHECK_MS, load = loadAlertState } = {}) {
  const [value, setValue] = useState({ ready: false, revision: 0, state: null });
  useEffect(() => {
    if (!active) return undefined;
    let alive = true;
    // Each time the app comes to the front the state is read again before
    // the alerts run: the background check may have alerted or paused
    // meanwhile (not ready until then; App's source changes, so the engine
    // starts from what was read).
    setValue(current => (current.ready ? { ...current, ready: false } : current));
    const read = () => Promise.resolve()
      .then(() => load())
      .then(next => {
        if (!alive) return;
        setValue(current => (current.ready && current.revision === next.revision ? current
          : { ready: true, revision: next.revision, state: normalizeAlertState(next.state) }));
      }, () => {
        // Unreadable: start empty rather than never alert.
        if (alive) setValue(current => (current.ready ? current : { ready: true, revision: 0, state: null }));
      });
    read();
    const timer = setInterval(read, period);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [active, period, load]);
  return value;
}
