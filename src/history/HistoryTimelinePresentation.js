// Presentation only: retained gaps/stops and the source model remain untouched.
export function timelinePresentation(nodes = []) {
  const shown = [];
  const first = nodes[0], initialStay = nodes[1];
  const samePlace = (a, b) => Number.isFinite(a?.latitude) && Number.isFinite(a?.longitude)
    && a.latitude === b?.latitude && a.longitude === b?.longitude;
  const startsWithStay = first?.type === 'departure' && initialStay?.type === 'stop'
    && initialStay.number === 1 && first.start === initialStay.start
    && !initialStay.gaps?.length && !initialStay.displayRange?.gaps?.length
    && samePlace(first, initialStay);
  const input = startsWithStay
    ? [{ ...first, end: initialStay.end, durationMs: initialStay.durationMs, departureStay: initialStay }, ...nodes.slice(2)]
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
    // Match the minute precision of the visible clocks only for an observed,
    // uninterrupted interval. Missing time must not become walking/stay time.
    const duration = node.durationMs ?? node.end - node.start;
    const complete = Number.isFinite(node.start) && Number.isFinite(node.end)
      && Number.isFinite(duration) && Math.abs(duration - (node.end - node.start)) < 1
      && !node.gaps?.length && !node.displayRange?.gaps?.length && !(node.interruptionMs > 0);
    if (!complete) return node;
    const displayDurationMs = Math.max(0, Math.floor(node.end / 60000) - Math.floor(node.start / 60000)) * 60000;
    if (displayDurationMs === Math.round(Math.max(0, duration) / 60000) * 60000) return node;
    return { ...node, displayDurationMs,
      ...(node.terminalStay ? { terminalStay: { ...node.terminalStay, displayDurationMs } } : {}),
      ...(node.departureStay ? { departureStay: { ...node.departureStay, displayDurationMs } } : {}) };
  });
}
