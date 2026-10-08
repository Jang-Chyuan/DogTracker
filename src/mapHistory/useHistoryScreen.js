// The state of the v3 history screen (055a/055b: one dog, 2–4 dogs or my
// route; H1/H2/H2b/H3a/H7/H8): the day shown, the rows of each dog shown, the
// protagonist, the 資料來源, the range (automatic or the one the user dragged,
// remembered per day), the shared cursor and what the map draws.
// The rules are the pure modules of src/history and src/history/screen.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createHistoryHolds } from '../placement/IndoorHold';
import { endOfDay, startOfToday } from '../tracking/TodayDistance';
import { cursorHaptic } from '../history/screen/HistoryScreenCursor';
import { nearestRecord } from '../history/screen/HistoryScreenRange';
import { dateNavigation, dayBounds, dayKey } from '../history/screen/HistoryScreenDates';
import { chooseDay, downloadPanel, knownDays, offlineMessage } from '../history/screen/HistoryCalendar';
import { dogTransition, ROUTE_COLOURS } from '../history/screen/HistoryScreenDogs';
import { multiSelection } from '../history/screen/HistoryMultiSelection';
import { HISTORY_SOURCE_OPTIONS } from '../history/screen/HistoryMultiSources';
import {
  dayHasRecords, multiCursors, multiDayModel, multiMapPresentation, sharedCursorTime,
} from '../history/screen/HistoryMultiModel';
import { useHistoryCloud } from './useHistoryCloud';
import { rangeTrack } from '../history/screen/HistoryRangeBar';
import { forgetRange, rememberedRange, rememberRangeFor } from '../history/screen/RangeMemory';
import { displayName } from '../dogs/DogName';
import { colors } from '../theme/tokens';
import { haptic } from '../utils/haptics';

// 多隻狗（2–4 隻）.
export const MAX_DOGS = 4;
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
  scope = '', revision = 0 }) {
  const [result, setResult] = useState({ key: null, rows: [], version: 0, error: '', replayHolds: null });
  const now = useRef(clock);
  now.current = clock;
  // `scope`: another reader of the same day (a screen fixture) is another day's rows.
  // `revision`: read the day again from the start (a download ended).
  const key = subject && day != null ? JSON.stringify([subject, slaveId, day, source, owner, scope, revision]) : null;
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
        } else {
          // A read that works again clears an earlier failure.
          setResult(current => (current.key === key && current.error ? { ...current, error: '' } : current));
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
export const routeColorOf = (subject, slot = 0) => (subject === 'phone' ? colors.phone : ROUTE_COLOURS[slot ?? 0]);

const EMPTY_ROWS = { rows: [], version: 0, error: '', replayHolds: null, loaded: false };

/**
 * The history screen for `target` ({ subject: 'dog' | 'phone', slaveId }),
 * the dog it was opened for (看軌跡) plus up to three more added with
 * 「＋ 加入」 (H7), or my route alone. `read` / `readDays` are useMapHistory's
 * readDay / readDays (or a fixture's); `clock` the time now (a fixture's is
 * fixed); `recording` false fixes my route's end at its last fix (記錄已關閉).
 * `aliases` / `avatars`: the dogs' names and faces, by collar number.
 */
export function useHistoryScreen({ target, read, readDays, owner = null, clock = Date.now, active = true,
  recording = null, onDayChange, memoryScope = '', preset = null, cloud = null, online = true, cloudSeed = null,
  aliases = null, avatars = null }) {
  const subject = target?.subject ?? null;
  const slaveId = target?.slaveId ?? null;
  const entryId = subject === 'phone' ? 'phone' : slaveId;
  const subjectKey = id => (id === 'phone' ? 'phone' : `dog:${id}`);
  const [now, setNow] = useState(clock);
  useEffect(() => {
    setNow(clock());
    if (!active) return undefined;
    const timer = setInterval(() => setNow(clock()), CLOCK_MS);
    return () => clearInterval(timer);
  }, [active, clock]);
  const todayStart = startOfToday(now);
  // 進入時的預設: today, the range of the day, the cursor on the newest fix,
  // the entry dog alone, 資料來源 全部. Each opening (and each fixture)
  // starts there again (flow.txt「再次進入」, 判定表「再次進入歷史的資料來源」).
  const baseKey = target ? `${subjectKey(entryId)}|${memoryScope}` : null;
  // Each opening is a new session (再次進入: today, the entry dog alone, 全部),
  // also the same dog opened again or a fixture with another preset.
  const presetJson = preset ? JSON.stringify(preset) : '';
  const opening = useRef({ base: null, preset: '', count: 0 });
  if (baseKey && (opening.current.base !== baseKey || opening.current.preset !== presetJson)) {
    opening.current = { base: baseKey, preset: presetJson, count: opening.current.count + 1 };
  } else if (!baseKey) opening.current = { ...opening.current, base: null };
  const sessionKey = baseKey ? `${baseKey}|${opening.current.count}` : null;
  const [dayState, setDayState] = useState({ key: null, day: null });
  // Today is taken once per opening: over midnight the screen keeps its day
  // (判定表「開著時過了午夜」), 「今天」 turning into the date.
  if (sessionKey && dayState.key !== sessionKey) setDayState({ key: sessionKey, day: startOfToday(clock()) });
  const day = dayState.key === sessionKey && dayState.day != null ? dayState.day : startOfToday(clock());
  const setDay = useCallback(value => setDayState({ key: sessionKey, day: value }), [sessionKey]);
  const dayEnd = endOfDay(day);
  const today = day === todayStart;
  // ---- who is shown (H7) --------------------------------------------------
  // { key, dogs: [{ id, slot, colour, hasData }], protagonist, source }:
  // the dogs in the order added, each keeping its colour slot (判定表「多隻狗
  // 的路線色」); a screen fixture can open with more (preset.dogs), another
  // protagonist (preset.protagonist) or another source (preset.source).
  const [selection, setSelection] = useState({ key: null });
  const fresh = () => {
    if (subject === 'phone') {
      return { key: sessionKey, subject, protagonist: 'phone', message: null, source: 'all',
        dogs: [{ id: 'phone', slot: 0, colour: colors.phone, hasData: true }] };
    }
    const ids = [entryId, ...(preset?.dogs || []).filter(id => id !== entryId)].slice(0, MAX_DOGS);
    const chosen = multiSelection(ids.map(id => ({ id, hasData: true })), { subject: 'dog' });
    const lead = ids.includes(preset?.protagonist) ? preset.protagonist : chosen.protagonist;
    return { key: sessionKey, source: preset?.source ?? 'all', ...chosen, protagonist: lead, rangeOwner: lead };
  };
  if (sessionKey && selection.key !== sessionKey) setSelection(fresh());
  const current = !sessionKey ? { dogs: [], source: 'all', protagonist: null }
    : selection.key === sessionKey ? selection : fresh();
  const source = current.source ?? 'all';
  const slotOf = index => current.dogs.find(d => d.slot === index) ?? null;
  // Each colour slot reads its own dog's day (hooks cannot be in a loop of
  // varying length: four readers, one per slot).
  const [readRevision, setReadRevision] = useState(0);
  const reader = index => ({ read, subject, day, owner, clock, scope: memoryScope, revision: readRevision,
    slaveId: subject === 'dog' ? slotOf(index)?.id ?? null : null,
    active: active && !!subject && !!slotOf(index) });
  const slot0 = useHistoryDayRows(reader(0));
  const slot1 = useHistoryDayRows(reader(1));
  const slot2 = useHistoryDayRows(reader(2));
  const slot3 = useHistoryDayRows(reader(3));
  const slots = [slot0, slot1, slot2, slot3];
  const rowsOf = id => {
    const dog = current.dogs.find(d => d.id === id);
    return dog ? slots[dog.slot] ?? EMPTY_ROWS : EMPTY_ROWS;
  };
  const dogIds = current.dogs.map(d => d.id);
  const idsKey = dogIds.join(',');
  // The days with rows of any dog shown (‹ › step between them; 判定表「多隻
  // 狗的月曆」: a day of any of them has a dot), in the source chosen.
  const [days, setDays] = useState([]);
  const anyLoaded = slots.some(slot => slot.version > 0);
  useEffect(() => {
    if (!active || !readDays || !subject) return undefined;
    let alive = true;
    const asks = subject === 'phone' ? [readDays({ subject, slaveId: null, source: 'all', owner })]
      : idsKey.split(',').map(id => readDays({ subject, slaveId: Number(id), source, owner }));
    Promise.all(asks.map(ask => Promise.resolve(ask).catch(() => [])))
      .then(lists => { if (alive) setDays([...new Set(lists.flatMap(list => (Array.isArray(list) ? list : [])))].sort()); })
      .catch(() => { if (alive) setDays([]); });
    return () => { alive = false; };
    // Asked again when the day's first rows arrive (today may just have begun)
    // and after a download.
  }, [active, readDays, subject, idsKey, source, owner, anyLoaded, readRevision]);
  const todayKey = dayKey(new Date(todayStart));
  const shownKey = dayKey(new Date(day));
  // ---- the day's model ----------------------------------------------------
  const loadedDogs = current.dogs.filter(d => rowsOf(d.id).loaded);
  const subjects = loadedDogs.map(d => ({ id: d.id, subject: subject === 'phone' ? 'phone' : 'dog',
    rows: rowsOf(d.id).rows, replayHolds: subject === 'dog' ? rowsOf(d.id).replayHolds : undefined }));
  const versions = loadedDogs.map(d => `${d.id}:${rowsOf(d.id).version}`).join('|');
  const hasRowsShown = subjects.some(s => dayHasRecords(s.rows, { source, dayStart: day, dayEnd }));
  const localDays = useMemo(() => [...new Set([...days, ...(hasRowsShown ? [shownKey] : [])])].sort(),
    [days, hasRowsShown, shownKey]);
  // The cloud's days of the dogs shown (054b): the calendar's dots, ‹ › and
  // downloads (a day only the cloud holds is downloaded for all of them).
  // Not asked for 這支手機收到的.
  const cloudDogs = subject === 'dog' && source !== 'local' ? dogIds : [];
  const cloudDays = useHistoryCloud({ cloud: cloudDogs.length ? cloud : null,
    slaveId: cloudDogs.length > 1 ? cloudDogs : cloudDogs[0] ?? null,
    scope: `${baseKey}|${cloudDogs.join(',')}|${cloud?.owner ?? ''}`, todayKey, local: localDays, active,
    seed: cloudSeed });
  const { knowledge } = cloudDays;
  const navigation = useMemo(() => dateNavigation(shownKey, todayKey, knownDays(knowledge)),
    [shownKey, todayKey, knowledge]);
  // ---- the range ----------------------------------------------------------
  // Remembered for the dog the screen was opened for while it is shown
  // (判定表「從卡片『看軌跡』進來…手動範圍仍存給入口的小黑」), else for the
  // protagonist. A screen fixture keeps its ranges apart from the real ones
  // (memoryScope), and can start with one already dragged (preset.manual, H2b).
  const memoryKeyOf = id => `${memoryScope}${subjectKey(id)}:${dayKey(new Date(day))}`;
  const entryShown = dogIds.includes(entryId);
  // Not the protagonist of the moment: switching it never changes the range
  // (加入、移除、換主角都不改範圍); the dog that gave the range does.
  const rangeDog = current.rangeOwner ?? current.protagonist;
  const writeKey = memoryKeyOf(entryShown ? entryId : rangeDog);
  const presetKey = preset?.manual ? `${writeKey}:${JSON.stringify(preset.manual)}` : '';
  const presetDone = useRef('');
  if (presetKey && presetDone.current !== presetKey) {
    presetDone.current = presetKey;
    rememberRangeFor(memoryKeyOf(entryId), preset.manual);
  }
  const [memoryRevision, setMemoryRevision] = useState(0);
  const readKey = entryShown && rememberedRange(memoryKeyOf(entryId)) ? memoryKeyOf(entryId)
    : memoryKeyOf(rangeDog);
  // memoryRevision stands for the memory's contents.
  const remembered = useMemo(() => rememberedRange(readKey), [readKey, memoryRevision]); // eslint-disable-line react-hooks/exhaustive-deps
  // While a handle is dragged: the range being made (list and summary follow).
  const [draft, setDraft] = useState(null);
  const manual = draft || remembered;
  // My route stops growing when recording is off (記錄已關閉).
  const growing = subject !== 'phone' || recording !== false;
  const following = today && growing && (!manual || manual.following);
  const lastRow = Math.max(0, ...subjects.map(s => s.rows[s.rows.length - 1]?.time ?? 0));
  const modelNow = Math.max(now, lastRow);
  // The first view waits for every dog shown (the map frames the
  // protagonist once); a dog added later is left out while it is read.
  const allLoaded = current.dogs.length > 0 && current.dogs.every(d => rowsOf(d.id).loaded);
  const shownOnce = useRef(null);
  if (allLoaded && sessionKey) shownOnce.current = `${sessionKey}|${day}|${source}`;
  const waiting = shownOnce.current !== `${sessionKey}|${day}|${source}` && !allLoaded;
  const dayModel = useMemo(() => {
    if (!subject || !subjects.length || waiting) return null;
    const main = subjects.find(s => s.id === current.protagonist) ? current.protagonist : subjects[0].id;
    return multiDayModel(subjects, { dayStart: day, dayEnd, today, now: modelNow, source, manual, following,
      protagonist: main, rangeOwner: current.rangeOwner ?? main, kept: current.kept ?? null });
    // versions stands for the rows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject, versions, day, dayEnd, today, modelNow, source, manual, following, current.protagonist,
    current.rangeOwner, current.kept, waiting]);
  const model = dayModel?.main ?? null;
  const protagonistId = dayModel?.protagonist ?? current.protagonist;
  // Who has a fix in the range (40% chips, 地圖不畫牠); a dog still being
  // read keeps what it had.
  const dataKey = dayModel ? current.dogs.map(d => {
    const entry = dayModel.subjects.find(s => s.id === d.id);
    return `${d.id}:${entry ? entry.hasData : d.hasData}`;
  }).join(',') : '';
  useEffect(() => {
    if (!dataKey || subject !== 'dog') return;
    const data = Object.fromEntries(dataKey.split(',').map(pair => pair.split(':')).map(([id, value]) => [id, value === 'true']));
    setSelection(state => {
      if (state.key !== sessionKey) return state;
      if (state.dogs.every(d => d.hasData === data[d.id])) return state;
      const next = dogTransition(state, { type: 'data', data });
      // The protagonist the model chose (判定表「主角」) stays the one wanted.
      return { ...next, protagonist: protagonistId, message: state.message };
    });
  }, [dataKey, sessionKey, subject, protagonistId]);
  // 判定表「補傳資料改變停住判斷之後」: a remembered range is kept by its
  // times (the fixes inside it); once nothing a minute long is left in it,
  // the day goes back to its automatic range.
  const shownPoints = dayModel?.subjects.flatMap(s => s.model?.points ?? []) ?? [];
  const emptied = !draft && !!remembered && !!dayModel && dayModel.dayPoints.length > 1
    && (shownPoints.length < 2 || Math.max(...shownPoints.map(p => p.time)) - Math.min(...shownPoints.map(p => p.time)) < 60000)
    && dayModel.dayPoints[dayModel.dayPoints.length - 1].time - dayModel.dayPoints[0].time >= 60000;
  useEffect(() => {
    if (!emptied) return;
    forgetRange(readKey);
    setMemoryRevision(revision => revision + 1);
  }, [emptied, readKey]);
  const track = rangeTrack({ dayStart: day, dayEnd, today, now });
  const range = dayModel?.range ?? null;
  // ---- the cursor ---------------------------------------------------------
  // null: on the protagonist's newest fix (and it follows new fixes).
  const [cursorTime, setCursorTime] = useState(null);
  // A 沒有資料 row was tapped: the cursor waits at the fix before the break
  // (判定表「游標在沒資料的時段」: grey dashed ring, 「這段沒資料（最後 10:29）」).
  const [inGap, setInGap] = useState(false);
  const [pressed, setPressed] = useState(null);
  const [focus, setFocus] = useState(null);
  const time = dayModel ? sharedCursorTime(dayModel, cursorTime) : null;
  const cursors = useMemo(() => (dayModel ? multiCursors(dayModel, time,
    { inGap, subject: subject === 'phone' ? 'phone' : 'dog' }) : {}), [dayModel, time, inGap, subject]);
  const cursor = cursors[protagonistId] ?? null;
  const moveCursor = useCallback((value, action = 'drag', node = null) => {
    const points = model?.points;
    if (!points?.length || value == null) return;
    const snapped = nearestRecord(points, value)?.time;
    if (snapped == null) return;
    const gap = node?.type === 'gap';
    haptic(cursorHaptic({ ...model, distanceEdges: model.edges }, cursor?.point?.time ?? null, snapped,
      gap ? 'route' : action));
    const last = points[points.length - 1].time;
    setCursorTime(snapped === last && !gap ? null : snapped);
    setInGap(gap);
    setPressed(node && !gap ? node.start : null);
    // A node or a stop number moves the map there (220 ms); a tap on the
    // route or a movement row only when the cursor would be out of sight.
    if (action !== 'drag') setFocus({ key: Date.now(), time: snapped, action });
  }, [model, cursor]);
  // ---- the day ------------------------------------------------------------
  const changeDay = useCallback(next => {
    if (next == null) return;
    const start = typeof next === 'string' ? dayBounds(next).dayStart : next;
    setDay(start);
    // 換日期時的順序: the protagonist of the new day gives its range.
    setSelection(state => ({ ...state, rangeOwner: state.protagonist, kept: null }));
    setDraft(null);
    setCursorTime(null);
    setInGap(false);
    setPressed(null);
    haptic('tick');
    onDayChange?.(start);
  }, [onDayChange, setDay]);
  const { startDownload, cancelDownload, downloadingDay } = cloudDays;
  const reread = useCallback(() => setReadRevision(value => value + 1), []);
  /** 取消 (and 返回鍵) while downloading: what arrived is shown, marked incomplete. */
  const cancel = useCallback(() => {
    if (!cancelDownload()) return false;
    reread();
    return true;
  }, [cancelDownload, reread]);
  /**
   * Go to `next` (「YYYY-MM-DD」) from the calendar or ‹ ›: { type: 'none' }
   * for a day that cannot be chosen, 'offline' (with H3d's words) when a day
   * only the cloud holds needs the network — the day does not change — else
   * the day changes ('show') and a cloud day starts downloading ('download').
   * A running download stops first (下載中點 ‹ ›、換別天＝取消).
   */
  const goTo = useCallback(next => {
    if (next == null) return { type: 'none' };
    const choice = chooseDay(next, { today: todayKey, knowledge, online });
    if (choice.type === 'none' || choice.type === 'offline') return choice;
    if (downloadingDay === next) return { type: 'show', day: next };
    cancel();
    if (next !== shownKey) changeDay(next);
    if (choice.type === 'download') startDownload(next, reread);
    return choice;
  }, [todayKey, knowledge, online, downloadingDay, cancel, shownKey, changeDay, startDownload, reread]);
  const previousDay = useCallback(() => goTo(navigation.previous), [goTo, navigation.previous]);
  const nextDay = useCallback(() => goTo(navigation.next), [goTo, navigation.next]);
  /** 重試 after a cancelled or failed download of the day shown. */
  const retryDownload = useCallback(() => {
    if (!online) return { type: 'offline', day: shownKey, message: offlineMessage(shownKey) };
    startDownload(shownKey, reread);
    return { type: 'download', day: shownKey };
  }, [online, shownKey, startDownload, reread]);
  const dayRecords = !!dayModel?.subjects.some(s => s.dayRecords);
  const download = downloadPanel(cloudDays.download, { day: shownKey, hasRows: dayRecords,
    incomplete: knowledge.incomplete.includes(shownKey) });
  // A screen fixture can open on another day (preset.goTo: H3c starts its
  // download), once per opening.
  const goToNow = useRef(goTo);
  goToNow.current = goTo;
  useEffect(() => {
    if (preset?.goTo && sessionKey) goToNow.current(preset.goTo);
  }, [preset?.goTo, sessionKey]);
  // ---- dragging the range -------------------------------------------------
  const dragRange = useCallback(value => setDraft(value), []);
  const commitRange = useCallback(value => {
    setDraft(null);
    if (!value) return;
    rememberRangeFor(writeKey, value);
    if (readKey !== writeKey) forgetRange(readKey);
    setMemoryRevision(revision => revision + 1);
  }, [writeKey, readKey]);
  // A new opening forgets the cursor and a half-dragged range (再次進入); a
  // screen fixture can open with the cursor earlier (preset.cursorAgo).
  const presetCursor = preset?.cursorAgo ?? null;
  useEffect(() => {
    setCursorTime(presetCursor != null ? clock() - presetCursor : null);
    setInGap(false);
    setPressed(null);
    setDraft(null);
    // Once per opening.
  }, [sessionKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // ---- several dogs (H7) and the source -----------------------------------
  const lookOf = useCallback(id => {
    const dog = current.dogs.find(d => d.id === id);
    return { color: dog?.colour ?? routeColorOf(subject), avatar: avatars?.[id] ?? null,
      name: id === 'phone' ? '我的路線' : displayName(id, aliases) };
  }, [current.dogs, subject, avatars, aliases]);
  const look = useMemo(() => Object.fromEntries(current.dogs.map(d => [d.id, lookOf(d.id)])), [current.dogs, lookOf]);
  const color = look[protagonistId]?.color ?? routeColorOf(subject);
  const map = useMemo(() => (dayModel ? multiMapPresentation(dayModel, cursors, look) : null),
    [dayModel, cursors, look]);
  const anyData = !!dayModel?.subjects.some(s => s.hasData);
  /** The chips (上方膠囊): every dog shown, the protagonist outlined. */
  const dogs = current.dogs.map(d => {
    const entry = dayModel?.subjects.find(s => s.id === d.id);
    const hasData = entry ? entry.hasData : d.hasData;
    return { id: d.id, slot: d.slot, ...look[d.id], hasData, protagonist: d.id === protagonistId,
      // 判定表「全部加入的狗都沒資料」: then a faded one can lead too.
      selectable: hasData || !anyData, removable: current.dogs.length > 1 };
  });
  const [message, setMessage] = useState(null);
  const say = useCallback(text => setMessage(text ? { text, key: Date.now() } : null), []);
  /** A chip or a face on the map: that dog leads (判定表「主角」). */
  const selectDog = useCallback(id => {
    const dog = dogs.find(d => d.id === id);
    if (!dog) return;
    haptic('tick');
    if (id === protagonistId || !dog.selectable) {
      // 點已經是主角的狗膠囊: the map moves to its cursor (if out of sight).
      if (id === protagonistId && cursor?.point) setFocus({ key: Date.now(), time: cursor.point.time, action: 'protagonist' });
      return;
    }
    setSelection(state => ({ ...state, protagonist: id }));
    // 換主角時的共用時刻: the time stays (it no longer follows the newest fix).
    if (cursorTime == null && time != null) setCursorTime(time);
    setPressed(null);
    setInGap(false);
    // 換主角時的地圖: always to the new protagonist's cursor (a chosen move).
    setFocus({ key: Date.now(), time: null, action: 'protagonist', id });
  }, [dogs, protagonistId, cursor, cursorTime, time]);
  /** ✕ on a chip (not on the last one). */
  const shownRange = dayModel?.range ?? null;
  const removeDog = useCallback(id => {
    setSelection(state => {
      if (state.dogs.length < 2) return state;
      const next = dogTransition(state, { type: 'remove', id });
      // The dog that gave the range goes: the range stays as it is (移除不改範圍).
      const gave = state.rangeOwner === id || (id === entryId && !!remembered);
      return { ...next, message: null, rangeOwner: gave ? next.protagonist : state.rangeOwner,
        kept: gave && shownRange ? shownRange : state.kept ?? null };
    });
    if (cursorTime == null && time != null) setCursorTime(time);
    haptic('tick');
  }, [shownRange, entryId, remembered, cursorTime, time]);
  /** A row of 「＋ 加入」: added with the smallest free colour; full at four. */
  const addDog = useCallback(dog => {
    if (current.dogs.length >= MAX_DOGS) { say(`最多同時 ${MAX_DOGS} 隻`); return false; }
    setSelection(state => {
      const next = dogTransition(state, { type: 'add', dog: { id: dog.id, hasData: dog.hasData !== false } });
      return { ...next, protagonist: state.protagonist, message: null };
    });
    haptic('tick');
    return true;
  }, [current.dogs.length, say]);
  /** 資料來源 (全部／這支手機收到的／雲端): the whole screen, the cursor stays. */
  const setSource = useCallback(value => {
    if (!HISTORY_SOURCE_OPTIONS.some(option => option.id === value)) return;
    cancel();
    setSelection(state => (state.source === value ? state : { ...state, source: value }));
    // 換資料來源後主角沒資料…游標不動.
    if (cursorTime == null && time != null) setCursorTime(time);
    setDraft(null);
    setPressed(null);
  }, [cancel, cursorTime, time]);
  /** Whether a dog not shown has records on the day shown in the source (加入 list). */
  const checkDay = useCallback(async id => {
    if (!readDays) return true;
    try {
      const list = await readDays({ subject: 'dog', slaveId: id, source, owner });
      return Array.isArray(list) && list.includes(shownKey);
    } catch { return true; }
  }, [readDays, source, owner, shownKey]);
  const loading = !!subject && !dayModel && !slots.some(slot => slot.error);
  return {
    // The export (H9) captures the whole day's model and the dogs' looks.
    dayModel, look,
    target, subject, entryId, day, dayEnd, today, now, todayStart, navigation, model, range, track, manual: !!manual,
    following, cursor, cursors, pressed, focus, map, color, loading,
    error: slots.find(slot => slot.error)?.error ?? '', previousDay, nextDay, changeDay, moveCursor, dragRange,
    commitRange, draft, dayPoints: dayModel?.dayPoints ?? [],
    // Several dogs (H7) and the source.
    dogs, protagonist: protagonistId, multi: current.dogs.length > 1, selectDog, removeDog, addDog, checkDay,
    message, say, source, setSource, full: current.dogs.length >= MAX_DOGS,
    // The calendar (054b).
    dayKey: shownKey, todayKey, knowledge, goTo, download, cancelDownload: cancel, retryDownload,
    cloudScope: cloudDays.cloudScope, askMonth: cloudDays.askMonth, askYear: cloudDays.askYear, retryQuery: cloudDays.retryQuery,
    stopQuery: cloudDays.stopQuery,
  };
}
