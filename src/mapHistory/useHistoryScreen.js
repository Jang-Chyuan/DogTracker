// The state of the v3 history screen (055a, one dog or my route; H1/H2/H2b/
// H3a/H8): the day shown, that day's rows, the range (automatic or the one the
// user dragged, remembered per day), the cursor and what the map draws.
// The rules are the pure modules of src/history and src/history/screen.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { historyTimeline } from '../history/HistoryTimeline';
import { createHistoryHolds } from '../placement/IndoorHold';
import { endOfDay, startOfToday } from '../tracking/TodayDistance';
import { cursorHaptic, screenCursor } from '../history/screen/HistoryScreenCursor';
import { nearestRecord } from '../history/screen/HistoryScreenRange';
import { dateNavigation, dayBounds, dayKey } from '../history/screen/HistoryScreenDates';
import { historyMapPresentation } from '../history/screen/HistoryMapModel';
import { rangeTrack } from '../history/screen/HistoryRangeBar';
import { rememberedRange, rememberRangeFor } from '../history/screen/RangeMemory';
import { colors } from '../theme/tokens';
import { haptic } from '../utils/haptics';

// Today's rows are read again this often (as the old list did); another day
// only changes with a download.
export const HISTORY_POLL_MS = 15000;
const PAST_POLL_MS = 60000;
// The clock moves on once a minute (「現在」, the range bar's right end).
const CLOCK_MS = 60000;

/**
 * One day's rows of one dog or my route, read in pages and followed while the
 * day is today. Returns { rows, version, replayHolds, loaded, error }.
 */
export function useHistoryDayRows({ read, subject, slaveId, day, source = 'all', owner = null, active = true, clock,
  scope = '' }) {
  const [result, setResult] = useState({ key: null, rows: [], version: 0, error: '', replayHolds: null });
  const now = useRef(clock);
  now.current = clock;
  // `scope`: another reader of the same day (a screen fixture) is another day's rows.
  const key = subject && day != null ? JSON.stringify([subject, slaveId, day, source, owner, scope]) : null;
  useEffect(() => {
    if (!active || !read || !key) return undefined;
    let alive = true, timer;
    const cache = { rows: [], seed: [], after: {}, first: true };
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
    const dayEnd = endOfDay(day);
    async function poll() {
      try {
        const at = now.current();
        const today = at >= day && at < dayEnd;
        const answer = await read({ subject, slaveId, start: day, end: dayEnd, source, owner, after: cache.after });
        if (!alive) return;
        if (cache.first) cache.seed = answer.seed || [];
        cache.after = answer.after || {};
        const added = answer.rows?.length || 0;
        if (added) cache.rows = [...cache.rows, ...answer.rows].sort((a, b) => a.time - b.time);
        if (added || cache.first) {
          cache.first = false;
          setResult(current => ({ key, rows: cache.rows, version: (current.key === key ? current.version : 0) + 1,
            error: '', replayHolds }));
        }
        timer = setTimeout(poll, today ? HISTORY_POLL_MS : PAST_POLL_MS);
      } catch (error) {
        if (!alive) return;
        setResult(current => ({ ...current, key, error: error?.message || '讀取失敗' }));
        timer = setTimeout(poll, HISTORY_POLL_MS);
      }
    }
    poll();
    return () => { alive = false; clearTimeout(timer); };
    // key stands for subject, slaveId, day, source and owner.
  }, [active, read, key]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = result.key === key ? result : { rows: [], version: 0, error: '', replayHolds: null };
  return { ...current, loaded: !!key && result.key === key && result.version > 0 };
}

/**
 * Whom a history query is about (the fixtures' and an old saved query's): the
 * dog it was opened for (看軌跡), else my route (「今天 x km」).
 */
export function historyTargetOf(preferences) {
  if (!preferences) return null;
  if (preferences.client && preferences.slaves?.length) return { subject: 'dog', slaveId: preferences.slaves[0] };
  if (preferences.phone) return { subject: 'phone', slaveId: null };
  return null;
}

/** The colour of the route: my route blue, a dog its slot's (route1 when alone). */
export const routeColorOf = subject => (subject === 'phone' ? colors.phone : colors.route1);

/**
 * The history screen for `target` ({ subject: 'dog' | 'phone', slaveId }).
 * `read` / `readDays` are useMapHistory's readDay / readDays (or a fixture's);
 * `clock` the time now (a fixture's is fixed); `recording` false fixes my
 * route's end at its last fix (記錄已關閉).
 */
export function useHistoryScreen({ target, read, readDays, owner = null, clock = Date.now, active = true,
  recording = null, onDayChange, memoryScope = '', preset = null }) {
  const subject = target?.subject ?? null;
  const slaveId = target?.slaveId ?? null;
  const subjectKey = subject === 'phone' ? 'phone' : `dog:${slaveId}`;
  const [now, setNow] = useState(clock);
  useEffect(() => {
    setNow(clock());
    if (!active) return undefined;
    const timer = setInterval(() => setNow(clock()), CLOCK_MS);
    return () => clearInterval(timer);
  }, [active, clock]);
  const todayStart = startOfToday(now);
  // 進入時的預設: today, the range of the day, the cursor on the newest fix.
  // Each opening (and each fixture) starts there again (flow.txt「再次進入」).
  const sessionKey = target ? `${subjectKey}|${memoryScope}` : null;
  const [dayState, setDayState] = useState({ key: null, day: null });
  const day = dayState.key === sessionKey && dayState.day != null ? dayState.day : startOfToday(clock());
  const setDay = useCallback(value => setDayState({ key: sessionKey, day: value }), [sessionKey]);
  const dayEnd = endOfDay(day);
  const today = day === todayStart;
  const day$ = useHistoryDayRows({ read, subject, slaveId: subject === 'dog' ? slaveId : null, day, owner,
    active: active && !!subject, clock, scope: memoryScope });
  // The days with rows (‹ › step between them).
  const [days, setDays] = useState([]);
  useEffect(() => {
    if (!active || !readDays || !subject) return undefined;
    let alive = true;
    Promise.resolve(readDays({ subject, slaveId: subject === 'dog' ? slaveId : null, source: 'all', owner }))
      .then(value => { if (alive) setDays(Array.isArray(value) ? value : []); })
      .catch(() => { if (alive) setDays([]); });
    return () => { alive = false; };
    // Asked again when the day's first rows arrive (today may just have begun).
  }, [active, readDays, subject, slaveId, owner, day$.version > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  const todayKey = dayKey(new Date(todayStart));
  const navigation = useMemo(() => {
    const known = [...new Set([...days, ...(day$.rows.length ? [dayKey(new Date(day))] : [])])].sort();
    return dateNavigation(dayKey(new Date(day)), todayKey, known);
  }, [days, day, day$.rows.length, todayKey]);
  // ---- the range ----------------------------------------------------------
  // A screen fixture keeps its ranges apart from the real ones (memoryScope),
  // and can start with one already dragged (preset.manual, H2b).
  const memoryKey = `${memoryScope}${subjectKey}:${dayKey(new Date(day))}`;
  const presetKey = preset?.manual ? `${memoryKey}:${JSON.stringify(preset.manual)}` : '';
  const presetDone = useRef('');
  if (presetKey && presetDone.current !== presetKey) {
    presetDone.current = presetKey;
    rememberRangeFor(memoryKey, preset.manual);
  }
  const [memoryRevision, setMemoryRevision] = useState(0);
  const remembered = useMemo(() => rememberedRange(memoryKey), [memoryKey, memoryRevision]); // eslint-disable-line react-hooks/exhaustive-deps
  // While a handle is dragged: the range being made (list and summary follow).
  const [draft, setDraft] = useState(null);
  const manual = draft || remembered;
  // My route stops growing when recording is off (記錄已關閉).
  const growing = subject !== 'phone' || recording !== false;
  const following = today && growing && (!manual || manual.following);
  const lastRow = day$.rows[day$.rows.length - 1]?.time ?? 0;
  const modelNow = Math.max(now, lastRow);
  const model = useMemo(() => {
    if (!subject || !day$.loaded) return null;
    return historyTimeline(day$.rows, {
      subject, source: 'all', dayStart: day, dayEnd, today, now: modelNow, following,
      manualRange: manual ? { start: manual.start, end: manual.following ? null : manual.end } : null,
      replayHolds: subject === 'dog' ? day$.replayHolds : undefined,
    });
    // day$.version stands for the rows.
  }, [subject, day$.loaded, day$.version, day, dayEnd, today, modelNow, following, manual]); // eslint-disable-line react-hooks/exhaustive-deps
  const track = rangeTrack({ dayStart: day, dayEnd, today, now });
  const range = model?.points.length ? {
    start: model.points[0].time, end: model.points[model.points.length - 1].time, following,
  } : null;
  // ---- the cursor ---------------------------------------------------------
  // null: on the newest fix (and it follows new fixes).
  const [cursorTime, setCursorTime] = useState(null);
  // A 沒有資料 row was tapped: the cursor waits at the fix before the break
  // (判定表「游標在沒資料的時段」: grey dashed ring, 「這段沒資料（最後 10:29）」).
  const [inGap, setInGap] = useState(false);
  const [pressed, setPressed] = useState(null);
  const [focus, setFocus] = useState(null);
  const points = model?.points;
  const cursorModel = useMemo(() => (model ? { ...model, distanceEdges: model.edges } : null), [model]);
  const effectiveTime = useMemo(() => {
    if (!points?.length) return null;
    if (cursorTime == null) return points[points.length - 1].time;
    // 判定表「範圍縮小後游標在外面」: to the nearest end of the range.
    return nearestRecord(points, cursorTime).time;
  }, [points, cursorTime]);
  const cursor = useMemo(() => (cursorModel && effectiveTime != null
    ? screenCursor(cursorModel, effectiveTime, { subject: subject === 'phone' ? 'phone' : 'dog',
      action: inGap ? 'gap' : 'entry' })
    : null), [cursorModel, effectiveTime, subject, inGap]);
  const moveCursor = useCallback((time, action = 'drag', node = null) => {
    if (!cursorModel || time == null) return;
    const snapped = nearestRecord(cursorModel.points, time)?.time;
    if (snapped == null) return;
    const gap = node?.type === 'gap';
    haptic(cursorHaptic(cursorModel, effectiveTime, snapped, gap ? 'route' : action));
    const last = cursorModel.points[cursorModel.points.length - 1].time;
    setCursorTime(snapped === last && !gap ? null : snapped);
    setInGap(gap);
    setPressed(node && !gap ? node.start : null);
    // A node or a stop number moves the map there (220 ms).
    if (action === 'node' || action === 'stop') setFocus({ key: Date.now(), time: snapped, action });
  }, [cursorModel, effectiveTime]);
  // ---- the day ------------------------------------------------------------
  const changeDay = useCallback(next => {
    if (next == null) return;
    const start = typeof next === 'string' ? dayBounds(next).dayStart : next;
    setDay(start);
    setDraft(null);
    setCursorTime(null);
    setInGap(false);
    setPressed(null);
    haptic('tick');
    onDayChange?.(start);
  }, [onDayChange, setDay]);
  const previousDay = useCallback(() => changeDay(navigation.previous), [changeDay, navigation.previous]);
  const nextDay = useCallback(() => changeDay(navigation.next), [changeDay, navigation.next]);
  // ---- dragging the range -------------------------------------------------
  const dragRange = useCallback(value => setDraft(value), []);
  const commitRange = useCallback(value => {
    setDraft(null);
    if (!value) return;
    rememberRangeFor(memoryKey, value);
    setMemoryRevision(revision => revision + 1);
  }, [memoryKey]);
  // A new opening forgets the cursor and a half-dragged range (再次進入).
  useEffect(() => {
    setCursorTime(null);
    setInGap(false);
    setPressed(null);
    setDraft(null);
  }, [sessionKey]);
  const color = routeColorOf(subject);
  const map = useMemo(() => historyMapPresentation(model, { color, cursor }), [model, color, cursor]);
  return {
    target, subject, day, dayEnd, today, now, todayStart, navigation, model, range, track, manual: !!manual,
    following, cursor, pressed, focus, map, color, loading: !!subject && !day$.loaded && !day$.error,
    error: day$.error, previousDay, nextDay, changeDay, moveCursor, dragRange, commitRange, draft,
  };
}
