import { interruptionText, nodePill, placeSpeech, sectionText } from '../src/history/HistoryText';
import { shownRowAt, shownStayDurationMs } from '../src/history/HistoryTimelinePresentation';
import { timelinePresentation } from '../src/history/HistoryTimelinePresentation';
import { exportTimelineRows } from '../src/mapHistory/ExportSnapshot';
import { layoutRow } from '../src/mapHistory/ExportPNG';
import { pngDrawPages } from '../src/mapHistory/ExportDraw';

const walk = (start, end, metres = 20) => ({ type: 'movement', mode: 'walking', start, end,
  durationMs: end - start, distanceM: metres, countedDistanceM: metres });
const gap = (start, end, reason) => ({ type: 'gap', mode: 'gap', start, end, reason });
// The phone's break inside one recording session (the timeline marks it).
const same = (start, end, reason) => ({ ...gap(start, end, reason), sameSession: true });
const MIN = 60000;

// 2026-10-13 (replaces #115's 「不計未觀測時間」): every minute between two
// listed times belongs to a row. A walk's minutes are its span; a break inside
// one recording session shorter than 30 min is folded into the row beside it
// (a stay first), silently: no note (2026-10-13, user).
test('consecutive walking legs become one presentation whose minutes are its span, distance the legs\' sum, source untouched', () => {
  const nodes = [walk(0, 60000), walk(90000, 150000), same(150000, 180000, 'uncertain'), walk(180000, 240000)];
  const before = JSON.stringify(nodes);
  const shown = timelinePresentation(nodes);
  expect(shown).toHaveLength(1);
  expect(shown[0]).toMatchObject({ start: 0, end: 240000, durationMs: 240000, countedDistanceM: 60, unlocatedMs: 30000 });
  expect(JSON.stringify(nodes)).toBe(before);
});

test.each([[undefined], ['uncertain']])('a same-session %s break under 30 min is folded into the walk; 30 min or more is a row', reason => {
  const folded = timelinePresentation([walk(0, MIN), same(MIN, 29 * MIN, reason), walk(29 * MIN, 30 * MIN)]);
  expect(folded).toHaveLength(1);
  expect(folded[0]).toMatchObject({ start: 0, end: 30 * MIN, durationMs: 30 * MIN, unlocatedMs: 28 * MIN, countedDistanceM: 40 });
  // One distance formatter (utils/distanceText): 40 m.
  expect(sectionText(folded[0]).rest).toBe('・40 m');
  const long = timelinePresentation([walk(0, MIN), same(MIN, 31 * MIN, reason), walk(31 * MIN, 32 * MIN)]);
  expect(long.map(n => n.type)).toEqual(['movement', 'gap', 'movement']);
  expect(long[0].unlocatedMs).toBeUndefined();
});

test('a break across a recording restart (no sameSession, or sessionChange) is always its own row', () => {
  const shown = timelinePresentation([walk(0, MIN), gap(MIN, 2 * MIN), walk(2 * MIN, 3 * MIN)]);
  expect(shown.map(n => n.type)).toEqual(['movement', 'gap', 'movement']);
  // PR #135 marks a session change; it wins even over a stray sameSession.
  const place = { type: 'stop', number: 1, start: 0, end: MIN, durationMs: MIN };
  for (const flagged of [{ ...gap(MIN, 2 * MIN), sessionChange: true }, { ...same(MIN, 2 * MIN), sessionChange: true }]) {
    const rows = timelinePresentation([place, flagged, walk(2 * MIN, 3 * MIN)]);
    expect(rows.map(n => n.type)).toEqual(['stop', 'gap', 'movement']);
    expect(rows[0]).toMatchObject({ end: MIN, durationMs: MIN });
    expect(rows[0].unlocatedMs).toBeUndefined();
  }
});

test('a folded break goes to the stay beside it before a walk, with no note under the place', () => {
  const place = { type: 'stop', number: 1, start: 0, end: 5 * MIN, durationMs: 5 * MIN };
  const [stay, leaving] = timelinePresentation([place, same(5 * MIN, 12 * MIN), walk(12 * MIN, 15 * MIN)]);
  expect(stay).toMatchObject({ number: 1, start: 0, end: 12 * MIN, durationMs: 12 * MIN, unlocatedMs: 7 * MIN });
  expect(nodePill(stay).text).toBe('停 12 分');
  expect(interruptionText(stay)).toBe('');
  expect(leaving).toMatchObject({ start: 12 * MIN, durationMs: 3 * MIN });
  // Arriving: the stay after the walk takes it.
  const [, arrived] = timelinePresentation([walk(0, 3 * MIN), same(3 * MIN, 5 * MIN), { ...place, start: 5 * MIN, end: 9 * MIN, durationMs: 4 * MIN }]);
  expect(arrived).toMatchObject({ start: 3 * MIN, durationMs: 6 * MIN, unlocatedMs: 2 * MIN });
  // The cursor in the folded break belongs to that stay, with its listed minutes.
  const nodes = [place, same(5 * MIN, 12 * MIN), walk(12 * MIN, 15 * MIN)];
  expect(shownRowAt(nodes, 8 * MIN)).toMatchObject({ type: 'stop', number: 1 });
  expect(shownStayDurationMs(nodes, place)).toBe(12 * MIN);
});

test('a short same-session interruption inside a stay is counted in its minutes with no 「不含中斷」', () => {
  const stay = { type: 'stop', id: 'visit:0', number: 1, start: 0, end: 20 * MIN, durationMs: 12 * MIN,
    interruptionMs: 8 * MIN, gaps: [{ start: 5 * MIN, end: 13 * MIN, sameSession: true }] };
  const [shown] = timelinePresentation([stay]);
  expect(shown).toMatchObject({ durationMs: 20 * MIN, interruptionMs: 0, gaps: [] });
  expect(nodePill(shown).text).toBe('停 20 分');
  expect(interruptionText(shown)).toBe('');
  expect(placeSpeech(shown, '虛構地點')).toContain('20 分鐘');
  expect(shownStayDurationMs([stay], stay)).toBe(20 * MIN);
  expect(stay.gaps).toHaveLength(1);
  // Kept deducted and noted: 30 min or more, a session change, or no proof of one session.
  for (const interruption of [{ start: 5 * MIN, end: 35 * MIN, sameSession: true },
    { start: 5 * MIN, end: 13 * MIN, sameSession: true, sessionChange: true },
    { start: 5 * MIN, end: 13 * MIN }]) {
    const long = { ...stay, end: Math.max(20 * MIN, interruption.end + 7 * MIN),
      interruptionMs: interruption.end - interruption.start, gaps: [interruption] };
    long.durationMs = long.end - long.start - long.interruptionMs;
    const [kept] = timelinePresentation([long]);
    expect(kept.durationMs).toBe(long.durationMs);
    expect(interruptionText(kept)).toBe(`不含中斷 ${Math.round(long.interruptionMs / MIN)} 分`);
  }
});

test('with only the departure or the end beside it, a short break is still listed', () => {
  const departure = { type: 'departure', start: 0, end: 0 };
  const end = { type: 'end', start: 5 * MIN, end: 5 * MIN, label: '結束' };
  expect(timelinePresentation([departure, same(0, 5 * MIN), end]).map(n => n.type)).toEqual(['departure', 'gap', 'end']);
});

test('two walks 3 min apart with no row between are not stretched over it', () => {
  const apart = timelinePresentation([walk(0, 60000), walk(240000, 300000)]);
  expect(apart).toHaveLength(2);
  expect(apart[0].end).toBe(60000);
});

test.each([
  { type: 'stop', start: 60000, end: 120000, number: 2 },
  { type: 'indoor', start: 60000, end: 120000 },
  { type: 'switch', start: 60000, end: 60000, number: 3 },
  { type: 'resume', start: 60000, end: 60000 },
  { ...walk(60000, 120000), mode: 'driving' },
  gap(60000, 120000), gap(60000, 120000, 'no-gps'), gap(60000, 120000, 'no-signal'),
])('real stop/mode/gap boundary is retained: %j', boundary => {
  const nodes = [walk(0, 60000), boundary, walk(boundary.end, boundary.end + 60000)];
  expect(timelinePresentation(nodes)).toEqual(nodes);
  expect(timelinePresentation(nodes)[2].countedDistanceM).toBe(20);
});

test('PNG uses the same collapsed rows; places expose start only, duration before address and no coordinates', () => {
  const place = { type: 'stop', start: 0, end: 60000, durationMs: 60000, number: 1, latitude: 24.9892, longitude: 121.3132 };
  const rows = exportTimelineRows([place, walk(60000, 120000), walk(130000, 190000)], () => '虛構測試地址');
  expect(rows).toHaveLength(2);
  expect(rows[0].times).toHaveLength(1);
  expect(rows[0].coordinates).toBe('');
  const block = { type: 'row', row: rows[0], ...layoutRow(rows[0], (text, size) => text.length * size), color: '#123456', y: 0 };
  const page = { width: 1080, height: 500, titleLines: [], subtitleLines: [], legend: [], blocks: [block], footer: { page: '1', y: 480, height: 20 } };
  const ops = pngDrawPages({ pages: [page] })[0].ops;
  const pill = ops.find(op => op.text === rows[0].pill.text);
  const address = ops.find(op => op.text?.startsWith('虛構'));
  expect(pill.y).toBe(address.y);
  expect(pill.x).toBeLessThan(address.x);
});

test('PNG address wraps below an unusually wide leading pill without shrinking its text', () => {
  const row = { kind: 'place', title: '虛構長地址', pill: { text: '停留', tone: 'plain' } };
  const block = layoutRow(row, (text, size) => text === '停留' ? 800 : text.length * size);
  expect(block.titleX).toBe(0);
  expect(block.titleY).toBeGreaterThan(0);
  expect(block.titleLines.join('')).toBe(row.title);
});

const terminalStay = { type: 'stop', number: 3, start: 120000, end: 480000,
  durationMs: 360000, latitude: 24.9892, longitude: 121.3132, gaps: [] };
const endpoint = { type: 'end', start: 480000, end: 480000,
  latitude: 24.9892, longitude: 121.3132, label: '結束' };
test('same-place terminal stay is one endpoint, retaining duration, address and source nodes', () => {
  const nodes = [walk(0, 120000), terminalStay, endpoint];
  const original = JSON.stringify(nodes);
  const shown = timelinePresentation(nodes);
  expect(shown).toHaveLength(2);
  expect(shown[1]).toMatchObject({ type: 'end', start: 120000, end: 480000,
    number: null, durationMs: 360000, terminalStay });
  const rows = exportTimelineRows(nodes, () => '虛構終點地址');
  expect(rows[1].title).toBe('虛構終點地址');
  expect(rows[1].pill.text).toContain('結束');
  expect(rows[1].pill.text).toContain('6');
  expect(rows[1].number).toBeNull();
  expect(rows[1].times).toHaveLength(1);
  expect(JSON.stringify(nodes)).toBe(original);
});
test.each([
  [terminalStay, { ...endpoint, latitude: endpoint.latitude + 0.001 }],
  [terminalStay, { ...endpoint, start: endpoint.start + 1 }],
  [{ ...terminalStay, gaps: [{ start: 300000, end: 400000 }] }, endpoint],
  [terminalStay, same(480000, 480001, 'uncertain'), { ...endpoint, start: 480001 }],
  [terminalStay, walk(480000, 540000), { ...endpoint, start: 540000 }],
])('different place/time, missing observation or final movement preserves distinct endpoint: %j', (...tail) => {
  const shown = timelinePresentation(tail);
  expect(shown.some(n => n.terminalStay)).toBe(false);
  expect(shown.filter(n => n.type === 'stop')).toHaveLength(1);
  expect(shown.filter(n => n.type === 'end')).toHaveLength(1);
});
test('a dog endpoint the confirmed visit recorded is that visit, though the visit coordinate is a mean', () => {
  const last = { latitude: 24.98925, longitude: 121.31318, time: 480000 };
  const visit = { ...terminalStay, id: 'visit:120000', points: [{ latitude: 24.9892, longitude: 121.3132, time: 120000 }, last] };
  const end = { ...endpoint, latitude: last.latitude, longitude: last.longitude, label: '現在' };
  const shown = timelinePresentation([walk(0, 120000), visit, end]);
  expect(shown).toHaveLength(2);
  expect(shown[1]).toMatchObject({ type: 'end', start: 120000, end: 480000, label: '現在', terminalStay: visit,
    latitude: last.latitude, longitude: last.longitude });
  // Nearby but not one of the visit's own fixes, or not a visit at all: two rows.
  const elsewhere = { ...end, latitude: last.latitude + 0.0001 };
  expect(timelinePresentation([walk(0, 120000), visit, elsewhere]).some(n => n.terminalStay)).toBe(false);
  expect(timelinePresentation([walk(0, 120000), { ...visit, id: 'stop:1' }, end]).some(n => n.terminalStay)).toBe(false);
});
// PR 116's shape: an unnumbered stationary run anchored at its first fix,
// possibly across a same-place save gap, ending at the endpoint's fix.
const stationary = { type: 'stop', id: 'phone-stationary:120000', presentationOnly: 'phone-stationary', number: null,
  start: 120000, end: 480000, durationMs: 360000, interruptionMs: 0, gaps: [], unobserved: [{ start: 200000, end: 400000 }],
  latitude: 24.98921, longitude: 121.31321 };
test('a phone stationary run ending at the endpoint is one end row with its minutes', () => {
  const end = { ...endpoint, label: '現在' };
  const shown = timelinePresentation([walk(0, 120000), stationary, end]);
  expect(shown).toHaveLength(2);
  expect(shown[1]).toMatchObject({ type: 'end', start: 120000, end: 480000, label: '現在', terminalStay: stationary, number: null });
  // A run that ended before the endpoint is still its own row.
  const earlier = { ...stationary, end: 470000 };
  expect(timelinePresentation([walk(0, 120000), earlier, walk(470000, 480000), end]).some(n => n.terminalStay)).toBe(false);
});
test('a phone stationary run from the departure fix is one departure row', () => {
  const departure = { type: 'departure', start: 0, end: 0, latitude: 24.98921, longitude: 121.31321 };
  const run = { ...stationary, id: 'phone-stationary:0', start: 0, end: 300000, durationMs: 300000 };
  const shown = timelinePresentation([departure, run, walk(300000, 480000), endpoint]);
  expect(shown[0]).toMatchObject({ type: 'departure', departureStay: run, end: 300000 });
  expect(shown.filter(n => n.type === 'stop')).toHaveLength(0);
});
test.each(['現在', '最後', '結束', '記錄已關閉'])('terminal presentation retains endpoint semantic label %s', label => {
  expect(timelinePresentation([terminalStay, { ...endpoint, label }])[0].label).toBe(label);
});

test.each(['walking', 'driving'])('PNG %s glyph leaves visible connecting line on both sides', mode => {
  const row = exportTimelineRows([{ ...walk(0, 60000), mode }], () => '')[0];
  const block = { type: 'row', row, ...layoutRow(row, (text, size) => text.length * size), color: '#123456', y: 0 };
  const page = { width: 1080, height: 500, titleLines: [], subtitleLines: [], legend: [], blocks: [block], footer: { page: '1', y: 480, height: 20 } };
  const ops = pngDrawPages({ pages: [page] })[0].ops;
  const icon = ops.find(op => op.t === 'icon');
  expect(icon.y).toBeGreaterThanOrEqual(40);
  expect(block.height - icon.y - icon.size).toBeGreaterThanOrEqual(40);
  if (mode === 'walking') {
    expect(ops.some(op => op.t === 'circle' && op.cy < icon.y)).toBe(true);
    expect(ops.some(op => op.t === 'circle' && op.cy > icon.y + icon.size)).toBe(true);
  } else {
    expect(ops.some(op => op.t === 'line' && op.y1 < icon.y && op.y2 > icon.y + icon.size)).toBe(true);
  }
});


test('departure and its exact adjacent initial stay share one departure row without renumbering or mutating raw nodes', () => {
  const departure = { type: 'departure', start: 59000, end: 59000, latitude: 24.9892, longitude: 121.3132 };
  const stay = { ...terminalStay, number: 1, start: 59000, end: 120000, durationMs: 61000 };
  const nodes = [departure, stay, walk(120000, 180000), { ...terminalStay, number: 2, start: 180000 }];
  const original = JSON.stringify(nodes);
  const shown = timelinePresentation(nodes);
  expect(shown.map(node => node.type)).toEqual(['departure', 'movement', 'stop']);
  expect(shown[0]).toMatchObject({ start: 59000, end: 120000, durationMs: 61000, departureStay: { number: 1 }, displayDurationMs: 120000 });
  expect(shown[2].number).toBe(2);
  const rows = exportTimelineRows(nodes, () => '虛構起點地址');
  expect(rows[0].pill.text).toContain('出發');
  expect(rows[0].pill.text).toContain('停 2 分');
  expect(JSON.stringify(nodes)).toBe(original);
});

test.each(['coordinate', 'time', 'gap', 'number'])('initial departure collapse rejects a different %s boundary', reason => {
  const departure = { type: 'departure', start: 0, end: 0, latitude: 24.9892, longitude: 121.3132 };
  const stay = { ...terminalStay, number: 1, start: 0, end: 60000, durationMs: 60000 };
  if (reason === 'coordinate') stay.latitude += 0.00001;
  if (reason === 'time') stay.start = 1;
  if (reason === 'gap') stay.gaps = [{ start: 1000, end: 2000 }];
  if (reason === 'number') stay.number = 2;
  expect(timelinePresentation([departure, stay]).map(node => node.type)).toEqual(['departure', 'stop']);
});

test('minute precision aligns consecutive displayed clocks without changing observed duration or a stay\'s interruptions', () => {
  const a = walk(59000, 120000), b = { ...terminalStay, start: 120000, end: 179000, durationMs: 59000 };
  const nodes = [a, b, { ...endpoint, start: 179000, end: 179000 }];
  const rows = exportTimelineRows(nodes, () => '虛構地址');
  expect(rows[0].time).toBe('2 分');
  expect(rows[1].pill.text).toContain('停 0 分');
  expect(timelinePresentation(nodes)[0].durationMs).toBe(61000);
  // A merged walk's minutes are its clock span, short weak-GPS time included
  // (00:00:59–00:04:00 is listed 00:00 → 4 分).
  const merged = timelinePresentation([walk(59000, 120000), same(120000, 180000, 'uncertain'), walk(180000, 240000)]);
  expect(merged[0].durationMs).toBe(181000);
  expect(merged[0].displayDurationMs).toBe(240000);
  const interrupted = timelinePresentation([{ ...b, durationMs: 30000, interruptionMs: 29000 }]);
  expect(interrupted[0].displayDurationMs).toBeUndefined();
});


test('a single initial stay does not erase the departure when its endpoint is also present', () => {
  const stay = { ...terminalStay, number: 1, start: 0 };
  const first = { ...stay, type: 'departure', end: 0, durationMs: 0 };
  const shown = timelinePresentation([first, stay, endpoint]);
  expect(shown.map(node => node.type)).toEqual(['departure', 'end']);
  expect(shown[0].departureStay).toEqual(stay);
});

// Clipping within a displayed minute can make observed rounding differ from clock rounding.
test.each([
  [4 * 60000 + 49000, 9 * 60000 + 18000, '5'],
  [12 * 60000 + 44000, 19 * 60000 + 2000, '7'],
])('a clipped stay has identical visible and spoken minutes (%s to %s)', (start, end, minutes) => {
  const raw = { ...terminalStay, start, end, durationMs: end - start };
  const shown = timelinePresentation([raw])[0];
  expect(nodePill(shown).text).toBe(`停 ${minutes} 分`);
  expect(placeSpeech(shown, '虛構地點')).toContain(`${minutes} 分鐘`);
  expect(raw.displayDurationMs).toBeUndefined();
});

test('a stay with an observation gap keeps actual observed minutes in both speech and visible pill', () => {
  const raw = { ...terminalStay, start: 4 * 60000, end: 9 * 60000, durationMs: 3 * 60000, interruptionMs: 2 * 60000 };
  const shown = timelinePresentation([raw])[0];
  expect(nodePill(shown).text).toBe('停 3 分');
  expect(placeSpeech(shown, '虛構地點')).toContain('3 分鐘');
});

test('clipped departure uses membership of the same confirmed visit, never address proximity', () => {
  const departure = { type: 'departure', start: 2449000, end: 2449000, latitude: 25, longitude: 121 };
  const stay = { type: 'stop', id: 'visit:2400000', number: 1, start: departure.start, end: 2718000,
    durationMs: 269000, latitude: 25.00002, longitude: 121.00003, gaps: [],
    points: [{ time: departure.start, latitude: 25, longitude: 121 }, { time: 2718000, latitude: 25.00004, longitude: 121.00006 }] };
  const nodes = [departure, stay, walk(stay.end, stay.end + 60000)];
  const original = JSON.stringify(nodes);
  const shown = timelinePresentation(nodes);
  expect(shown.map(n => n.type)).toEqual(['departure', 'movement']);
  expect(shown[0]).toMatchObject({ latitude: stay.latitude, longitude: stay.longitude, departureStay: { id: stay.id } });
  expect(JSON.stringify(nodes)).toBe(original);
  for (const changed of [
    { ...stay, id: undefined },
    { ...stay, points: [{ ...stay.points[0], time: departure.start + 1 }] },
    { ...stay, points: [{ ...stay.points[0], latitude: 25.000001 }] },
    { ...stay, displayRange: { gaps: [{ start: departure.start + 1000, end: departure.start + 2000 }] } },
  ]) expect(timelinePresentation([departure, changed]).map(n => n.type)).toEqual(['departure', 'stop']);
  expect(timelinePresentation([departure, walk(departure.start, stay.start + 1), stay])
    .some(n => n.departureStay)).toBe(false);
});

// 2026-10-13 (dog 108's 10/12 on the emulator began 「00:01 接續前一天」): a
// stay going on from the day before begins its row at midnight, its minutes
// from there too, when the day's first packet is within a packet gap of it.
describe('a stay going on from the day before begins its row at midnight', () => {
  const { nodeTimes, listDuration } = require('../src/history/HistoryText');
  const { presentationDurationMs } = require('../src/history/HistoryTimelinePresentation');
  // Made-up times: 2026-10-12, Taiwan.
  const MIDNIGHT = new Date('2026-10-12T00:00:00+08:00').getTime();
  const indoor = (start, end, extra = {}) => ({ type: 'indoor', start, end, durationMs: end - start,
    latitude: 24.99, longitude: 121.31, continuesPreviousDay: true, ...extra });
  const stop = (start, end, extra = {}) => ({ type: 'stop', number: 1, id: 'visit:1', start, end,
    durationMs: end - start, latitude: 24.99, longitude: 121.31, continuesPreviousDay: true, ...extra });
  const end = at => ({ type: 'end', start: at, end: at, latitude: 24.99, longitude: 121.32, label: '最後' });
  const HOUR = 60 * MIN;

  test('室內 from the night before: 00:00, minutes from midnight; the model is untouched', () => {
    const nodes = [indoor(MIDNIGHT + 70 * 1000, MIDNIGHT + 7 * HOUR + 20 * 1000),
      walk(MIDNIGHT + 7 * HOUR + 20 * 1000, MIDNIGHT + 7 * HOUR + 30 * MIN), end(MIDNIGHT + 7 * HOUR + 30 * MIN)];
    const before = JSON.stringify(nodes);
    const [row] = timelinePresentation(nodes);
    expect(nodeTimes(row)).toEqual(['00:00', '07:00']);
    expect(nodePill(row).text).toBe('接續前一天');
    expect(row.start).toBe(MIDNIGHT);
    expect(listDuration(presentationDurationMs(row))).toBe('7 時');
    // The cursor and TalkBack say the row's minutes.
    expect(shownStayDurationMs(nodes, nodes[0])).toBe(7 * HOUR);
    expect(shownRowAt(nodes, MIDNIGHT + 30 * 1000)).toMatchObject({ type: 'indoor', start: MIDNIGHT });
    expect(placeSpeech(row, '虛構地點')).toContain('00:00 到 07:00');
    expect(JSON.stringify(nodes)).toBe(before);
  });

  test('a stop from the night before, the same', () => {
    const [row] = timelinePresentation([stop(MIDNIGHT + 2 * MIN, MIDNIGHT + 40 * MIN),
      walk(MIDNIGHT + 40 * MIN, MIDNIGHT + 50 * MIN), end(MIDNIGHT + 50 * MIN)]);
    expect(nodeTimes(row)).toEqual(['00:00', '00:40']);
    expect(nodePill(row).text).toBe('接續前一天');
  });

  test('a first packet long after midnight, or a stay that did not go on, keeps its own time', () => {
    const late = timelinePresentation([indoor(MIDNIGHT + 3 * HOUR, MIDNIGHT + 5 * HOUR), end(MIDNIGHT + 5 * HOUR + MIN)]);
    expect(nodeTimes(late[0])[0]).toBe('03:00');
    const own = timelinePresentation([indoor(MIDNIGHT + MIN, MIDNIGHT + HOUR, { continuesPreviousDay: false }),
      end(MIDNIGHT + HOUR + MIN)]);
    expect(nodeTimes(own[0])[0]).toBe('00:01');
  });
});
