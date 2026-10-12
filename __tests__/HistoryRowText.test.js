// 2026-10-13 approved list wording (invented places and times only):
// short rows in metres, a row with distance never says 「0 分」, and 出發
// names the same place as a 室內 hold that starts right after it.
import { t as i18nT } from '../src/i18n';
import { km, movementSummary, nodePill, placeSpeech, rowDistance, sectionSpeech, sectionText } from '../src/history/HistoryText';
import { timelinePresentation } from '../src/history/HistoryTimelinePresentation';
import { historyTimeline } from '../src/history/HistoryTimeline';
import { cursorLabel } from '../src/history/screen';
import { exportTimelineRows } from '../src/mapHistory/ExportSnapshot';
import { offset } from '../__fixtures__/IndoorScenarios';

const MINUTE = 60000;
const T0 = new Date(2026, 0, 5, 9, 0).getTime();
const move = (mode, start, end, metres) => ({ type: 'movement', mode, start, end, durationMs: end - start,
  distanceM: metres, countedDistanceM: ['driving', 'ride'].includes(mode) ? 0 : metres });

describe('short distances in metres', () => {
  test.each([
    [0, '0 m'], [4, '0 m'], [5, '10 m'], [40, '40 m'], [44, '40 m'], [94, '90 m'],
    // The rounded value decides: never 「100 m」.
    [95, '0.1 km'], [100, '0.1 km'], [149, '0.1 km'], [1449, '1.4 km'], [null, '0 m'], [-3, '0 m'],
  ])('%p m → %s', (metres, text) => expect(rowDistance(metres)).toBe(text));

  test('walking, moving and vehicle rows; ≥ 100 m keep km', () => {
    expect(sectionText(move('walking', T0, T0 + 2 * MINUTE, 40))).toMatchObject({ time: '2 分', rest: '・40 m' });
    expect(sectionText(move('moving', T0, T0 + 3 * MINUTE, 0))).toMatchObject({ time: '3 分', rest: '・0 m' });
    expect(sectionText(move('driving', T0, T0 + 2 * MINUTE, 80))).toMatchObject({ rest: '・80 m' });
    expect(sectionText(move('ride', T0, T0 + 9 * MINUTE, 4100))).toMatchObject({ rest: '・4.1 km' });
    expect(sectionText(move('walking', T0, T0 + 28 * MINUTE, 1400)).rest).toBe('・1.4 km');
  });

  test('TalkBack says metres', () => {
    expect(sectionSpeech(move('walking', T0, T0 + 2 * MINUTE, 40))).toBe('走路 2 分鐘，40 公尺');
  });

  test('the cursor reads like a row; the summary total stays km', () => {
    const model = { points: [{ time: T0 }, { time: T0 + 10 * MINUTE }], locations: [],
      sections: [move('moving', T0, T0 + 10 * MINUTE, 80)], distanceM: 80, durationMs: 10 * MINUTE, nodes: [] };
    expect(cursorLabel(model, T0 + 5 * MINUTE)[1]).toBe('已移動 40 m');
    expect(cursorLabel(model, T0)[1]).toBe('已移動 0 m');
    expect(cursorLabel(model, T0 + 10 * MINUTE, 'phone')[1]).toBe('已走 80 m');
    expect(movementSummary(model, 'dog')).toContain(km(80));
    expect(km(80)).toBe('0.1 km');
  });
});

describe('a row with distance never shows 0 minutes', () => {
  test('clock-aligned minutes of 0 with distance: 「不到 1 分」; durations unchanged', () => {
    // 09:00:10–09:00:50: one clock minute, 200 m (a dog running).
    const row = move('moving', T0 + 10000, T0 + 50000, 200);
    const [shown] = timelinePresentation([row]);
    expect(shown.durationMs).toBe(40000);
    expect(sectionText(shown)).toMatchObject({ lead: i18nT('c125'), time: '不到 1 分', rest: '・0.2 km' });
    expect(sectionSpeech(shown)).toBe('移動 不到 1 分鐘，0.2 公里');
    expect(row.durationMs).toBe(40000);
  });

  test('crossing a clock minute keeps the clock minutes', () => {
    // 09:00:50–09:01:10 is 「1 分」 by the clocks (displayDurationMs).
    const [shown] = timelinePresentation([move('walking', T0 + 50000, T0 + 70000, 30)]);
    expect(shown.displayDurationMs).toBe(MINUTE);
    expect(sectionText(shown).time).toBe('1 分');
  });

  test('vehicle rows use their actual distance', () => {
    expect(sectionText(move('ride', T0, T0 + 20000, 300)).time).toBe('不到 1 分');
  });

  test('a row showing 「0 m」 still says 「0 分」', () => {
    expect(sectionText(move('walking', T0, T0 + 20000, 0))).toMatchObject({ time: '0 分', rest: '・0 m' });
    expect(sectionText(move('walking', T0, T0 + 20000, 4))).toMatchObject({ time: '0 分', rest: '・0 m' });
  });
});

describe('出發 and a 室內 hold right after it name one place', () => {
  const raw = { latitude: 24.98931, longitude: 121.31321 };
  const anchor = { latitude: 24.98922, longitude: 121.31320 };
  const departure = { type: 'departure', start: T0, end: T0, ...raw };
  const indoor = (start, place = anchor) => ({ type: 'indoor', start, end: start + 40 * MINUTE, ...place });

  test('within a minute, nothing counted: the departure is shown at the hold; both rows stay', () => {
    const nodes = [departure, move('walking', T0, T0 + 30000, 0), indoor(T0 + 30000)];
    const before = JSON.stringify(nodes);
    const shown = timelinePresentation(nodes);
    expect(shown.map(n => n.type)).toEqual(['departure', 'movement', 'indoor']);
    expect(shown[0]).toMatchObject({ type: 'departure', start: T0, ...anchor });
    expect(shown[0].departureStay).toBeUndefined();
    expect(JSON.stringify(nodes)).toBe(before);
    // The PNG list shows the screen's rows: one address for both.
    const rows = exportTimelineRows(nodes, node => `虛構地址 ${node.latitude}`);
    expect(rows[0].title).toBe(rows[2].title);
  });

  test('directly adjacent and across a short weak-GPS row', () => {
    expect(timelinePresentation([departure, indoor(T0 + 20000)])[0]).toMatchObject(anchor);
    expect(timelinePresentation([departure, { type: 'gap', mode: 'gap', reason: 'uncertain', start: T0, end: T0 + 20000 },
      indoor(T0 + 20000)])[0]).toMatchObject(anchor);
  });

  test.each([
    ['counted distance between', [departure, move('moving', T0, T0 + 30000, 12), indoor(T0 + 30000)]],
    ['more than a minute later', [departure, move('walking', T0, T0 + 90000, 0), indoor(T0 + 90000)]],
    ['a vehicle between', [departure, move('ride', T0, T0 + 30000, 300), indoor(T0 + 30000)]],
    ['a signal break between', [departure, { type: 'gap', mode: 'gap', reason: 'no-signal', start: T0, end: T0 + 30000 },
      indoor(T0 + 30000)]],
    ['a stay first', [departure, { type: 'stop', number: 1, start: T0 + 30000, end: T0 + 10 * MINUTE, ...anchor },
      indoor(T0 + 10 * MINUTE)]],
    ['a hold without coordinates', [departure, indoor(T0 + 30000, { latitude: null, longitude: null })]],
  ])('unchanged: %s', (_, nodes) => {
    expect(timelinePresentation(nodes)[0]).toMatchObject(raw);
  });

  test('a dog history: first fix 4 m off, then a hold — model keeps the fix, the list the hold', () => {
    const origin = { latitude: 24.9892, longitude: 121.3132 };
    const good = (time, metres, speed = null) => ({ time, ...offset(origin, metres, 0),
      satellites: 9, hdop: 1, speed_kmh: speed, master_id: 1, slave_id: 6 });
    const classify = rows => ({ environment: 'window', observedAt: Math.max(...rows.map(r => r.track_at)) });
    const rows = [good(0, 4), good(5000, 1),
      ...Array.from({ length: 24 }, (_, i) => ({ ...good(10000 + i * 5000, 0),
        latitude: 0, longitude: 0, satellites: 0, hdop: 655.35 })),
      ...Array.from({ length: 30 }, (_, i) => good(130000 + i * 5000, i % 2 ? 3 : 0, 0))];
    const model = historyTimeline(rows, { subject: 'dog', dayStart: 0, dayEnd: 500000,
      range: { start: 0, end: 300000 }, holdOptions: { classify } });
    expect(model.nodes.map(n => n.type)).toEqual(['departure', 'indoor']);
    const [start, hold] = model.nodes;
    expect(start.latitude).toBe(model.points[0].latitude);
    expect(start.latitude).not.toBe(hold.latitude);
    const shown = timelinePresentation(model.nodes);
    expect(shown.map(n => n.type)).toEqual(['departure', 'indoor']);
    expect(shown[0]).toMatchObject({ latitude: hold.latitude, longitude: hold.longitude });
  });
});

describe('no 「接續隔天」 capsule', () => {
  const stay = { type: 'stop', number: 2, start: T0, end: T0 + 25 * MINUTE, durationMs: 25 * MINUTE,
    latitude: 24.9892, longitude: 121.3132, gaps: [] };
  const end = { type: 'end', start: T0 + 25 * MINUTE, end: T0 + 25 * MINUTE, latitude: 24.9892,
    longitude: 121.3132, label: i18nT('c330'), continuesNextDay: true };

  test('a terminal stay running past midnight shows only its minutes', () => {
    const shown = timelinePresentation([move('walking', T0 - 5 * MINUTE, T0, 300), stay, end]);
    expect(shown.at(-1).terminalStay).toBeDefined();
    expect(nodePill(shown.at(-1))).toEqual({ text: '停 25 分', tone: 'stay' });
    // The PNG row is the same capsule.
    const rows = exportTimelineRows([move('walking', T0 - 5 * MINUTE, T0, 300), stay, end], () => '虛構地址');
    expect(rows.at(-1).pill).toEqual({ text: '停 25 分', tone: 'stay' });
  });

  test('a plain end has no capsule; TalkBack still reads place and time', () => {
    expect(nodePill(end)).toBeNull();
    expect(placeSpeech(end, '虛構地址')).toBe('虛構地址，09:25');
  });

  test('a hold running past midnight keeps 「室內・N 分」', () => {
    expect(nodePill({ type: 'indoor', start: T0, end: T0 + 40 * MINUTE, continuesNextDay: true }))
      .toEqual({ text: '室內・40 分', tone: 'indoor' });
  });

  test('the copy is gone from resources', () => {
    expect(Object.values(require('../src/i18n/zh-TW.json'))).not.toContain('接續隔天');
  });
});
