import { historyTimeline } from '../src/history/HistoryTimeline';
import { timelinePresentation, presentationDurationMs } from '../src/history/HistoryTimelinePresentation';
import { listDuration, nodePill, sectionText } from '../src/history/HistoryText';
import { buildExportSnapshot } from '../src/mapHistory/ExportSnapshot';
import { buildCSV } from '../src/mapHistory/ExportCSV';
import { buildGPX } from '../src/mapHistory/ExportGPX';
import { t } from '../src/i18n';

// Invented phone day (five-second fixes, one recording session, no real
// place or time). A script is a list of [kind, seconds, extra]:
// walk 5 km/h east; still (fine, 4 m); coarse (still, 28 m: over the 25 m
// stay gate, within the 30 m stationary detector and the 50 m filter);
// weak (speed 2 km/h with a 5 m/s spread: no reliable speed, so uncertain);
// none (nothing saved: a real recording gap).
const base = 1600000000000;
const MINUTE = 60000;
function day(script) {
  const rows = [];
  let s = 0, east = 0;
  const fix = (extra = {}) => rows.push({ time: base + s * 1000, latitude: 1, longitude: 1 + east / 111320,
    raw_latitude: 1, raw_longitude: 1 + east / 111320, accuracy: 4, raw_speed_kmh: 0, speed_kmh: 0,
    speed_accuracy_mps: 0.4, motion_state: 'stationary', session_id: 'fiction-session', ...extra });
  for (const [kind, seconds, extra = {}] of script) {
    for (let k = 0; k < seconds; k += 5, s += 5) {
      if (kind === 'walk') { east += 7; fix({ raw_speed_kmh: 5.04, speed_kmh: 5.04, motion_state: 'moving', ...extra }); }
      if (kind === 'still') fix({ motion_state: k >= 20 ? 'stationary' : 'suspected_stationary', ...extra });
      if (kind === 'coarse') fix({ accuracy: 28, motion_state: 'stationary', ...extra });
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
 * are its clock span, and the only rows of unobserved time are explicit
 * 「沒有資料」 (or a listed 「GPS 訊號弱」) rows. */
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
    unobserved: rows.filter(n => n.type === 'gap') };
}
const expectAccounted = model => {
  const a = accounting(model);
  expect(a.holes).toEqual([]);
  expect(a.overlaps).toEqual([]);
  expect(a.off).toEqual([]);
  expect(Math.abs(a.total - a.span)).toBeLessThanOrEqual(a.interrupted);
  for (const gap of a.unobserved) expect([undefined, 'uncertain']).toContain(gap.reason);
  return a;
};

// One invented day with every shape that lost minutes on a real replay.
const wholeDay = [
  ['still', 600], ['walk', 300],
  ['weak', 40], ['walk', 300], // a short weak-GPS moment inside a walk
  ['still', 60], ['weak', 30], ['walk', 200], // a red light, then weak GPS
  ['still', 300], ['coarse', 900], ['walk', 300], // a stay, then 15 min coarse there
  ['coarse', 900], ['walk', 300], // 15 min standing still, only coarse fixes
  ['none', 600], ['walk', 300], // a real recording gap
  ['weak', 400, { drift: 2 }], ['walk', 300], // a long weak-GPS stretch on the move
];

test('every minute of an invented day belongs to exactly one listed row', () => {
  const a = expectAccounted(timeline(day(wholeDay)));
  expect(a.total).toBe(a.span);
  // The real gap is still its own 「沒有資料」 row.
  expect(a.unobserved.some(n => n.reason === undefined && n.end - n.start >= 10 * MINUTE - 5000)).toBe(true);
});

test.each([
  ['weak GPS inside a walk', [['walk', 300], ['weak', 40], ['walk', 300]]],
  ['red light then weak GPS', [['walk', 300], ['still', 40], ['weak', 30], ['walk', 300]]],
  ['weak GPS between a walk and a stay', [['walk', 300], ['weak', 60, { drift: 6 }], ['still', 400]]],
  ['coarse after a stay', [['walk', 300], ['still', 300], ['coarse', 900], ['walk', 300]]],
  ['coarse before a stay', [['walk', 300], ['coarse', 900], ['still', 300], ['walk', 300]]],
  ['coarse only', [['walk', 300], ['coarse', 900], ['walk', 300]]],
  ['coarse to the end', [['walk', 300], ['still', 300], ['coarse', 900]]],
  ['long weak GPS on the move', [['walk', 300], ['weak', 400, { drift: 2 }], ['walk', 300]]],
  ['recording gap', [['walk', 300], ['none', 600], ['walk', 300]]],
])('%s: rows cover the range with no hole and no double count', (_name, script) => {
  expectAccounted(timeline(day(script)));
});

test('a merged walk counts the short weak-GPS time inside it; its distance stays the legs\' sum', () => {
  const model = timeline(day([['walk', 300], ['weak', 40], ['walk', 300]]));
  const source = model.nodes.filter(n => n.type === 'movement');
  expect(source).toHaveLength(2);
  expect(model.nodes.some(n => n.type === 'gap' && n.reason === 'uncertain')).toBe(true);
  const walks = accounting(model).rows.filter(n => n.type === 'movement');
  expect(walks).toHaveLength(1);
  expect(walks[0].durationMs).toBe(walks[0].end - walks[0].start);
  expect(walks[0].start).toBe(source[0].start);
  expect(walks[0].end).toBe(source[1].end);
  expect(walks[0].countedDistanceM).toBeCloseTo(source[0].countedDistanceM + source[1].countedDistanceM, 6);
  expect(walks[0].countedDistanceM).toBeCloseTo(model.distanceM, 6);
});

test('a weak-GPS stretch of a gap\'s length is its own row, not walking minutes', () => {
  const model = timeline(day([['walk', 300], ['weak', 400, { drift: 2 }], ['walk', 300]]));
  const { rows } = accounting(model);
  const weak = rows.find(n => n.type === 'gap');
  expect(weak).toMatchObject({ reason: 'uncertain' });
  expect(weak.end - weak.start).toBeGreaterThanOrEqual(3 * MINUTE);
  expect(sectionText(weak).lead).toBe(t('c883'));
  expect(rows.filter(n => n.type === 'movement')).toHaveLength(2);
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
  // The display-only coarse stay is not a GPX stay waypoint.
  expect(snapshot.subjects[0].stays.every(s => s.number != null)).toBe(true);
});
