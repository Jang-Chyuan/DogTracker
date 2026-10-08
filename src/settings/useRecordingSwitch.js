import { useCallback, useRef, useState } from 'react';
import { useLiveLocation } from '../locationTracker/useLiveLocation';
import { startLocationTracker, stopLocationTracker } from '../locationTracker/LocationTrackerService';
import { getErrorMessage } from '../utils/errors';

const SERVICE = Object.freeze({ start: startLocationTracker, stop: stopLocationTracker });

/**
 * Settings → 手機 「位置記錄」: the switch is the user's choice (on unless
 * they switched it off), read once a second while `active`; turning it on
 * asks for location if needed and starts recording. { enabled, running,
 * busy, error, toggle(on) }.
 */
export function useRecordingSwitch(active, service = SERVICE) {
  const live = useLiveLocation(active);
  // What the user chose, shown until the native state says the same.
  const [wanted, setWanted] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const running = useRef(false);
  const toggle = useCallback(async on => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setWanted(on);
    setError(null);
    try {
      if (on) await service.start(); else await service.stop();
    } catch (failure) {
      setWanted(null);
      setError(getErrorMessage(failure));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, [service]);
  const stored = live ? live.enabled ?? live.running : null;
  if (wanted != null && !busy && stored === wanted) setWanted(null);
  return { enabled: wanted ?? stored, running: !!live?.running, busy, error, toggle };
}
