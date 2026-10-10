import { useEffect, useRef, useState } from 'react';
import { startOfToday } from '../tracking/TodayDistance';
import { createTodayRouteEngine } from '../tracking/TodayRouteEngine';

// How often the live map adds newly recorded positions to today's distance.
// The pill shows tenths of a kilometre, so a few seconds late is invisible.
export const TODAY_ROUTE_POLL_MS = 15000;
// S4 (位置記錄) shows the count of today's fixes (「今天 N 筆」, one every
// 10 s): read often enough there that a new fix, or the empty table right
// after 刪除我的路線, shows at once. Each read only asks for rows after the
// cursor, and the sum is recomputed only when rows arrived.
export const TODAY_COUNT_POLL_MS = 2000;
const PAGE = 2000;

/**
 * 「今天 x km」: today's recorded route of this phone, read incrementally from
 * myLocationTracker while the live map is in front (only new rows each poll;
 * the day starts over at local midnight). The distance is my route's range
 * for today — departure detection, driving not counted (todayRouteDistance),
 * the same number as the history summary. Returns { count, metres, status }
 * or null until the first read. `pollMs`: how often to look for new rows; a
 * change reads at once.
 */
export function useTodayRoute(database, ready, active, clock = Date.now, pollMs = TODAY_ROUTE_POLL_MS) {
  // `engine` keeps what the history logic built from the rows read so far
  // (TodayRouteEngine): a poll only works through the new rows (068). A new
  // day, or a row older than one already taken, starts a new one.
  const rows = useRef({ day: null, engine: null, count: 0, cursor: null, last: null, read: 0 });
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
        if (rows.current.day !== day) {
          rows.current = { day, engine: createTodayRouteEngine({ dayStart: day }), count: 0,
            cursor: null, last: null, read: -1 };
        }
        const current = rows.current;
        for (;;) {
          const page = await database.phoneRouteSince(day, current.cursor, PAGE);
          if (!alive || rows.current !== current) return;
          if (!page.length) break;
          if (!current.engine.add(page)) {
            // Out of order (a clock change): read the day again from the start.
            rows.current = { ...current, day: null };
            return;
          }
          current.count += page.length;
          const last = page[page.length - 1];
          current.last = last.time;
          current.cursor = { time: last.time, id: last.id };
          if (page.length < PAGE) break;
        }
        // New rows change the answer; without them only the clock can, while
        // a departure is being confirmed (it settles at minute 8 by the
        // phone's time even if no fix came, 判定表「出發偵測：資料不到 8 分鐘」).
        if (current.read === current.count && current.status !== 'confirming') return;
        current.read = current.count;
        const sum = current.engine.sum(Math.max(at, current.last ?? at));
        current.status = sum.status;
        const { count, metres, status } = sum;
        setRoute(value => (value?.count === count && value?.metres === metres && value?.status === status
          ? value : { count, metres, status }));
      } catch {
        // A failed read keeps the last sum; the next poll tries again.
      } finally {
        if (alive) timer = setTimeout(poll, pollMs);
      }
    }
    poll();
    return () => { alive = false; clearTimeout(timer); };
  }, [database, ready, active, pollMs]);
  return route;
}
