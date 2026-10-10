// The activity page's data: reads one dog's period through `read` and builds
// the A4 view (src/activity/views). The running period (今天, 這一週…) is read
// again when the screen's clock reaches a new minute; past periods once. 年 is
// read and judged a month at a time with a pause in between, so the page
// (spinner, back key, tabs) stays responsive over half a million minutes.
import { useCallback, useEffect, useRef, useState } from 'react';
import { activityPeriod, buildActivityView, combineYearView } from './views';
import { activityDetail, activityViewInput } from './ActivityData';
import { minuteOf } from './ActivityMinutes';
import { captureMapRead, completedMapRevision } from '../cloud/CloudPublication';

const pause = () => new Promise(resolve => setTimeout(resolve, 0));

/**
 * @param read (slaveId, { start, end, detail }) => Promise<ActivityData answer>
 * @param readEarliest (slaveId) => Promise<number|null>
 * @param now the screen's clock (a fixture's fixed time); only its minute counts
 * @returns {{ status: 'loading'|'ready'|'error', view, retry, earliest }} `earliest`:
 *   the dog's first reading as last read (null: none; undefined: not read yet)
 */
export function useActivityView({ read, readEarliest, slaveId, mode, date, now, active = true,
  owner = null, getPublication = null, revision = 0, publishedReads = false }) {
  const minute = minuteOf(now);
  const [state, setState] = useState({ key: null, status: 'loading', view: null });
  const [attempt, setAttempt] = useState(0);
  // A new reader (another account, the database reopened) is another source:
  // its answers never mix with the old one's.
  const sources = useRef({ read: null, readEarliest: null, id: 0 });
  if (sources.current.read !== read || sources.current.readEarliest !== readEarliest) {
    sources.current = { read, readEarliest, id: sources.current.id + 1 };
  }
  const source = sources.current.id;
  const accepted = useRef(null);
  // The dog's first reading as last read (‹ stops there; a tab switch that
  // lands before it shows the first period with data instead).
  const [first, setFirst] = useState({ key: null, time: null });
  const period = activityPeriod(mode, date);
  const key = `${source}|${owner ?? ''}|${slaveId}|${mode}|${period.start}`;
  const current = activityPeriod(mode, minute).start === period.start;
  // The running period follows the clock; a past one does not.
  const clock = current ? minute : null;
  useEffect(() => {
    if (!active || !read) return undefined;
    let alive = true;
    (async () => {
      const publication = publishedReads && accepted.current !== key && getPublication
        ? () => { const value = getPublication(); return value && { ...value, pending: false }; }
        : getPublication;
      const fence = captureMapRead(publication, owner, completedMapRevision(publication?.()));
      try {
        if (!fence.open) return;
        setState(previous => ({ key, status: previous.key === key && previous.view ? 'ready' : 'loading', view: previous.key === key ? previous.view : null }));
        // Read every time: the first reading moves when older history is
        // downloaded, and appears once a dog without any gets one.
        const earliest = readEarliest ? await readEarliest(slaveId) : null;
        if (!alive || !fence.valid()) return;
        const at = clock ?? minute;
        const bound = earliest != null && earliest < at ? earliest : at;
        // A date outside [first reading, now] (a tab switch from a period
        // that started before the first reading) shows the nearest period.
        const target = Math.min(Math.max(date, bound), at);
        const shown = activityPeriod(mode, target);
        let view;
        if (mode === 'year') {
          const months = [];
          for (let start = shown.start; start < Math.min(shown.end, at + 1);) {
            const month = activityPeriod('month', start);
            // Months before the dog's first reading have nothing to read.
            if (earliest != null && month.end > earliest) {
              const answer = await read(slaveId, { start: month.start, end: month.end, detail: 'minute' });
              if (!alive || !fence.valid()) return;
              months.push(buildActivityView({ mode: 'month', date: month.start, now: at,
                earliest: Math.min(bound, month.start), since: earliest, ...activityViewInput(answer) }));
              await pause();
              if (!alive || !fence.valid()) return;
            }
            start = month.end;
          }
          view = combineYearView({ date: shown.start, now: at, earliest: bound, months });
        } else {
          const answer = await read(slaveId, { start: shown.start, end: shown.end, detail: activityDetail(mode) });
          if (!alive || !fence.valid()) return;
          view = buildActivityView({ mode, date: shown.start, now: at, earliest: bound, since: earliest,
            ...activityViewInput(answer) });
        }
        if (!alive || !fence.valid()) return;
        setFirst({ key: `${source}|${owner ?? ''}|${slaveId}`, time: earliest });
        accepted.current = key;
        setState({ key, status: 'ready', view });
      } catch {
        if (alive && fence.valid()) setState(previous => ({ key, status: 'error', view: previous.key === key ? previous.view : null }));
      }
    })();
    return () => {
      alive = false;
    };
    // `minute` only matters through `clock` (the running period).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, clock, active, read, readEarliest, attempt, owner, getPublication, revision, publishedReads]);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  const earliest = first.key === `${source}|${owner ?? ''}|${slaveId}` ? first.time : undefined;
  // A different period or source shows 載入中 until its own answer, never the old one.
  if (state.key !== key) return { status: 'loading', view: null, retry, earliest };
  return { ...state, retry, earliest };
}
