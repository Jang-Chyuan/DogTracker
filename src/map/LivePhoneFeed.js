import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useLiveLocation } from '../locationTracker/useLiveLocation';
import { PHONE_FIX_MAX_AGE_S } from './MapFraming';

// The recording service's live snapshot is read once a second, and while it
// records each copy differs from the last even when the phone stands still:
// the fix's age, its time and the received/saved counters move every second.
// Only the phone's dot needs every copy (it hands native the fix time it is
// drawing, PhoneLocationOverlay). Handing each copy to the whole live map
// re-rendered MapScreen, GoogleTrackingMap and every marker once a second and
// had Google redraw the map, idle on the map included.

// The phone's dot stops animating (and writing its display position back)
// after this many seconds without a fix, PhoneLocationOverlay's threshold. Its
// colour never follows age: a stop held in low-power mode (a fix about every
// 30 s, at most 5 minutes apart) keeps the phone's colour.
const PHONE_STALE_AFTER_S = 3;
// While nothing else changes, the map's copy still takes a newer fix time
// this often, so ages measured from it (the card's 「手機 x 分鐘前」, the
// 10-minute cut-off) stay within the map clock's own step.
export const LIVE_PHONE_REFRESH_MS = 10000;

function ageStep(ageSeconds) {
  if (!Number.isFinite(ageSeconds)) return 'none';
  if (ageSeconds > PHONE_FIX_MAX_AGE_S) return 'lost';
  return ageSeconds > PHONE_STALE_AFTER_S ? 'stale' : 'fresh';
}

// Everything the map reads except what moves every second by itself.
function shownFields(value) {
  const { ageSeconds, received, accepted, rejected, saved, position, ...rest } =
    value;
  return JSON.stringify({
    ...rest,
    age: ageStep(ageSeconds),
    position: position ? { ...position, timestamp: undefined } : position,
  });
}

/**
 * Whether the live map must take `next` instead of the copy it shows: any
 * change except the per-second age, fix time and counters; the age crossing
 * 3 s (grey dot) or 10 minutes (no fix); or a fix time LIVE_PHONE_REFRESH_MS
 * newer than the shown one (or older: a new session or a clock change).
 */
export function livePhoneChanged(shown, next) {
  if (shown === next) return false;
  if (!shown || !next) return true;
  if (shownFields(shown) !== shownFields(next)) return true;
  const before = shown.position?.timestamp;
  const after = next.position?.timestamp;
  if (!Number.isFinite(after)) return false;
  return (
    !Number.isFinite(before) ||
    after < before ||
    after - before >= LIVE_PHONE_REFRESH_MS
  );
}

/** The newest live snapshot, for the phone's dot: { get, set, subscribe }. */
export function createLivePhoneFeed() {
  let value = null;
  const listeners = new Set();
  return {
    get: () => value,
    set(next) {
      if (next === value) return;
      value = next;
      listeners.forEach(listener => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const NO_FEED = { get: () => null, subscribe: () => () => {} };

/**
 * The phone's dot: the feed's newest copy while it has a position, else the
 * copy its parent drew it from (a fixture, history, or the moment recording
 * stops before the parent removes the dot).
 */
export function useLivePhone(feed, shown) {
  const source = feed ?? NO_FEED;
  const latest = useSyncExternalStore(source.subscribe, source.get);
  return latest?.running && latest.position ? latest : shown;
}

/**
 * Reads the live snapshot once a second (useLiveLocation) without rendering
 * anything: every copy goes to `feed` (the phone's dot and `onEvery`), and
 * `onChange` gets only the copies livePhoneChanged lets through.
 */
export function LivePhoneReader({ active, feed, onChange, onEvery }) {
  const live = useLiveLocation(active);
  const shown = useRef(undefined);
  useEffect(() => {
    // Away (the app in the background, or a page over the map) the last copy
    // stays: handing null removed the phone's dot and circle at every pause
    // and drew a new marker at every resume, whose bitmap could be taken
    // before the map was back on screen (no dot until an unrelated redraw),
    // and whose deferred removal Fabric reported as MissingViewState. The
    // next read (within a second of coming back) replaces it.
    if (!active) return;
    feed.set(live);
    onEvery?.(live);
    if (shown.current !== undefined && !livePhoneChanged(shown.current, live))
      return;
    shown.current = live;
    onChange(live);
  }, [active, live, feed, onChange, onEvery]);
  return null;
}
