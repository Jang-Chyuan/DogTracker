// 2026-10-14 (user decision): a day (or range) that begins with a stay has no
// 「出發」 — that stay is the first row, 停留 1, with its minutes and address,
// on the list, the map, TalkBack, the PNG and the GPX waypoint names. 出發 is
// the start of a range that begins moving (a walk first, or the detected
// departure). The end side is unchanged: a same-place last stay is still
// 「結束 · 停 N 分」. Invented phone days near Taoyuan station only.
import { historyTimeline } from '../src/history/HistoryTimeline';
import { timelinePresentation, presentationDurationMs } from '../src/history/HistoryTimelinePresentation';
import { nodePill, placeSpeech } from '../src/history/HistoryText';
import { historyMapPresentation } from '../src/history/screen/HistoryMapModel';
import { stopSpeech } from '../src/map/MarkerA11yLayer';
import { buildExportSnapshot, exportTimelineRows } from '../src/mapHistory/ExportSnapshot';
import { buildGPX } from '../src/mapHistory/ExportGPX';
import { t } from '../src/i18n';

const MINUTE = 60000;
const dayStart = new Date(2026, 9, 13).getTime();
const dayEnd = dayStart + 24 * 60 * MINUTE;
const DEPARTURE = t('c124');

// A fix every 5 s from `from`: still (a stay), walk (5 km/h east) or back (west).
function day(script, from = dayStart) {
  const rows = [];
  let s = 0, east = 0;
  const fix = extra => rows.push({ time: from + s * 1000, latitude: 24.9892, longitude: 121.3138 + east / 101000,
    accuracy: 4, raw_speed_kmh: 0, speed_kmh: 0, speed_accuracy_mps: 0.4, motion_state: 'stationary',
    session_id: 'fiction-session', ...extra });
  for (const [kind, seconds] of script) {
    for (let k = 0; k < seconds; k += 5, s += 5) {
      if (kind === 'walk' || kind === 'back') {
        east += kind === 'walk' ? 7 : -7;
        fix({ raw_speed_kmh: 5.04, speed_kmh: 5.04, motion_state: 'moving' });
      } else fix({});
    }
  }
  return rows;
}
const timeline = (rows, options = {}) => historyTimeline(rows, { subject: 'phone', dayStart, dayEnd, ...options });
const whole = rows => timeline(rows, { manualRange: { start: rows[0].time, end: rows.at(-1).time } });
const kinds = shown => shown.map(n => (n.departureStay ? 'departure+stay' : n.terminalStay ? 'end+stay' : n.type));

/** Nowhere a 出發: list rows, the PNG list, the map's places and their speech, GPX names. */
function expectNoDeparture(model) {
  const shown = timelinePresentation(model.nodes);
  expect(shown.some(n => n.type === 'departure' || n.departureStay)).toBe(false);
  expect(shown.some(n => nodePill(n)?.text?.includes(DEPARTURE))).toBe(false);
  expect(shown.some(n => placeSpeech(n, '虛構地址').includes(DEPARTURE))).toBe(false);
  const png = exportTimelineRows(model.nodes, () => '虛構地址');
  expect(png.some(row => row.type === 'departure' || row.pill?.text?.includes(DEPARTURE))).toBe(false);
  const snapshot = buildExportSnapshot({ day: { subjects: [{ id: 'phone', model }] },
    range: { start: model.points[0].time, end: model.points.at(-1).time }, subject: 'phone' });
  expect(buildGPX(snapshot)).not.toContain(DEPARTURE);
  return { shown, png, snapshot };
}
const waypointNames = snapshot => [...buildGPX(snapshot).matchAll(/<wpt[^>]*><time>[^<]*<\/time><name>([^<]*)<\/name>/g)]
  .map(m => m[1]);
const numberedName = number => new RegExp(`^${t('c793', { prefix: '', number, value: '\\d+' })}$`);

test('a day starting with a stay: 停留 1 first (no 出發), numbered on the list, the map, TalkBack, PNG and GPX', () => {
  const rows = day([['still', 20 * 60], ['walk', 10 * 60], ['still', 15 * 60], ['back', 10 * 60]], dayStart + 8 * 60 * MINUTE);
  const model = whole(rows);
  const { shown, png, snapshot } = expectNoDeparture(model);
  expect(kinds(shown)).toEqual(['stop', 'movement', 'stop', 'movement', 'end']);
  expect(shown[0]).toMatchObject({ number: 1, start: rows[0].time });
  expect(nodePill(shown[0]).text).toBe(t('c127', { duration: '20 分' }));
  expect(placeSpeech(shown[0], '虛構起點')).toMatch(new RegExp(`^${t('c136', { duration: 1 })}，虛構起點，`, 'u'));
  expect(shown[2].number).toBe(2);
  // The same numbers everywhere (#154): from 1, none skipped.
  const places = historyMapPresentation(model, { color: '#1A73E8', subject: 'phone' }).places;
  expect(places.map(p => p.number)).toEqual([1, 2]);
  expect(stopSpeech(places[0])).toMatch(new RegExp(`^${t('c136', { duration: 1 })}`, 'u'));
  expect(png.filter(r => r.number != null).map(r => r.number)).toEqual([1, 2]);
  const names = waypointNames(snapshot);
  expect(names[0]).toMatch(numberedName(1));
  expect(names[1]).toMatch(numberedName(2));
  // Every minute has a row (#132/#135/#149): the rows tile the range.
  const timed = shown.filter(n => n.end > n.start);
  expect(timed[0].start).toBe(rows[0].time);
  for (let i = 1; i < timed.length; i++) expect(timed[i].start).toBe(timed[i - 1].end);
});

test('a day starting with a walk keeps 出發', () => {
  const rows = day([['walk', 10 * 60], ['still', 20 * 60], ['back', 10 * 60]], dayStart + 8 * 60 * MINUTE);
  for (const model of [timeline(rows), whole(rows)]) {
    const shown = timelinePresentation(model.nodes);
    expect(kinds(shown)).toEqual(['departure', 'movement', 'stop', 'movement', 'end']);
    expect(nodePill(shown[0]).text).toBe(DEPARTURE);
    expect(shown[2].number).toBe(1);
  }
});

describe('a day like 10/13: home from 00:00, a walk, a short stay, the walk home, home', () => {
  const rows = day([['still', 7 * 60 * 60], ['walk', 15 * 60], ['still', 10 * 60], ['back', 15 * 60], ['still', 60 * 60]]);

  test('the whole day: 停留 1 from 00:00, the walk, 停留 2, the walk home, 「結束 · 停 N 分」', () => {
    const model = whole(rows);
    const { shown } = expectNoDeparture(model);
    expect(kinds(shown)).toEqual(['stop', 'movement', 'stop', 'movement', 'end+stay']);
    expect(shown[0]).toMatchObject({ number: 1, start: dayStart });
    expect(Math.round(presentationDurationMs(shown[0]) / MINUTE)).toBe(7 * 60);
    expect(shown[2].number).toBe(2);
    // The end side is unchanged: home again is the end's stay, unnumbered.
    expect(shown.at(-1).terminalStay.number).toBeNull();
    expect(nodePill(shown.at(-1)).text).toBe(`${t('c330')} · ${t('c127', { duration: '1 時' })}`);
  });

  test('the range from the detected departure (今天的出發到現在) starts moving: 出發 then the walk', () => {
    const now = rows.at(-1).time + 1000;
    for (const model of [timeline(rows), timeline(rows, { today: true, now })]) {
      expect(model.departure.status).toBe('confirmed');
      // The detected range is unchanged: it starts where the walk set off.
      expect(model.range.start).toBe(model.departure.automaticRange.start);
      expect(model.range.start).toBeGreaterThan(dayStart + 6 * 60 * MINUTE);
      const shown = timelinePresentation(model.nodes);
      expect(kinds(shown)).toEqual(['departure+stay', 'movement', 'stop', 'movement', 'end+stay']);
      // Only 「出發」: the home stay's last seconds are that row's time, unnumbered.
      expect(nodePill(shown[0]).text).toBe(DEPARTURE);
      expect(shown[0].departureStay.number ?? null).toBeNull();
      expect(shown[2].number).toBe(1);
      expect(historyMapPresentation(model, { color: '#1A73E8', subject: 'phone' }).places.map(p => p.number)).toEqual([1]);
    }
  });

  test('a range dragged into the home stay starts with that stay, 停留 1', () => {
    const model = timeline(rows, { manualRange: { start: rows[0].time + 6 * 60 * MINUTE, end: rows.at(-1).time } });
    const { shown } = expectNoDeparture(model);
    expect(shown[0]).toMatchObject({ type: 'stop', number: 1, start: rows[0].time + 6 * 60 * MINUTE });
    expect(Math.round(presentationDurationMs(shown[0]) / MINUTE)).toBe(60);
  });
});

test('a single-stay day: the stay, then the end (the first row is never the end\'s stay)', () => {
  const rows = day([['still', 60 * 60]], dayStart + 8 * 60 * MINUTE);
  const model = whole(rows);
  const { shown } = expectNoDeparture(model);
  expect(kinds(shown)).toEqual(['stop', 'end']);
  expect(nodePill(shown[0]).text).toBe(t('c127', { duration: '59 分' }));
  expect(nodePill(shown[1]).text).toBe(t('c330'));
  // A range wholly in that stay (displayStays): unnumbered, as the map's label.
  expect(shown[0].number).toBeNull();
});

test('the map and the PNG map draw the end time marker solid (`last`), the start hollow', () => {
  const rows = day([['walk', 10 * 60], ['still', 20 * 60], ['back', 10 * 60]], dayStart + 8 * 60 * MINUTE);
  const model = timeline(rows);
  const times = historyMapPresentation(model, { color: '#1A73E8', subject: 'phone' }).times;
  expect(times[0]).toMatchObject({ end: true });
  expect(times[0].last).toBeUndefined();
  expect(times.at(-1)).toMatchObject({ end: true, last: true });
  const snapshot = buildExportSnapshot({ day: { subjects: [{ id: 'phone', model }] },
    range: { start: model.points[0].time, end: model.points.at(-1).time }, subject: 'phone' });
  const exported = snapshot.subjects[0].map.times;
  expect(exported[0]).toMatchObject({ end: true, last: false });
  expect(exported.at(-1)).toMatchObject({ end: true, last: true });
});
