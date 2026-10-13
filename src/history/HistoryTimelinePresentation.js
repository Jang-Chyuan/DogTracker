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
const stayRow = node => ['stop', 'indoor'].includes(node?.type) || !!node?.departureStay || !!node?.terminalStay;
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
  if (node.terminalStay) grown.terminalStay = { ...node.terminalStay, start,
    durationMs: node.terminalStay.durationMs + extra, ...withUnlocated(node.terminalStay, unlocated) };
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
  const row = presentedOf(nodes).map(n => n.terminalStay ?? n.departureStay ?? n).find(n => sameStay(n, stay));
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
export function timelinePresentation(source = []) {
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
  const stationaryRun = node => node?.presentationOnly === 'phone-stationary';
  const startsWithStay = first?.type === 'departure' && initialStay?.type === 'stop'
    && (initialStay.number === 1 || stationaryRun(initialStay)) && first.start === initialStay.start
    && !initialStay.gaps?.length && !initialStay.displayRange?.gaps?.length
    && (samePlace(first, initialStay) || firstBelongsToStay || stationaryRun(initialStay));
  const input = startsWithStay
    ? [{ ...first, latitude: initialStay.latitude, longitude: initialStay.longitude,
      end: initialStay.end, durationMs: initialStay.durationMs, departureStay: initialStay }, ...nodes.slice(2)]
    : nodes;
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
  // Raw holes (time no row has) of less than a gap beside a walk: the walk's.
  for (let i = 1; i < shown.length; i++) {
    const a = shown[i - 1], b = shown[i];
    const hole = b.start - a.end;
    if (!(hole > 0 && hole < GAP_MS)) continue;
    if (walking(a)) shown[i - 1] = stretch(a, a.start, b.start, 0);
    else if (walking(b)) shown[i] = stretch(b, a.end, b.end, 0);
  }
  // A terminal stay and its endpoint are one visual place. Inspect the original
  // adjacency: a hidden weak-GPS row must still veto it. The phone's endpoint
  // takes the stay's own coordinate; a dog's is its last recorded fix, which
  // the confirmed visit itself recorded (membership and exact time prove it,
  // as for the departure), while the visit's coordinate is a mean.
  const end = nodes[nodes.length - 1], stay = nodes[nodes.length - 2];
  const endBelongsToStay = typeof stay?.id === 'string' && stay.id.startsWith('visit:')
    && stay.points?.some(point => point.time === end?.start && samePlace(point, end));
  const shownStay = shown[shown.length - 2];
  if (end?.type === 'end' && stay?.type === 'stop' && shownStay?.type === 'stop'
    && stay.end === end.start
    && !stay.gaps?.length && !stay.displayRange?.gaps?.length
    && (samePlace(stay, end) || endBelongsToStay || stationaryRun(stay))) {
    // The shown stay: it may carry a folded break before it.
    shown.splice(shown.length - 2, 2, { ...end, start: shownStay.start,
      durationMs: shownStay.durationMs, terminalStay: shownStay, number: null,
      ...withUnlocated(shownStay, 0) });
  }
  const indoor = indoorAtDeparture(nodes);
  // The first 室內 row is that hold (only 0 m rows come before it), even when
  // a folded short break gave it a new object.
  const from = indoor ? shown.findIndex(n => n.type === 'indoor') : -1;
  return (from > 0 ? shown.slice(from) : shown).map(node => {
    const duration = node.durationMs ?? node.end - node.start;
    const displayDurationMs = alignedDuration(node);
    if (displayDurationMs == null || displayDurationMs === Math.round(Math.max(0, duration) / MINUTE) * MINUTE) return node;
    return { ...node, displayDurationMs,
      ...(node.terminalStay ? { terminalStay: { ...node.terminalStay, displayDurationMs } } : {}),
      ...(node.departureStay ? { departureStay: { ...node.departureStay, displayDurationMs } } : {}) };
  });
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
