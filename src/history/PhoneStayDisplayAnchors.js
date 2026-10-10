import { coordinateValid, distanceMeters, samePlaceGap } from './HistoryConfig';

const raw = p => ({ latitude: p.raw_latitude, longitude: p.raw_longitude });
const lower = (list, time, value, inclusive = false) => {
  let lo = 0, hi = list.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (value(list[mid]) < time || (inclusive && value(list[mid]) === time)) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};
const prefix = (list, bad) => {
  const sums = [0];
  for (const item of list) sums.push(sums[sums.length - 1] + Number(!!bad(item)));
  return sums;
};

/** Only an already confirmed phone stay supplies a display coordinate. Do not
 * infer a stay from proximity, nor change the observation used by the cursor.
 */
export function phoneDisplayLocations(model) {
  return model.displayStays?.length ? [...(model.locations || []), ...model.displayStays] : model.locations || [];
}
export function phoneStayAtTime(locations, time) {
  if (!Number.isFinite(time)) return null;
  return (locations || []).find(n => n.type === 'stop'
    && time >= (n.displayRange?.start ?? n.start) && time <= (n.displayRange?.end ?? n.end) && coordinateValid(n)
    && ![...(n.gaps || []), ...(n.displayRange?.gaps || [])].some(gap => time > gap.start && time < gap.end)) || null;
}
export function phoneStayDisplayCoordinate(locations, time) {
  const stay = phoneStayAtTime(locations, time);
  return stay ? { latitude: stay.latitude, longitude: stay.longitude } : null;
}

/** Display identity only: never merge visits or alter their fixes/distance/gaps.
 * Whole-day context must precede range clipping. The first completed visit's
 * existing representative stays the fixed region; a chain cannot enlarge it.
 */
export function phoneStayDisplayAnchors(visits, points, edges, config) {
  const anchors = new Map();
  if (!config.stillMps || visits.length < 2) return anchors;
  const pointBad = prefix(points, p => p.phoneConfirmedMovement);
  const edgeBad = prefix(edges, e => e.countedDistanceM > 0 || e.mode === 'driving');
  const candidates = visits.map(visit => {
    const first = visit.points.find(p => p.phoneStationary);
    const fixes = first ? visit.points.filter(p => p.time >= first.time && p.time <= first.time + 60000
      && p.phoneStationary && Number.isFinite(p.accuracy) && p.accuracy >= 0
      && p.accuracy <= config.stayAccuracyM && coordinateValid(raw(p))) : [];
    return { visit, first, fixes };
  }).filter(group => group.fixes.length >= 3);
  // Brief unconfirmed recovery visits cannot supply an anchor. Their points
  // and edges remain in the interval veto; skipping them cannot hide travel.
  for (let i = 1; i < candidates.length; i += 1) {
    const a = candidates[i - 1], b = candidates[i];
    const prior = a.visit, next = b.visit;
    if (!prior.completed || prior.continuesPreviousDay || prior.continuesNextDay) continue;
    const index = lower(points, prior.end, p => p.time);
    const last = points[index];
    if (last?.time !== prior.end || !samePlaceGap(last, b.first, config)) continue;
    // Both visits and all intervening observations must lack actual departure
    // evidence, including a short measured walk with zero net displacement.
    const ps = lower(points, prior.start, p => p.time);
    const pe = lower(points, next.end, p => p.time, true);
    const es = lower(edges, prior.start, e => e.end, true);
    const ee = lower(edges, next.end, e => e.start);
    if (pointBad[pe] !== pointBad[ps] || edgeBad[ee] !== edgeBad[es]) continue;
    const anchor = anchors.get(prior.id) || { latitude: prior.latitude, longitude: prior.longitude };
    if (!coordinateValid(anchor) || [...a.fixes, ...b.fixes].some(p => distanceMeters(anchor, raw(p)) > config.radiusM)) continue;
    anchors.set(prior.id, anchor);
    anchors.set(next.id, anchor);
  }
  return anchors;
}
