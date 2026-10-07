import { useEffect, useRef, useState } from 'react';
import { addRoutePoints, emptyRouteDistance, startOfToday } from '../tracking/TodayDistance';

// How often the live map adds newly recorded positions to today's distance.
// The pill shows tenths of a kilometre, so a few seconds late is invisible.
export const TODAY_ROUTE_POLL_MS = 15000;
const PAGE = 2000;

/**
 * 「今天 x km」: today's recorded route of this phone, read incrementally from
 * myLocationTracker while the live map is in front (only new rows each poll;
 * the sum starts over at local midnight). Returns { count, metres } or null
 * until the first read.
 */
export function useTodayRoute(database, ready, active, clock = Date.now) {
  const state = useRef(emptyRouteDistance());
  const cursor = useRef(null);
  const [route, setRoute] = useState(null);
  const now = useRef(clock);
  now.current = clock;
  useEffect(() => {
    if (!ready || !active || !database?.phoneRouteSince) return undefined;
    let alive = true, timer;
    async function poll() {
      try {
        const day = startOfToday(now.current());
        if (state.current.day !== day) {
          state.current = emptyRouteDistance(day);
          cursor.current = null;
        }
        for (;;) {
          const page = await database.phoneRouteSince(day, cursor.current, PAGE);
          if (!alive || state.current.day !== day) return;
          if (!page.length) break;
          state.current = addRoutePoints(state.current, page);
          const last = page[page.length - 1];
          cursor.current = { time: last.time, id: last.id };
          if (page.length < PAGE) break;
        }
        const { count, metres } = state.current;
        setRoute(current => (current?.count === count && current?.metres === metres ? current : { count, metres }));
      } catch {
        // A failed read keeps the last sum; the next poll tries again.
      } finally {
        if (alive) timer = setTimeout(poll, TODAY_ROUTE_POLL_MS);
      }
    }
    poll();
    return () => { alive = false; clearTimeout(timer); };
  }, [database, ready, active]);
  return route;
}
