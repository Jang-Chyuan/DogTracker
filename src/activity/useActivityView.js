// The activity page's data: reads one dog's period through `read` and builds
// the A4 view (src/activity/views). The running period (今天, 這一週…) is read
// again when the screen's clock reaches a new minute; past periods once. 年 is
// read and judged a month at a time with a pause in between, so the page
// (spinner, back key, tabs) stays responsive over half a million minutes.
import { useCallback, useEffect, useRef, useState } from 'react';
import { activityPeriod, buildActivityView, combineYearView } from './views';
import { activityDetail, activityViewInput } from './ActivityData';
import { minuteOf } from './ActivityMinutes';

const pause = () => new Promise(resolve => setTimeout(resolve, 0));

/**
 * @param read (slaveId, { start, end, detail }) => Promise<ActivityData answer>
 * @param readEarliest (slaveId) => Promise<number|null>
 * @param now the screen's clock (a fixture's fixed time); only its minute counts
 * @returns {{ status: 'loading'|'ready'|'error', view, retry }}
 */
export function useActivityView({ read, readEarliest, slaveId, mode, date, now, active = true }) {
  const minute = minuteOf(now);
  const [state, setState] = useState({ key: null, status: 'loading', view: null });
  const [attempt, setAttempt] = useState(0);
  const earliest = useRef({ slaveId: null, time: undefined });
  const period = activityPeriod(mode, date);
  const key = `${slaveId}|${mode}|${period.start}|${attempt}`;
  const current = activityPeriod(mode, minute).start === period.start;
  // The running period follows the clock; a past one does not.
  const clock = current ? minute : null;
  useEffect(() => {
    if (!active || !read) return undefined;
    let alive = true;
    (async () => {
      try {
        if (earliest.current.slaveId !== slaveId || earliest.current.time === undefined) {
          const time = readEarliest ? await readEarliest(slaveId) : null;
          earliest.current = { slaveId, time };
        }
        const at = clock ?? minute;
        const first = earliest.current.time;
        const bound = first != null && first < at ? first : at;
        let view;
        if (mode === 'year') {
          const months = [];
          for (let start = period.start; start < Math.min(period.end, at + 1);) {
            const month = activityPeriod('month', start);
            // Months before the dog's first reading have nothing to read.
            if (first != null && month.end > first) {
              const answer = await read(slaveId, { start: month.start, end: month.end, detail: 'minute' });
              if (!alive) return;
              months.push(buildActivityView({ mode: 'month', date: month.start, now: at,
                earliest: Math.min(bound, month.start), since: first, ...activityViewInput(answer) }));
              await pause();
              if (!alive) return;
            }
            start = month.end;
          }
          view = combineYearView({ date: period.start, now: at, earliest: bound, months });
        } else {
          const answer = await read(slaveId, { start: period.start, end: period.end, detail: activityDetail(mode) });
          if (!alive) return;
          view = buildActivityView({ mode, date: period.start, now: at, earliest: bound, since: first,
            ...activityViewInput(answer) });
        }
        setState({ key, status: 'ready', view });
      } catch {
        if (alive) setState({ key, status: 'error', view: null });
      }
    })();
    return () => {
      alive = false;
    };
    // `minute` only matters through `clock` (the running period).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, clock, active, read, readEarliest]);
  const retry = useCallback(() => {
    earliest.current = { slaveId: null, time: undefined };
    setAttempt(value => value + 1);
  }, []);
  // A different period shows 載入中 until its own answer, never the old one.
  if (state.key !== key) return { status: 'loading', view: null, retry };
  return { ...state, retry };
}
