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
  expect(label).toBe(t('c136', { duration: listDuration(presentationDurationMs(stay)) }));
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
  // The display-only coarse stay is not a GPX stay waypoint.
  expect(snapshot.subjects[0].stays.every(s => s.number != null)).toBe(true);
});
