import { t } from '../i18n';
import { accuracyOf, configFor, coordinateValid, distanceMeters, measuredSpeedMps, median, recordingSessionChanged,
  samePlaceGap } from './HistoryConfig';
import { historySourceStream, filterHistoryPoints, replayHistoryHolds } from './HistorySources';
import { historyMovement } from './HistoryMovement';
import { historyDeparture } from './HistoryDeparture';
import { historyStops, historyIndoorNodes } from './HistoryStops';
import { phoneStayDisplayCoordinate } from './PhoneStayDisplayAnchors';
import { endpointStays } from './HistoryTimelinePresentation';

/** Display only: retain observed stationary time that has no existing place row.
 * Never classify a gap, a red light in a drive, or uncertain fixes as a stay.
 *
 * PR 116 (067 「同地中斷＝連續停留」): a same-place break inside one recording
 * session (`samePlaceBreak`: the recorder kept running, the phone saved no fix
 * — Samsung stops GPS on a still phone with the screen off — and the fixes on
 * both sides are in one place without confirmed movement) belongs to the same
 * stay, together with the zero-distance re-acquisition fixes right after it
 * (at most gapMs). A session change (recording off) stays 「沒有資料」. The
 * unobserved ranges are kept on the stop as `unobserved`.
 *
 * 2026-10-13: stationary fixes coarser than stayAccuracyM (25 m, the stay
 * position gate) but within the history accuracy filter are still observed
 * stationary time: they join the run instead of leaving it without a row.
 * They never place it — the anchor is the run's first fix within 25 m when it
 * has one — and such a run is `coarse` (with its worst `accuracyM`), so
 * mergePhoneSamePlaceStays may give its minutes to the stay it touches.
 *
 * Weak GPS of a phone that measured itself still (`stillUnplaced` edges: the
 * detector could not place coarse fixes, but their own speed says standing
 * still) is coarse stationary time too, while its raw fixes stay within
 * radiusM + their accuracy of where the run began: the <30-minute fold must
 * never turn it into a 0 m walk (「走路 27 分」 standing in a shop). */
export function phoneStationaryPresentationStops(edges, { config = configFor('phone'), covered = () => false } = {}) {
  const session = p => typeof p.session_id === 'string' && p.session_id.length > 0 ? p.session_id : null;
  const valid = p => p.phoneStationary && p.phoneMotionState === 'stationary' && !p.phoneConfirmedMovement
    && p.motion_state != null && session(p) != null
    && ('raw_speed_kmh' in p || 'speed_kmh' in p || 'speed_accuracy_mps' in p)
    && coordinateValid(p) && Number.isFinite(p.accuracy) && p.accuracy >= 0 && p.accuracy <= config.accuracyM;
  const fine = p => p.accuracy <= config.stayAccuracyM;
  const sameSession = edge => session(edge.from) != null && session(edge.from) === session(edge.to);
  const raw = p => (Number.isFinite(p.raw_latitude) && Number.isFinite(p.raw_longitude)
    ? { latitude: p.raw_latitude, longitude: p.raw_longitude } : p);
  const unplaced = p => p.phoneMotionState === 'unknown' && !p.phoneStationary && !p.phoneConfirmedMovement
    && p.motion_state != null && session(p) != null && coordinateValid(p)
    && Number.isFinite(p.accuracy) && p.accuracy >= 0 && p.accuracy <= config.accuracyM;
  const stops = [];
  let run = null;
  const finish = () => {
    if (run && run.end - run.start >= config.stayMs) stops.push({ type: 'stop',
      id: `phone-stationary:${run.start}`, presentationOnly: 'phone-stationary', number: null,
      start: run.start, end: run.end, durationMs: run.end - run.start, interruptionMs: 0, gaps: [],
      ...(run.unobserved.length ? { unobserved: run.unobserved } : {}),
      ...(run.coarseM ? { coarse: true, accuracyM: run.coarseM } : {}),
      latitude: (run.fine ?? run.anchor).latitude, longitude: (run.fine ?? run.anchor).longitude });
    run = null;
  };
  for (const edge of edges) {
    const usable = edge.end > edge.start && edge.mode !== 'driving' && sameSession(edge) && !covered(edge)
      && coordinateValid(edge.from) && coordinateValid(edge.to);
    const observed = usable && !edge.gap && !edge.bridged && !edge.uncertain && edge.mode === 'walking'
      && edge.countedDistanceM === 0 && valid(edge.from) && valid(edge.to);
    const origin = run && (run.pending?.end ?? run.end) === edge.start && run.session === session(edge.from)
      ? run.origin : raw(edge.from);
    const stillWeak = usable && edge.stillUnplaced === true && !edge.bridged && !(edge.countedDistanceM > 0)
      && (valid(edge.from) || unplaced(edge.from)) && unplaced(edge.to)
      && [edge.from, edge.to].every(p => !(distanceMeters(origin, raw(p)) > config.radiusM + p.accuracy + 1e-8));
    const samePlaceBreak = usable && edge.samePlaceBreak === true && !(edge.countedDistanceM > 0)
      && !edge.from.phoneConfirmedMovement && !edge.to.phoneConfirmedMovement;
    // Re-acquisition after a break: no counted distance, no confirmed movement.
    const settling = usable && !edge.bridged && (!edge.gap || edge.uncertain) && edge.countedDistanceM === 0
      && !edge.from.phoneConfirmedMovement && !edge.to.phoneConfirmedMovement;
    const reach = run && (run.pending?.end ?? run.end) === edge.start && run.session === session(edge.from);
    if (observed || samePlaceBreak || stillWeak) {
      if (run && !reach) finish();
      if (!run) run = { start: edge.start, end: edge.end, anchor: edge.from, session: session(edge.from),
        unobserved: [], pending: null, broke: false, fine: null, coarseM: 0, origin: raw(edge.from) };
      run.end = edge.end; run.pending = null;
      // Weak GPS never places the run, but makes it coarse (its footprint).
      if (stillWeak) run.coarseM = Math.max(run.coarseM, edge.from.accuracy, edge.to.accuracy);
      for (const p of observed ? [edge.from, edge.to] : []) {
        if (fine(p)) run.fine ??= p;
        else run.coarseM = Math.max(run.coarseM, p.accuracy);
      }
      if (samePlaceBreak) { run.unobserved.push({ start: edge.start, end: edge.end }); run.broke = true; }
      continue;
    }
    // Only after a break, and only as long as a short recording gap.
    if (settling && reach && run.broke && edge.end - (run.pending?.start ?? edge.start) <= config.gapMs) {
      run.pending = { start: run.pending?.start ?? edge.start, end: edge.end };
      continue;
    }
    finish();
  }
  finish();
  return stops;
}

/** Display only (PR 116, 067): stays at one place joined by a same-session
 * same-place break (a presentation stop carrying `unobserved`) and 0 m foot
 * rows of at most gapMs are one stay. The first real stop keeps its identity
 * and number; minutes are the parts' own (interruptions stay deducted).
 * 2026-10-13: likewise a `coarse` stationary run (fixes over 25 m) touching
 * a stay within the run's own accuracy of it: its minutes are the stay's, the
 * stay keeps its coordinate, and no second numbered stay is absorbed for it.
 * Returns the new node list and the replaced/removed source nodes. */
export function mergePhoneSamePlaceStays(nodes, { config = configFor('phone') } = {}) {
  const stay = n => n?.type === 'stop';
  const zeroFoot = n => n?.type === 'movement' && (n.mode === 'walking' || n.mode === 'moving')
    && n.countedDistanceM === 0 && n.end - n.start <= config.gapMs;
  // A coarse run's footprint (its worst accuracy) must reach the stay.
  const near = (a, b) => Number.isFinite(a?.latitude) && Number.isFinite(b?.latitude)
    && !(distanceMeters(a, b) > config.radiusM + Math.max(a.accuracyM || 0, b.accuracyM || 0) + 1e-8);
  const joins = n => n.unobserved?.length || n.coarse;
  const out = [], replaced = new Map(), removed = new Set();
  for (let i = 0; i < nodes.length; i++) {
    if (!stay(nodes[i])) { out.push(nodes[i]); continue; }
    // Grow a chain stop (0 m foot)* stop … while each part touches the last.
    let j = i, last = i;
    let real = nodes[i].presentationOnly ? 0 : 1;
    for (let k = i + 1; k < nodes.length; k++) {
      const n = nodes[k];
      if (n.start !== nodes[k - 1].end) break;
      // Coarse fixes alone never join two numbered stays (their numbers stay).
      if (stay(n) && !n.presentationOnly && real
        && !nodes.slice(i, k + 1).some(m => m.unobserved?.length)) break;
      if (stay(n) && near(nodes[i], n)) { last = k; real += n.presentationOnly ? 0 : 1; continue; }
      if (zeroFoot(n)) continue;
      break;
    }
    j = last;
    const chain = nodes.slice(i, j + 1);
    if (j === i || !chain.some(joins)) { out.push(nodes[i]); continue; }
    const stops = chain.filter(stay);
    const base = stops.find(n => !n.presentationOnly) ?? stops[0];
    const merged = { ...base, start: chain[0].start, end: chain[chain.length - 1].end,
      durationMs: chain.reduce((sum, n) => sum + (n.durationMs ?? n.end - n.start), 0),
      interruptionMs: stops.reduce((sum, n) => sum + (n.interruptionMs || 0), 0),
      gaps: stops.flatMap(n => n.gaps || []),
      unobserved: stops.flatMap(n => n.unobserved || []),
      ...(base.displayRange ? { displayRange: { ...base.displayRange, start: chain[0].start, end: chain[chain.length - 1].end,
        gaps: stops.flatMap(n => n.displayRange?.gaps || []) } } : {}),
      mergedStays: stops };
    for (const n of chain) if (n !== base) removed.add(n);
    replaced.set(base, merged);
    out.push(merged);
    i = j;
  }
  return { nodes: out, replaced, removed };
}

/** 2026-10-13 (user, display): walks beside a phone stay that are no trip.
 * - A 0 m walk (nothing counted, no confirmed movement, under listGapMs)
 *   whose fixes stay within stillPlaceM of the stay beside it is that stay's
 *   time: the stay grows over it. Between two stays at one place (within
 *   stillPlaceM) the three are one stay.
 * - A short real walk between two stays at one place is one stay when the
 *   walk lasts at most excursionMs and both its farthest fix and the second
 *   stay are within the first stay's radius (excursionAccuracyFactor × its
 *   median accuracy, clamped to [excursionMinM, excursionMaxM]). Its counted
 *   distance stays in the list: it goes to the foot row that arrived at the
 *   stay, else the next foot row (as moves inside a stay always do); with no
 *   such row the walk stays a row.
 * Recording session changes are 「沒有資料」 rows, never inside these: only
 * directly adjacent rows join. The first real stop keeps its identity and
 * number. Returns the new node list and the replaced/removed source nodes. */
export function foldPhoneStayWalks(nodes, { config = configFor('phone'), points = [] } = {}) {
  const stay = n => n?.type === 'stop';
  const foot = n => n?.type === 'movement' && (n.mode === 'walking' || n.mode === 'moving');
  const firstAt = time => {
    let lo = 0, hi = points.length;
    while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (points[mid].time < time) lo = mid + 1; else hi = mid; }
    return lo;
  };
  const fixesIn = (start, end) => {
    const out = [];
    for (let i = firstAt(start); i < points.length && points[i].time <= end; i++) out.push(points[i]);
    return out;
  };
  const placed = n => Number.isFinite(n?.latitude) && Number.isFinite(n?.longitude);
  const within = (a, b, m) => placed(a) && placed(b) && !(distanceMeters(a, b) > m + 1e-8);
  const radiusOf = s => {
    const accuracies = fixesIn(s.start, s.end).map(p => p.accuracy).filter(Number.isFinite);
    const accuracy = accuracies.length ? median(accuracies) : config.missingAccuracyM;
    return Math.min(config.excursionMaxM, Math.max(config.excursionMinM, config.excursionAccuracyFactor * accuracy));
  };
  // Beside a recording-session change (#135) the recorder was about to stop
  // or had just started: handling the phone there may read as movement, but
  // with nothing counted it is still no trip (2026-10-13).
  const zeroWalk = (w, s, restart = false) => !!config.stillMps && foot(w) && !(Math.round(w.countedDistanceM) > 0)
    && w.end - w.start < config.listGapMs
    && fixesIn(w.start, w.end).every(p => (restart || !p.phoneConfirmedMovement) && within(s, p, config.stillPlaceM));
  const restartAt = (n, time) => n?.type === 'gap' && n.sessionChange === true && (n.start === time || n.end === time);
  // The excursion runs from the first stay's end until the phone has settled
  // again: leaveMs of fixes without movement (no confirmed movement, no
  // measured speed of stillMps or more) within the radius. A visit's circle
  // follows its first fix, so the second stay may itself hold the far part
  // of the walk: its fixes count until then.
  const moving = p => p.phoneConfirmedMovement
    || (!p.phoneStationary && measuredSpeedMps(p) != null && measuredSpeedMps(p) >= config.stillMps);
  const excursion = (a, w, b) => {
    if (!foot(w) || !(config.excursionMs > 0)) return false;
    const radius = radiusOf(a);
    if (!within(a, b, radius)) return false;
    const fixes = fixesIn(a.end, b.end);
    let settled = null;
    for (let i = 0, since = null; i < fixes.length && settled == null; i++) {
      const p = fixes[i];
      if (moving(p) || !within(a, p, radius)) { since = null; continue; }
      since ??= i;
      if (p.time - fixes[since].time >= config.leaveMs) settled = since;
    }
    return settled != null && fixes[settled].time - a.end <= config.excursionMs
      && fixes.slice(0, settled).every(p => within(a, p, radius));
  };
  const join = (parts, base) => {
    const stops = parts.filter(stay);
    const first = parts[0], last = parts[parts.length - 1];
    return { ...base, start: first.start, end: last.end,
      durationMs: parts.reduce((sum, n) => sum + (n.durationMs ?? n.end - n.start), 0),
      interruptionMs: stops.reduce((sum, n) => sum + (n.interruptionMs || 0), 0),
      gaps: stops.flatMap(n => n.gaps || []),
      ...(stops.some(n => n.unobserved?.length) ? { unobserved: stops.flatMap(n => n.unobserved || []) } : {}),
      ...(base.displayRange ? { displayRange: { ...base.displayRange, start: first.start, end: last.end,
        gaps: stops.flatMap(n => n.displayRange?.gaps || n.gaps || []) } } : {}),
      ...(stops.length > 1 ? { mergedStays: stops.flatMap(n => n.mergedStays || [n]) } : {}) };
  };
  let out = [...nodes];
  const replaced = new Map(), removed = new Set();
  const source = n => { for (const [from, to] of replaced) if (to === n) return from; return n; };
  const replace = (index, count, parts, base) => {
    const merged = join(parts, base);
    for (const n of parts) if (n !== base) removed.add(source(n));
    replaced.set(source(base), merged);
    out.splice(index, count, merged);
  };
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 0; i < out.length && !changed; i++) {
      const a = out[i], w = out[i + 1], b = out[i + 2];
      if (!stay(a) || !foot(w) || a.end !== w.start) continue;
      const pair = stay(b) && w.end === b.start;
      const base = !a.presentationOnly || !pair || b.presentationOnly ? a : b;
      if (pair && zeroWalk(w, a) && within(a, b, config.stillPlaceM)) {
        replace(i, 3, [a, w, b], base); changed = true;
      } else if (pair && excursion(a, w, b)) {
        // The walk's metres go where a stay's own moves go.
        const before = out[i - 1], after = out.slice(i + 3).find(foot);
        const host = foot(before) && before.end === a.start ? before : after;
        if (w.countedDistanceM > 0 && !host) continue;
        if (w.countedDistanceM > 0) host.countedDistanceM += w.countedDistanceM;
        replace(i, 3, [a, w, b], base); changed = true;
      } else if (zeroWalk(w, a, restartAt(b, w.end))) { replace(i, 2, [a, w], a); changed = true; }
    }
    for (let i = 1; i < out.length && !changed; i++) {
      const w = out[i - 1], b = out[i];
      if (stay(b) && foot(w) && w.end === b.start && zeroWalk(w, b, restartAt(out[i - 2], w.start))) {
        replace(i - 1, 2, [w, b], b); changed = true;
      }
    }
  }
  return { nodes: out, replaced, removed };
}

/** 2026-10-13 (phone, display only): travel rows of a phone standing still.
 * A still phone read 「走路 N 分・0 m」 between breaks, and a drive went on
 * over the time after parking (「開車 12 分」) when the parked fixes carried
 * no speed (network fixes indoors, an emulator): neither is travel.
 * - A drive's tail in which every fix stays within radiusM + its accuracy of
 *   the first one, with no confirmed movement and no measured speed of
 *   stillMps or more, for stayMs or more, is an unnumbered stay; the drive
 *   ends where it parked (a red light the drive went on from is no tail). A
 *   drive that never left that spot is that stay.
 * - A foot row of a minute or more with nothing counted, no confirmed
 *   movement and every fix within stillPlaceM of its first, with no foot row
 *   or stay on either side (it lies between breaks, ends or switch points),
 *   is an unnumbered stay. Beside a stay #149's folding takes such a row.
 * Rows of a recorder that measures no speed or motion (older rows) stay.
 * Switch points touching such a stay go: the stay separates the modes (H1).
 * The model's sections, the map, distances, CSV and GPX are unchanged. */
export function phoneStillTravel(nodes, { config = configFor('phone'), points = [], vehicles = [] } = {}) {
  if (!config.stillMps || !points.length) return nodes;
  const firstAt = time => {
    let lo = 0, hi = points.length;
    while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (points[mid].time < time) lo = mid + 1; else hi = mid; }
    return lo;
  };
  const fixesIn = (start, end) => {
    const out = [];
    for (let i = firstAt(start); i < points.length && points[i].time <= end; i++) out.push(points[i]);
    return out;
  };
  const raw = p => (Number.isFinite(p.raw_latitude) && Number.isFinite(p.raw_longitude)
    ? { latitude: p.raw_latitude, longitude: p.raw_longitude } : p);
  // Only a recorder that measures speed and motion can say a fix was still;
  // older rows (geometry alone) keep their rows as they were.
  const modern = p => p.phoneMotionState != null && ('raw_speed_kmh' in p || 'speed_kmh' in p || 'speed_accuracy_mps' in p);
  const quiet = p => modern(p) && !p.phoneConfirmedMovement && !(measuredSpeedMps(p) >= config.stillMps);
  const near = (anchor, p) => !(distanceMeters(raw(anchor), raw(p)) > config.radiusM + accuracyOf(p, config) + 1e-8);
  const foot = n => n?.type === 'movement' && (n.mode === 'walking' || n.mode === 'moving');
  const placeOf = fixes => fixes.find(p => p.accuracy <= config.stayAccuracyM) ?? fixes[0];
  const stayOf = (start, end, fixes, from) => {
    const at = placeOf(fixes);
    return { type: 'stop', id: `phone-${from}:${start}`, presentationOnly: 'phone-stationary', number: null,
      start, end, durationMs: end - start, interruptionMs: 0, gaps: [], latitude: at.latitude, longitude: at.longitude };
  };
  const made = [];
  const out = nodes.flatMap((n, i) => {
    // Only where the vehicle itself ended (not a range clipping it at a red light).
    if (n.type === 'movement' && n.mode === 'driving' && vehicles.some(v => v.end === n.end)) {
      const fixes = fixesIn(n.start, n.end);
      let k = fixes.length - 1;
      while (k > 0 && quiet(fixes[k - 1]) && fixes.slice(k).every(p => quiet(p) && near(fixes[k - 1], p))) k--;
      if (k < 0 || fixes.length < 2 || n.end - fixes[k].time < config.stayMs) return [n];
      const stay = stayOf(fixes[k].time, n.end, fixes.slice(k), 'parked');
      made.push(stay);
      if (fixes[k].time <= n.start) return [stay];
      let tail = 0;
      for (let j = k + 1; j < fixes.length; j++) tail += distanceMeters(fixes[j - 1], fixes[j]);
      return [{ ...n, end: stay.start, durationMs: stay.start - n.start,
        endLatitude: fixes[k].latitude, endLongitude: fixes[k].longitude,
        distanceM: Math.max(0, n.distanceM - tail) }, stay];
    }
    // Beside a stay, #149's folding gives the stay this time instead.
    const beside = m => foot(m) || ['stop', 'indoor'].includes(m?.type);
    if (!foot(n) || Math.round(n.countedDistanceM) > 0 || n.end - n.start < 60000
      || beside(nodes[i - 1]) || beside(nodes[i + 1])) return [n];
    const fixes = fixesIn(n.start, n.end);
    if (fixes.length < 2 || !fixes.every(p => modern(p) && !p.phoneConfirmedMovement
      && !(distanceMeters(fixes[0], p) > config.stillPlaceM + 1e-8))) return [n];
    const stay = stayOf(n.start, n.end, fixes, 'still');
    made.push(stay);
    return [stay];
  });
  if (!made.length) return nodes;
  // A 恢復記錄 where such a stay starts is that stay's start (as for any stay).
  return out.filter(n => !(n.type === 'switch' && made.some(s => s.start === n.start || s.end === n.start))
    && !(n.type === 'resume' && made.some(s => s.start === n.start)));
}

/** PR 116: phone foot rows with nothing counted that would read
 * 「走路 0 分 · 0.0 km」 next to a place, a break or either end: they say
 * nothing, so the list leaves them out. */
export function emptyPhoneFootRows(nodes) {
  const foot = n => n?.type === 'movement' && (n.mode === 'walking' || n.mode === 'moving');
  const shownMinutes = n => Math.floor(n.end / 60000) - Math.floor(n.start / 60000);
  const beside = n => !n || !['movement', 'switch'].includes(n.type);
  return new Set(nodes.filter((n, i) => foot(n) && n.countedDistanceM === 0
    && ((n.durationMs ?? n.end - n.start) < 60000 || shownMinutes(n) === 0)
    && beside(nodes[i - 1]) && beside(nodes[i + 1])));
}

const sessionOf = p => typeof p?.session_id === 'string' && p.session_id.length > 0 ? p.session_id : null;

/** 2026-10-13 (phone): 「沒有資料 00:00–first」 when the range begins at the
 * day's first fix and the fix before midnight (`context`) is more than gapMs
 * before it; for a fixed end at the day's last fix, 「沒有資料 last–24:00」
 * when the next fix after midnight is more than gapMs after it. Nothing
 * without a fix on the other side (no record proves the time empty or not).
 * Rows of one recording session are `sameSession` (the list folds a short one
 * into the row beside it, #132); a session change is its own row (#135); a
 * same-session break at one place (samePlaceGap: 067, the stay goes on over
 * midnight) is `samePlace`: the stay beside it takes it, however long. */
function dayBoundaryGaps({ context, dayPoints, first, last, dayStart, dayEnd, following, config }) {
  const out = [];
  const row = (from, to, start, end, side) => ({ type: 'gap', mode: 'gap', dayBoundary: side,
    start, end, durationMs: end - start,
    latitude: (side === 'start' ? to : from).latitude, longitude: (side === 'start' ? to : from).longitude,
    endLatitude: (side === 'start' ? to : from).latitude, endLongitude: (side === 'start' ? to : from).longitude,
    distanceM: 0, countedDistanceM: 0, excluded: true, line: 'long-dashed',
    ...(sessionOf(from) != null && sessionOf(from) === sessionOf(to) ? { sameSession: true } : {}),
    ...(recordingSessionChanged(from, to) ? { sessionChange: true } : {}),
    ...(samePlaceGap(from, to, config) ? { samePlace: true } : {}) });
  if (first && first === dayPoints[0] && first.time > dayStart) {
    const before = context.filter(p => p.time < dayStart).pop();
    if (before && first.time - before.time > config.gapMs) out.push(row(before, first, dayStart, first.time, 'start'));
  }
  if (last && !following && last === dayPoints[dayPoints.length - 1] && last.time < dayEnd) {
    const after = context.find(p => p.time >= dayEnd);
    if (after && after.time - last.time > config.gapMs) out.push(row(last, after, last.time, dayEnd, 'end'));
  }
  return out;
}

/** Pure H1/H2 list. `nodes` contains location rows AND movement/gap rows in
 * display order. No geocoding: address resolution can use location rows later.
 * Supply full-day observations (and <=24h hold/visit context for midnight).
 * Day bounds are [dayStart, dayEnd); range endpoints are actual observations.
 * Consumer calendar/list/export must use the returned source stream. */
export function historyTimeline(rows = [], options = {}) {
  const { subject = 'dog', dayStart = -Infinity, dayEnd = Infinity,
    today = false, now = rows[rows.length - 1]?.time ?? 0, manualRange = null, closedAt = null,
    following = today && manualRange?.end == null, state = null, timezone = '',
    replayHolds, config = configFor(subject), measure } = options;
  const measured = (stage, count, operation) => measure ? measure(stage, count, operation) : operation();
  const replay = replayHolds ?? (subject === 'dog'
    ? packets => replayHistoryHolds(packets, { since: dayStart, ...options.holdOptions }) : undefined);
  const stream = measured('stream', rows.length, () => historySourceStream(rows, { replayHolds: replay, measure }));
  const context = measured('filter', stream.points.length, () => filterHistoryPoints(stream.points, { subject, config }));
  const dayPoints = context.filter(p => p.time >= dayStart && p.time < dayEnd);
  const contextMovement = measured('context-movement', context.length, () => historyMovement(context, { subject, config }));
  const departure = historyDeparture(dayPoints, { subject, config, today, now, movement: contextMovement, manualRange });
  const range = options.range ?? departure.range;
  const points = dayPoints.filter(p => p.time >= range.start && p.time <= range.end);
  // Classify on the full day: clipping must not erase vehicle confirmation.
  const vehicles = contextMovement.vehicles;
  const movement = measured('range-movement', points.length, () => historyMovement(points, { subject, config, vehicles }));
  const switches = movement.switches.map(({ point, ...node }) => node);
  const identity = JSON.stringify([subject, range.start, following ? 'following' : range.end,
    dayStart, dayEnd, timezone, !!manualRange]);
  const stays = measured('stops', context.length, () => historyStops(context, { subject, config, start: range.start, end: range.end,
    dayStart, dayEnd: dayEnd - 1, vehicles, edges: contextMovement.edges, following, identity, state }));
  const held = measured('indoor', context.length, () => historyIndoorNodes(context, { start: Math.max(range.start, dayStart),
    end: Math.min(range.end, dayEnd - 1), dayStart, dayEnd: dayEnd - 1, config }));
  // 067: a hold the dog walked on out of (its next real fix more than
  // movedOnM from the hold spot) was no stay: the collar kept reporting
  // without GPS while the dog moved — 「收不到 GPS」, not 室內.
  const movedOn = held.filter(node => {
    const next = context.find(p => p.time > node.end && !p.heldReason);
    return next && config.movedOnM && distanceMeters(node, next) > config.movedOnM;
  });
  const indoor = held.filter(node => !movedOn.includes(node));
  const locations = [...stays.stops, ...indoor,
    ...switches.filter(s => !stays.stops.some(v => s.start >= v.start && s.start <= v.end))]
    .sort((a, b) => a.start - b.start);
  const displayLocations = [...locations, ...(stays.displayStays || [])];
  const containsStayEdge = edge => displayLocations.some(n => n.type === 'stop'
    && edge.start >= (n.displayRange?.start ?? n.start) && edge.end <= (n.displayRange?.end ?? n.end)
    && ![...(n.gaps || []), ...(n.displayRange?.gaps || [])].some(g => g.start < edge.end && g.end > edge.start));
  const sectionEdges = movement.edges.map(edge => {
    // A same-place bridge supplies no travel evidence. If it did not belong
    // to a confirmed stay, retain the interruption instead of inventing walking.
    const containedBridge = edge.bridged && containsStayEdge(edge);
    // PR 116: same recording session both sides — the recorder ran but no
    // fix was saved (phoneStationaryPresentationStops may take it as a stay).
    const sameSession = typeof edge.from.session_id === 'string' && edge.from.session_id.length > 0
      && edge.from.session_id === edge.to.session_id;
    const shown = subject === 'phone' && edge.bridged && !containedBridge
      ? { ...edge, gap: true, mode: 'gap', ...(sameSession ? { samePlaceBreak: true } : {}) } : edge;
    // A break across a recording session change (the recorder was off: app
    // updated or killed, recording switched off) is never stay time and is
    // always its own 「沒有資料」 row (`sessionChange`), however short.
    return subject === 'phone' && shown.gap && !shown.uncertain && recordingSessionChanged(edge.from, edge.to)
      ? { ...shown, sessionChange: true } : shown;
  });
  // Construct fallback only after movement, visits and gaps are settled; it
  // feeds no detection back. Same-session same-place breaks are 067 stays.
  const stationary = subject === 'phone' ? phoneStationaryPresentationStops(sectionEdges, { config,
    covered: edge => displayLocations.some(n => ['stop', 'indoor'].includes(n.type)
      && (n.displayRange?.start ?? n.start) < edge.end && (n.displayRange?.end ?? n.end) > edge.start),
  }) : [];
  const inStationary = e => stationary.some(s => e.start >= s.start && e.end <= s.end);
  // 判定表「恢復記錄節點」: after a break of over 30 minutes the first fix
  // after it is a 恢復記錄 node (unless a stay or a hold already starts there).
  for (const e of sectionEdges) {
    if (e.mode !== 'gap' || e.durationMs <= config.resumeAfterMs || inStationary(e)) continue;
    // A presentation stay starting there — or once the detector settled, a
    // few seconds on — is that start too (2026-10-13; the list lets it begin
    // at the first fix).
    if (locations.some(n => n.start === e.end)
      || stationary.some(n => n.start >= e.end && n.start - e.end < config.gapMs)) continue;
    locations.push({ type: 'resume', start: e.end, end: e.end, latitude: e.to.latitude, longitude: e.to.longitude });
  }
  locations.sort((a, b) => a.start - b.start);
  const first = points[0], last = points[points.length - 1];
  if (first && !locations.some(n => n.start === first.time
    && (n.type === 'indoor' || (n.type === 'stop' && n.continuesPreviousDay)))) locations.unshift({ type: 'departure',
    start: first.time, end: first.time, latitude: first.latitude, longitude: first.longitude,
    manual: !!manualRange && manualRange.start !== departure.automaticRange.start,
    continuesPreviousDay: context.some(p => p.time < dayStart)
      && first.time - context.filter(p => p.time < dayStart).pop().time <= config.gapMs });
  const displayedEnd = subject === 'phone' && last ? phoneStayDisplayCoordinate(displayLocations, last.time) : null;
  if (last && last !== first && !locations.some(n => n.end === last.time && n.type === 'indoor')) locations.push({ type: 'end',
    start: last.time, end: last.time, latitude: last.latitude, longitude: last.longitude,
    ...(displayedEnd ? { ...displayedEnd,
      originalRepresentative: { latitude: last.latitude, longitude: last.longitude } } : {}),
    // 判定表「「現在」和「最後 12:05」」; a recording that was switched off
    // ends with 「記錄已關閉 10:20」 (closedAt, when the caller knows it).
    label: following ? now - last.time <= 120000 ? t('c130') : t("c660") : closedAt != null ? t("c656") : t('c330'),
    closedAt: following ? null : closedAt,
    continuesNextDay: context.some(p => p.time >= dayEnd && p.time - last.time <= config.gapMs) });
  const sections = [];
  // Moves inside a stay still count (判定表「距離怎麼算」: 和有沒有被標成停留
  // 無關): they go to the foot row that arrived there, or else the next one,
  // so the rows add up to the summary.
  let carried = 0;
  // Skipped stationary edges right after the last row (a pause on foot).
  let pause = null;
  const isFoot = mode => mode === 'walking' || mode === 'moving';
  for (const e of sectionEdges) {
    // Time a presentation stay keeps (all of it 0 m) is no travel/gap row.
    if (inStationary(e)) { pause = null; continue; }
    // Coarse fixes may sit just outside a visit's representative-position
    // quality gate. Two detector-confirmed stationary observations are still
    // no walk. An already classified drive includes red-light time, so keep
    // those edges contiguous in the same driving row; preserve actual gaps.
    if (subject === 'phone' && !e.gap && !e.bridged
      && e.mode !== 'driving' && e.from.phoneStationary && e.to.phoneStationary) {
      const row = sections[sections.length - 1];
      if (pause && pause.end === e.start) pause.end = e.end;
      else pause = row && row.end === e.start ? { start: e.start, end: e.end } : null;
      continue;
    }
    // A pause shorter than a stay (a red light mid-walk) that no place row
    // covers is 0 m time of that walk: the walk on either side stays one row
    // (as phoneStationaryPresentationStops only takes runs of a stay's length).
    const footPause = pause && pause.end === e.start && pause.end - pause.start < config.stayMs
      && !locations.some(n => n.end >= pause.start && n.start <= pause.end) ? pause : null;
    pause = null;
    // A brief unknown observation inside an already confirmed visit does not
    // become a new travel/interruption row. Actual recording gaps remain.
    if (e.uncertain && e.durationMs <= config.gapMs && containsStayEdge(e)) continue;
    if (e.mode !== 'gap' && (containsStayEdge(e) || locations.some(n => n.type === 'indoor'
      && e.start >= n.start && e.end <= n.end))) {
      // A move while arriving (within gapMs of the foot row that arrived)
      // is that row's; a later one — drift hours into the stay, the first
      // steps of leaving — goes to the next foot row (2026-10-13: never to a
      // walk hours earlier, across breaks and other stays).
      const arrived = [...sections].reverse().find(row => row.type === 'movement');
      if (arrived && isFoot(arrived.mode) && e.start - arrived.end <= config.gapMs) arrived.countedDistanceM += e.countedDistanceM;
      else carried += e.countedDistanceM;
      continue;
    }
    if (e.mode === 'indoor') continue;
    const prior = sections[sections.length - 1];
    // A dog's break keeps its own reason (收不到 GPS / 沒收到訊號): breaks
    // with different reasons are different rows.
    const reason = e.uncertain && e.durationMs <= config.gapMs ? 'uncertain' : e.gap && subject === 'dog'
      ? (e.gapReason ?? (stream.packets.some(p => p.time > e.start && p.time < e.end) ? 'no-gps' : 'no-signal')) : undefined;
    if (footPause && prior?.type === 'movement' && isFoot(prior.mode) && prior.mode === e.mode
      && prior.reason === reason && prior.end === footPause.start) {
      prior.end = e.end; prior.durationMs += footPause.end - footPause.start + e.durationMs;
      prior.distanceM += e.distanceM; prior.countedDistanceM += e.countedDistanceM;
    } else if (prior && prior.mode === e.mode && prior.reason === reason && prior.end === e.start
      && !locations.some(n => n.start === e.start || n.end === e.start)) {
      prior.end = e.end; prior.durationMs += e.durationMs;
      prior.distanceM += e.gap ? 0 : e.distanceM; prior.countedDistanceM += e.countedDistanceM;
      if (e.sessionChange) prior.sessionChange = true;
    } else sections.push({ type: e.gap ? 'gap' : 'movement', mode: e.mode,
      // 067: a dog's break says why — packets came without a fix
      // (「收不到 GPS」) or nothing came (「沒收到訊號」). A phone's stays
      // 「沒有資料」.
      ...(reason ? { reason } : {}),
      ...(e.sessionChange ? { sessionChange: true } : {}),
      start: e.start, end: e.end, durationMs: e.durationMs,
      latitude: e.from.latitude, longitude: e.from.longitude,
      endLatitude: e.to.latitude, endLongitude: e.to.longitude,
      distanceM: e.gap ? 0 : e.distanceM, countedDistanceM: e.countedDistanceM,
      excluded: ['driving', 'ride', 'gap'].includes(e.mode),
      line: e.gap ? 'long-dashed' : ['driving', 'ride'].includes(e.mode) ? 'solid' : 'dotted' });
    const row = sections[sections.length - 1];
    if (carried && isFoot(row.mode)) { row.countedDistanceM += carried; carried = 0; }
  }
  // A phone break inside one recording session (the list folds a short one
  // into the row beside it, 2026-10-13); a session change is always its own
  // row. A short weak-GPS step had fixes on both sides (the recorder ran)
  // unless the two say otherwise; a break with no fix needs one known session.
  if (subject === 'phone') {
    const sameSessionGap = e => e.uncertain && e.durationMs <= config.gapMs
      ? !(sessionOf(e.from) && sessionOf(e.to) && sessionOf(e.from) !== sessionOf(e.to))
      : sessionOf(e.from) != null && sessionOf(e.from) === sessionOf(e.to);
    for (const section of sections) {
      if (section.type !== 'gap') continue;
      const inside = sectionEdges.filter(e => e.gap && e.start >= section.start && e.end <= section.end);
      if (inside.length && inside.every(sameSessionGap)) section.sameSession = true;
    }
  }
  const noGPSGaps = new Map(sections.filter(section => section.type === 'gap'
    && section.reason === 'no-gps').map(section => [section.start, section]));
  for (const node of movedOn) {
    const continuation = noGPSGaps.get(node.end);
    if (continuation) {
      continuation.start = node.start;
      continuation.durationMs = continuation.end - node.start;
      continuation.latitude = node.latitude;
      continuation.longitude = node.longitude;
      continue;
    }
    sections.push({ type: 'gap', mode: 'gap', reason: 'no-gps', start: node.start, end: node.end,
      durationMs: node.end - node.start, latitude: node.latitude, longitude: node.longitude,
      endLatitude: node.latitude, endLongitude: node.longitude, distanceM: 0, countedDistanceM: 0,
      excluded: true, line: 'long-dashed' });
  }
  sections.sort((a, b) => a.start - b.start);
  const rank = node => node.type === 'departure' ? 0 : ['movement', 'gap'].includes(node.type) ? 2 : node.type === 'end' ? 3 : 1;
  // 2026-10-13: a still-here stay (displayStays: the range lies wholly in a
  // day-confirmed long stay) is a list row too, unnumbered, so the list says
  // what the map's label says (the 出發／終點 rows take it as #115 merges).
  const stillHere = (stays.displayStays || []).map(v => {
    const { start: from, end: to } = v.displayRange;
    const gaps = (v.displayRange.gaps || []).filter(g => g.start >= from && g.end <= to);
    const interruptionMs = gaps.reduce((sum, g) => sum + g.end - g.start, 0);
    return { ...v, type: 'stop', number: null, presentationOnly: 'still-here', start: from, end: to,
      durationMs: to - from - interruptionMs, interruptionMs, gaps };
  });
  let nodes = [...locations, ...sections, ...stillHere].sort((a, b) => a.start - b.start || rank(a) - rank(b));
  // A switch right beside another place (a stay ends, the car starts after a
  // few seconds on foot) would leave a 0 km foot row between two points:
  // the place itself already separates the modes, so the switch and the empty
  // foot row go (H1: 停留 2 → 坐車 → 3).
  const foot = n => n?.type === 'movement' && (n.mode === 'walking' || n.mode === 'moving');
  const place = n => n && !['movement', 'gap', 'switch'].includes(n.type);
  const drop = new Set();
  nodes.forEach((n, i) => {
    if (n.type !== 'switch') return;
    for (const [side, beyond] of [[nodes[i - 1], nodes[i - 2]], [nodes[i + 1], nodes[i + 2]]]) {
      if (foot(side) && side.countedDistanceM === 0 && side.durationMs <= 60000 && place(beyond) && !drop.has(beyond)) {
        drop.add(n); drop.add(side); return;
      }
    }
  });
  // The fallback must not affect existing switch cleanup; it is a place for
  // the empty-foot-row cleanup below (PR 116).
  nodes = [...nodes.filter(n => !drop.has(n)), ...stationary]
    .sort((a, b) => a.start - b.start || rank(a) - rank(b));
  // Likewise a few seconds on foot with nothing counted between two places
  // (a stay, then the dog goes inside; a stay that runs into the end): the
  // places are adjacent (判定表「停在原處節點的前後」: 3 分鐘以內…停在原處
  // 節點不算移動段).
  nodes.forEach((n, i) => {
    if (foot(n) && n.countedDistanceM === 0 && n.durationMs <= 60000
      && place(nodes[i - 1]) && place(nodes[i + 1])) drop.add(n);
  });
  nodes = nodes.filter(n => !drop.has(n));
  // 2026-10-13 (phone): a parked tail of a drive and a 0 m 「走路」 standing
  // alone are stationary time, not travel (display only).
  if (subject === 'phone') {
    const still = phoneStillTravel(nodes, { config, points, vehicles });
    // The switch points and 恢復記錄 it set aside leave the map's places too.
    const kept = new Set(still);
    for (const n of nodes) if (!kept.has(n) && n.type !== 'movement') drop.add(n);
    nodes = still;
  }
  // PR 116 / 067: stays at one place joined by a same-session break are one.
  let replaced = new Map(), removed = new Set();
  if (subject === 'phone') ({ nodes, replaced, removed } = mergePhoneSamePlaceStays(nodes, { config }));
  if (subject === 'phone') {
    // 2026-10-13: 0 m walks beside a stay and short excursions between two
    // stays at one place are the stay's time.
    const fold = foldPhoneStayWalks(nodes, { config, points });
    const original = new Map([...replaced].map(([from, to]) => [to, from]));
    for (const n of fold.removed) removed.add(original.get(n) ?? n);
    for (const [from, to] of fold.replaced) replaced.set(original.get(from) ?? from, to);
    nodes = fold.nodes;
  }
  if (subject === 'phone') {
    const empty = emptyPhoneFootRows(nodes);
    for (const n of empty) drop.add(n);
    nodes = nodes.filter(n => !empty.has(n));
    // 2026-10-13: an interruption inside a stay whose two fixes are of one
    // recording session is marked `sameSession` (the list counts a short one
    // in the stay's minutes). New gap objects: the visit's own stay as it is.
    const at = new Map(context.map(p => [p.time, p]));
    for (const node of nodes) {
      if (node.type !== 'stop' || !node.gaps?.length) continue;
      node.gaps = node.gaps.map(g => {
        const a = sessionOf(at.get(g.start)), b = sessionOf(at.get(g.end));
        return a != null && a === b ? { ...g, sameSession: true } : g;
      });
    }
  }
  // 2026-10-13 (phone): the time between midnight and the day's first fix,
  // and between its last fix and midnight, is a row too when the fixes on
  // the other side of midnight are more than gapMs away (the caller reads the
  // fix before and, for a past day, the one after: HistoryDatabase).
  const boundaries = subject === 'phone' ? dayBoundaryGaps({ context, dayPoints, first, last,
    dayStart, dayEnd, following, config }) : [];
  for (const gap of boundaries) {
    if (gap.dayBoundary === 'start') sections.unshift(gap); else sections.push(gap);
    nodes = gap.dayBoundary === 'start' ? [gap, ...nodes] : [...nodes, gap];
  }
  // 判定表「交通方式切換點」: stays and switch points share one numbering in
  // time order; holds, departure, resume and end are not numbered.
  // 2026-10-13 (user, #154): the numbers shown start at 1 and skip none. A
  // stay the list shows inside 出發 or the end (「出發 · 停 N 分」「結束 ·
  // 停 N 分」) has no number of its own (`listedWith`), and the map draws no
  // marker for it; the stays and switch points after it count from 1.
  const numbered = node => (node.type === 'stop' || node.type === 'switch') && !node.presentationOnly;
  let number = 0;
  for (const node of nodes) if (numbered(node)) node.number = ++number;
  const merged = endpointStays(nodes);
  if ((merged.departure && numbered(merged.departure)) || (merged.end && numbered(merged.end))) {
    if (merged.departure && numbered(merged.departure)) merged.departure.listedWith = 'departure';
    if (merged.end && numbered(merged.end)) merged.end.listedWith = 'end';
    number = 0;
    for (const node of nodes) if (numbered(node)) node.number = node.listedWith ? null : ++number;
  }
  const keptLocations = locations.filter(n => !drop.has(n) && !removed.has(n)).map(n => replaced.get(n) ?? n);
  const keptSections = sections.filter(n => !drop.has(n) && !removed.has(n));
  // H8 asks whether the day itself has records; the context read before
  // midnight does not count (判定表「停住期間的封包算不算『有紀錄』」: held
  // packets do).
  const dayRecords = stream.packets.some(p => p.time >= dayStart && p.time < dayEnd);
  // 2026-10-13: a dog's day (or range) with packets but not one usable fix —
  // the collar was heard, never located — is what the calendar's dot and
  // ‹ › promised: one 「收不到 GPS」 row from its first packet to its last,
  // not 「這段時間沒有紀錄」. Nothing to draw on the map.
  if (subject === 'dog' && !points.length && dayRecords) {
    const from = Number.isFinite(range.start) ? Math.max(range.start, dayStart) : dayStart;
    const to = Number.isFinite(range.end) ? Math.min(range.end, dayEnd - 1) : dayEnd - 1;
    const heard = stream.packets.filter(p => p.time >= from && p.time <= to);
    if (heard.length > 1 && heard[heard.length - 1].time > heard[0].time) {
      const a = heard[0], b = heard[heard.length - 1];
      const row = { type: 'gap', mode: 'gap', reason: 'no-gps', start: a.time, end: b.time,
        durationMs: b.time - a.time, latitude: null, longitude: null, endLatitude: null, endLongitude: null,
        distanceM: 0, countedDistanceM: 0, excluded: true, line: 'long-dashed', unlocated: true };
      nodes = [row];
    }
  }
  // dayPoints: the whole day's filtered fixes (the range bar snaps to them);
  // edges: the range's fix-to-fix steps (the history cursor's distance).
  return { ...stream, dayRecords, points, dayPoints,
    ...(subject === 'dog' ? { dayEdges: contextMovement.edges.filter(e => e.start >= dayStart && e.end < dayEnd) } : {}),
    edges: sectionEdges, range, departure, nodes,
    locations: keptLocations, sections: keptSections,
    ...(stays.displayStays?.length ? { displayStays: stays.displayStays } : {}),
    state: stays.state, typicalMs: stays.typicalMs,
    distanceM: movement.edges.reduce((sum, e) => sum + e.countedDistanceM, 0),
    durationMs: first ? last.time - first.time : 0,
    hasGaps: sectionEdges.some(e => e.gap), rangeEnabled: !!first && last.time - first.time >= 60000 };
}
