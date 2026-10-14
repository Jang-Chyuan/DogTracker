import { historyTimeline } from '../src/history/HistoryTimeline';
import { configFor } from '../src/history/HistoryConfig';
import { timelinePresentation, presentationDurationMs } from '../src/history/HistoryTimelinePresentation';
import { interruptionText, listDuration, nodePill, sectionText } from '../src/history/HistoryText';
import { distanceText } from '../src/utils/distanceText';
import { cursorLabel, screenCursor } from '../src/history/screen/HistoryScreenCursor';
import { buildExportSnapshot } from '../src/mapHistory/ExportSnapshot';
import { buildCSV } from '../src/mapHistory/ExportCSV';
import { buildGPX } from '../src/mapHistory/ExportGPX';
import { t } from '../src/i18n';
import { point } from '../__fixtures__/HistoryLogicFixtures';

// Invented phone day (five-second fixes, no real place or time). A script is
// a list of [kind, seconds, extra]:
// walk 5 km/h east; still (fine, 4 m); coarse (still, 28 m: over the 25 m
// stay gate, within the 30 m stationary detector and the 50 m filter);
// weak (speed 2 km/h with a 5 m/s spread: no reliable speed, so uncertain;
// `drift` metres east per fix); none (nothing saved; `move` metres east over
// it); session (recording restarted: the following fixes have a new session).
const base = 1600000000000;
const MINUTE = 60000;
const config = configFor('phone');
function day(script) {
  const rows = [];
  let s = 0, east = 0, session = 'fiction-session-1';
  const fix = (extra = {}) => rows.push({ time: base + s * 1000, latitude: 1, longitude: 1 + east / 111320,
    raw_latitude: 1, raw_longitude: 1 + east / 111320, accuracy: 4, raw_speed_kmh: 0, speed_kmh: 0,
    speed_accuracy_mps: 0.4, motion_state: 'stationary', session_id: session, ...extra });
  for (const [kind, seconds, extra = {}] of script) {
    if (kind === 'session') { session = seconds; continue; }
    if (kind === 'none') east += extra.move ?? 0;
    for (let k = 0; k < seconds; k += 5, s += 5) {
      if (kind === 'walk') { east += 7; fix({ raw_speed_kmh: 5.04, speed_kmh: 5.04, motion_state: 'moving' }); }
      // drive: 50 km/h east; jiggle: standing still with a slow reading that is
      // no stillness (0.55 m/s ± 0.5): 「走路」 of 0 m.
      if (kind === 'drive') { east += 70; fix({ raw_speed_kmh: 50.4, speed_kmh: 50.4, motion_state: 'moving' }); }
      if (kind === 'jiggle') {
        const jitter = (k % 10 === 0 ? 2 : -2) / 111320;
        fix({ latitude: 1 + jitter, raw_latitude: 1 + jitter, accuracy: 8, raw_speed_kmh: 2, speed_kmh: 2,
          speed_accuracy_mps: 0.5, motion_state: 'moving' });
      }
      if (kind === 'still') fix({ motion_state: k >= 20 ? 'stationary' : 'suspected_stationary' });
      if (kind === 'coarse') fix({ accuracy: 28, motion_state: 'stationary' });
      if (kind === 'weak') {
        east += extra.drift ?? 0;
        const jitter = (k % 10 === 0 ? 3 : -3) / 111320;
        fix({ latitude: 1 + jitter, raw_latitude: 1 + jitter, raw_speed_kmh: 2, speed_kmh: 2,
          speed_accuracy_mps: 5, motion_state: 'moving' });
      }
    }
  }
  east += 7; fix({ raw_speed_kmh: 5.04, speed_kmh: 5.04, motion_state: 'moving' });
  return rows;
}
const timeline = rows => historyTimeline(rows, { subject: 'phone', dayStart: base, dayEnd: base + 86400000,
  manualRange: { start: rows[0].time, end: rows.at(-1).time } });
const minuteOf = ms => Math.floor(ms / MINUTE);
const minutesShown = row => Math.round(presentationDurationMs(row) / MINUTE);
const noted = row => Math.round(((row.terminalStay ?? row.departureStay ?? row).interruptionMs || 0) / MINUTE);

/** The list's own minute accounting: rows with a length tile the selected
 * range (no hole, no overlap), each row's minutes plus its 「不含中斷」 note
 * are its clock span (a folded short break is inside its minutes), and
 * the only rows of unobserved time are explicit 「沒有資料」／「GPS 訊號弱」. */
function accounting(model) {
  const shown = timelinePresentation(model.nodes);
  const rows = shown.filter(n => n.end > n.start);
  const first = model.points[0].time, last = model.points.at(-1).time;
  const holes = [], overlaps = [], off = [];
  if (rows[0].start !== first) holes.push({ start: first, end: rows[0].start });
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].start > rows[i - 1].end) holes.push({ start: rows[i - 1].end, end: rows[i].start });
    if (rows[i].start < rows[i - 1].end) overlaps.push({ start: rows[i].start, end: rows[i - 1].end });
  }
  if (rows.at(-1).end !== last) holes.push({ start: rows.at(-1).end, end: last });
  for (const row of rows) {
    const clock = minuteOf(row.end) - minuteOf(row.start);
    if (Math.abs(minutesShown(row) + noted(row) - clock) > (noted(row) ? 1 : 0)) off.push(row);
  }
  const total = rows.reduce((sum, row) => sum + minutesShown(row) + noted(row), 0);
  return { shown, rows, holes, overlaps, off, total, span: minuteOf(last) - minuteOf(first),
    interrupted: rows.filter(noted).length,
    unobserved: rows.filter(n => n.type === 'gap'),
    folded: rows.filter(n => (n.unlocatedMs ?? n.terminalStay?.unlocatedMs ?? n.departureStay?.unlocatedMs) > 0) };
}
const expectAccounted = model => {
  const a = accounting(model);
  expect(a.holes).toEqual([]);
  expect(a.overlaps).toEqual([]);
  expect(a.off).toEqual([]);
  expect(Math.abs(a.total - a.span)).toBeLessThanOrEqual(a.interrupted);
  for (const gap of a.unobserved) {
    expect([undefined, 'uncertain']).toContain(gap.reason);
    // Listed: a long break, or one across a recording restart.
    expect(gap.end - gap.start >= config.listGapMs || !gap.sameSession).toBe(true);
  }
  return a;
};

// One invented day with every shape that lost minutes on a real replay.
const wholeDay = [
  ['still', 600], ['walk', 300],
  ['weak', 40], ['walk', 300], // a short weak-GPS moment inside a walk
  ['still', 60], ['weak', 30], ['walk', 200], // a red light, then weak GPS
  ['still', 300], ['coarse', 900], ['walk', 300], // a stay, then 15 min coarse there
  ['coarse', 900], ['walk', 300], // 15 min standing still, only coarse fixes
  ['none', 600, { move: 400 }], ['walk', 300], // 10 min nothing saved, same recording
  ['weak', 400, { drift: 2 }], ['walk', 300], // a weak-GPS stretch on the move
  ['none', 300, { move: 300 }], ['session', 'fiction-session-2'], ['walk', 300], // recording restarted
  ['none', 1900, { move: 2000 }], ['walk', 300], // over 30 min nothing saved
];

test('every minute of an invented day belongs to exactly one listed row', () => {
  const a = expectAccounted(timeline(day(wholeDay)));
  expect(a.total).toBe(a.span);
  // Rows of their own: the recording restart and the break over 30 min.
  expect(a.unobserved.map(n => [n.sameSession === true, n.end - n.start >= config.listGapMs]))
    .toEqual([[false, false], [true, true]]);
  // The short breaks are inside the rows beside them, and say so.
  expect(a.folded.length).toBeGreaterThanOrEqual(2);
});

test.each([
  ['weak GPS inside a walk', [['walk', 300], ['weak', 40], ['walk', 300]]],
  ['red light then weak GPS', [['walk', 300], ['still', 40], ['weak', 30], ['walk', 300]]],
  ['weak GPS between a walk and a stay', [['walk', 300], ['weak', 60, { drift: 6 }], ['still', 400]]],
  ['coarse after a stay', [['walk', 300], ['still', 300], ['coarse', 900], ['walk', 300]]],
  ['coarse before a stay', [['walk', 300], ['coarse', 900], ['still', 300], ['walk', 300]]],
  ['coarse only', [['walk', 300], ['coarse', 900], ['walk', 300]]],
  ['coarse to the end', [['walk', 300], ['still', 300], ['coarse', 900]]],
  ['weak GPS stretch on the move', [['walk', 300], ['weak', 400, { drift: 2 }], ['walk', 300]]],
  ['short break between walks', [['walk', 300], ['none', 600, { move: 400 }], ['walk', 300]]],
  ['short break after a stay', [['walk', 300], ['still', 400], ['none', 600, { move: 400 }], ['walk', 300]]],
  ['long break', [['walk', 300], ['none', 1900, { move: 2000 }], ['walk', 300]]],
  ['recording restart', [['walk', 300], ['none', 300, { move: 300 }], ['session', 'fiction-session-2'], ['walk', 300]]],
  // 2026-10-13 sweep: a few still fixes between two recording restarts, a
  // 恢復記錄 followed by still fixes no stay took, weak GPS split by a moment
  // of walking, a 0 m walk between restarts, a 0 m walk before driving off,
  // parking after a drive.
  ['still fixes between restarts', [['walk', 300], ['none', 400], ['session', 'fiction-session-2'], ['still', 40],
    ['none', 200], ['session', 'fiction-session-3'], ['still', 70], ['none', 300], ['session', 'fiction-session-4'],
    ['walk', 300]]],
  ['恢復記錄 then still fixes, then a restart', [['still', 600], ['none', 2400, { move: 500 }], ['still', 100],
    ['none', 5], ['session', 'fiction-session-2'], ['none', 240], ['still', 40], ['session', 'fiction-session-3'],
    ['none', 240], ['still', 300], ['walk', 300]]],
  ['weak GPS split by a moment of walking', [['still', 300], ['none', 2400, { move: 500 }], ['weak', 200],
    ['jiggle', 5], ['weak', 100], ['jiggle', 5], ['weak', 120]]],
  ['a 0 m walk between restarts', [['still', 300], ['none', 400], ['session', 'fiction-session-2'], ['jiggle', 300],
    ['none', 400], ['session', 'fiction-session-3'], ['walk', 300]]],
  ['a 0 m walk before driving off', [['jiggle', 300], ['drive', 600], ['walk', 300]]],
  ['parked after a drive', [['walk', 300], ['drive', 600], ['still', 720], ['walk', 200]]],
])('%s: rows cover the range with no hole and no double count', (_name, script) => {
  expectAccounted(timeline(day(script)));
});

test('a merged walk counts the short weak-GPS time inside it; its distance stays the legs\' sum', () => {
  const model = timeline(day([['walk', 300], ['weak', 40], ['walk', 300]]));
  const source = model.nodes.filter(n => n.type === 'movement');
  expect(source).toHaveLength(2);
  expect(model.nodes.some(n => n.type === 'gap' && n.reason === 'uncertain' && n.sameSession)).toBe(true);
  const walks = accounting(model).rows.filter(n => n.type === 'movement');
  expect(walks).toHaveLength(1);
  expect(walks[0].durationMs).toBe(walks[0].end - walks[0].start);
  expect(walks[0].start).toBe(source[0].start);
  expect(walks[0].end).toBe(source[1].end);
  expect(walks[0].countedDistanceM).toBeCloseTo(source[0].countedDistanceM + source[1].countedDistanceM, 6);
  expect(walks[0].countedDistanceM).toBeCloseTo(model.distanceM, 6);
});

test('a short same-session break is no row: the walk around it silently carries its minutes', () => {
  const model = timeline(day([['walk', 300], ['none', 600, { move: 400 }], ['walk', 300]]));
  const gap = model.nodes.find(n => n.type === 'gap');
  expect(gap).toMatchObject({ sameSession: true });
  const { rows } = accounting(model);
  expect(rows.map(n => n.type)).toEqual(['movement']);
  expect(rows[0].unlocatedMs).toBe(gap.end - gap.start);
  // No note: the row reads like any walk (2026-10-13, user).
  expect(sectionText(rows[0]).rest).toBe(`・${distanceText(rows[0].countedDistanceM)}`);
  // The cursor in the break says the walk, not 「這段沒資料」.
  const inside = gap.start + 60000;
  for (const action of ['drag', 'shared']) {
    const cursor = screenCursor(model, inside, { subject: 'phone', action });
    expect(cursor.stale).toBe(false);
    expect(cursor.label[1]).not.toBe(t('c325', { time: cursor.label[0] }));
  }
  // No distance across the break: the summary and the row agree.
  expect(rows[0].countedDistanceM).toBeCloseTo(model.distanceM, 6);
  // The map keeps the break (its edge is still a gap).
  expect(model.edges.some(e => e.gap && e.start === gap.start)).toBe(true);
});

test('a weak-GPS stretch on the move is folded into the walk around it', () => {
  const model = timeline(day([['walk', 300], ['weak', 400, { drift: 2 }], ['walk', 300]]));
  const { rows } = accounting(model);
  expect(rows.map(n => n.type)).toEqual(['movement']);
  expect(sectionText(rows[0]).rest).not.toContain('未定位');
});

test('the stay is preferred over the walk; the cursor and the list say the same minutes', () => {
  const model = timeline(day([['walk', 300], ['still', 400], ['none', 600, { move: 400 }], ['walk', 300]]));
  const source = model.nodes.find(n => n.type === 'stop');
  const gap = model.nodes.find(n => n.type === 'gap');
  expect(gap.start).toBe(source.end);
  const { rows } = accounting(model);
  const stay = rows.find(n => n.type === 'stop');
  expect(stay).toMatchObject({ start: source.start, end: gap.end, number: source.number });
  expect(interruptionText(stay)).toBe('');
  const pill = nodePill(stay).text;
  expect(pill).toBe(t('c127', { duration: listDuration(presentationDurationMs(stay)) }));
  const label = cursorLabel(model, source.start + 60000, 'phone')[1];
  // Its number too, as its row (2026-10-14: the cursor names the row).
  expect(label).toBe(t('c1342', { number: stay.number, duration: listDuration(presentationDurationMs(stay)) }));
  // GPX keeps the stay's own observed span.
  const snapshot = buildExportSnapshot({ day: { subjects: [{ id: 'phone', model }] },
    range: { start: model.points[0].time, end: model.points.at(-1).time }, subject: 'phone' });
  expect(snapshot.subjects[0].stays[0]).toMatchObject({ start: source.start, end: source.end });
});

test('a recording restart beside a stay is a row and the cursor there still says 「這段沒資料」', () => {
  const model = timeline(day([['walk', 300], ['still', 400], ['none', 400], ['session', 'fiction-session-2'],
    ['still', 400], ['walk', 300]]));
  const { rows } = expectAccounted(model);
  const gap = rows.find(n => n.type === 'gap');
  expect(gap.sameSession).toBeUndefined();
  const cursor = screenCursor(model, gap.start + 60000, { subject: 'phone', action: 'shared' });
  expect(cursor.stale).toBe(true);
  expect(cursor.label[1]).toBe(t('c325', { time: cursor.label[0] }));
});

test('a break of 30 min or more stays its own 「沒有資料」 row', () => {
  const model = timeline(day([['walk', 300], ['none', 1900, { move: 2000 }], ['walk', 300]]));
  const { rows } = accounting(model);
  expect(rows.map(n => n.type)).toEqual(['movement', 'gap', 'movement']);
  expect(sectionText(rows[1]).lead).toBe(t('c089'));
  expect(rows[0].unlocatedMs).toBeUndefined();
});

test('a recording restart stays its own 「沒有資料」 row however short', () => {
  const model = timeline(day([['walk', 300], ['none', 300, { move: 300 }], ['session', 'fiction-session-2'], ['walk', 300]]));
  const { rows } = accounting(model);
  expect(rows.map(n => n.type)).toEqual(['movement', 'gap', 'movement']);
  expect(rows[1].sameSession).toBeUndefined();
  expect(rows[1].end - rows[1].start).toBeLessThan(config.listGapMs);
});

test('coarse stationary time after a stay is that stay\'s minutes: same number, same coordinate', () => {
  const fineOnly = timeline(day([['walk', 300], ['still', 300], ['walk', 300]]));
  const model = timeline(day([['walk', 300], ['still', 300], ['coarse', 900], ['walk', 300]]));
  const stays = model.nodes.filter(n => n.type === 'stop');
  expect(stays).toHaveLength(1);
  const [stay] = stays;
  expect(stay.number).toBe(1);
  expect(stay.presentationOnly).toBeUndefined();
  const before = fineOnly.nodes.find(n => n.type === 'stop');
  expect({ latitude: stay.latitude, longitude: stay.longitude })
    .toEqual({ latitude: before.latitude, longitude: before.longitude });
  expect(stay.end - stay.start).toBeGreaterThan(19 * MINUTE);
  expect(nodePill(accounting(model).rows.find(n => n.type === 'stop')).text)
    .toBe(t('c127', { duration: listDuration(20 * MINUTE) }));
  // The cursor and the map read the same stay.
  expect(model.locations.find(n => n.type === 'stop')).toBe(stay);
  // Distance does not change: coarse still fixes add none.
  expect(model.distanceM).toBeCloseTo(fineOnly.distanceM, 6);
});

test('coarse stationary time with no stay beside it is an unnumbered stay; numbered stays keep their numbers', () => {
  const model = timeline(day([['walk', 300], ['still', 300], ['walk', 300], ['coarse', 900], ['walk', 300],
    ['still', 300], ['walk', 300]]));
  const stays = model.nodes.filter(n => n.type === 'stop');
  expect(stays.map(n => n.number)).toEqual([1, null, 2]);
  expect(stays[1]).toMatchObject({ presentationOnly: 'phone-stationary', coarse: true });
  expect(stays[1].end - stays[1].start).toBeGreaterThanOrEqual(14 * MINUTE);
  expect(model.locations.filter(n => n.type === 'stop').map(n => n.number)).toEqual([1, 2]);
  expectAccounted(model);
});

test('coarse time never joins two numbered stays', () => {
  const model = timeline(day([['walk', 300], ['still', 300], ['coarse', 900], ['still', 300], ['walk', 300]]));
  // The fine visit on either side already is one stay (the coarse fixes are not judged).
  expect(model.nodes.filter(n => n.type === 'stop').map(n => n.number)).toEqual([1]);
  expectAccounted(model);
});

test('CSV rows and GPX track points are the raw rows, whatever the list folds', () => {
  const rows = day(wholeDay);
  const model = timeline(rows);
  const snapshot = buildExportSnapshot({ day: { subjects: [{ id: 'phone', model }] },
    range: { start: rows[0].time, end: rows.at(-1).time }, subject: 'phone', look: { phone: { color: '#1A73E8' } } });
  const csv = buildCSV(snapshot).trim().split('\r\n');
  expect(csv).toHaveLength(rows.length + 1);
  const gpx = buildGPX(snapshot);
  expect((gpx.match(/<trkpt /g) || []).length).toBe(rows.length);
  // Every break, folded in the list or not, still splits the GPX track.
  expect(snapshot.subjects[0].gaps.length).toBeGreaterThanOrEqual(model.nodes.filter(n => n.type === 'gap').length);
  // The display-only coarse stay is not a GPX stay waypoint; every waypoint
  // has a name (a stay shown inside 出發 or the end has no number, #154).
  expect(snapshot.subjects[0].stays).toHaveLength(model.nodes.filter(n => n.type === 'stop' && !n.presentationOnly).length);
  expect(gpx).not.toMatch(/null|undefined/);
});

// ---- 2026-10-13: the shapes the device sweep found -------------------------

test('a few still fixes between two recording restarts are a stay of their own, or under a minute the break\'s', () => {
  const model = timeline(day([['walk', 300], ['none', 400], ['session', 'fiction-session-2'], ['still', 40],
    ['none', 200], ['session', 'fiction-session-3'], ['still', 70], ['none', 300], ['session', 'fiction-session-4'],
    ['walk', 300]]));
  const { rows } = expectAccounted(model);
  // 40 s between two restarts: one 「沒有資料」 over both; 70 s: 「停 1 分」.
  expect(rows.map(n => n.type)).toEqual(['movement', 'gap', 'stop', 'gap', 'movement']);
  expect(rows[1]).toMatchObject({ sessionChange: true });
  expect(rows[2]).toMatchObject({ presentationOnly: 'between-breaks', number: null });
  expect(nodePill(rows[2]).text).toBe(t('c127', { duration: listDuration(MINUTE) }));
  // The model (map, GPX) keeps every break.
  expect(model.nodes.filter(n => n.type === 'gap')).toHaveLength(3);
});

test('a 恢復記錄 followed by still fixes is that stay\'s start, not a point with minutes after it in no row', () => {
  const model = timeline(day([['still', 600], ['none', 2400, { move: 500 }], ['still', 100], ['none', 5],
    ['session', 'fiction-session-2'], ['none', 240], ['still', 300], ['walk', 300]]));
  const { shown, rows } = expectAccounted(model);
  const after = rows.find(n => n.type === 'gap' && n.end - n.start > config.resumeAfterMs);
  const next = rows[rows.indexOf(after) + 1];
  expect(next).toMatchObject({ type: 'stop', start: after.end, number: null });
  expect(shown.some(n => n.type === 'resume' && n.start === after.end)).toBe(false);
});

test('weak GPS split by a moment of 0 m walking is one 「GPS 訊號弱」 row', () => {
  const model = timeline(day([['still', 300], ['none', 2400, { move: 500 }], ['weak', 200], ['jiggle', 5],
    ['weak', 100], ['jiggle', 5], ['weak', 120]]));
  const { rows } = expectAccounted(model);
  // (Here the walk at the end takes the short weak-GPS time, #132; with only
  // the 恢復記錄 and the end beside them they are one listed row.)
  expect(rows.filter(n => n.type === 'gap' && n.reason === 'uncertain').length).toBeLessThanOrEqual(1);
  const alone = timelinePresentation([
    { type: 'resume', start: 0, end: 0 },
    { type: 'gap', mode: 'gap', reason: 'uncertain', sameSession: true, start: 0, end: 200000 },
    { type: 'gap', mode: 'gap', reason: 'uncertain', sameSession: true, start: 205000, end: 300000 },
    { type: 'end', start: 300000, end: 300000, label: t('c330') }]);
  expect(alone.map(n => n.type)).toEqual(['resume', 'gap', 'end']);
  expect(alone[1]).toMatchObject({ start: 0, end: 300000, reason: 'uncertain' });
});

test('a 0 m 「走路」 with no stay beside it is a stay', () => {
  const model = timeline(day([['still', 300], ['none', 400], ['session', 'fiction-session-2'], ['jiggle', 300],
    ['none', 400], ['session', 'fiction-session-3'], ['walk', 300]]));
  const { rows } = expectAccounted(model);
  expect(rows.some(n => n.type === 'movement' && Math.round(n.countedDistanceM) === 0)).toBe(false);
  // 2026-10-14: five minutes of it are a stay of their own (the phone has no
  // 3× baseline); it was an unnumbered presentation stay before.
  const jiggle = rows.filter(n => n.type === 'stop' && n.start > model.points[0].time + 600000
    && n.end < model.points.at(-1).time - 600000);
  expect(jiggle).toHaveLength(1);
  // The first stay is the range's first row (2026-10-14: no 出發 before a stay).
  expect(rows[0]).toMatchObject({ type: 'stop', start: model.points[0].time });
  expect(rows.some(n => n.type === 'departure')).toBe(false);
  // Before driving off: the stay is the first row (no 出發), no switch point beside it.
  const off = timeline(day([['jiggle', 300], ['drive', 600], ['walk', 300]]));
  const listed = expectAccounted(off).shown;
  expect(listed[0]).toMatchObject({ type: 'stop', start: off.points[0].time });
  expect(listed.some(n => n.type === 'departure' || n.departureStay)).toBe(false);
  expect(listed[1]).toMatchObject({ type: 'movement', mode: 'driving' });
  // A recorder without speed or motion columns keeps its row (geometry
  // alone): HistoryReviewRules 「a long slow stretch before the car」.
});

test('a drive does not go on over the time after parking: the parked minutes are a stay', () => {
  const model = timeline(day([['walk', 300], ['drive', 600], ['still', 720], ['walk', 200]]));
  const { rows } = expectAccounted(model);
  const drive = rows.find(n => n.mode === 'driving');
  expect(drive.end - drive.start).toBeLessThan(11 * MINUTE);
  const parked = rows[rows.indexOf(drive) + 1];
  // 2026-10-14: parked a stay's length before walking off, the drive ends
  // where it parked: a stay of its own, numbered like any other (it was an
  // unnumbered display stay cut from the drive's tail).
  expect(parked).toMatchObject({ type: 'stop', number: 2 });
  expect(parked.presentationOnly).toBeUndefined();
  expect(parked.end - parked.start).toBeGreaterThanOrEqual(11 * MINUTE);
  // The drive keeps its metres; the map's drive ends where it parked.
  expect(drive.distanceM).toBeGreaterThan(8000);
  expect(model.sections.find(n => n.mode === 'driving').end).toBeLessThanOrEqual(parked.start);
  // A red light the drive went on from stays in the drive.
  const light = timeline(day([['walk', 300], ['drive', 300], ['still', 200], ['drive', 300], ['walk', 200]]));
  expect(expectAccounted(light).rows.filter(n => n.mode === 'driving')).toHaveLength(1);
});

test('a stay\'s 0 m tail before a recording restart is the stay\'s, even with the phone in hand', () => {
  const rows = day([['walk', 300], ['still', 900], ['jiggle', 60], ['session', 'fiction-session-2'], ['none', 400],
    ['still', 600], ['walk', 300]]);
  // Picking the phone up to restart the recorder reads as movement.
  const tail = new Set(rows.filter(r => r.accuracy === 8).map(r => r.time));
  const handled = rows.map(r => (tail.has(r.time) ? { ...r, raw_speed_kmh: 4, speed_kmh: 4, speed_accuracy_mps: 0.3 } : r));
  for (const input of [rows, handled]) {
    const { rows: listed } = expectAccounted(timeline(input));
    expect(listed.map(n => n.type)).toEqual(['movement', 'stop', 'gap', 'stop', 'movement']);
  }
});

// A dog: fixes every 10 s; holds (室內) replayed as given; packets without a
// fix while it walks on (收不到 GPS).
function dogDay(script) {
  const out = [];
  let s = 0, north = 0, held = null;
  for (const [kind, seconds] of script) {
    if (kind !== 'held') held = null;
    for (let k = 0; k < seconds; k += 10, s += 10) {
      if (kind === 'walk') { north += 10; out.push(point(s, north)); }
      if (kind === 'still') out.push(point(s, north + (k % 20 ? 2 : -2)));
      if (kind === 'held') { held ??= s * 1000; out.push(point(s, north, { heldReason: 'indoor', heldSince: held, locationTime: null })); }
      if (kind === 'nofix') { north += 10; out.push({ time: s * 1000, latitude: null, longitude: null }); }
    }
  }
  return out;
}
const dogTimeline = rows => historyTimeline(rows, { subject: 'dog', replayHolds: packets => packets,
  manualRange: { start: rows[0].time, end: rows.at(-1).time } });

test.each([
  ['walk into a hold and out', [['walk', 300], ['held', 1800], ['walk', 120], ['still', 600], ['walk', 300]]],
  ['two holds one after the other', [['walk', 300], ['held', 1200], ['walk', 60], ['held', 900], ['walk', 300]]],
  ['a stay then a hold', [['walk', 300], ['still', 600], ['held', 1200], ['walk', 300]]],
  ['收不到 GPS on the move', [['walk', 300], ['nofix', 400], ['walk', 300], ['still', 600], ['walk', 200]]],
])('dog: %s — every minute of the range is in one row', (_name, script) => {
  const model = dogTimeline(dogDay(script));
  const shown = timelinePresentation(model.nodes).filter(n => n.end > n.start);
  const first = model.points[0].time, last = model.points.at(-1).time;
  expect(shown[0].start).toBe(first);
  expect(shown.at(-1).end).toBe(last);
  for (let i = 1; i < shown.length; i++) expect(shown[i].start).toBe(shown[i - 1].end);
  const minutes = shown.reduce((sum, n) => sum + minutesShown(n) + noted(n), 0);
  expect(Math.abs(minutes - (minuteOf(last) - minuteOf(first)))).toBeLessThanOrEqual(shown.filter(noted).length);
});
