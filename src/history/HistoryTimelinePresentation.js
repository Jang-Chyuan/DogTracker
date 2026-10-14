import { configFor } from './HistoryConfig';

const MINUTE = 60000;
// The same gap threshold for a dog and the phone (HistoryConfig common).
const GAP_MS = configFor('phone').gapMs;
// 2026-10-13: a same-session break shorter than this is folded (HistoryConfig).
const LIST_GAP_MS = configFor('phone').listGapMs;
const last = list => list[list.length - 1];
const walking = node => node?.type === 'movement' && node.mode === 'walking';
const moving = node => node?.type === 'movement';
// A row that is a stay: a stop, a hold, or a departure / end carrying one.
const stayRow = node => ['stop', 'indoor'].includes(node?.type) || !!node?.departureStay;
// The phone's 「沒有資料」 / 「GPS 訊號弱」 inside one recording session. A
// recording-session change (`sessionChange`, PR #135) is always its own row.
const foldable = node => node.type === 'gap' && (node.reason == null || node.reason === 'uncertain')
  && node.sameSession === true && node.sessionChange !== true && node.end - node.start < LIST_GAP_MS;
// 2026-10-13: an interruption inside a stay (its `gaps`) between two fixes of
// one recording session, shorter than listGapMs, is counted in the stay's
// minutes with no 「不含中斷」 note; longer ones, or across a session change,
// stay deducted and noted. The timeline marks `sameSession` (phone only).
const foldableInside = gap => gap.sameSession === true && gap.sessionChange !== true
  && gap.end - gap.start < LIST_GAP_MS;
function foldInterior(node) {
  if (node.type !== 'stop' || !node.gaps?.length) return node;
  const folded = node.gaps.filter(g => foldableInside(g) && g.start >= node.start && g.end <= node.end);
  if (!folded.length) return node;
  const ms = folded.reduce((sum, g) => sum + g.end - g.start, 0);
  return { ...node, gaps: node.gaps.filter(g => !folded.includes(g)),
    durationMs: (node.durationMs ?? node.end - node.start) + ms,
    interruptionMs: Math.max(0, (node.interruptionMs || 0) - ms), ...withUnlocated(node, ms) };
}
const unfolded = node => {
  const row = { ...node };
  delete row.folded;
  return row;
};
const withUnlocated = (node, ms) => {
  const total = (node.unlocatedMs || 0) + ms;
  return total > 0 ? { unlocatedMs: total } : {};
};
// Time between two rows that no row in `between` (folded breaks) has.
const unlistedBetween = (between, a, b) => b.start - a.end
  - between.reduce((sum, n) => sum + n.end - n.start, 0);
/** A row stretched over the time beside it; a departure / end keeps its stay in step. */
function stretch(node, start, end, unlocated) {
  const extra = (node.start - start) + (end - node.end);
  const grown = { ...node, start, end, durationMs: (node.durationMs ?? node.end - node.start) + extra,
    ...withUnlocated(node, unlocated) };
  if (node.departureStay) grown.departureStay = { ...node.departureStay, end,
    durationMs: node.departureStay.durationMs + extra, ...withUnlocated(node.departureStay, unlocated) };
  return grown;
}
const alignedDuration = node => {
  const duration = node.durationMs ?? node.end - node.start;
  // Displayed clocks have minute precision; never turn a gap into observed time.
  const complete = Number.isFinite(node.start) && Number.isFinite(node.end)
    && Number.isFinite(duration) && Math.abs(duration - (node.end - node.start)) < 1
    && !node.gaps?.length && !node.displayRange?.gaps?.length && !(node.interruptionMs > 0);
  return complete ? Math.max(0, Math.floor(node.end / MINUTE) - Math.floor(node.start / MINUTE)) * MINUTE : null;
};

/** Shared display copy only: visible pills, marker speech and cursor labels. */
export const presentationDurationMs = node => node.displayDurationMs ?? alignedDuration(node)
  ?? node.durationMs ?? node.end - node.start;

// The list of a node array, once (cursor and map speech read it per move).
const presented = new WeakMap();
const presentedOf = nodes => {
  if (!presented.has(nodes)) presented.set(nodes, timelinePresentation(nodes));
  return presented.get(nodes);
};
const sameStay = (n, stay) => n === stay || (n.type === stay.type && (n.number ?? null) === (stay.number ?? null)
  && (n.id ?? null) === (stay.id ?? null) && n.start <= stay.start && n.end >= stay.end);
/**
 * A source stay's minutes as the list shows them: a short same-session break
 * beside or inside it counts (2026-10-13), so the cursor and the map's
 * TalkBack say what the row says. Without the list (or no matching row) its
 * own minutes.
 */
export function shownStayDurationMs(nodes, stay) {
  if (!Array.isArray(nodes) || !stay) return presentationDurationMs(stay);
  const row = presentedOf(nodes).map(n => n.departureStay ?? n).find(n => sameStay(n, stay));
  return presentationDurationMs(row ?? stay);
}

/**
 * The listed row a moment belongs to (a row with a length; a boundary goes to
 * the later row, the last moment to the last row), or null. A folded break
 * belongs to the row that took it, so the cursor says that row, not 「這段沒資料」.
 */
export function shownRowAt(nodes, time) {
  if (!Array.isArray(nodes)) return null;
  const rows = presentedOf(nodes).filter(n => n.end > n.start);
  return rows.find(n => n.start <= time && time < n.end)
    ?? (rows.length && time === rows[rows.length - 1].end ? rows[rows.length - 1] : null);
}

// Presentation only: retained gaps/stops and the source model remain untouched.
export function timelinePresentation(all = []) {
  return presentationOf(all).listed;
}

/**
 * The source stay the list shows inside 出發 (a range that begins moving: the
 * seconds of the stay it set off from), as the input's own object, or null.
 * historyTimeline numbers the stays without it (2026-10-13, #154: the numbers
 * shown start at 1 and skip none). 2026-10-14: no stay goes into the end any
 * more (`end` is always null): the last stay is a numbered row of its own.
 */
export function endpointStays(all = []) {
  const { departureSource } = presentationOf(all);
  return { departure: departureSource, end: null };
}

function presentationOf(all) {
  // 2026-10-13: the rows of no data before the day's first fix and after its
  // last (`dayBoundary`, phone) are set aside: the departure and the end keep
  // their places in the rules below, and they join the list at the end.
  const lead = all[0]?.dayBoundary === 'start' ? all[0] : null;
  const tail = all.length > 1 && all[all.length - 1]?.dayBoundary === 'end' ? all[all.length - 1] : null;
  const source = lead || tail ? all.slice(lead ? 1 : 0, tail ? -1 : all.length) : all;
  // A short same-session interruption inside a stay is the stay's time too.
  const nodes = source.some(n => n.type === 'stop' && n.gaps?.some(foldableInside)) ? source.map(foldInterior) : source;
  const first = nodes[0], initialStay = nodes[1];
  const samePlace = (a, b) => Number.isFinite(a?.latitude) && Number.isFinite(a?.longitude)
    && a.latitude === b?.latitude && a.longitude === b?.longitude;
  // A clipped departure can be a recorded point of the same confirmed visit,
  // while that visit's representative coordinate is the mean of many points.
  // Membership, visit identity and exact timestamp prove this; an address or
  // nearby-coordinate threshold cannot prove that two locations are one visit.
  const firstBelongsToStay = typeof initialStay?.id === 'string' && initialStay.id.startsWith('visit:')
    && initialStay.points?.some(point => point.time === first?.start && samePlace(point, first));
  // A phone stationary run (PR 116, presentationOnly, unnumbered) is built only
  // from 0 m edges of one recording session (stationary edges, same-place
  // breaks kept in `unobserved`, and the 0 m re-acquisition after a break):
  // its first edge starts at the departure fix, its last ends at the endpoint
  // fix, so time alone proves the endpoint is that run.
  // A still-here stay (2026-10-13) is the range itself: it starts at the
  // departure fix and ends at the endpoint fix by construction.
  const stationaryRun = node => node?.presentationOnly === 'phone-stationary'
    || node?.presentationOnly === 'still-here';
  // 2026-10-13: a stationary run that begins a few seconds after the
  // departure fix (the detector settles on its first fixes; nothing listed
  // between them) is that departure's stay too, from the departure on — not
  // 「出發」 and 「停 N 分」 at the same minute.
  const settlingRun = stationaryRun(initialStay) && initialStay.start > first?.start
    && initialStay.start - first.start < GAP_MS;
  const startsWithStay = first?.type === 'departure' && initialStay?.type === 'stop'
    // The model's first stay: numbered 1, or (#154) left unnumbered because
    // this row shows it.
    && (initialStay.number === 1 || initialStay.listedWith === 'departure' || stationaryRun(initialStay))
    && (first.start === initialStay.start || settlingRun)
    && !initialStay.gaps?.length && !initialStay.displayRange?.gaps?.length
    && (samePlace(first, initialStay) || firstBelongsToStay || stationaryRun(initialStay));
  const departureStay = startsWithStay && settlingRun ? stretch(initialStay, first.start, initialStay.end, 0) : initialStay;
  // 2026-10-14 (user): a day (or range) that begins with a stay has no 出發:
  // that stay is the first row, numbered like any other (startingStay
  // below). A range that begins moving keeps 出發, and the end of a stay
  // clipped into it is that row's time, unnumbered (「出發」 only): the
  // detected departure (`detected`: the range starts where the walk or the
  // drive set off, often at the stay's last fix), or a stay clipped to
  // seconds (a manual range from its last fix).
  const sliver = startsWithStay && (first.detected === true || noMinutes(departureStay));
  const input = sliver
    ? [{ ...first, latitude: departureStay.latitude, longitude: departureStay.longitude,
      end: departureStay.end, durationMs: departureStay.durationMs, departureStay }, ...nodes.slice(2)]
    : startsWithStay ? [departureStay, ...nodes.slice(2)] : nodes;
  // Every minute between two listed times belongs to a row (2026-10-13; this
  // replaces #115's rule that a merged walk counts only its own legs). A break
  // inside one recording session shorter than listGapMs (「沒有資料」 or
  // 「GPS 訊號弱」) is no row of its own: its minutes go, silently, to the
  // stay beside it, else the walk, else another movement (`unlocatedMs` keeps
  // how much; nothing is shown). Longer breaks and every session change stay
  // rows; the map still draws the break.
  const out = [];
  for (const node of input) {
    let at = out.length - 1;
    while (at >= 0 && out[at].folded) at--;
    const prior = out[at];
    // Consecutive walking legs with only folded breaks or short unlisted time
    // between them are one walk: its minutes are its span, its distance the
    // legs' sum; the breaks in it are counted in it.
    if (walking(node) && walking(prior) && node.start >= prior.end
      && unlistedBetween(out.slice(at + 1), prior, node) < GAP_MS) {
      const unlocated = out.slice(at + 1).reduce((sum, n) => sum + n.end - n.start, 0);
      out.splice(at + 1);
      out[at] = { ...prior, end: node.end,
        endLatitude: node.endLatitude, endLongitude: node.endLongitude,
        durationMs: node.end - prior.start,
        distanceM: prior.distanceM + node.distanceM,
        countedDistanceM: prior.countedDistanceM + node.countedDistanceM,
        ...withUnlocated(prior, unlocated + (node.unlocatedMs || 0)) };
      continue;
    }
    out.push(foldable(node) ? { ...node, folded: true } : node);
  }
  const shown = [];
  for (let i = 0; i < out.length; i++) {
    if (!out[i].folded) { shown.push(out[i]); continue; }
    let j = i;
    while (out[j + 1]?.folded) j++;
    const breaks = out.slice(i, j + 1), unlocated = breaks.reduce((sum, n) => sum + n.end - n.start, 0);
    const before = last(shown), after = out[j + 1];
    // A break already inside the row beside it (a stay's own interruption
    // listed as well) adds no time to it.
    const from = Math.min(before ? before.end : breaks[0].start, after ? after.start : Infinity);
    const to = Math.max(after ? after.start : breaks[breaks.length - 1].end, before ? before.end : -Infinity);
    let host = null;
    for (const kind of [stayRow, walking, moving]) {
      if (!host) host = kind(before) ? 'before' : kind(after) ? 'after' : null;
    }
    if (host === 'before') shown[shown.length - 1] = stretch(before, before.start, to, unlocated);
    else if (host === 'after') out[j + 1] = stretch(after, from, after.end, unlocated);
    // Nothing with a length beside it (only the departure or the end): listed.
    else for (const row of breaks) shown.push(unfolded(row));
    i = j;
  }
  closeHoles(shown);
  startingStay(shown);
  endingStay(shown);
  const indoor = indoorAtDeparture(nodes);
  // The first 室內 row is that hold (only 0 m rows come before it), even when
  // a folded short break gave it a new object.
  const from = indoor ? shown.findIndex(n => n.type === 'indoor') : -1;
  // The day-boundary rows first: a carry-over they already start at 00:00
  // (withDayBoundaries) leaves fromMidnight nothing to do; a 「沒有資料」 row
  // before the first row (a session change) keeps it from reaching back.
  // The 室內 row then starts where the range does (the summary's start): the
  // few seconds before its first held packet are its time too (2026-10-13).
  const indoorFirst = from > 0 ? [stretch(shown[from], Math.min(shown[0].start, shown[from].start),
    shown[from].end, 0), ...shown.slice(from + 1)] : shown;
  const listed = withDayBoundaries(indoorFirst, lead, tail);
  if (listed.length) listed[0] = fromMidnight(listed[0]);
  return { departureSource: sliver ? source[1] : null, listed: listed.map(node => {
    const duration = node.durationMs ?? node.end - node.start;
    const displayDurationMs = alignedDuration(node);
    if (displayDurationMs == null || displayDurationMs === Math.round(Math.max(0, duration) / MINUTE) * MINUTE) return node;
    return { ...node, displayDurationMs,
      ...(node.departureStay ? { departureStay: { ...node.departureStay, displayDurationMs } } : {}) };
  }) };
}

// A stay whose shown minutes round to none (a range clipping it to seconds).
const noMinutes = stay => Math.round(Math.max(0, presentationDurationMs(stay)) / MINUTE) === 0;

/**
 * 2026-10-14 (user decision, replaces merging the initial stay into 出發): a
 * range that begins with a stay has no 出發 row. A bare 出發 with a stay
 * starting at its very time next (the rows above already gave that stay the
 * seconds before it) goes: the stay is the first row, with its own number,
 * minutes and address. A stay of no shown minutes is no start (出發 stays).
 * 出發 is the start of a range that begins moving. Display only: the model's
 * departure node, the map's first time marker, CSV and GPX rows are kept.
 */
function startingStay(shown) {
  const [first, next] = shown;
  if (first?.type === 'departure' && pointRow(first) && !first.departureStay && first.detected !== true
    && next?.type === 'stop' && next.start === first.start && !noMinutes(next)) shown.shift();
}

/**
 * 2026-10-14 (user decision, replaces merging the last stay into the end,
 * 「結束 · 停 N 分」): a range that ends in a stay ends with that stay — a
 * numbered row of its own, its minutes and address — and no end row: the end
 * is the stay itself (the map draws no end marker there either:
 * HistoryMapModel). The end row stays only where the range ends moving (or in
 * a break), and where it says the recording was switched off (「記錄已關閉
 * 10:20」). Display only: the model's end node, CSV and GPX rows are kept.
 */
function endingStay(shown) {
  const end = shown[shown.length - 1], stay = shown[shown.length - 2];
  if (end?.type === 'end' && pointRow(end) && end.closedAt == null
    && ['stop', 'indoor'].includes(stay?.type) && stay.end === end.start) shown.pop();
}

const gapRow = node => node?.type === 'gap';
const pointRow = node => node && node.end === node.start;
/**
 * Every moment between two listed times belongs to a row (2026-10-13, #132
 * extended to every shape): time no row has — a dropped 0 m foot row, still
 * fixes no stay took, the steps into a hold before its first held packet, a
 * few fixes between two breaks — goes to the row beside it, in place:
 * - a walk (less than a gap of it), else a stay (stop, 室內, a departure or
 *   end with its stay), else another movement (a dog's 移動, a drive; less
 *   than a gap);
 * - between breaks or ends only: under a minute, the break beside it (two
 *   breaks of one kind with only that between them are one row); a minute or
 *   more is a stay of its own, unnumbered (`presentationOnly: 'between-breaks'`:
 *   the fixes were there, at one place) — the 出發 or the end beside it takes
 *   it as their stay, and a 恢復記錄 there is that stay's start.
 * Display only: the model, the map, CSV and GPX keep what was recorded.
 */
function closeHoles(shown) {
  const out = [];
  for (const node of shown) {
    const a = last(out);
    const hole = a ? node.start - a.end : 0;
    if (!(hole > 0)) { out.push(node); continue; }
    const short = hole < GAP_MS;
    const growA = () => { out[out.length - 1] = stretch(a, a.start, node.start, 0); out.push(node); };
    if (short && walking(a)) growA();
    else if (short && walking(node)) out.push(stretch(node, a.end, node.end, 0));
    else if (stayRow(a)) growA();
    else if (stayRow(node)) out.push(stretch(node, a.end, node.end, 0));
    else if (short && moving(a)) growA();
    else if (short && moving(node)) out.push(stretch(node, a.end, node.end, 0));
    else if (hole < MINUTE) {
      if (gapRow(a) && gapRow(node) && (a.reason ?? null) === (node.reason ?? null)) {
        const joined = { ...a, end: node.end, durationMs: node.end - a.start,
          endLatitude: node.endLatitude, endLongitude: node.endLongitude,
          ...(a.sessionChange || node.sessionChange ? { sessionChange: true } : {}) };
        if (!node.sameSession) delete joined.sameSession;
        out[out.length - 1] = joined;
      } else if (gapRow(a)) {
        out[out.length - 1] = { ...a, end: node.start, durationMs: node.start - a.start };
        out.push(node);
      } else if (gapRow(node)) out.push({ ...node, start: a.end, durationMs: node.end - a.end });
      else out.push(node);
    } else if (moving(a) || moving(node)) out.push(node);
    else {
      const from = pointRow(a) ? a : gapRow(a) ? { latitude: a.endLatitude, longitude: a.endLongitude } : node;
      const stay = { type: 'stop', presentationOnly: 'between-breaks', number: null,
        id: `between-breaks:${a.end}`, start: a.end, end: node.start, durationMs: hole,
        interruptionMs: 0, gaps: [], latitude: from.latitude ?? node.latitude, longitude: from.longitude ?? node.longitude };
      // A 恢復記錄 there is that stay's start; a 出發 there goes too (a
      // range that begins with a stay has no 出發: startingStay), and so does
      // the end after it (endingStay).
      if (['resume', 'departure'].includes(a.type) && pointRow(a)) out.pop();
      out.push(stay, node);
    }
  }
  shown.splice(0, shown.length, ...out);
}

/** The day-boundary rows (timelinePresentation). A same-session break at one
 * place (`samePlace`: the stay goes on over midnight, 067) is always stay time,
 * as the other day shows it (2026-10-13, user: the two days agree): the stay
 * row beside it grows over it; with none there it is the stay itself — the
 * day's first row 「接續前一天」 instead of a bare 出發, or the end row's
 * 「停 N 分」 running on to midnight. A foldable short break goes, silently,
 * to the stay row beside it. Otherwise it is a row of its own (a session
 * change always, #135). */
function withDayBoundaries(rows, lead, tail) {
  if (!lead && !tail) return rows;
  const out = [...rows];
  const carried = gap => gap.samePlace === true && gap.sameSession === true && gap.sessionChange !== true;
  const takes = gap => carried(gap) || foldable(gap);
  // The stay over midnight on this side: unnumbered, display only.
  const stayOf = (gap, side) => ({ type: 'stop', presentationOnly: 'carried-over', number: null,
    id: `carried-over:${gap.start}`, start: gap.start, end: gap.end, durationMs: gap.end - gap.start,
    interruptionMs: 0, gaps: [], latitude: gap.latitude, longitude: gap.longitude,
    ...(side === 'start' ? { continuesPreviousDay: true } : { continuesNextDay: true }) });
  if (lead) {
    const host = out[0];
    const beside = host && host.start === lead.end;
    if (takes(lead) && stayRow(host) && beside) out[0] = stretch(host, lead.start, host.end, lead.end - lead.start);
    else if (carried(lead) && beside && host.type === 'departure') out[0] = stayOf(lead, 'start');
    else out.unshift(carried(lead) ? stayOf(lead, 'start') : lead);
  }
  if (tail) {
    const host = out[out.length - 1];
    const beside = host && host.end === tail.start;
    if (takes(tail) && stayRow(host) && beside) out[out.length - 1] = stretch(host, host.start, tail.end, tail.end - tail.start);
    // The stay going on over midnight: the end is that stay (endingStay).
    else if (carried(tail) && beside && host.type === 'end' && host.closedAt == null) out[out.length - 1] = stayOf(tail, 'end');
    else out.push(carried(tail) ? stayOf(tail, 'end') : tail);
  }
  return out;
}

/**
 * 2026-10-13: a stay going on from the day before (「接續前一天」, a stop or a
 * 室內 hold) begins its row at midnight, not at the day's first packet a
 * minute or two later (「00:01 接續前一天」): the dog was already there. Its
 * minutes count from midnight too, as the row's clocks say (every minute
 * between two listed times belongs to a row). Only within a packet gap
 * (GAP_MS) of midnight: a first packet long after it (the collar was off) is
 * where the day's data begins, and the row keeps it. Presentation only: the
 * model, the map, CSV and GPX keep the first packet.
 */
function fromMidnight(node) {
  if (!['stop', 'indoor'].includes(node?.type) || !node.continuesPreviousDay) return node;
  const midnight = new Date(node.start);
  midnight.setHours(0, 0, 0, 0);
  const early = node.start - midnight.getTime();
  return early > 0 && early < GAP_MS ? stretch(node, midnight.getTime(), node.end, early) : node;
}

/**
 * 在室內就不要出發了 (2026-10-13, user decision): a day that begins indoors —
 * a 室內 hold starting within a minute of the first fix, with no counted
 * distance before it (only 0 m foot rows or short weak-GPS time) — has no
 * 出發 row: the list starts with the hold. (A hold starting at the first fix
 * already has no departure node in the model.) Display only: the model, the
 * map's first point, CSV and GPX are unchanged; the PNG list is this
 * presentation, as on screen. Every other day starts with 出發.
 */
function indoorAtDeparture(nodes) {
  const departure = nodes[0];
  if (departure?.type !== 'departure') return null;
  for (const node of nodes.slice(1)) {
    if (!(node.start - departure.start <= MINUTE)) return null;
    if (node.type === 'indoor') return node;
    const still = node.type === 'movement' && (node.mode === 'walking' || node.mode === 'moving')
      && !(node.countedDistanceM > 0);
    if (!still && !(node.type === 'gap' && node.reason === 'uncertain')) return null;
  }
  return null;
}
