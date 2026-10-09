// The cloud side of the history's days (054b): what the calendar has found
// out about one dog's days in the cloud, and the download of a day only the
// cloud holds. The rules are src/history/screen/HistoryCalendar.js; this hook
// only asks (HistoryCloud.js, or a screen fixture's stand-in) and remembers.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { dayBounds, dayKey } from '../history/screen/HistoryScreenDates';
import { daysBetween, monthQueryRange, monthsToCheck, walkCloudDays } from '../history/screen/HistoryCalendar';

const EMPTY = { cloud: [], checked: [], earliest: null };
// Days whose download was not finished, per scope (subject, account and
// fixture), for as long as the app runs (判定表「補下載完成」: only a finished download is complete).
const INCOMPLETE = new Map();
const incompleteOf = key => {
  if (!INCOMPLETE.has(key)) INCOMPLETE.set(key, new Set());
  return INCOMPLETE.get(key);
};
const merge = (list, more) => (more.length ? [...new Set([...list, ...more])] : list);

/**
 * `cloud`: HistoryCloud's adapter (null: signed out, or my route); `slaveId`
 * the dog; `scope` changes when the subject, account or fixture changes (all
 * that was found is forgotten); `todayKey` today's 「YYYY-MM-DD」; `local` the
 * days this phone holds. Returns { knowledge, askMonth, askYear, retryQuery,
 * stopQuery, download, startDownload, cancelDownload }.
 */
export function useHistoryCloud({ cloud, slaveId, scope, todayKey, local, active = true, seed = null }) {
  const enabled = !!cloud && slaveId != null;
  // `seed`: what a screen fixture says was already found (its H3c starts on
  // a cloud day); never set for real.
  const fresh = useMemo(() => ({ scope, ...EMPTY, ...seed }), [scope, seed]);
  const [found, setFound] = useState(fresh);
  const [query, setQuery] = useState({ scope, status: 'idle' });
  const [download, setDownload] = useState(null);
  const known = useMemo(() => (found.scope === scope ? found : fresh), [found, scope, fresh]);
  const status = query.scope === scope ? query.status : 'idle';
  const asking = useRef(null);
  const lastAsk = useRef(null);
  const downloading = useRef(null);
  const downloadSeq = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  // A new subject, account or fixture forgets what was found and stops asking.
  useEffect(() => () => {
    asking.current?.abort();
    asking.current = null;
    // A late answer of the old subject's download is not this one's.
    downloadSeq.current += 1;
    downloading.current?.abort();
    downloading.current = null;
    lastAsk.current = null;
    setDownload(null);
  }, [scope]);
  // Paused (the app in the background, another screen): the question stops;
  // back in front, the last one is asked again (the calendar may be open).
  const again = useRef(null);
  useEffect(() => {
    if (active) {
      if (!asking.current && lastAsk.current) again.current?.();
      return;
    }
    if (!asking.current) return;
    asking.current.abort();
    asking.current = null;
    setQuery({ scope, status: 'idle' });
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
  const add = useCallback((cloudDays, checkedDays, extra = {}) => {
    if (!alive.current) return;
    setFound(current => {
      const base = current.scope === scope ? current : fresh;
      return { ...base, ...extra, cloud: merge(base.cloud, cloudDays), checked: merge(base.checked, checkedDays) };
    });
  }, [scope, fresh]);
  // ---- the earliest day (once per subject) --------------------------------
  // Set once answered; a stopped question is simply asked again next time.
  const earliestAsked = useRef(null);
  const askEarliest = useCallback(signal => {
    if (!enabled || earliestAsked.current === scope) return Promise.resolve();
    return cloud.earliest({ slaveId, signal }).then(time => {
      if (signal.aborted) return;
      earliestAsked.current = scope;
      if (time == null) {
        // The cloud holds nothing for this dog: every day is known empty.
        add([], [], { earliest: null, none: true });
        return;
      }
      const key = dayKey(new Date(time));
      add([key], [], { earliest: key });
    });
  }, [enabled, scope, cloud, slaveId, add]);
  /** Asks one question at a time; a new one stops the one before. */
  const run = useCallback(work => {
    if (!enabled) return;
    asking.current?.abort();
    const controller = new AbortController();
    asking.current = controller;
    setQuery({ scope, status: 'querying' });
    const current = () => alive.current && asking.current === controller && !controller.signal.aborted;
    Promise.all([askEarliest(controller.signal), work(controller.signal, current)]).then(() => {
      if (current()) setQuery({ scope, status: 'idle' });
    }).catch(() => {
      if (current()) setQuery({ scope, status: 'failed' });
    }).finally(() => {
      if (asking.current === controller) asking.current = null;
    });
  }, [enabled, scope, askEarliest]);
  const checked = useMemo(() => new Set(known.checked), [known.checked]);
  /** The calendar shows `month`: find its days with rows (H3b's dots). */
  const askMonth = useCallback(month => {
    if (!enabled || known.none) return;
    const { since, until } = monthQueryRange(month, todayKey);
    lastAsk.current = { type: 'month', month };
    if (daysBetween(since, until).every(day => checked.has(day)) && earliestAsked.current === scope) {
      setQuery({ scope, status: 'idle' });
      return;
    }
    run((signal, current) => walkCloudDays({
      newestBefore: (cutoff, from) => cloud.newestBefore({ slaveId, cutoff, since: from, signal }),
      since, until, isCurrent: current,
      onStep: step => { if (current()) add(step.found ? [step.found] : [], step.checked); },
    }));
  }, [enabled, known.none, todayKey, checked, scope, run, cloud, slaveId, add]);
  /** H3e shows `year`: one question per month not known yet. */
  const askYear = useCallback(year => {
    if (!enabled || known.none) return;
    lastAsk.current = { type: 'year', year };
    const knowledge = { local, cloud: known.cloud, checked: known.checked, earliest: known.earliest, cloudEnabled: true };
    const months = monthsToCheck(year, todayKey, knowledge);
    if (!months.length && earliestAsked.current === scope) {
      setQuery({ scope, status: 'idle' });
      return;
    }
    run((signal, current) => Promise.all(months.map(async month => {
      const first = `${year}-${String(month).padStart(2, '0')}-01`;
      const since = dayBounds(first).dayStart;
      const until = Math.min(new Date(year, month, 1).getTime(), dayBounds(todayKey).dayEnd);
      const time = await cloud.newestBefore({ slaveId, cutoff: until, since, signal });
      if (!current()) return;
      if (time == null) add([], daysBetween(since, until));
      else {
        // The month's newest day holds rows; the days after it are empty.
        const day = dayKey(new Date(time));
        add([day], daysBetween(dayBounds(day).dayStart, until));
      }
    })));
  }, [enabled, known, local, todayKey, scope, run, cloud, slaveId, add]);
  const retryQuery = useCallback(() => {
    const last = lastAsk.current;
    if (last?.type === 'month') askMonth(last.month);
    else if (last?.type === 'year') askYear(last.year);
  }, [askMonth, askYear]);
  again.current = () => {
    const last = lastAsk.current;
    if (last?.type === 'month') askMonth(last.month);
    else if (last?.type === 'year') askYear(last.year);
  };
  /** The calendar closed: stop asking (what was found stays). */
  const stopQuery = useCallback(() => {
    asking.current?.abort();
    asking.current = null;
    lastAsk.current = null;
    setQuery({ scope, status: 'idle' });
  }, [scope]);
  // ---- downloading a day --------------------------------------------------
  const incompleteKey = scope;
  const [durable, setDurable] = useState({ scope: null, states: [] });
  useEffect(() => {
    if (!enabled || !cloud.downloadStates) return undefined;
    let alive = true;
    Promise.resolve(cloud.downloadStates({ slaveId })).then(states => {
      if (!alive) return;
      const pending = incompleteOf(scope);
      pending.clear();
      for (const row of states) if (!row.complete) pending.add(row.day);
      setDurable({ scope, states });
    }).catch(() => { if (alive) setDurable({ scope, states: local.map(day => ({ day, complete: 0 })) }); });
    return () => { alive = false; };
  }, [enabled, cloud, scope]); // eslint-disable-line react-hooks/exhaustive-deps

  const [incompleteRevision, setIncompleteRevision] = useState(0);
  const markIncomplete = useCallback((day, value) => {
    const days = incompleteOf(incompleteKey);
    if (value === days.has(day)) return;
    if (value) days.add(day); else days.delete(day);
    setIncompleteRevision(revision => revision + 1);
  }, [incompleteKey]);
  const startDownload = useCallback((day, onEnd) => {
    if (!enabled) return;
    // Incomplete until it has finished.
    markIncomplete(day, true);
    downloading.current?.abort();
    const controller = new AbortController();
    downloading.current = controller;
    const id = downloadSeq.current + 1;
    downloadSeq.current = id;
    setDownload({ day, status: 'downloading', id });
    const { dayStart, dayEnd } = dayBounds(day);
    Promise.resolve().then(() => cloud.download({ slaveId, dayStart, dayEnd, signal: controller.signal }))
      .then(() => {
        if (!alive.current || downloadSeq.current !== id) return;
        setDownload({ day, status: 'done', id });
        markIncomplete(day, false);
        // Downloaded (rows or not): the cloud was asked about this day.
        add([], [day]);
        onEnd?.('done');
      })
      .catch(() => {
        if (!alive.current || downloadSeq.current !== id) return;
        setDownload({ day, status: controller.signal.aborted ? 'cancelled' : 'failed', id });
        onEnd?.('failed');
      })
      .finally(() => { if (downloading.current === controller) downloading.current = null; });
  }, [enabled, cloud, slaveId, add, markIncomplete]);
  /** 取消, 返回鍵, ‹ › or another day while downloading. */
  const cancelDownload = useCallback(() => {
    if (!downloading.current) return false;
    const controller = downloading.current;
    downloading.current = null;
    downloadSeq.current += 1;
    controller.abort();
    setDownload(current => (current?.status === 'downloading' ? { ...current, status: 'cancelled' } : current));
    return true;
  }, []);
  const knowledge = useMemo(() => ({ local, cloud: known.cloud, checked: known.checked, earliest: known.earliest,
    cloudEnabled: enabled && !known.none, query: enabled ? status : 'idle',
    incomplete: enabled ? [...new Set([...incompleteOf(incompleteKey), ...(cloud?.downloadStates && durable.scope !== scope ? local : [])])] : [] }),
  // incompleteRevision stands for INCOMPLETE's contents.
  [local, known, enabled, status, incompleteKey, incompleteRevision, cloud, durable, scope]); // eslint-disable-line react-hooks/exhaustive-deps
  return { knowledge, cloudScope: enabled ? scope : null, askMonth, askYear, retryQuery, stopQuery, download, startDownload, cancelDownload,
    downloadingDay: download?.status === 'downloading' ? download.day : null };
}
