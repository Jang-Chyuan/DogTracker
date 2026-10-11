const MINUTE = 60000;
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
  const shown = [];
  const first = nodes[0], initialStay = nodes[1];
  const samePlace = (a, b) => Number.isFinite(a?.latitude) && Number.isFinite(a?.longitude)
    && a.latitude === b?.latitude && a.longitude === b?.longitude;
  // A clipped departure can be a recorded point of the same confirmed visit,
  // while that visit's representative coordinate is the mean of many points.
  // Membership, visit identity and exact timestamp prove this; an address or
  // nearby-coordinate threshold cannot prove that two locations are one visit.
  const firstBelongsToStay = typeof initialStay?.id === 'string' && initialStay.id.startsWith('visit:')
    && initialStay.points?.some(point => point.time === first?.start && samePlace(point, first));
  const startsWithStay = first?.type === 'departure' && initialStay?.type === 'stop'
    && initialStay.number === 1 && first.start === initialStay.start
    && !initialStay.gaps?.length && !initialStay.displayRange?.gaps?.length
    && (samePlace(first, initialStay) || firstBelongsToStay);
  const input = startsWithStay
    ? [{ ...first, latitude: initialStay.latitude, longitude: initialStay.longitude,
      end: initialStay.end, durationMs: initialStay.durationMs, departureStay: initialStay }, ...nodes.slice(2)]
    : nodes;
  for (const node of input) {
    if (node.type === 'gap' && node.reason === 'uncertain') { continue; }
    const prior = shown[shown.length - 1];
    if (node.type === 'movement' && node.mode === 'walking'
      && prior?.type === 'movement' && prior.mode === 'walking') {
      shown[shown.length - 1] = { ...prior, end: node.end,
        endLatitude: node.endLatitude, endLongitude: node.endLongitude,
        durationMs: prior.durationMs + node.durationMs,
        distanceM: prior.distanceM + node.distanceM,
        countedDistanceM: prior.countedDistanceM + node.countedDistanceM };
    } else shown.push(node);
  }
  // A terminal stay and its same-coordinate endpoint are one visual place.
  // Inspect the original adjacency: a hidden weak-GPS row must still veto it.
  const end = nodes[nodes.length - 1], stay = nodes[nodes.length - 2];
  if (end?.type === 'end' && stay?.type === 'stop' && shown[shown.length - 2]?.type === 'stop'
    && stay.end === end.start
    && !stay.gaps?.length && !stay.displayRange?.gaps?.length
    && Number.isFinite(stay.latitude) && Number.isFinite(stay.longitude)
    && stay.latitude === end.latitude && stay.longitude === end.longitude) {
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
