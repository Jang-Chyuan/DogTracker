// Presentation only: retained gaps/stops and the source model remain untouched.
export function timelinePresentation(nodes = []) {
  const shown = [];
  for (const node of nodes) {
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
  if (end?.type === 'end' && stay?.type === 'stop' && stay.end === end.start
    && !stay.gaps?.length && !stay.displayRange?.gaps?.length
    && Number.isFinite(stay.latitude) && Number.isFinite(stay.longitude)
    && stay.latitude === end.latitude && stay.longitude === end.longitude) {
    shown.splice(shown.length - 2, 2, { ...end, start: stay.start,
      durationMs: stay.durationMs, terminalStay: stay, number: null });
  }
  return shown;
}
