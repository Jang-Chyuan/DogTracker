import { useEffect, useState } from 'react';
import { NativeModules, Platform } from 'react-native';

const POLL_MS = 2000;

// The home map's view of the receiver: the native service's own state, read
// directly. BleService.getBackgroundState also replays the last payload into
// the hardware screen's handlers, which the map must not trigger.
// `active` already folds in the app being in the foreground.
export function useReceiverState(active, native = Platform.OS === 'android' ? NativeModules.BleBackground : null) {
  const [state, setState] = useState(null);
  useEffect(() => {
    if (!active || !native?.getState) return undefined;
    let disposed = false;
    let reading = false;
    const read = async () => {
      if (reading) return;
      reading = true;
      try {
        const next = await native.getState();
        if (!disposed) setState(next ?? null);
      } catch {
        // A failed read keeps the last known state; the next poll retries.
      } finally {
        reading = false;
      }
    };
    read();
    const timer = setInterval(read, POLL_MS);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [active, native]);
  return state;
}
