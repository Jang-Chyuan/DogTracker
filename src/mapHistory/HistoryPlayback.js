// Playback rules for the history tab. Kept pure so the cursor, the clipping and
// the speed can be tested without a map or a timer.

/** 1 second of wall clock plays this many seconds of the recording. */
export const SPEEDS = Object.freeze([60, 600, 3600]);
export const DEFAULT_SPEED = 600;
export const TICK_MS = 250;

export function speedLabel(speed) {
  return speed < 3600 ? `${speed / 60} 分／秒` : `${speed / 3600} 小時／秒`;
}

/**
 * The span playback runs over: the first and last row actually drawn, not the
 * queried range. A "last 24 hours" query whose phone only holds the last three
 * would otherwise spend most of the playback on an empty map.
 */
export function playbackWindow(data) {
  let since = Infinity;
  let until = -Infinity;
  for (const track of [data?.phone, ...(data?.clients || [])]) {
    for (const time of track?.times || []) {
      if (time < since) since = time;
      if (time > until) until = time;
    }
  }
  if (!Number.isFinite(since) || !Number.isFinite(until) || until <= since) return null;
  return { since, until };
}

/**
 * The drawn part of a track up to `at`. Playback only hides the future, so no
 * anchor point is needed: the kept points already reach the cursor.
 */
export function clipTrackTo(track, at) {
  if (!track || !Number.isFinite(at)) return track;
  const segments = track.segments
    .map(segment => segment.filter(point => point.time <= at))
    .filter(segment => segment.length);
  const last = segments.length ? segments[segments.length - 1] : null;
  return {
    ...track,
    segments,
    // The marker is where the device was at the cursor, not where it ended up.
    latest: last ? last[last.length - 1] : null,
    count: segments.reduce((total, segment) => total + segment.length, 0),
  };
}

/** Where the cursor lands after `elapsed` of wall clock; never past the end. */
export function nextCursor(at, window, speed, elapsed = TICK_MS) {
  if (!window) return null;
  const from = Number.isFinite(at) ? at : window.since;
  return Math.min(window.until, from + elapsed * speed);
}

export function cursorFraction(at, window) {
  if (!window || !Number.isFinite(at)) return 1;
  return Math.min(1, Math.max(0, (at - window.since) / (window.until - window.since)));
}

export function cursorAtFraction(fraction, window) {
  if (!window) return null;
  const clamped = Math.min(1, Math.max(0, fraction));
  return window.since + clamped * (window.until - window.since);
}
