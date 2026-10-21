import { interruptionText, nodePill, placeSpeech, sectionText } from '../src/history/HistoryText';
import { shownRowAt, shownStayDurationMs } from '../src/history/HistoryTimelinePresentation';
import { timelinePresentation } from '../src/history/HistoryTimelinePresentation';
import { exportTimelineRows } from '../src/mapHistory/ExportSnapshot';
import { layoutRow, PNG_STYLE } from '../src/mapHistory/ExportPNG';
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
  // 2026-10-15 (user, layout A): the address first at full width, the pill
  // on the line under it, both at the place column's left edge.
  expect(pill.y).toBeGreaterThan(address.y);
  expect(pill.x).toBeGreaterThan(0);
  expect(pill.x - address.x).toBeLessThanOrEqual(PNG_STYLE.pillPadding);
});

test('PNG: a wide pill never takes room from the address (layout A)', () => {
  const row = { kind: 'place', title: '虛構長地址', pill: { text: '在附近走動 1 時 49 分・200 m', tone: 'stay' } };
  const block = layoutRow(row, (text, size) => text === row.pill.text ? 800 : text.length * size);
  expect(block.titleX).toBe(0);
  expect(block.titleY).toBe(0);
  expect(block.titleLines.join('')).toBe(row.title);
  // The pill lies below the address's last line.
  expect(block.items[0].y).toBeGreaterThanOrEqual(block.titleLines.length * PNG_STYLE.addressLine);
});

const terminalStay = { type: 'stop', number: 3, start: 120000, end: 480000,
  durationMs: 360000, latitude: 24.9892, longitude: 121.3132, gaps: [] };
const endpoint = { type: 'end', start: 480000, end: 480000,
  latitude: 24.9892, longitude: 121.3132, label: '結束' };
// 2026-10-14 (user, replaces merging the last stay into the end): a range
// that ends in a stay ends with that stay, a numbered row; no end row.
test('a range ending in a stay ends with that numbered stay: no end row, source nodes untouched', () => {
  const nodes = [walk(0, 120000), terminalStay, endpoint];
  const original = JSON.stringify(nodes);
  const shown = timelinePresentation(nodes);
  expect(shown.map(n => n.type)).toEqual(['movement', 'stop']);
  expect(shown[1]).toMatchObject({ number: 3, start: 120000, end: 480000, durationMs: 360000 });
  const rows = exportTimelineRows(nodes, () => '虛構終點地址');
  expect(rows).toHaveLength(2);
  expect(rows[1]).toMatchObject({ type: 'stop', number: 3, title: '虛構終點地址' });
  expect(rows[1].pill.text).toBe('停 6 分');
  expect(JSON.stringify(nodes)).toBe(original);
});
test.each([
  [terminalStay, { ...endpoint, latitude: endpoint.latitude + 0.001 }],
  [{ ...terminalStay, gaps: [{ start: 300000, end: 400000 }] }, endpoint],
  [{ ...terminalStay, id: 'visit:120000' }, { ...endpoint, label: '現在' }],
  [{ ...terminalStay, presentationOnly: 'phone-stationary', number: null }, { ...endpoint, label: '最後' }],
])('the end at a stay\'s last fix is that stay, wherever its fix and whatever its label: %j', (...tail) => {
  const shown = timelinePresentation(tail);
  expect(shown.map(n => n.type)).toEqual(['stop']);
  expect(shown.some(n => n.terminalStay)).toBe(false);
});
// A few still seconds after the stay are its time too (every minute has a
// row), so that range still ends in the stay; a walk or a long break after it
// does not.
test.each([
  [terminalStay, gap(480000, 480000 + 40 * MIN), { ...endpoint, start: 480000 + 40 * MIN, end: 480000 + 40 * MIN }],
  [terminalStay, walk(480000, 540000), { ...endpoint, start: 540000, end: 540000 }],
])('a range ending on the move or after a long break keeps its end row: %j', (...tail) => {
  const shown = timelinePresentation(tail);
  expect(shown.filter(n => n.type === 'stop')).toHaveLength(1);
  expect(shown.filter(n => n.type === 'end')).toHaveLength(1);
});
test('a switched-off recording keeps its end row 「記錄已關閉 10:20」 after the stay', () => {
  const closed = { ...endpoint, label: '記錄已關閉', closedAt: 480000 };
  const shown = timelinePresentation([walk(0, 120000), terminalStay, closed]);
  expect(shown.map(n => n.type)).toEqual(['movement', 'stop', 'end']);
  expect(nodePill(shown[2]).tone).toBe('closed');
});
// PR 116's shape: an unnumbered stationary run anchored at its first fix,
// possibly across a same-place save gap, ending at the endpoint's fix.
const stationary = { type: 'stop', id: 'phone-stationary:120000', presentationOnly: 'phone-stationary', number: null,
  start: 120000, end: 480000, durationMs: 360000, interruptionMs: 0, gaps: [], unobserved: [{ start: 200000, end: 400000 }],
  latitude: 24.98921, longitude: 121.31321 };
test('a phone stationary run ending at the endpoint is the last row, unnumbered, with its minutes', () => {
  const end = { ...endpoint, label: '現在' };
  const shown = timelinePresentation([walk(0, 120000), stationary, end]);
  expect(shown.map(n => n.type)).toEqual(['movement', 'stop']);
  expect(shown[1]).toMatchObject({ id: stationary.id, start: 120000, end: 480000, number: null });
  // A run that ended before the endpoint: the walk after it and the end row.
  const earlier = { ...stationary, end: 470000 };
  expect(timelinePresentation([walk(0, 120000), earlier, walk(470000, 480000), end]).map(n => n.type))
    .toEqual(['movement', 'stop', 'movement', 'end']);
});
// 2026-10-14 (user): a range that begins with a stay has no 出發 row.
test('a phone stationary run from the departure fix is the first row, with no 出發', () => {
  const departure = { type: 'departure', start: 0, end: 0, latitude: 24.98921, longitude: 121.31321 };
  const run = { ...stationary, id: 'phone-stationary:0', start: 0, end: 300000, durationMs: 300000 };
  const shown = timelinePresentation([departure, run, walk(300000, 480000), endpoint]);
  expect(shown.map(n => n.type)).toEqual(['stop', 'movement', 'end']);
  expect(shown[0]).toMatchObject({ id: run.id, start: 0, end: 300000, number: null });
  expect(shown.some(n => n.departureStay)).toBe(false);
});
// 2026-10-14: an end row (a range ending on the move) keeps its state; only
// a fixed end says nothing (no capsule): the row is its time and place.
// 2026-10-15 (user): never 「最後 HH:MM」 — no fix since: 「HH:MM 之後沒有位置」.
test.each([['now', /^現在$/u], ['no-fix', /^\d\d:\d\d 之後沒有位置$/u], ['fixed', null]])('a moving end keeps its state %s', (endState, pill) => {
  const shown = timelinePresentation([walk(0, 540000), { ...endpoint, start: 540000, end: 540000, endState }]);
  expect(shown[1].endState).toBe(endState);
  if (pill) expect(nodePill(shown[1]).text).toMatch(pill);
  else expect(nodePill(shown[1])).toBeNull();
});
test('a day of one stay is one row: the stay, numbered', () => {
  const only = { ...terminalStay, number: 1, start: 0 };
  expect(timelinePresentation([only, endpoint]).map(n => n.type)).toEqual(['stop']);
  const departure = { type: 'departure', start: 0, end: 0, latitude: only.latitude, longitude: only.longitude };
  const shown = timelinePresentation([departure, only, endpoint]);
  expect(shown.map(n => n.type)).toEqual(['stop']);
  expect(shown[0]).toMatchObject({ number: 1, start: 0, end: 480000 });
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
    // The car line stops short of the glyph and goes on below it, never through it.
    const lines = ops.filter(op => op.t === 'line');
    expect(lines.some(op => op.y1 < icon.y && op.y2 <= icon.y)).toBe(true);
    expect(lines.some(op => op.y1 >= icon.y + icon.size && op.y2 > icon.y + icon.size)).toBe(true);
    expect(lines.some(op => op.y1 < icon.y + icon.size && op.y2 > icon.y)).toBe(false);
  }
  // Like the screen's transportIcon: no dot or line inside the glyph.
  expect(ops.some(op => op.t === 'circle' && op.cy + op.r > icon.y && op.cy - op.r < icon.y + icon.size)).toBe(false);
});


test('a range that begins with a stay lists that stay first, numbered, with no 出發 and raw nodes untouched', () => {
  const departure = { type: 'departure', start: 59000, end: 59000, latitude: 24.9892, longitude: 121.3132 };
  const stay = { ...terminalStay, number: 1, start: 59000, end: 120000, durationMs: 61000 };
  const nodes = [departure, stay, walk(120000, 180000), { ...terminalStay, number: 2, start: 180000 }];
  const original = JSON.stringify(nodes);
  const shown = timelinePresentation(nodes);
  expect(shown.map(node => node.type)).toEqual(['stop', 'movement', 'stop']);
  expect(shown[0]).toMatchObject({ number: 1, start: 59000, end: 120000, durationMs: 61000, displayDurationMs: 120000 });
  expect(shown[2].number).toBe(2);
  const rows = exportTimelineRows(nodes, () => '虛構起點地址');
  expect(rows[0]).toMatchObject({ type: 'stop', number: 1, title: '虛構起點地址' });
  expect(rows[0].pill.text).toBe('停 2 分');
  expect(rows.some(row => row.pill?.text?.includes('出發'))).toBe(false);
  expect(placeSpeech(shown[0], '虛構起點地址')).toMatch(/^停留 1，/u);
  expect(JSON.stringify(nodes)).toBe(original);
});

// The stay a range begins with is its first row whatever its own coordinate,
// a few ms' offset, an interruption inside it or its number (2026-10-14:
// nothing is merged any more, the bare 出發 point just goes).
test.each(['coordinate', 'time', 'gap', 'number'])('a range that begins with a stay of a different %s has no 出發 either', reason => {
  const departure = { type: 'departure', start: 0, end: 0, latitude: 24.9892, longitude: 121.3132 };
  const stay = { ...terminalStay, number: 1, start: 0, end: 60000, durationMs: 60000 };
  if (reason === 'coordinate') stay.latitude += 0.00001;
  if (reason === 'time') stay.start = 1;
  if (reason === 'gap') Object.assign(stay, { gaps: [{ start: 1000, end: 2000 }], durationMs: 59000, interruptionMs: 1000 });
  if (reason === 'number') stay.number = 2;
  const shown = timelinePresentation([departure, stay]);
  expect(shown.map(node => node.type)).toEqual(['stop']);
  expect(shown[0]).toMatchObject({ start: 0, latitude: stay.latitude, number: stay.number });
});

test('a range that begins moving keeps 出發; the seconds of the stay a detected departure set off from are the walk\'s', () => {
  const departure = { type: 'departure', start: 0, end: 0, latitude: 24.9892, longitude: 121.3132 };
  expect(timelinePresentation([departure, walk(0, 120000), { ...terminalStay, number: 1 }])[0].type).toBe('departure');
  // The detected departure is the stay's last fix (the fix before the walk).
  const stay = { ...terminalStay, number: 1, start: 0, end: 50000, durationMs: 50000 };
  const shown = timelinePresentation([{ ...departure, detected: true }, stay, walk(50000, 400000)]);
  expect(shown.map(node => node.type)).toEqual(['departure', 'movement']);
  // 出發 shows no minutes, so it is a moment; the walk starts at it (the
  // times add up: HistoryTimeClocks).
  expect(shown[0]).toMatchObject({ start: 0, end: 0, departureStay: stay });
  expect(shown[1]).toMatchObject({ start: 0, end: 400000 });
  // 2026-10-14: no 「出發」 — the start row is its time and place only.
  expect(nodePill(shown[0])).toBeNull();
});

test('minute precision aligns consecutive displayed clocks without changing observed duration or a stay\'s interruptions', () => {
  const a = walk(59000, 120000), b = { ...terminalStay, start: 120000, end: 179000, durationMs: 59000 };
  const nodes = [a, b, { ...endpoint, start: 179000, end: 179000 }];
  const rows = exportTimelineRows(nodes, () => '虛構地址');
  expect(rows[0].time).toBe('2 分');
  // 2026-10-14: the stay the range ends in is the last row (no end row).
  expect(rows).toHaveLength(2);
  expect(rows[1]).toMatchObject({ type: 'stop' });
  expect(timelinePresentation(nodes)[0].durationMs).toBe(61000);
  // A merged walk's minutes are its clock span, short weak-GPS time included
  // (00:00:59–00:04:00 is listed 00:00 → 4 分).
  const merged = timelinePresentation([walk(59000, 120000), same(120000, 180000, 'uncertain'), walk(180000, 240000)]);
  expect(merged[0].durationMs).toBe(181000);
  expect(merged[0].displayDurationMs).toBe(240000);
  const interrupted = timelinePresentation([{ ...b, durationMs: 30000, interruptionMs: 29000 }]);
  // 2026-10-14: its clocks (00:02–00:02) less its interruption: the shown
  // minutes add up with the 「不含中斷」 note (HistoryTimeClocks).
  expect(interrupted[0].displayDurationMs).toBe(0);
});


test('a single initial stay with its endpoint: the stay alone (no 出發, no end row)', () => {
  const stay = { ...terminalStay, number: 1, start: 0 };
  const first = { ...stay, type: 'departure', end: 0, durationMs: 0 };
  const shown = timelinePresentation([first, stay, endpoint]);
  expect(shown.map(node => node.type)).toEqual(['stop']);
  expect(shown[0]).toEqual(stay);
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
  // 2026-10-14: the stay is the first row, at its own (mean) coordinate.
  expect(shown.map(n => n.type)).toEqual(['stop', 'movement']);
  expect(shown[0]).toMatchObject({ id: stay.id, number: 1, latitude: stay.latitude, longitude: stay.longitude });
  expect(JSON.stringify(nodes)).toBe(original);
  // A detected departure from that stay's fix keeps 出發 and takes the
  // clipped stay only when the same visit proves that point is the stay's.
  const detected = { ...departure, detected: true };
  expect(timelinePresentation([detected, stay, walk(stay.end, stay.end + 60000)])[0])
    .toMatchObject({ type: 'departure', latitude: stay.latitude, departureStay: { id: stay.id } });
  for (const changed of [
    { ...stay, id: undefined },
    { ...stay, points: [{ ...stay.points[0], time: departure.start + 1 }] },
    { ...stay, points: [{ ...stay.points[0], latitude: 25.000001 }] },
    { ...stay, displayRange: { gaps: [{ start: departure.start + 1000, end: departure.start + 2000 }] } },
  ]) expect(timelinePresentation([detected, changed]).map(n => n.type)).toEqual(['departure', 'stop']);
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
  const end = at => ({ type: 'end', start: at, end: at, latitude: 24.99, longitude: 121.32, endState: 'no-fix' });
  const HOUR = 60 * MIN;

  test('室內 from the night before: 00:00, minutes from midnight; the model is untouched', () => {
    const nodes = [indoor(MIDNIGHT + 70 * 1000, MIDNIGHT + 7 * HOUR + 20 * 1000),
      walk(MIDNIGHT + 7 * HOUR + 20 * 1000, MIDNIGHT + 7 * HOUR + 30 * MIN), end(MIDNIGHT + 7 * HOUR + 30 * MIN)];
    const before = JSON.stringify(nodes);
    const [row] = timelinePresentation(nodes);
    expect(nodeTimes(row)).toEqual(['00:00', '07:00']);
    // 2026-10-15 (user): no 「接續前一天」 pill — its 00:00 says it.
    expect(nodePill(row).text).toBe('在遮蔽處 7 時');
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
    expect(nodePill(row).text).toBe('停 40 分');
  });

  test('a first packet long after midnight, or a stay that did not go on, keeps its own time', () => {
    const late = timelinePresentation([indoor(MIDNIGHT + 3 * HOUR, MIDNIGHT + 5 * HOUR), end(MIDNIGHT + 5 * HOUR + MIN)]);
    expect(nodeTimes(late[0])[0]).toBe('03:00');
    const own = timelinePresentation([indoor(MIDNIGHT + MIN, MIDNIGHT + HOUR, { continuesPreviousDay: false }),
      end(MIDNIGHT + HOUR + MIN)]);
    expect(nodeTimes(own[0])[0]).toBe('00:01');
  });
});

// 2026-10-15 (audit of real days, live checkpoints): two shapes whose times
// did not add up while today was still being recorded. Fictional nodes.
describe('live rows always add up', () => {
  const at = { latitude: 24.9892, longitude: 121.3138 };
  test('the seconds between 恢復記錄 and the live end are a row (no hole)', () => {
    // 57 min with no data, the recording back at 10:22:43, the end (現在) at
    // 10:23:06: the 0 m step between the two moments was dropped.
    const nodes = [gap(9 * 60 * MIN, 10 * 60 * MIN + 22 * MIN + 43000), { type: 'resume', ...at,
      start: 10 * 60 * MIN + 22 * MIN + 43000, end: 10 * 60 * MIN + 22 * MIN + 43000 },
    { type: 'end', ...at, start: 10 * 60 * MIN + 23 * MIN + 6000, end: 10 * 60 * MIN + 23 * MIN + 6000, label: '現在' }];
    const shown = timelinePresentation(nodes);
    for (let i = 1; i < shown.length; i += 1) expect(shown[i].start).toBe(shown[i - 1].end);
    expect(shown.at(-1).end).toBe(10 * 60 * MIN + 23 * MIN + 6000);
    // The phone was there: an unnumbered stay from the recording's return.
    expect(shown.at(-1)).toMatchObject({ type: 'stop', presentationOnly: 'between-breaks', number: null,
      start: 10 * 60 * MIN + 22 * MIN + 43000 });
  });

  test('a departure still being confirmed, still there since: the stay is the row, not a 5-minute 出發', () => {
    const start = 16 * 60 * MIN + 4 * MIN + 39000, end = 16 * 60 * MIN + 9 * MIN + 55000;
    const nodes = [{ type: 'departure', ...at, start, end: start, detected: true },
      { type: 'stop', presentationOnly: 'still-here', number: null, ...at, start, end, durationMs: end - start,
        interruptionMs: 0, gaps: [] },
      { type: 'end', ...at, start: end, end, label: '現在' }];
    const shown = timelinePresentation(nodes);
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ type: 'stop', presentationOnly: 'still-here', start, end });
    expect(shown.some(row => row.type === 'departure' && row.end > row.start)).toBe(false);
  });

  test('a detected departure that set off from a stay keeps its moment (unchanged)', () => {
    const nodes = [{ type: 'departure', ...at, start: 0, end: 0, detected: true },
      { type: 'stop', id: 'visit:1', number: 1, ...at, start: 0, end: 20000, durationMs: 20000, points: [{ time: 0, ...at }] },
      walk(20000, 10 * MIN, 600), { type: 'end', ...at, start: 10 * MIN, end: 10 * MIN, label: '現在' }];
    const shown = timelinePresentation(nodes);
    expect(shown[0]).toMatchObject({ type: 'departure', start: 0, end: 0 });
    expect(shown[1]).toMatchObject({ type: 'movement', start: 0 });
  });
});

// 2026-10-15 (user): an end that says something of its own stays a row
// after the stay it is in — 「20:49 之後沒有位置」 like 記錄已關閉; 「現在」 and a
// plain end go into the stay as before.
test.each([['no-fix', 2], ['now', 1], ['fixed', 1]])('an end %s after a stay: %i rows', (endState, count) => {
  const stay = { type: 'stop', number: 1, id: 'visit:0', start: 0, end: 600000, durationMs: 600000,
    latitude: 24.9892, longitude: 121.3132 };
  const end = { type: 'end', start: 600000, end: 600000, latitude: 24.9892, longitude: 121.3132, endState };
  expect(timelinePresentation([stay, end])).toHaveLength(count);
});
