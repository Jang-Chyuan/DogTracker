import { useEffect, useState } from 'react';

export const CLOCK_MS = 10000;

/**
 * The map's own clock.
 *
 * The time window, the faded marker and the 24-hour cut-off are all measured
 * against "now", but nothing else on this screen changes identity when the
 * collar goes quiet: the tracking row, the route snapshot and the preferences
 * all stay the same object. Without a clock the window would freeze at the
 * moment of the last row, and a position from hours ago would keep being drawn
 * as if it were current — exactly the case the window exists for.
 *
 * It stops while the map is not the visible screen, so a background app does
 * not re-render on a timer, and re-reads the time as soon as it runs again.
 */
export function useMapClock(running, period = CLOCK_MS) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), period);
    return () => clearInterval(timer);
  }, [running, period]);
  return now;
}
