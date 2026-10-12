import { configFor } from './HistoryConfig';

const MINUTE = 60000;
// The same gap threshold for a dog and the phone (HistoryConfig common).
const GAP_MS = configFor('phone').gapMs;
const last = list => list[list.length - 1];
const walking = node => node?.type === 'movement' && node.mode === 'walking';
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

// Presentation only: retained gaps/stops and the source model remain untouched.
export function timelinePresentation(nodes = []) {
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
  // replaces #115's rule that a merged walk counts only its own legs). A
  // weak-GPS row shorter than a gap is not listed: its time, and any other
  // short unlisted time beside a walk, is that walk's (0 m) time. A longer
  // weak-GPS row would mislead inside a walk, so it stays its own row.
  const out = [];
  for (const node of input) {
    const short = node.type === 'gap' && node.reason === 'uncertain' && node.end - node.start < GAP_MS;
    let prior = null;
    for (let k = out.length - 1; k >= 0 && !prior; k--) if (!out[k].unlisted) prior = out[k];
    // Consecutive walking legs with only short unlisted time between them are
    // one walk: its minutes are its span, its distance the legs' sum.
    if (walking(node) && walking(prior) && node.start >= prior.end && node.start - prior.end < GAP_MS) {
      while (out[out.length - 1] !== prior) out.pop();
      out[out.length - 1] = { ...prior, end: node.end,
        endLatitude: node.endLatitude, endLongitude: node.endLongitude,
        durationMs: node.end - prior.start,
        distanceM: prior.distanceM + node.distanceM,
        countedDistanceM: prior.countedDistanceM + node.countedDistanceM };
      continue;
    }
    out.push(short ? { ...node, unlisted: true } : node);
  }
  // Short unlisted time between two rows goes to the walk beside it; without a
  // walk there, a weak-GPS row covering a clock minute is listed after all.
  const shown = [];
  for (let i = 0; i < out.length; i++) {
    const node = out[i];
    if (!node.unlisted) { shown.push(node); continue; }
    let j = i;
    while (out[j + 1]?.unlisted) j++;
    const before = last(shown), after = out[j + 1];
    const from = before ? before.end : node.start, to = after ? after.start : out[j].end;
    if (to - from < GAP_MS && walking(before) && to >= before.end) {
      shown[shown.length - 1] = { ...before, end: to, durationMs: before.durationMs + (to - before.end) };
    } else if (to - from < GAP_MS && walking(after) && from <= after.start) {
      out[j + 1] = { ...after, start: from, durationMs: after.durationMs + (after.start - from) };
    } else {
      for (const hidden of out.slice(i, j + 1)) {
        if (Math.floor(hidden.end / MINUTE) > Math.floor(hidden.start / MINUTE)) {
          const { unlisted, ...row } = hidden;
          shown.push(row);
        }
      }
    }
    i = j;
  }
  // Raw holes (time no row has) of less than a gap beside a walk: the walk's.
  for (let i = 1; i < shown.length; i++) {
    const a = shown[i - 1], b = shown[i];
    const hole = b.start - a.end;
    if (!(hole > 0 && hole < GAP_MS)) continue;
    if (walking(a)) shown[i - 1] = { ...a, end: b.start, durationMs: a.durationMs + hole };
    else if (walking(b)) shown[i] = { ...b, start: a.end, durationMs: b.durationMs + hole };
  }
  // A terminal stay and its endpoint are one visual place. Inspect the original
  // adjacency: a hidden weak-GPS row must still veto it. The phone's endpoint
  // takes the stay's own coordinate; a dog's is its last recorded fix, which
  // the confirmed visit itself recorded (membership and exact time prove it,
  // as for the departure), while the visit's coordinate is a mean.
  const end = nodes[nodes.length - 1], stay = nodes[nodes.length - 2];
  const endBelongsToStay = typeof stay?.id === 'string' && stay.id.startsWith('visit:')
    && stay.points?.some(point => point.time === end?.start && samePlace(point, end));
  if (end?.type === 'end' && stay?.type === 'stop' && shown[shown.length - 2]?.type === 'stop'
    && stay.end === end.start
    && !stay.gaps?.length && !stay.displayRange?.gaps?.length
    && (samePlace(stay, end) || endBelongsToStay || stationaryRun(stay))) {
    shown.splice(shown.length - 2, 2, { ...end, start: stay.start,
      durationMs: stay.durationMs, terminalStay: stay, number: null });
  }
  return shown.map(node => {
    const duration = node.durationMs ?? node.end - node.start;
    const displayDurationMs = alignedDuration(node);
    if (displayDurationMs == null || displayDurationMs === Math.round(Math.max(0, duration) / MINUTE) * MINUTE) return node;
    return { ...node, displayDurationMs,
      ...(node.terminalStay ? { terminalStay: { ...node.terminalStay, displayDurationMs } } : {}),
      ...(node.departureStay ? { departureStay: { ...node.departureStay, displayDurationMs } } : {}) };
  });
}
