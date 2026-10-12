import { t } from '../i18n';
import { configFor, coordinateValid, distanceMeters } from './HistoryConfig';
import { historySourceStream, filterHistoryPoints, replayHistoryHolds } from './HistorySources';
import { historyMovement } from './HistoryMovement';
import { historyDeparture } from './HistoryDeparture';
import { historyStops, historyIndoorNodes } from './HistoryStops';
import { phoneStayDisplayCoordinate } from './PhoneStayDisplayAnchors';

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
 * mergePhoneSamePlaceStays may give its minutes to the stay it touches. */
export function phoneStationaryPresentationStops(edges, { config = configFor('phone'), covered = () => false } = {}) {
  const session = p => typeof p.session_id === 'string' && p.session_id.length > 0 ? p.session_id : null;
  const valid = p => p.phoneStationary && p.phoneMotionState === 'stationary' && !p.phoneConfirmedMovement
    && p.motion_state != null && session(p) != null
    && ('raw_speed_kmh' in p || 'speed_kmh' in p || 'speed_accuracy_mps' in p)
    && coordinateValid(p) && Number.isFinite(p.accuracy) && p.accuracy >= 0 && p.accuracy <= config.accuracyM;
  const fine = p => p.accuracy <= config.stayAccuracyM;
  const sameSession = edge => session(edge.from) != null && session(edge.from) === session(edge.to);
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
    const samePlaceBreak = usable && edge.samePlaceBreak === true && !(edge.countedDistanceM > 0)
      && !edge.from.phoneConfirmedMovement && !edge.to.phoneConfirmedMovement;
    // Re-acquisition after a break: no counted distance, no confirmed movement.
    const settling = usable && !edge.bridged && (!edge.gap || edge.uncertain) && edge.countedDistanceM === 0
      && !edge.from.phoneConfirmedMovement && !edge.to.phoneConfirmedMovement;
    const reach = run && (run.pending?.end ?? run.end) === edge.start && run.session === session(edge.from);
    if (observed || samePlaceBreak) {
      if (run && !reach) finish();
      if (!run) run = { start: edge.start, end: edge.end, anchor: edge.from, session: session(edge.from),
        unobserved: [], pending: null, broke: false, fine: null, coarseM: 0 };
      run.end = edge.end; run.pending = null;
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
    return subject === 'phone' && edge.bridged && !containedBridge
      ? { ...edge, gap: true, mode: 'gap', ...(sameSession ? { samePlaceBreak: true } : {}) } : edge;
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
    if (locations.some(n => n.start === e.end)) continue;
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
      const arrived = [...sections].reverse().find(row => row.type === 'movement');
      if (arrived && isFoot(arrived.mode)) arrived.countedDistanceM += e.countedDistanceM;
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
    } else sections.push({ type: e.gap ? 'gap' : 'movement', mode: e.mode,
      // 067: a dog's break says why — packets came without a fix
      // (「收不到 GPS」) or nothing came (「沒收到訊號」). A phone's stays
      // 「沒有資料」.
      ...(reason ? { reason } : {}),
      start: e.start, end: e.end, durationMs: e.durationMs,
      latitude: e.from.latitude, longitude: e.from.longitude,
      endLatitude: e.to.latitude, endLongitude: e.to.longitude,
      distanceM: e.gap ? 0 : e.distanceM, countedDistanceM: e.countedDistanceM,
      excluded: ['driving', 'ride', 'gap'].includes(e.mode),
      line: e.gap ? 'long-dashed' : ['driving', 'ride'].includes(e.mode) ? 'solid' : 'dotted' });
    const row = sections[sections.length - 1];
    if (carried && isFoot(row.mode)) { row.countedDistanceM += carried; carried = 0; }
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
  let nodes = [...locations, ...sections].sort((a, b) => a.start - b.start || rank(a) - rank(b));
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
  // PR 116 / 067: stays at one place joined by a same-session break are one.
  let replaced = new Map(), removed = new Set();
  if (subject === 'phone') ({ nodes, replaced, removed } = mergePhoneSamePlaceStays(nodes, { config }));
  if (subject === 'phone') {
    const empty = emptyPhoneFootRows(nodes);
    for (const n of empty) drop.add(n);
    nodes = nodes.filter(n => !empty.has(n));
  }
  // 判定表「交通方式切換點」: stays and switch points share one numbering in
  // time order; holds, departure, resume and end are not numbered.
  let number = 0;
  for (const node of nodes) {
    if ((node.type === 'stop' || node.type === 'switch') && !node.presentationOnly) node.number = ++number;
  }
  const keptLocations = locations.filter(n => !drop.has(n) && !removed.has(n)).map(n => replaced.get(n) ?? n);
  const keptSections = sections.filter(n => !drop.has(n) && !removed.has(n));
  // H8 asks whether the day itself has records; the context read before
  // midnight does not count (判定表「停住期間的封包算不算『有紀錄』」: held
  // packets do).
  const dayRecords = stream.packets.some(p => p.time >= dayStart && p.time < dayEnd);
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
