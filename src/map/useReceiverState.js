import { useEffect, useRef, useState } from 'react';
import { NativeModules, Platform } from 'react-native';

const POLL_MS = 2000;

// The map's view of the receiver: the native service's own state, read
// directly every POLL_MS while `active`. BleService.getBackgroundState also
// replays the last payload into the hardware screen's handlers, which the map
// must not trigger. `reader` is anything with getState(): the native module,
// or a debug screen fixture (src/dev/ScreenFixtures.js).
//
// Returns undefined while the first read of this reader is still pending, so
// the map can wait before framing a receiver whose identity is not known yet;
// null when inactive, without a native module, or after a failed first read.
export function useReceiverState(active, reader) {
  const native = reader ?? (Platform.OS === 'android' ? NativeModules.BleBackground : null);
  const [state, setState] = useState(undefined);
  // Native creates a fresh bridge object on every poll, including its nested
  // receiverPauses. Compare the complete payload so new fields/errors still
  // publish, but an unchanged receiver does not wake every App child at 2 s.
  const publishedKey = useRef(undefined);
  useEffect(() => {
    if (!active || !native?.getState) return undefined;
    let disposed = false;
    let reading = false;
    const read = async () => {
      if (reading) return;
      reading = true;
      try {
        const next = await native.getState();
        if (!disposed) {
          const value = next ?? null;
          const key = JSON.stringify(value);
          if (key !== publishedKey.current) {
            publishedKey.current = key;
            setState(value);
          }
        }
      } catch {
        // A failed read keeps the last known state; the next poll retries.
        if (!disposed) setState(current => (current === undefined ? null : current));
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
  // A switched reader (fixture on/off) must not show the previous one's state.
  const [owner, setOwner] = useState(native);
  if (owner !== native) {
    publishedKey.current = undefined;
    setOwner(native);
    setState(undefined);
  }
  if (!active || !native?.getState) return null;
  return state;
}
