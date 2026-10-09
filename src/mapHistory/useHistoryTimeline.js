import { useEffect, useRef, useState } from 'react';
import { historyTimeline } from '../history/HistoryTimeline';
import { createHistoryHolds } from '../placement/IndoorHold';
import { endOfDay, startOfToday } from '../tracking/TodayDistance';

// Today's list follows new rows as often as 「今天 x km」 does; another day
// only changes with a download, looked for less often.
export const HISTORY_TIMELINE_POLL_MS = 15000;
const PAST_POLL_MS = 60000;
// Without new rows, today's list is still recomputed this often: 「現在」
// turns into 「最後 12:05」 and a departure being confirmed settles.
const CLOCK_REFRESH_MS = 60000;

/**
 * Which list the old history page shows (054a; 055 replaces the page): the
 * dog it was opened for (看軌跡 stores that dog first), else my route
 * (「今天 x km」 stores the phone only). The day is the query's.
 */
export function timelineSubject(preferences, now) {
  if (!preferences) return null;
  const day = preferences.timeMode === 'fixed' && Number.isFinite(preferences.startAt)
    ? startOfToday(preferences.startAt) : startOfToday(now);
  if (preferences.client && preferences.slaves?.length) return { subject: 'dog', slaveId: preferences.slaves[0], day };
  if (preferences.phone) return { subject: 'phone', slaveId: null, day };
  return null;
}

/**
 * The H1/H2 time-line list of one dog or my route for one day (src/history):
 * stays, switch points, 沒有資料, departure and end. `read` is
 * HistoryDatabase.historyDayRows (or a screen fixture's). `source` is the
 * history's 資料來源 ('all' | 'local' | 'cloud'; its UI comes in 055).
 * `following` false fixes today's end at the last fix (recording switched
 * off, 判定表「記錄已關閉…但今天有路線」).
 * Returns { model, loading, error } — model null until the first read.
 */
export function useHistoryTimeline({ read, target, source = 'all', owner = null, active = true,
  clock = Date.now, following = true }) {
  const [result, setResult] = useState({ key: null, model: null, error: '' });
  const now = useRef(clock);
  now.current = clock;
  const key = target ? JSON.stringify([target.subject, target.slaveId, target.day, source, owner]) : null;
  useEffect(() => {
    if (!active || !read || !target) return undefined;
    let alive = true, timer;
    const cache = { rows: [], seed: [], after: {}, state: null, computedAt: 0, count: -1, today: null };
    // The hold pass (IndoorHold) is the costly part of a day: today's rows
    // only grow, so the same pass continues with the new packets.
    const holds = { pass: null, keys: [] };
    const replayHolds = packets => {
      const keys = packets.map(p => `${p.source}:${p.id}:${p.time}`);
      const same = holds.pass && holds.keys.length <= keys.length && holds.keys.every((done, i) => done === keys[i]);
      if (!same) { holds.pass = createHistoryHolds({ seed: cache.seed }); holds.keys = []; }
      holds.pass.append(packets.slice(holds.keys.length));
      holds.keys = keys;
      return holds.pass.output;
    };
    const dayStart = target.day, dayEnd = endOfDay(target.day);
    async function poll() {
      try {
        const at = now.current();
        const today = at >= dayStart && at < dayEnd;
        const answer = await read({ subject: target.subject, slaveId: target.slaveId, start: dayStart,
          end: dayEnd, source, owner, after: cache.after });
        if (!alive) return;
        if (cache.count < 0) cache.seed = answer.seed || [];
        cache.after = answer.after || {};
        if (answer.rows?.length) cache.rows = [...cache.rows, ...answer.rows].sort((a, b) => a.time - b.time);
        // Midnight (today turning into a past day) settles the day once more
        // (判定表「停留怎麼存」: 過了午夜…馬上把最後一次造訪結算).
        const changed = cache.rows.length !== cache.count || cache.today !== today;
        if (changed || (today && at - cache.computedAt >= CLOCK_REFRESH_MS)) {
          const model = historyTimeline(cache.rows, { subject: target.subject, source, dayStart, dayEnd,
            today, now: Math.max(at, cache.rows.at(-1)?.time ?? at), following: today && following,
            state: cache.state, replayHolds: target.subject === 'dog' ? replayHolds : undefined });
          cache.state = model.state;
          cache.count = cache.rows.length;
          cache.today = today;
          cache.computedAt = at;
          setResult({ key, model, error: '' });
        }
        if (alive) timer = setTimeout(poll, today ? HISTORY_TIMELINE_POLL_MS : PAST_POLL_MS);
      } catch (error) {
        if (!alive) return;
        setResult(current => ({ ...current, key, error: error?.message || '讀取失敗' }));
        timer = setTimeout(poll, HISTORY_TIMELINE_POLL_MS);
      }
    }
    poll();
    return () => { alive = false; clearTimeout(timer); };
  }, [active, read, key, target?.subject, target?.slaveId, target?.day, source, owner, following]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = result.key === key ? result : { model: null, error: '' };
  return { model: current.model, loading: !!key && !current.model && !current.error, error: current.error };
}
