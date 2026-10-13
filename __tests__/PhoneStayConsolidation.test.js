import { historyTimeline } from '../src/history/HistoryTimeline';
import { configFor, samePlaceGap } from '../src/history/HistoryConfig';
import { timelinePresentation, presentationDurationMs, shownStayDurationMs } from '../src/history/HistoryTimelinePresentation';
import { listDuration, nodePill, sectionText } from '../src/history/HistoryText';
import { cursorLabel } from '../src/history/screen/HistoryScreenCursor';
import { buildExportSnapshot } from '../src/mapHistory/ExportSnapshot';
import { buildCSV } from '../src/mapHistory/ExportCSV';
import { buildGPX } from '../src/mapHistory/ExportGPX';
import { createTodayRouteEngine } from '../src/tracking/TodayRouteEngine';
import { todayRouteDistance } from '../src/tracking/TodayDistance';
import { t } from '../src/i18n';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createHistoryDatabase } from '../src/mapHistory/HistoryDatabase';

// 2026-10-13 (user): stays of my route the list cut into pieces. Invented
// phone rows only (five-second fixes, metres east of an arbitrary origin; no
// real place, time or route). A script is a list of [kind, seconds, extra]:
// still — measured standing still (0 km/h ± 0.4 m/s, 5 m accuracy);
// drift — no measured speed at all, `at` metres east (indoors the position
// wanders while the phone stays put); walk — 4 km/h, `step` metres east per
// fix (negative: west); none — nothing saved; session — the recorder
// restarted (a new session id from then on).
const MINUTE = 60000;
const dayStart = new Date(2026, 0, 12).getTime();
const dayEnd = new Date(2026, 0, 13).getTime();
const config = configFor('phone');
const METRE = 1 / 111320;

function rows(script, { from = dayStart + 9 * 3600000, session = 'fiction-session-1', accuracy = 5 } = {}) {
  const out = [];
  let time = from, east = 0;
  const fix = extra => out.push({ id: out.length + 1, time, latitude: 1, longitude: 1 + east * METRE,
    raw_latitude: 1, raw_longitude: 1 + east * METRE, accuracy, raw_speed_kmh: 0, speed_kmh: 0,
    speed_accuracy_mps: 0.4, motion_state: 'stationary', session_id: session, ...extra });
  for (const [kind, seconds, extra = {}] of script) {
    if (kind === 'session') { session = seconds; continue; }
    if (kind === 'none') { time += seconds * 1000; east += extra.move ?? 0; continue; }
    if (kind === 'goto') { east = seconds; continue; }
    for (let k = 0; k < seconds; k += 5, time += 5000) {
      if (kind === 'still') fix({ ...(extra.accuracy ? { accuracy: extra.accuracy } : {}) });
      if (kind === 'drift') {
        const at = typeof extra.at === 'function' ? extra.at(k) : extra.at ?? 0;
        const saved = east;
        east += at;
        fix({ raw_speed_kmh: null, speed_kmh: null, speed_accuracy_mps: null, motion_state: 'unknown',
          accuracy: extra.accuracy ?? 12 });
        east = saved;
      }
      if (kind === 'walk') {
        east += extra.step ?? 5.5;
        fix({ raw_speed_kmh: 4, speed_kmh: 4, speed_accuracy_mps: 0.3, motion_state: 'moving',
          ...(extra.accuracy ? { accuracy: extra.accuracy } : {}) });
      }
    }
  }
  return out;
}
const timeline = (input, options = {}) => historyTimeline(input, { subject: 'phone', dayStart, dayEnd,
  range: { start: input.find(r => r.time >= dayStart).time, end: input.filter(r => r.time < dayEnd).at(-1).time },
  ...options });
const listed = model => timelinePresentation(model.nodes);
const stays = model => model.nodes.filter(n => n.type === 'stop' && !n.presentationOnly);
const shownTypes = model => listed(model).map(n => n.departureStay ? 'departure+stay'
  : n.terminalStay ? 'end+stay' : n.type);
const rowSum = model => model.sections.reduce((sum, n) => sum + n.countedDistanceM, 0);

// Rows with a length tile [from, to]: no hole, no overlap (the #132 rule).
function expectTiled(model, from, to) {
  const shown = listed(model).filter(n => n.end > n.start);
  expect(shown[0].start).toBe(from);
  expect(shown.at(-1).end).toBe(to);
  for (let i = 1; i < shown.length; i++) expect(shown[i].start).toBe(shown[i - 1].end);
}

describe('1. drift without a measured speed is no departure', () => {
  // 40 min at home, 7 min of speedless fixes wandering 30–60 m east (long
  // enough for the detector to let go of its lock), 40 min at home again,
  // then a walk away.
  const script = [['still', 2400], ['drift', 420, { at: k => 30 + (k % 30) }], ['still', 2400],
    ['walk', 300]];

  test('the stay is one numbered stay; the speedless minutes are its time', () => {
    const model = timeline(rows(script));
    expect(stays(model).map(n => n.number)).toEqual([1]);
    expect(shownTypes(model)).toEqual(['departure+stay', 'movement', 'end']);
    expectTiled(model, model.points[0].time, model.points.at(-1).time);
  });

  test('a measured walking speed still leaves the stay (60 m off on foot and back)', () => {
    const walked = [['still', 2400], ['walk', 55, { step: 5.5 }], ['walk', 60, { step: 0 }], ['walk', 55, { step: -5.5 }],
      ['still', 2400], ['walk', 300]];
    expect(stays(timeline(rows(walked)))).toHaveLength(2);
  });

  test('samePlaceGap: speedless ends within stillPlaceM are one place, never across a session change', () => {
    const at = (east, extra = {}) => ({ time: 0, latitude: 1, longitude: 1 + east * METRE, raw_latitude: 1,
      raw_longitude: 1 + east * METRE, accuracy: 10, raw_speed_kmh: null, speed_kmh: null,
      speed_accuracy_mps: null, phoneMotionState: 'unknown', session_id: 'fiction-session-1', ...extra });
    const still = { raw_speed_kmh: 0, speed_kmh: 0, speed_accuracy_mps: 0.4, phoneMotionState: 'stationary' };
    const later = p => ({ ...p, time: 20 * MINUTE });
    expect(samePlaceGap(at(0, still), later(at(80)), config)).toBe(true);
    expect(samePlaceGap(at(0), later(at(80)), config)).toBe(true);
    expect(samePlaceGap(at(0), later(at(120)), config)).toBe(false);
    // A measured walk, confirmed movement or a new recording session: no.
    expect(samePlaceGap(at(0), later(at(80, { raw_speed_kmh: 4, speed_accuracy_mps: 0.3 })), config)).toBe(false);
    expect(samePlaceGap(at(0), later(at(80, { phoneConfirmedMovement: true })), config)).toBe(false);
    expect(samePlaceGap(at(0), later(at(80, { session_id: 'fiction-session-2' })), config)).toBe(false);
    // Older rows without speed columns are judged by geometry alone, as before.
    const legacy = p => { const { raw_speed_kmh: _a, speed_kmh: _b, speed_accuracy_mps: _c, ...rest } = p; return rest; };
    expect(samePlaceGap(legacy(at(0)), later(legacy(at(80))), config)).toBe(false);
  });

  test('a break whose speedless ends lie 60 m apart at one place is no 「沒有資料」 row', () => {
    const model = timeline(rows([['still', 2400], ['none', 900, { move: 60 }], ['drift', 120], ['still', 2400],
      ['walk', 300]]));
    expect(stays(model)).toHaveLength(1);
    expect(listed(model).some(n => n.type === 'gap')).toBe(false);
  });

  test('the same break across a recording restart stays two stays and a 「沒有資料」 row (#135)', () => {
    const model = timeline(rows([['still', 2400], ['none', 900, { move: 60 }], ['session', 'fiction-session-2'],
      ['drift', 120], ['still', 2400], ['walk', 300]]));
    expect(stays(model)).toHaveLength(2);
    const gap = listed(model).find(n => n.type === 'gap');
    expect(gap).toMatchObject({ sessionChange: true });
  });
});

describe('2. drift inside a stay is no walk', () => {
  test('a 0 m walk right after a stay is that stay: no 「走路 N 分・0 m」 row', () => {
    // Just after midnight: the stay from the evening before goes on, the
    // recorder saves nothing for 100 s (the detector lets go of the lock), a
    // minute of zero-speed fixes while it locks again, then a recording
    // restart, a stay, and the walk out.
    const input = rows([['still', 1020], ['none', 100], ['still', 20, { accuracy: 30 }], ['still', 60], ['none', 300],
      ['session', 'fiction-session-2'], ['still', 2400], ['walk', 300]], { from: dayStart - 10 * MINUTE });
    const model = timeline(input);
    expect(shownTypes(model)).toEqual(['departure+stay', 'gap', 'stop', 'movement', 'end']);
    expect(listed(model)[1]).toMatchObject({ sessionChange: true });
    expect(rowSum(model)).toBeCloseTo(model.distanceM, 6);
    expectTiled(model, model.points[0].time, model.points.at(-1).time);
  });

  test('moves deep inside a stay never land on a walk hours earlier', () => {
    // Walk in, a stay of 2 h with a few metres measured at the end of it,
    // a recording restart, another stay, and the walk out.
    const input = rows([['walk', 300], ['still', 3600], ['walk', 10, { step: 6 }], ['walk', 10, { step: -6 }],
      ['still', 3600], ['walk', 300]]);
    const model = timeline(input);
    const walks = model.sections.filter(n => n.type === 'movement');
    expect(rowSum(model)).toBeCloseTo(model.distanceM, 6);
    // The walk in keeps only its own metres (about 300 s at 4 km/h).
    expect(walks[0].countedDistanceM).toBeLessThan(340);
  });

  test('the drift across a same-place break never counts once the walk goes on', () => {
    // Back after 15 min with one speedless fix 60 m off (now one place with
    // the stay, samePlaceGap), then straight on foot: the run goes on from
    // where the phone reappeared, not from the stay's last fix.
    const day = off => rows([['still', 2400], ['none', 900, { move: off }], ['drift', 5], ['walk', 300]]);
    const drifted = timeline(day(60)), control = timeline(day(0));
    expect(drifted.distanceM).toBeGreaterThan(250);
    expect(Math.abs(drifted.distanceM - control.distanceM)).toBeLessThan(6);
    expect(rowSum(drifted)).toBeCloseTo(drifted.distanceM, 6);
    const input = day(60), now = input.at(-1).time;
    const engine = createTodayRouteEngine({ dayStart });
    engine.add(input);
    expect(engine.sum(now).metres).toBeCloseTo(todayRouteDistance(input, { now, dayStart }).metres, 6);
  });

  test('a measured walk is still counted in full', () => {
    const model = timeline(rows([['still', 1800], ['walk', 300], ['still', 1800]]));
    expect(model.distanceM).toBeGreaterThan(300);
    expect(rowSum(model)).toBeCloseTo(model.distanceM, 6);
  });
});

describe('3. the hours around midnight are rows too', () => {
  const lastBefore = (east, extra = {}) => rows([['still', 30]], { from: dayStart - 2 * 3600000, ...extra })
    .map(r => ({ ...r, longitude: 1 + east * METRE, raw_longitude: 1 + east * METRE }));

  test('a recording restart before the first fix: 「沒有資料 00:00–first」, its own row', () => {
    const today = rows([['still', 2400], ['walk', 300]], { from: dayStart + 40 * MINUTE, session: 'fiction-session-2' });
    const model = timeline([...lastBefore(0), ...today]);
    const shown = listed(model);
    expect(shown[0]).toMatchObject({ type: 'gap', start: dayStart, end: today[0].time, sessionChange: true });
    expect(sectionText(shown[0]).rest).toBe(' 00:00–00:40');
    expect(shown[1].departureStay).toBeTruthy();
    expectTiled(model, dayStart, model.points.at(-1).time);
  });

  test('a short break of one recording before the first fix is folded into the first row (#132)', () => {
    const today = rows([['still', 2400], ['walk', 300]], { from: dayStart + 10 * MINUTE });
    // 200 m away: not the same place, so no stay spans midnight.
    const model = timeline([...rows([['walk', 30]], { from: dayStart - 15 * MINUTE })
      .map(r => ({ ...r, longitude: r.longitude + 200 * METRE, raw_longitude: r.raw_longitude + 200 * METRE })), ...today]);
    const shown = listed(model);
    expect(shown.some(n => n.type === 'gap')).toBe(false);
    expect(shown[0]).toMatchObject({ type: 'departure', start: dayStart });
    expect(shown[0].departureStay).toBeTruthy();
    expectTiled(model, dayStart, model.points.at(-1).time);
  });

  test('a past day ending with a long break: 「沒有資料 last–24:00」 after the end row', () => {
    const day = rows([['walk', 300], ['still', 2400]], { from: dayEnd - 3 * 3600000 });
    const next = rows([['still', 30]], { from: dayEnd + 6 * 3600000, session: 'fiction-session-2' });
    const model = timeline([...day, ...next]);
    const shown = listed(model);
    expect(shown.at(-1)).toMatchObject({ type: 'gap', start: day.at(-1).time, end: dayEnd, sessionChange: true });
    expect(sectionText(shown.at(-1)).rest).toBe(` ${sectionText(shown.at(-1)).rest.slice(1, 6)}–24:00`);
    expect(shown.at(-2).terminalStay).toBeTruthy();
    expectTiled(model, model.points[0].time, dayEnd);
  });

  test('no row of no data without a fix on the other side, nor while today goes on', () => {
    const day = rows([['walk', 300], ['still', 2400]], { from: dayEnd - 3 * 3600000 });
    expect(listed(timeline(day)).some(n => n.type === 'gap')).toBe(false);
    const today = rows([['still', 2400], ['walk', 300]], { from: dayStart + 40 * MINUTE });
    const model = timeline([...lastBefore(500), ...today], { today: true, now: today.at(-1).time, following: true,
      range: undefined });
    expect(listed(model).filter(n => n.dayBoundary === 'end')).toHaveLength(0);
  });

  test('the day read brings the fix before the day and, once, the first one after it, however far', async () => {
    const connection = createMemoryConnection();
    try {
      connection.sqlite.exec('CREATE TABLE myLocationTracker(id INTEGER PRIMARY KEY, recorded_at INTEGER, latitude REAL, longitude REAL, accuracy_meters REAL)');
      const insert = connection.sqlite.prepare('INSERT INTO myLocationTracker(id,recorded_at,latitude,longitude,accuracy_meters) VALUES(?,?,1,1,5)');
      insert.run(1, dayStart - 5 * 3600000); // the evening before, long before the context window
      insert.run(2, dayStart + 9 * 3600000);
      insert.run(3, dayEnd + 6 * 3600000); // the next morning
      insert.run(4, dayEnd + 7 * 3600000);
      const history = createHistoryDatabase(connection);
      const first = await history.historyDayRows({ subject: 'phone', start: dayStart, end: dayEnd });
      expect(first.rows.map(row => row.id)).toEqual([1, 2, 3]);
      // Polling adds only new rows: the neighbours come once.
      insert.run(5, dayStart + 10 * 3600000);
      const next = await history.historyDayRows({ subject: 'phone', start: dayStart, end: dayEnd, after: first.after });
      expect(next.rows.map(row => row.id)).toEqual([5]);
    } finally { connection.close(); }
  });

  test('CSV and GPX keep exactly the day\'s rows', () => {
    const today = rows([['still', 2400], ['walk', 300]], { from: dayStart + 40 * MINUTE, session: 'fiction-session-2' });
    const model = timeline([...lastBefore(0), ...today]);
    const snapshot = buildExportSnapshot({ day: { subjects: [{ id: 'phone', model }] },
      range: { start: model.points[0].time, end: model.points.at(-1).time }, subject: 'phone' });
    expect(buildCSV(snapshot).trim().split('\r\n')).toHaveLength(today.length + 1);
    expect((buildGPX(snapshot).match(/<trkpt /g) || []).length).toBe(today.length);
  });
});

describe('4. a still-here stay is in the list too', () => {
  test('a range wholly inside a long stay: 出發 carries the stay, as the map label says', () => {
    const input = rows([['still', 2400]]);
    const now = input.at(-1).time;
    const model = historyTimeline(input, { subject: 'phone', dayStart, dayEnd, today: true, now });
    expect(model.displayStays).toHaveLength(1);
    const [first] = listed(model);
    expect(first.departureStay).toBeTruthy();
    const minutes = listDuration(presentationDurationMs(first.departureStay));
    expect(nodePill(first).text).toContain(minutes);
    // The map's stay label and the cursor read the same minutes.
    expect(listDuration(shownStayDurationMs(model.nodes, model.displayStays[0]))).toBe(minutes);
    expect(cursorLabel(model, input[100].time, 'phone')[1]).toBe(t('c136', { duration: minutes }));
    // Still no numbered stay, and no GPX stay waypoint.
    expect(stays(model)).toHaveLength(0);
    const snapshot = buildExportSnapshot({ day: { subjects: [{ id: 'phone', model }] },
      range: { start: input[0].time, end: now }, subject: 'phone' });
    expect(snapshot.subjects[0].stays).toEqual([]);
  });
});

describe('5. a short real walk between two stays at one place', () => {
  // A stay, out about 28 m and around there for 40 s on foot, back, the stay
  // again, then away.
  const excursion = ({ out = 28, around = 40, accuracy = 5 } = {}) => rows([['still', 2400, { accuracy }],
    ['walk', out * 5 / 5.5 - (out * 5 / 5.5) % 5, { step: 5.5, accuracy }], ['walk', around, { step: 0, accuracy }],
    ['walk', out * 5 / 5.5 - (out * 5 / 5.5) % 5, { step: -5.5, accuracy }],
    ['still', 2400, { accuracy }], ['walk', 300, { accuracy }]]);

  test('is one stay; its metres stay in the list and the summary', () => {
    const model = timeline(excursion());
    expect(stays(model).map(n => n.number)).toEqual([1]);
    expect(shownTypes(model)).toEqual(['departure+stay', 'movement', 'end']);
    expect(rowSum(model)).toBeCloseTo(model.distanceM, 6);
    expectTiled(model, model.points[0].time, model.points.at(-1).time);
  });

  test('stays two when the walk lasts over five minutes', () => {
    expect(stays(timeline(excursion({ around: 6 * 60 })))).toHaveLength(2);
  });

  test('stays two when it went beyond the stay\'s radius (2 × accuracy, at least 30 m)', () => {
    expect(stays(timeline(excursion({ out: 45 })))).toHaveLength(2);
    // With 22 m fixes the radius is 44 m: the same 40 m walk is inside it.
    expect(stays(timeline(excursion({ out: 40, accuracy: 22 })))).toHaveLength(1);
    expect(stays(timeline(excursion({ out: 40 })))).toHaveLength(2);
  });
});
