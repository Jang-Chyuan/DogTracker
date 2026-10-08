import { configFor, distanceMeters, atLeast, above } from './HistoryConfig';
import { historyMovement, isVehiclePoint } from './HistoryMovement';

const nearest = (points, target, lo, hi) => points.filter(p => p.time >= lo && p.time <= hi)
  .sort((a, b) => Math.abs(a.time - target) - Math.abs(b.time - target) || a.time - b.time)[0];
/** Replays full day's filtered observations: late-confirmed vehicles therefore
 * revoke overlapping confirmations without retaining a stale lock. Later trips
 * outside the first confirmation interval do not alter departure. */
export function historyDeparture(points, { subject = 'dog', config = configFor(subject),
  today = false, now = points[points.length - 1]?.time ?? 0,
  movement = historyMovement(points, { subject, config }), manualRange = null } = {}) {
  const candidates = points.filter(p => !p.heldReason && !isVehiclePoint(p, movement.vehicles));
  const finish = (status, candidate = null, start = points[0]?.time ?? null, decisionTime = null) => {
    const automaticRange = { start, end: points[points.length - 1]?.time ?? null };
    return { status, candidateTime: candidate?.time ?? null, decisionTime,
      automaticRange, range: manualRange ? { start: manualRange.start,
        end: manualRange.end ?? automaticRange.end } : automaticRange,
      manual: !!manualRange };
  };
  for (const candidate of candidates) {
    const t = candidate.time;
    const previous = points[points.indexOf(candidate) - 1];
    const adjacentVehicle = movement.vehicles.some(v => v.end === t);
    const start = !previous || adjacentVehicle || t - previous.time > config.gapMs || previous.heldReason ? t : previous.time;
    const elapsed = today ? now - t : Infinity;
    if (elapsed < 210000) continue;
    const three = nearest(candidates, t + 180000, t + 150000, t + 210000);
    if (!three) continue;
    const distance = distanceMeters(candidate, three), speed = distance / ((three.time - t) / 1000);
    if (!above(distance, 40) || !atLeast(speed, config.departureMinSpeed) || above(speed, config.departureMaxSpeed)) continue;
    let decisionTime = t + 480000;
    // Phone-only grace when a high-speed run at minute eight is unconfirmed.
    const atEight = movement.edges.filter(e => e.start < decisionTime && e.end >= decisionTime).pop();
    const suspected = subject === 'phone' && atEight && !atEight.gap && atLeast(atEight.speed, config.vehicleSpeed);
    if (suspected) {
      const slowdown = movement.edges.find(e => e.start >= decisionTime && !atLeast(e.speed, config.vehicleSpeed));
      decisionTime = Math.min(t + 510000, slowdown?.end ?? Infinity);
      if (!today) decisionTime = Math.min(decisionTime, Math.max(t + 480000, now));
    }
    if (elapsed < decisionTime - t) return finish('confirming', candidate, start, decisionTime);
    const eight = nearest(candidates, t + 480000, t + 420000, t + 480000);
    const interrupted = movement.edges.some(e => e.gap && e.start < t + 480000 && e.end > t);
    const transported = movement.vehicles.some(v => v.start <= decisionTime && v.end > start);
    const indoor = points.some(p => p.heldReason && p.time >= t && p.time <= t + 480000);
    if (!eight || !above(distanceMeters(candidate, eight), 80) || interrupted || transported || indoor) continue;
    return finish('confirmed', candidate, start, decisionTime);
  }
  return finish(today ? 'not-departed' : 'undetermined');
}
