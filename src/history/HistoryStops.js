import { t } from '../i18n';
import { configFor, coordinateValid, distanceMeters, median, above, samePlaceGap, measuredSpeedMps } from './HistoryConfig';
import { isVehiclePoint } from './HistoryMovement';
import { phoneReliableSpeed } from '../locationTracker/PhoneMotion';
import { phoneStayDisplayAnchors } from './PhoneStayDisplayAnchors';

// 判定表「停留的代表位置」: the mean of the visit's judged fixes (accuracy
// within 25 m, both sides of a short interruption); the map number, the
// address and the coordinates all use it. A proven phone return may reuse a
// completed representative for display only, after visit judgement. The centre
// (first fix) still decides who is inside.
function mean(points) {
  const n = points.length;
  return { latitude: points.reduce((sum, p) => sum + p.latitude, 0) / n,
    longitude: points.reduce((sum, p) => sum + p.longitude, 0) / n };
}
const settle = (visit, completed) => ({ ...visit, ...mean(visit.points), completed });

// A coarse gap endpoint can establish continuity without voting for the
// representative position. Require the existing motion detector to confirm
// a compact stationary return; a nearby endpoint alone never proves a stay.
function phoneGapContinuity(points, visits, config, vehicles) {
  if (!config.stillMps) return visits;
  const raw = p => ({ latitude: p.raw_latitude, longitude: p.raw_longitude });
  const valid = p => Number.isFinite(p.raw_latitude) && Number.isFinite(p.raw_longitude)
    && Number.isFinite(p.accuracy) && p.accuracy >= 0 && p.accuracy <= 30;
  const bridges = [];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1], b = points[i];
    if (!a.phoneStationary || !valid(a) || !valid(b) || !samePlaceGap(a, b, config)) continue;
    for (let j = i; j < points.length && j < i + 720 && points[j].time - b.time <= config.gapMs; j += 1) {
      const p = points[j], speed = phoneReliableSpeed(p);
      if (!valid(p) || p.phoneConfirmedMovement || isVehiclePoint(p, vehicles)
        || (speed != null && speed >= config.stillMps)
        || distanceMeters(raw(b), raw(p)) > config.radiusM
        || (j > i && p.time - points[j - 1].time > config.gapMs)) break;
      if (p.phoneStationary) { bridges.push({ start: a.time, end: b.time, confirmedAt: p.time }); break; }
    }
  }
  const merged = [];
  let bridgeIndex = 0;
  for (const visit of visits) {
    const prior = merged[merged.length - 1];
    while (prior && bridgeIndex < bridges.length && (bridges[bridgeIndex].start < prior.end
      || bridges[bridgeIndex].confirmedAt < visit.start)) bridgeIndex += 1;
    const candidate = bridges[bridgeIndex];
    const bridge = prior && candidate && prior.end <= candidate.start && visit.start >= candidate.end
      && visit.start <= candidate.confirmedAt && candidate.start - prior.end <= config.gapMs;
    if (!bridge) { merged.push(visit); continue; }
    const pointsTogether = [...prior.points, ...visit.points];
    const interruptionMs = prior.interruptionMs + visit.interruptionMs;
    merged[merged.length - 1] = { ...prior, ...mean(pointsTogether), end: visit.end,
      completed: visit.completed, points: pointsTogether, gaps: [...prior.gaps, ...visit.gaps],
      inferredContinuityGaps: [...(prior.inferredContinuityGaps || []),
        { start: candidate.start, end: candidate.end }, ...(visit.inferredContinuityGaps || [])],
      interruptionMs, durationMs: visit.end - prior.start - interruptionMs };
  }
  return merged;
}

// A brief run of continuously sampled, uncertain phone fixes can split one
// long visit into several votes. Reconcile only between already long visits,
// retaining the uncertainty interval and waiting for detector confirmation.
// This does not bridge an actual recording/session gap or classify motion.
function phoneQualityContinuity(points, visits, config, vehicles) {
  if (!config.stillMps || visits.length < 2) return visits;
  const indexByTime = new Map(points.map((p, i) => [p.time, i]));
  const raw = p => ({ latitude: p.raw_latitude, longitude: p.raw_longitude });
  const valid = p => Number.isFinite(p.accuracy) && p.accuracy >= 0 && p.accuracy <= 30
    && coordinateValid(raw(p));
  const isLong = v => v.durationMs >= config.alwaysStayMs;
  const confirmedInterval = (prior, next) => {
    const first = indexByTime.get(prior.end), last = indexByTime.get(next.start);
    if (first == null || last == null || last <= first || last - first >= 720
      || next.start - prior.end > config.gapMs || !valid(points[first]) || !valid(points[last])
      || points[first].session_id == null || points[first].session_id === ''
      || !prior.points.some(p => p.phoneStationary)
      || distanceMeters(raw(points[first]), raw(points[last])) > config.radiusM) return null;
    let confirmed = null;
    const observed = [];
    for (let i = first; i < points.length && i < first + 720; i += 1) {
      const p = points[i], speed = phoneReliableSpeed(p);
      if (p.time - next.start > config.gapMs) break;
      if (!valid(p) || p.phoneMotionState == null || p.heldReason || p.phoneConfirmedMovement
        || isVehiclePoint(p, vehicles) || (speed != null && speed >= config.stillMps)
        || (i <= last && p.phoneMotionState !== 'unknown')
        // A detector's re-entry transition can still say moving despite a
        // reliable zero-speed sample. Only accept that bounded recovery;
        // absent/unreliable velocity cannot excuse a moving transition.
        || (i > last && p.phoneMotionState !== 'unknown' && !p.phoneStationary && speed !== 0)
        || p.session_id !== points[first].session_id
        || (i > first && (p.time <= points[i - 1].time || p.time - points[i - 1].time > config.enterMs))) return null;
      observed.push(p);
      if (i >= last && p.phoneStationary) { confirmed = p.time; break; }
    }
    if (confirmed == null) return null;
    const centre = { latitude: median(observed.map(p => p.raw_latitude)),
      longitude: median(observed.map(p => p.raw_longitude)) };
    // Keep the existing 25m place region: each uncertain observation's
    // finite accuracy footprint must intersect it, rather than enlarging
    // the global stay radius to fit noisy fixes.
    if (observed.some(p => distanceMeters(raw(p), centre) > config.radiusM + p.accuracy)) return null;
    return { start: prior.end, end: next.start, confirmedAt: confirmed };
  };
  const merged = [visits[0]];
  for (let i = 1; i < visits.length; i += 1) {
    const prior = merged[merged.length - 1];
    let last = i;
    if (isLong(prior)) {
      while (last < visits.length && !isLong(visits[last])
        && visits[last].start - prior.end <= config.gapMs) last += 1;
    }
    const next = visits[last];
    const interval = isLong(prior) && next && isLong(next) ? confirmedInterval(prior, next) : null;
    if (!interval) { merged.push(visits[i]); continue; }
    const parts = [prior, ...visits.slice(i, last + 1)], allPoints = parts.flatMap(v => v.points);
    const interruptionMs = parts.reduce((sum, v) => sum + v.interruptionMs, 0);
    merged[merged.length - 1] = { ...prior, ...mean(allPoints), end: next.end,
      completed: next.completed, points: allPoints, gaps: parts.flatMap(v => v.gaps), interruptionMs,
      inferredContinuityGaps: parts.flatMap(v => v.inferredContinuityGaps || []),
      inferredQualityIntervals: [...parts.flatMap(v => v.inferredQualityIntervals || []), interval],
      durationMs: next.end - prior.start - interruptionMs };
    i = last;
  }
  return merged;
}

/** One vote per visit; departure is confirmed only by consecutive outside fixes. */
export function historyVisits(points, { subject = 'dog', config = configFor(subject),
  vehicles = [], following = false } = {}) {
  const visits = [];
  // The last fix that took part in the judgement: fixes over 25 m are not
  // judged at all, so they neither bridge nor break an interruption.
  let current = null, outside = [], insideIndex = 0, judged = null;
  const finish = () => {
    if (!current) return;
    visits.push(settle(current, true)); current = null; outside = [];
  };
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    if (p.heldReason || isVehiclePoint(p, vehicles)) { finish(); judged = null; continue; }
    if (p.accuracy > config.stayAccuracyM) continue;
    if (current && judged) {
      const dt = p.time - judged.time;
      // 067: a break whose two ends are at the same place stays one visit.
      if (dt > config.gapMs && !samePlaceGap(judged, p, config)
        && (dt >= config.mergeGapMs || above(distanceMeters(judged, p), config.radiusM))) finish();
    }
    const judgedBefore = judged;
    judged = p;
    if (!current) {
      insideIndex = i;
      current = { id: `visit:${p.time}`, type: 'stop', start: p.time, end: p.time,
        center: { latitude: p.latitude, longitude: p.longitude },
        latitude: p.latitude, longitude: p.longitude, points: [p], gaps: [], durationMs: 0, interruptionMs: 0 };
      continue;
    }
    // Measured standing still (the phone's own speed under stillMps, within
    // stillPlaceM): the position drifted out of the circle, the phone stayed
    // (067) — it counts as inside.
    const still = config.stillMps && (p.phoneStationary || (measuredSpeedMps(p) != null && measuredSpeedMps(p) < config.stillMps))
      && !(distanceMeters(current.center, p) > (config.stillPlaceM || config.radiusM));
    // Back after a break at the same place as the last judged fix: still the
    // same stay, wherever the circle's centre is (Codex review, 067).
    const resumed = !!judgedBefore && samePlaceGap(judgedBefore, p, config);
    if (still || resumed || !above(distanceMeters(current.center, p), config.radiusM)) {
      const last = current.points[current.points.length - 1];
      // All signal gaps are deducted, including gaps inside an unconfirmed exit.
      const gaps = points.slice(insideIndex + 1, i + 1).filter(q => !(q.accuracy > config.stayAccuracyM));
      let previous = last, interrupted = 0;
      for (const q of gaps) {
        if (q.time - previous.time > config.gapMs && !samePlaceGap(previous, q, config)) {
          interrupted += q.time - previous.time;
          current.gaps.push({ start: previous.time, end: q.time });
        }
        previous = q;
      }
      current.durationMs += p.time - last.time - interrupted;
      current.interruptionMs += interrupted;
      current.end = p.time; current.points.push(p); outside = []; insideIndex = i;
      // The stay goes on around where it resumed (the circle follows).
      if (resumed && above(distanceMeters(current.center, p), config.radiusM)) {
        current.center = { latitude: p.latitude, longitude: p.longitude };
      }
    } else {
      outside.push({ point: p, index: i });
      if (outside.length >= 2 && p.time - outside[0].point.time > config.leaveMs) {
        const restart = outside[0].index;
        finish(); i = restart - 1;
      }
    }
  }
  if (current) visits.push(settle(current, !following));
  return phoneQualityContinuity(points, phoneGapContinuity(points, visits, config, vehicles), config, vehicles);
}
function clippedVisit(visit, start, end, dayBoundary = false) {
  const inside = visit.points.filter(p => p.time >= start && p.time <= end);
  if (!inside.length) return null;
  const interruptionMs = visit.gaps.filter(g => g.start >= inside[0].time
    && g.end <= inside[inside.length - 1].time).reduce((sum, g) => sum + g.end - g.start, 0);
  return { ...visit, ...mean(inside), start: inside[0].time, end: inside[inside.length - 1].time,
    ...(visit.inferredContinuityGaps ? { inferredContinuityGaps: visit.inferredContinuityGaps.filter(g =>
      g.start >= inside[0].time && g.end <= inside[inside.length - 1].time) } : {}),
    ...(visit.inferredQualityIntervals ? { inferredQualityIntervals: visit.inferredQualityIntervals.filter(g =>
      g.start >= inside[0].time && g.end <= inside[inside.length - 1].time) } : {}),
    points: inside, interruptionMs,
    durationMs: inside[inside.length - 1].time - inside[0].time - interruptionMs,
    completed: visit.completed || visit.end > end,
    continuesPreviousDay: !!visit.continuesPreviousDay || (dayBoundary && visit.start < start),
    continuesNextDay: !!visit.continuesNextDay || (dayBoundary && visit.end > end) };
}
/**
 * 判定表「停留的重算」: a whole recalculation replays the decisions in time
 * order, as they would have been made live — so a stay marked while the
 * baseline was low stays marked when later visits raise it (「標了就不撤銷」),
 * and opening a finished day gives what following it all day gave.
 * Each step is a visit starting or ending:
 * - 「至少 5 次」 counts visits started so far (the ongoing one too); fewer
 *   than five in the range → the whole day's visits so far are the baseline
 *   (備援基準), and fewer than five of those → nothing is marked yet.
 * - The median is over visits already ended.
 * - The first time the baseline is usable (or the range's own baseline takes
 *   over from the day's, for a range that follows now), every visit in the
 *   range is judged; afterwards each visit is judged when it ends, and the
 *   ongoing one at the end of the data.
 * - A fixed end (past day, fixed manual end, recording closed) settles the
 *   last visit; with the day baseline still in use, the whole day's ended
 *   visits judge every unmarked visit once more (判定表「固定終點的結算」).
 *   A fixed-end range keeps the day baseline once it took it.
 * `state` and `identity` are accepted for callers that keep them; the
 * replay itself is deterministic, so appending rows gives the same answer.
 */
export function historyStops(points, { start = -Infinity, end = Infinity,
  dayStart = start, dayEnd = end, subject = 'dog', config = configFor(subject),
  vehicles = [], edges = [], following = false, identity = '' } = {}) {
  const visits = historyVisits(points, { subject, config, vehicles, following });
  const day = visits.map(v => clippedVisit(v, dayStart, dayEnd, true)).filter(Boolean);
  const anchors = subject === 'phone' && edges.length
    ? phoneStayDisplayAnchors(day, points, edges, config) : new Map();
  const selected = day.map(v => clippedVisit(v, start, end)).filter(Boolean)
    .map(v => anchors.has(v.id) ? { ...v,
      originalRepresentative: { latitude: v.latitude, longitude: v.longitude },
      ...anchors.get(v.id) } : v);
  const dayById = subject === 'phone' ? new Map(day.map(v => [v.id, v])) : null;
  const qualifies = (v, typical) => v.durationMs >= config.stayMs && v.durationMs >= typical * config.stayRatio;
  const marked = new Set();
  const steps = [...new Set(day.flatMap(v => [v.start, v.end]))].sort((x, y) => x - y);
  let ready = false, fallback = null, typicalMs = null;
  const judge = (list, typical) => { for (const v of list) if (!marked.has(v.id) && qualifies(v, typical)) marked.add(v.id); };
  for (const tick of steps) {
    const ownStarted = selected.filter(v => v.start <= tick).length;
    const useFallback = (!following && fallback) || ownStarted < config.minVisits;
    const base = useFallback ? day : selected;
    const started = base.filter(v => v.start <= tick).length;
    const typical = median(base.filter(v => v.completed && v.end <= tick).map(v => v.durationMs));
    if (started < config.minVisits || typical == null) continue;
    const switched = ready && fallback !== useFallback;
    typicalMs = typical;
    if (!ready || switched) judge(selected.filter(v => v.end <= tick && (v.completed || v.start <= tick)), typical);
    else judge(selected.filter(v => v.completed && v.end === tick), typical);
    ready = true; fallback = useFallback;
  }
  // The ongoing visit is judged again with every append (and at the end here).
  if (ready) judge(selected.filter(v => !v.completed), typicalMs);
  // 067: a visit of alwaysStayMs or more is a stay whatever the baseline —
  // unless it is the whole range: that is 還在原地 (only the time range, no
  // stay; 判定表「還在原地」).
  const unnumbered = new Set();
  if (config.alwaysStayMs) {
    const inRange = points.filter(p => p.time >= start && p.time <= end);
    const first = inRange[0]?.time, last = inRange[inRange.length - 1]?.time;
    // A closed phone range clips the displayed duration, not the stationary
    // evidence already observed elsewhere in this day. Keep a day-confirmed
    // long stay when its selected tail is shorter than alwaysStayMs. Actual
    // visit gaps/departures were settled above, before this presentation clip.
    for (const v of selected) {
      const observed = dayById?.get(v.id) ?? v;
      // The still-here exemption uses that same available visit interval:
      // coarse boundary fixes must not turn a wholly stationary range into
      // a numbered stop. A real gap cannot establish continuous still-here.
      const coversRange = subject === 'phone'
        ? Math.max(observed.start, start) <= first && Math.min(observed.end, end) >= last
          && !observed.gaps.some(g => g.start < last && g.end > first)
        : v.start <= first && v.end >= last;
      if (observed.durationMs >= config.alwaysStayMs && !coversRange) marked.add(v.id);
      if (subject === 'phone' && observed.durationMs >= config.alwaysStayMs && coversRange
        && !inRange.some(p => p.phoneConfirmedMovement)
        && !edges.some(e => e.start >= first && e.end <= last
          && (e.countedDistanceM > 0 || e.mode === 'driving'
            || (e.gap && !e.uncertain && !e.bridged)))) unnumbered.add(v.id);
    }
  }
  if (ready && !following && fallback) {
    const settled = median(day.filter(v => v.completed).map(v => v.durationMs));
    if (settled != null) { typicalMs = settled; judge(selected, settled); }
  }
  const stops = selected.filter(v => marked.has(v.id)).map((v, i) => {
    const original = dayById?.get(v.id);
    const displayStart = original && Math.max(original.start, start);
    const displayEnd = original && Math.min(original.end, end);
    // Coarse observations within a visit confirmed by the full available day
    // may outlast the selected quality-qualified fixes. They keep the same
    // display place; quality points, duration and export observations stay raw.
    const displayRange = original && (displayStart < v.start || displayEnd > v.end)
      ? { start: displayStart, end: displayEnd, gaps: original.gaps } : null;
    return { ...v, number: i + 1, ...(displayRange ? { displayRange } : {}) };
  });
  // Still-here has no numbered location row, but its observed confirmation
  // remains available to display helpers. Never create it from mere proximity
  // or let it hide measured short travel / actual recording gaps.
  const displayStays = selected.filter(v => unnumbered.has(v.id) && !marked.has(v.id)).map(v => {
    const original = dayById.get(v.id);
    const coordinate = anchors.get(v.id) || { latitude: original.latitude, longitude: original.longitude };
    return { ...v, ...coordinate, displayRange: { start: Math.max(original.start, start),
      end: Math.min(original.end, end), gaps: original.gaps } };
  });
  return { visits: selected, stops, ...(displayStays.length ? { displayStays } : {}), typicalMs, fallback: !!fallback || selected.length < config.minVisits,
    state: { identity, ready, fallback: !!fallback, marked: [...marked] } };
}
/** Indoor holds are unconditional, unnumbered nodes, split at actual packet gaps.
 * Feed packet observations replayed with applyHistoryHolds / createHistoryHolds.
 * Coordinates are the existing hold anchor; do not infer an address. */
export function historyIndoorNodes(points, { start = -Infinity, end = Infinity, dayStart = start, dayEnd = end,
  config = configFor('dog') } = {}) {
  const nodes = [];
  let node = null, previous = null;
  for (const p of points) {
    if (p.time < start || p.time > end) continue;
    if (!p.heldReason) { node = null; previous = p; continue; }
    if (!node || node.heldSince !== p.heldSince
      || (p.time - previous.time > config.gapMs && !samePlaceGap(previous, p, config))) {
      node = { type: 'indoor', start: p.time, end: p.time, durationMs: 0,
        latitude: p.latitude, longitude: p.longitude, reason: p.heldReason,
        heldSince: p.heldSince, label: t('c114'),
        continuesPreviousDay: p.heldSince < dayStart, continuesNextDay: false };
      nodes.push(node);
    } else { node.end = p.time; node.durationMs = node.end - node.start; }
    previous = p;
  }
  const after = points.find(p => p.time > dayEnd);
  if (after?.heldReason && nodes.length) {
    const last = nodes[nodes.length - 1];
    last.continuesNextDay = last.heldSince === after.heldSince
      && (after.time - last.end <= config.gapMs || samePlaceGap({ ...last, time: last.end }, after, config));
  }
  return nodes;
}
