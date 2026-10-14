// 2026-10-14 (user decisions, #163): a range is listed as its stays and
// movements, with no merged ends.
// - Begins with a stay: no 「出發」. That stay is the first row, 停留 1, with
//   its minutes and address (list, map, TalkBack, PNG, GPX). 出發 is the start
//   of a range that begins moving (a walk first, or the detected departure).
// - Ends with a stay: that stay is the last row, numbered, and there is no
//   end row and no end time marker. A range that ends moving keeps its end
//   row: its time, solid node and address, and no 「結束」 anywhere.
// - Every stay → movement: a down chevron under the stay (list and PNG), and
//   TalkBack says 「從停留 N 離開，」 on the movement row.
// Invented phone days near Taoyuan station only.
import { historyTimeline } from '../src/history/HistoryTimeline';
import { timelinePresentation, presentationDurationMs } from '../src/history/HistoryTimelinePresentation';
import { leavesFrom, nodePill, placeSpeech, sectionSpeech } from '../src/history/HistoryText';
import { groupSamePlaceStays, historyMapPresentation } from '../src/history/screen/HistoryMapModel';
import { stopSpeech } from '../src/map/MarkerA11yLayer';
import { buildExportSnapshot, exportTimelineRows } from '../src/mapHistory/ExportSnapshot';
import { buildGPX } from '../src/mapHistory/ExportGPX';
import { t } from '../src/i18n';

const MINUTE = 60000;
const dayStart = new Date(2026, 9, 13).getTime();
const dayEnd = dayStart + 24 * 60 * MINUTE;
const DEPARTURE = t('c124');
const END = t('c330');

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
const snapshotOf = model => buildExportSnapshot({ day: { subjects: [{ id: 'phone', model }] },
  range: { start: model.points[0].time, end: model.points.at(-1).time }, subject: 'phone' });
const isSection = n => n.type === 'movement' || n.type === 'gap';
const speechOf = shown => shown.map((n, i) => (isSection(n) ? sectionSpeech(n, isSection(shown[i - 1] ?? {}) ? null : shown[i - 1])
  : placeSpeech(n, '虛構地址')));

/** Nowhere a 出發 or a 結束: list rows and speech, the PNG list, GPX. */
function expectNoEndWords(model, { departure = false } = {}) {
  const shown = timelinePresentation(model.nodes);
  const words = departure ? [END] : [DEPARTURE, END];
  if (!departure) expect(shown.some(n => n.type === 'departure' || n.departureStay)).toBe(false);
  for (const word of words) {
    expect(shown.some(n => !isSection(n) && nodePill(n)?.text?.includes(word))).toBe(false);
    expect(speechOf(shown).some(text => text.includes(word))).toBe(false);
  }
  const png = exportTimelineRows(model.nodes, () => '虛構地址');
  for (const word of words) expect(png.some(row => row.pill?.text?.includes(word))).toBe(false);
  const gpx = buildGPX(snapshotOf(model));
  for (const word of [DEPARTURE, END]) expect(gpx).not.toContain(word);
  return { shown, png };
}
const waypointNames = model => [...buildGPX(snapshotOf(model)).matchAll(/<wpt[^>]*><time>[^<]*<\/time><name>([^<]*)<\/name>/g)]
  .map(m => m[1]);
const numberedName = number => new RegExp(`^${t('c793', { prefix: '', number, value: '\\d+' })}$`);
/** Rows with a length tile the range (#132/#135/#149). */
function expectTiled(shown, from, to) {
  const timed = shown.filter(n => n.end > n.start);
  expect(timed[0].start).toBe(from);
  expect(timed.at(-1).end).toBe(to);
  for (let i = 1; i < timed.length; i++) expect(timed[i].start).toBe(timed[i - 1].end);
}

test('a day starting and ending with a stay: 停留 1 … 停留 N, no 出發 and no end row, numbered everywhere', () => {
  const rows = day([['still', 20 * 60], ['walk', 10 * 60], ['still', 15 * 60], ['back', 10 * 60], ['still', 20 * 60]],
    dayStart + 8 * 60 * MINUTE);
  const model = whole(rows);
  const { shown, png } = expectNoEndWords(model);
  expect(kinds(shown)).toEqual(['stop', 'movement', 'stop', 'movement', 'stop']);
  expect(shown.filter(n => n.type === 'stop').map(n => n.number)).toEqual([1, 2, 3]);
  expect(shown[0]).toMatchObject({ start: rows[0].time });
  expect(nodePill(shown[0]).text).toBe(t('c127', { duration: '20 分' }));
  expect(placeSpeech(shown[0], '虛構起點')).toMatch(new RegExp(`^${t('c136', { duration: 1 })}，虛構起點，`, 'u'));
  expectTiled(shown, rows[0].time, rows.at(-1).time);
  // The PNG list and GPX names carry the same numbers (#154).
  expect(png.filter(r => r.number != null).map(r => r.number)).toEqual([1, 2, 3]);
  const names = waypointNames(model);
  [1, 2, 3].forEach((number, i) => expect(names[i]).toMatch(numberedName(number)));
  // The map: stays 1 and 3 are one place (home), one marker 「1・3」; stay 2
  // its own. No start or end time marker: the numbers mark them.
  const map = historyMapPresentation(model, { color: '#1A73E8', subject: 'phone' });
  expect(map.places.map(p => p.label ?? String(p.number))).toEqual(['1・3', '2']);
  expect(stopSpeech(map.places[0])).toMatch(new RegExp(`^${t('c136', { duration: 1 })}，.*；${t('c136', { duration: 3 })}，`, 'u'));
  expect(map.times.some(marker => marker.end)).toBe(false);
  const exported = snapshotOf(model).subjects[0].map;
  expect(exported.times.some(marker => marker.end)).toBe(false);
  expect(exported.places.map(p => String(p.number))).toEqual(['1・3', '2']);
});

test('every stay → movement leaves the stay: a chevron under the stay and 「從停留 N 離開，」', () => {
  const rows = day([['still', 20 * 60], ['walk', 10 * 60], ['still', 15 * 60], ['back', 10 * 60], ['still', 20 * 60]],
    dayStart + 8 * 60 * MINUTE);
  const model = whole(rows);
  const shown = timelinePresentation(model.nodes);
  expect(shown.map((n, i) => leavesFrom(n, shown[i + 1]))).toEqual([true, false, true, false, false]);
  const speech = speechOf(shown);
  expect(speech[1]).toMatch(new RegExp(`^${t('c1336', { place: t('c136', { duration: 1 }) })}走路`, 'u'));
  expect(speech[3]).toMatch(new RegExp(`^${t('c1336', { place: t('c136', { duration: 2 }) })}走路`, 'u'));
  // The PNG draws the same chevron (ExportDraw) where the row says `leave`.
  const png = exportTimelineRows(model.nodes, () => '虛構地址');
  expect(png.filter(r => r.kind === 'place').map(r => r.leave)).toEqual([true, true, false]);
  // Not after 出發, not into a break.
  expect(leavesFrom({ type: 'departure' }, { type: 'movement' })).toBe(false);
  expect(leavesFrom({ type: 'stop', number: 1 }, { type: 'gap' })).toBe(false);
  expect(leavesFrom({ type: 'indoor' }, { type: 'movement' })).toBe(true);
});

test('a day starting and ending with a walk keeps 出發 and a bare end row: time, solid node, address, no word', () => {
  const rows = day([['walk', 10 * 60], ['still', 20 * 60], ['back', 10 * 60]], dayStart + 8 * 60 * MINUTE);
  for (const model of [timeline(rows), whole(rows)]) {
    const { shown } = expectNoEndWords(model, { departure: true });
    expect(kinds(shown)).toEqual(['departure', 'movement', 'stop', 'movement', 'end']);
    expect(nodePill(shown[0]).text).toBe(DEPARTURE);
    expect(shown[2].number).toBe(1);
    expect(nodePill(shown.at(-1))).toBeNull();
    expect(placeSpeech(shown.at(-1), '虛構終點')).toBe('虛構終點，08:39');
    const map = historyMapPresentation(model, { color: '#1A73E8', subject: 'phone' });
    expect(map.times[0]).toMatchObject({ end: true });
    expect(map.times.at(-1)).toMatchObject({ end: true, last: true });
  }
});

test('today\'s live end keeps 「現在」 (a moving end), and a stay going on now is its own last row', () => {
  const moving = day([['walk', 10 * 60], ['still', 20 * 60], ['back', 10 * 60]], dayStart + 8 * 60 * MINUTE);
  const live = timeline(moving, { today: true, now: moving.at(-1).time + 30000 });
  const shown = timelinePresentation(live.nodes);
  expect(shown.at(-1)).toMatchObject({ type: 'end', label: t('c130') });
  expect(nodePill(shown.at(-1)).text).toBe(t('c130'));
  // The PNG is a file: its end says no 「現在」 (and no 「結束」).
  expect(exportTimelineRows(live.nodes, () => '').at(-1).pill).toBeNull();
  const still = day([['walk', 10 * 60], ['still', 20 * 60]], dayStart + 8 * 60 * MINUTE);
  const here = timeline(still, { today: true, now: still.at(-1).time + 30000 });
  expect(kinds(timelinePresentation(here.nodes)).at(-1)).toBe('stop');
});

describe('a day like 10/13: home from 00:00, a walk, a short stay, the walk home, home', () => {
  const rows = day([['still', 7 * 60 * 60], ['walk', 15 * 60], ['still', 10 * 60], ['back', 15 * 60], ['still', 60 * 60]]);

  test('the whole day: 停留 1 from 00:00, the walk, 停留 2, the walk home, 停留 3 to the end', () => {
    const model = whole(rows);
    const { shown } = expectNoEndWords(model);
    expect(kinds(shown)).toEqual(['stop', 'movement', 'stop', 'movement', 'stop']);
    expect(shown.filter(n => n.type === 'stop').map(n => n.number)).toEqual([1, 2, 3]);
    expect(shown[0]).toMatchObject({ start: dayStart });
    expect(Math.round(presentationDurationMs(shown[0]) / MINUTE)).toBe(7 * 60);
    expect(nodePill(shown.at(-1)).text).toBe(t('c127', { duration: '1 時' }));
    expectTiled(shown, dayStart, rows.at(-1).time);
  });

  test('the range from the detected departure (今天的出發到現在) starts moving: 出發 then the walk', () => {
    const now = rows.at(-1).time + 1000;
    for (const model of [timeline(rows), timeline(rows, { today: true, now })]) {
      expect(model.departure.status).toBe('confirmed');
      // The detected range is unchanged: it starts where the walk set off.
      expect(model.range.start).toBe(model.departure.automaticRange.start);
      expect(model.range.start).toBeGreaterThan(dayStart + 6 * 60 * MINUTE);
      const shown = timelinePresentation(model.nodes);
      expect(kinds(shown)).toEqual(['departure+stay', 'movement', 'stop', 'movement', 'stop']);
      // Only 「出發」: the home stay's last seconds are that row's time, unnumbered.
      expect(nodePill(shown[0]).text).toBe(DEPARTURE);
      expect(shown[0].departureStay.number ?? null).toBeNull();
      expect(shown.filter(n => n.type === 'stop').map(n => n.number)).toEqual([1, 2]);
      const map = historyMapPresentation(model, { color: '#1A73E8', subject: 'phone' });
      expect(map.places.map(p => p.number)).toEqual([1, 2]);
      // The start is drawn (出發 is listed); the end is stay 2 itself.
      expect(map.times.filter(marker => marker.end).map(marker => !!marker.last)).toEqual([false]);
    }
  });

  test('a range dragged into the home stay starts with that stay, 停留 1', () => {
    const model = timeline(rows, { manualRange: { start: rows[0].time + 6 * 60 * MINUTE, end: rows.at(-1).time } });
    const { shown } = expectNoEndWords(model);
    expect(shown[0]).toMatchObject({ type: 'stop', number: 1, start: rows[0].time + 6 * 60 * MINUTE });
    expect(Math.round(presentationDurationMs(shown[0]) / MINUTE)).toBe(60);
  });
});

test('a single-stay day is one row, the stay', () => {
  const rows = day([['still', 60 * 60]], dayStart + 8 * 60 * MINUTE);
  const model = whole(rows);
  const { shown } = expectNoEndWords(model);
  expect(kinds(shown)).toEqual(['stop']);
  expect(nodePill(shown[0]).text).toBe(t('c127', { duration: '59 分' }));
  // A range wholly in that stay (displayStays): unnumbered, as the map's label.
  expect(shown[0].number).toBeNull();
  expect(historyMapPresentation(model, { color: '#1A73E8', subject: 'phone' }).times).toEqual([]);
});

test('numbered stays at one place share one marker; switch points and far stays do not', () => {
  const at = (number, metres, type = 'stop') => ({ key: `${type}${number}`, kind: 'number', type, number,
    start: number * MINUTE, end: number * MINUTE + MINUTE, coordinate: { latitude: 24.9892, longitude: 121.3138 + metres / 101000 } });
  const grouped = groupSamePlaceStays([at(1, 0), at(2, 400), at(3, 10), at(4, 5, 'switch')]);
  expect(grouped.map(p => p.label ?? String(p.number))).toEqual(['1・3', '2', '4']);
  expect(grouped[0]).toMatchObject({ key: 'stop1', number: 1, numbers: [1, 3] });
});
