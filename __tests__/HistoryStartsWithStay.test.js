// 2026-10-14 (user decisions, #163): a range is listed as its stays and
// movements, with no merged ends.
// - Begins with a stay: no 「出發」 row. That stay is the first row, with its
//   minutes and address; its node is the hollow start circle and it has no
//   number (round 3). 出發 is the start of a range that begins moving (a walk
//   first, or the detected departure).
// - Ends with a stay: that stay is the last row, its node the solid end
//   circle, no number; no end row. A range that ends moving keeps its end
//   row: its time, solid node and address, and no 「結束」 anywhere.
// - The stays in between are numbered from 1. On the map the ends are the
//   hollow / solid time markers (one marker when they are at one place).
// - Every stay → movement: a down chevron under the stay (list and PNG), and
//   TalkBack says 「從停留 N 離開，」 on the movement row.
// Invented phone days near Taoyuan station only.
import { historyTimeline } from '../src/history/HistoryTimeline';
import { rangeEndRows, timelinePresentation, presentationDurationMs } from '../src/history/HistoryTimelinePresentation';
import { clock, leavesFrom, nodePill, placeSpeech, sectionSpeech } from '../src/history/HistoryText';
import { groupSamePlaceStays, historyMapPresentation } from '../src/history/screen/HistoryMapModel';
import { stopSpeech } from '../src/map/MarkerA11yLayer';
import { buildExportSnapshot, exportTimelineRows } from '../src/mapHistory/ExportSnapshot';
import { buildGPX } from '../src/mapHistory/ExportGPX';
import { t } from '../src/i18n';

const MINUTE = 60000;
const dayStart = new Date(2026, 9, 13).getTime();
const dayEnd = dayStart + 24 * 60 * MINUTE;
const DEPARTURE = '出發';
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
  // 2026-10-14: neither word anywhere, whether the range starts moving or not.
  const words = [DEPARTURE, END];
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

test('a day starting and ending with a stay: start circle, 停留 1, end circle; no 出發 / end rows', () => {
  const rows = day([['still', 20 * 60], ['walk', 10 * 60], ['still', 15 * 60], ['back', 10 * 60], ['still', 20 * 60]],
    dayStart + 8 * 60 * MINUTE);
  const model = whole(rows);
  const { shown, png } = expectNoEndWords(model);
  expect(kinds(shown)).toEqual(['stop', 'movement', 'stop', 'movement', 'stop']);
  expect(shown.filter(n => n.type === 'stop').map(n => n.number)).toEqual([null, 1, null]);
  expect(shown[0]).toMatchObject({ start: rows[0].time });
  expect(nodePill(shown[0]).text).toBe(t('c127', { duration: '20 分' }));
  // TalkBack reads the row as it is (no 出發 / 結束): 「停留，地址，…」.
  expect(placeSpeech(shown[0], '虛構起點')).toMatch(/^停留，虛構起點，/u);
  expect(placeSpeech(shown[2], '虛構地點')).toMatch(new RegExp(`^${t('c136', { duration: 1 })}，虛構地點，`, 'u'));
  expectTiled(shown, rows[0].time, rows.at(-1).time);
  // The list's start / end circles: the first and the last row.
  expect(rangeEndRows(shown)).toEqual({ start: 0, end: 4 });
  // The PNG list and GPX names carry the same numbers (#154); the start and
  // end stays are 「停留・N 分」 (c1310), no number.
  expect(png.filter(r => r.number != null).map(r => r.number)).toEqual([1]);
  expect(png.filter(r => r.kind === 'place').map(r => [r.rangeStart, r.rangeEnd])).toEqual([[true, false], [false, false], [false, true]]);
  const names = waypointNames(model);
  const unnumbered = new RegExp(`^${t('c1310', { prefix: '', value: '\\d+' })}$`);
  expect(names).toHaveLength(3);
  expect(names[0]).toMatch(unnumbered);
  expect(names[1]).toMatch(numberedName(1));
  expect(names[2]).toMatch(unnumbered);
  // The map: only stay 1 is a number; the range's start and end (home, one
  // place) are one time marker, the solid end inside the start's ring.
  const map = historyMapPresentation(model, { color: '#1A73E8', subject: 'phone' });
  expect(map.places.map(p => p.label ?? String(p.number))).toEqual(['1']);
  expect(stopSpeech(map.places[0])).toMatch(new RegExp(`^${t('c136', { duration: 1 })}，`, 'u'));
  const ends = map.times.filter(marker => marker.end);
  expect(ends).toHaveLength(1);
  expect(ends[0]).toMatchObject({ first: true, last: true, label: expect.stringMatching(/^\d\d:\d\d–\d\d:\d\d$/u) });
  const exported = snapshotOf(model).subjects[0].map;
  expect(exported.places.map(p => String(p.number))).toEqual(['1']);
  expect(exported.times.filter(marker => marker.end)).toEqual([expect.objectContaining({ first: true, last: true })]);
});

test('every stay → movement leaves the stay: a chevron under the stay and 「從停留 N 離開，」', () => {
  const rows = day([['still', 20 * 60], ['walk', 10 * 60], ['still', 15 * 60], ['back', 10 * 60], ['still', 20 * 60]],
    dayStart + 8 * 60 * MINUTE);
  const model = whole(rows);
  const shown = timelinePresentation(model.nodes);
  expect(shown.map((n, i) => leavesFrom(n, shown[i + 1]))).toEqual([true, false, true, false, false]);
  const speech = speechOf(shown);
  // The first stay has no number: 「從停留離開，」; stay 1 「從停留 1 離開，」.
  expect(speech[1]).toMatch(new RegExp(`^${t('c1336', { place: '停留' })}走路`, 'u'));
  expect(speech[3]).toMatch(new RegExp(`^${t('c1336', { place: t('c136', { duration: 1 }) })}走路`, 'u'));
  // The PNG draws the same chevron (ExportDraw) where the row says `leave`.
  const png = exportTimelineRows(model.nodes, () => '虛構地址');
  expect(png.filter(r => r.kind === 'place').map(r => r.leave)).toEqual([true, true, false]);
  // The small departure time beside the chevron: the stay's end clock, which
  // is the movement row's start (HistoryTimeClocks checks the sums).
  const places = png.filter(r => r.kind === 'place');
  expect(places[0].leaveTime).toBe(clock(shown[1].start));
  expect(places[1].leaveTime).toBe(clock(shown[3].start));
  expect(places[2].leaveTime).toBeNull();
  // Not after 出發, not into a break.
  expect(leavesFrom({ type: 'departure' }, { type: 'movement' })).toBe(false);
  expect(leavesFrom({ type: 'stop', number: 1 }, { type: 'gap' })).toBe(false);
  expect(leavesFrom({ type: 'indoor' }, { type: 'movement' })).toBe(true);
});

test('a day starting and ending with a walk: a bare start row and a bare end row (time, circle, address, no word)', () => {
  const rows = day([['walk', 10 * 60], ['still', 20 * 60], ['back', 10 * 60]], dayStart + 8 * 60 * MINUTE);
  for (const model of [timeline(rows), whole(rows)]) {
    const { shown } = expectNoEndWords(model, { departure: true });
    expect(placeSpeech(shown[0], '虛構起點')).toMatch(/^虛構起點，\d\d:\d\d$/u);
    expect(kinds(shown)).toEqual(['departure', 'movement', 'stop', 'movement', 'end']);
    // 2026-10-14: the start row is its hollow circle, time and place: no 「出發」.
    expect(nodePill(shown[0])).toBeNull();
    expect(shown[2].number).toBe(1);
    expect(nodePill(shown.at(-1))).toBeNull();
    expect(placeSpeech(shown.at(-1), '虛構終點')).toBe('虛構終點，08:39');
    const map = historyMapPresentation(model, { color: '#1A73E8', subject: 'phone' });
    expect(map.times[0]).toMatchObject({ end: true });
    expect(map.times.at(-1)).toMatchObject({ end: true, last: true });
    // 出發 and the end row are rows: the stay between them is 1 as it is.
    expect(rangeEndRows(shown)).toEqual({ start: null, end: null });
    expect(map.places.map(p => p.number)).toEqual([1]);
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

  test('the whole day: home from 00:00 (start circle), the walk, 停留 1, the walk home, home (end circle)', () => {
    const model = whole(rows);
    const { shown } = expectNoEndWords(model);
    expect(kinds(shown)).toEqual(['stop', 'movement', 'stop', 'movement', 'stop']);
    expect(shown.filter(n => n.type === 'stop').map(n => n.number)).toEqual([null, 1, null]);
    expect(rangeEndRows(shown)).toEqual({ start: 0, end: 4 });
    expect(shown[0]).toMatchObject({ start: dayStart });
    expect(Math.round(presentationDurationMs(shown[0]) / MINUTE)).toBe(7 * 60);
    // 2026-10-14: home from where the walk home stopped (its last seconds
    // inside the circle are the walk's).
    expect(nodePill(shown.at(-1)).text).toBe(t('c127', { duration: '59 分' }));
    expectTiled(shown, dayStart, rows.at(-1).time);
  });

  test('the range from the detected departure (今天的出發到現在) starts moving: the start row (no word) then the walk', () => {
    const now = rows.at(-1).time + 1000;
    for (const model of [timeline(rows), timeline(rows, { today: true, now })]) {
      expect(model.departure.status).toBe('confirmed');
      // The detected range is unchanged: it starts where the walk set off.
      expect(model.range.start).toBe(model.departure.automaticRange.start);
      expect(model.range.start).toBeGreaterThan(dayStart + 6 * 60 * MINUTE);
      const shown = timelinePresentation(model.nodes);
      expect(kinds(shown)).toEqual(['departure+stay', 'movement', 'stop', 'movement', 'stop']);
      // Only 「出發」: the home stay's last seconds are that row's time, unnumbered.
      expect(nodePill(shown[0])).toBeNull();
      expect(shown[0].departureStay.number ?? null).toBeNull();
      expect(shown.filter(n => n.type === 'stop').map(n => n.number)).toEqual([1, null]);
      expect(rangeEndRows(shown)).toEqual({ start: null, end: 4 });
      const map = historyMapPresentation(model, { color: '#1A73E8', subject: 'phone' });
      expect(map.places.map(p => p.number)).toEqual([1]);
      // The start is the 出發 time marker at the walk's start, the end the
      // solid one at home (the same place: one marker).
      expect(map.times.filter(marker => marker.end)).toEqual([expect.objectContaining({ first: true, last: true })]);
    }
  });

  test('a range dragged into the home stay starts with that stay (the start circle)', () => {
    const model = timeline(rows, { manualRange: { start: rows[0].time + 6 * 60 * MINUTE, end: rows.at(-1).time } });
    const { shown } = expectNoEndWords(model);
    expect(shown[0]).toMatchObject({ type: 'stop', number: null, start: rows[0].time + 6 * 60 * MINUTE });
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
  // No marker of its own (unnumbered): one time marker carries both ends —
  // the solid end in the start's ring, 「08:00–08:59」 — not two labels.
  const times = historyMapPresentation(model, { color: '#1A73E8', subject: 'phone' }).times;
  expect(times).toHaveLength(1);
  expect(times[0]).toMatchObject({ first: true, last: true, label: expect.stringMatching(/^\d\d:\d\d–\d\d:\d\d$/u) });
  expect(rangeEndRows(shown)).toEqual({ start: 0, end: 0 });
});

test('numbered stays at one place share one marker; switch points and far stays do not', () => {
  const at = (number, metres, type = 'stop') => ({ key: `${type}${number}`, kind: 'number', type, number,
    start: number * MINUTE, end: number * MINUTE + MINUTE, coordinate: { latitude: 24.9892, longitude: 121.3138 + metres / 101000 } });
  const grouped = groupSamePlaceStays([at(1, 0), at(2, 400), at(3, 10), at(4, 5, 'switch')]);
  expect(grouped.map(p => p.label ?? String(p.number))).toEqual(['1・3', '2', '4']);
  expect(grouped[0]).toMatchObject({ key: 'stop1', number: 1, numbers: [1, 3] });
});

test('on screen: the start / end circles replace the first and last nodes; the departure time beside each chevron', async () => {
  const React = require('react');
  const Renderer = require('react-test-renderer');
  const { StyleSheet } = require('react-native');
  const HistoryTimelineList = require('../src/mapHistory/HistoryTimelineList').default;
  const { AddressLookupContext } = require('../src/placement/AddressLookup');
  const rows = day([['still', 20 * 60], ['walk', 10 * 60], ['still', 15 * 60], ['back', 10 * 60], ['still', 20 * 60]],
    dayStart + 8 * 60 * MINUTE);
  const model = whole(rows);
  const shown = timelinePresentation(model.nodes);
  const lookup = { lookup: () => null, subscribe: () => () => {} };
  let renderer;
  await Renderer.act(async () => { renderer = Renderer.create(<AddressLookupContext.Provider value={lookup}>
    <HistoryTimelineList model={model} color="#1A73E8" />
  </AddressLookupContext.Provider>); });
  const host = id => renderer.root.findAll(node => typeof node.type === 'string' && node.props.testID === id);
  const firstLines = host('place-node-first-line');
  expect(firstLines).toHaveLength(3);
  const views = line => line.findAll(node => typeof node.type === 'string').map(node => StyleSheet.flatten(node.props.style) || {});
  const texts = line => line.findAll(node => typeof node.type === 'string' && typeof node.props.children === 'number');
  // The first node: the hollow 出發 circle (a route-colour border, no number).
  expect(views(firstLines[0]).some(style => style.borderColor === '#1A73E8')).toBe(true);
  expect(texts(firstLines[0])).toHaveLength(0);
  // The middle stay keeps its number 1.
  expect(texts(firstLines[1]).map(node => node.props.children)).toEqual([1]);
  // The last node: the solid end circle (route-colour fill, no number).
  expect(views(firstLines[2]).some(style => style.backgroundColor === '#1A73E8')).toBe(true);
  expect(texts(firstLines[2])).toHaveLength(0);
  // The small time beside each chevron: when it left, the next row's start.
  expect(host('leave-chevron')).toHaveLength(2);
  expect(host('leave-time').map(node => node.props.children)).toEqual([clock(shown[1].start), clock(shown[3].start)]);
  await Renderer.act(async () => renderer.unmount());
});
