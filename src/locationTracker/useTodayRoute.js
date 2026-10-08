import { useEffect, useRef, useState } from 'react';
import { startOfToday, todayRouteDistance } from '../tracking/TodayDistance';

// How often the live map adds newly recorded positions to today's distance.
// The pill shows tenths of a kilometre, so a few seconds late is invisible.
export const TODAY_ROUTE_POLL_MS = 15000;
const PAGE = 2000;

/**
 * 「今天 x km」: today's recorded route of this phone, read incrementally from
 * myLocationTracker while the live map is in front (only new rows each poll;
 * the day starts over at local midnight). The distance is my route's range
 * for today — departure detection, driving not counted (todayRouteDistance),
 * the same number as the history summary. Returns { count, metres, status }
 * or null until the first read.
 */
export function useTodayRoute(database, ready, active, clock = Date.now) {
  const rows = useRef({ day: null, list: [], cursor: null, state: null, read: 0 });
  const [route, setRoute] = useState(null);
  const now = useRef(clock);
  now.current = clock;
  useEffect(() => {
    if (!ready || !active || !database?.phoneRouteSince) return undefined;
    let alive = true, timer;
    async function poll() {
      try {
        const at = now.current();
        const day = startOfToday(at);
        if (rows.current.day !== day) rows.current = { day, list: [], cursor: null, state: null, read: -1 };
        const current = rows.current;
        for (;;) {
          const page = await database.phoneRouteSince(day, current.cursor, PAGE);
          if (!alive || rows.current !== current) return;
          if (!page.length) break;
          current.list.push(...page);
          const last = page[page.length - 1];
          current.cursor = { time: last.time, id: last.id };
          if (page.length < PAGE) break;
        }
        // Only new rows change the answer (the clock alone moves 「現在」,
        // which the pill does not show).
        if (current.read === current.list.length) return;
        current.read = current.list.length;
        const sum = todayRouteDistance(current.list, { now: Math.max(at, current.list.at(-1)?.time ?? at),
          dayStart: day, state: current.state });
        current.state = sum.state;
        const { count, metres, status } = sum;
        setRoute(value => (value?.count === count && value?.metres === metres && value?.status === status
          ? value : { count, metres, status }));
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
