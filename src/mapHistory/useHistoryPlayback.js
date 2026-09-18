import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  cursorAtFraction,
  DEFAULT_SPEED,
  nextCursor,
  playbackWindow,
  TICK_MS,
} from './HistoryPlayback';

const IDLE = { window: null, at: null, playing: false };

/**
 * Owns the playback cursor of the history tab.
 *
 * While the cursor is null the whole window is drawn, which is also where
 * playback lands when it reaches the end. Starting playback freezes
 * the window it started with: a "last N hours" query keeps moving its end every
 * refresh, and a cursor measured against a moving window would jump or restart
 * under the user. Changing the query (or leaving the tab) ends playback,
 * because a cursor from another range would hide most of the new one.
 */
export function useHistoryPlayback(data, queryKey, active = true) {
  const live = useMemo(() => playbackWindow(data), [data]);
  const [state, setState] = useState(IDLE);
  const [speed, setSpeed] = useState(DEFAULT_SPEED);
  const liveWindow = useRef(live);
  liveWindow.current = live;
  useEffect(() => {
    setState(IDLE);
  }, [queryKey, active]);
  useEffect(() => {
    if (!state.playing || !state.window || !active) return undefined;
    const timer = setInterval(() => {
      setState(current => {
        if (!current.playing || !current.window) return current;
        const at = nextCursor(current.at, current.window, speed);
        // Reaching the end ends playback completely rather than parking the
        // cursor on the last moment: a frozen cursor would keep hiding every
        // row recorded since, and the final frame is the whole window anyway.
        return at >= current.window.until ? IDLE : { ...current, at };
      });
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [state.playing, state.window, speed, active]);
  const stop = useCallback(() => setState(IDLE), []);
  const toggle = useCallback(() => {
    setState(current => {
      if (current.playing) return { ...current, playing: false };
      const window = current.window || liveWindow.current;
      if (!window) return current;
      // Pressing play at the end replays the window instead of doing nothing.
      const at = Number.isFinite(current.at) && current.at < window.until
        ? current.at : window.since;
      return { window, at, playing: true };
    });
  }, []);
  const seek = useCallback(fraction => {
    setState(current => {
      const window = current.window || liveWindow.current;
      if (!window) return current;
      return { ...current, window, at: cursorAtFraction(fraction, window) };
    });
  }, []);
  return {
    window: state.window || live,
    at: state.at,
    playing: state.playing,
    speed,
    toggle,
    seek,
    stop,
    setSpeed,
  };
}
