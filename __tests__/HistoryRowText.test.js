// 2026-10-13 approved list wording (invented places and times only): one
// distance formatter for the card and the history list, a row with distance
// never says 「0 分」, a day that begins indoors has no 出發 row, and no
// 「接續隔天」 capsule.
import { t as i18nT } from '../src/i18n';
import { km, movementSummary, nodePill, placeSpeech, sectionSpeech, sectionText } from '../src/history/HistoryText';
import { timelinePresentation } from '../src/history/HistoryTimelinePresentation';
import { historyTimeline } from '../src/history/HistoryTimeline';
import { cursorLabel } from '../src/history/screen';
import { exportTimelineRows } from '../src/mapHistory/ExportSnapshot';
import { distanceText } from '../src/utils/distanceText';
import { formatDistance } from '../src/map/DogReadout';
import { offset } from '../__fixtures__/IndoorScenarios';

const MINUTE = 60000;
const T0 = new Date(2026, 0, 5, 9, 0).getTime();
const move = (mode, start, end, metres) => ({ type: 'movement', mode, start, end, durationMs: end - start,
  distanceM: metres, countedDistanceM: ['driving', 'ride'].includes(mode) ? 0 : metres });

describe('one distance formatter', () => {
  test.each([
    [0, '0 m'], [2, '0 m'], [3, '5 m'], [7.4, '5 m'], [8, '10 m'], [40, '40 m'], [44, '45 m'], [97, '95 m'],
    // Each step is decided on the rounded value.
    [98, '100 m'], [104, '100 m'], [126, '130 m'], [847, '850 m'], [994, '990 m'], [996, '1.0 km'],
    [1000, '1.0 km'], [1449, '1.4 km'], [12400, '12.4 km'], [null, '0 m'], [-3, '0 m'], [NaN, '0 m'],
  ])('%p m → %s', (metres, text) => expect(distanceText(metres)).toBe(text));

  test('the dog card uses the same formatter', () => {
    expect(formatDistance).toBe(distanceText);
  });

  test('walking, moving and vehicle rows', () => {
    expect(sectionText(move('walking', T0, T0 + 2 * MINUTE, 40))).toMatchObject({ time: '2 分', rest: '・40 m' });
    expect(sectionText(move('moving', T0, T0 + 3 * MINUTE, 0))).toMatchObject({ time: '3 分', rest: '・0 m' });
    expect(sectionText(move('driving', T0, T0 + 2 * MINUTE, 80))).toMatchObject({ rest: '・80 m' });
    expect(sectionText(move('walking', T0, T0 + 6 * MINUTE, 340))).toMatchObject({ rest: '・340 m' });
    expect(sectionText(move('ride', T0, T0 + 9 * MINUTE, 4100))).toMatchObject({ rest: '・4.1 km' });
    expect(sectionText(move('walking', T0, T0 + 28 * MINUTE, 1400)).rest).toBe('・1.4 km');
  });

  test('TalkBack says metres', () => {
    expect(sectionSpeech(move('walking', T0, T0 + 2 * MINUTE, 40))).toBe('走路 2 分鐘，40 公尺');
  });

  test('the cursor reads like a row; the summary total stays km', () => {
    const model = { points: [{ time: T0 }, { time: T0 + 10 * MINUTE }], locations: [],
      sections: [move('moving', T0, T0 + 10 * MINUTE, 80)], distanceM: 80, durationMs: 10 * MINUTE, nodes: [] };
    expect(cursorLabel(model, T0 + 5 * MINUTE)[1]).toBe('移動中・40 m');
    expect(cursorLabel(model, T0)[1]).toBe('移動中・0 m');
    expect(cursorLabel(model, T0 + 10 * MINUTE, 'phone')[1]).toBe('走路・已走 80 m');
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
    expect(sectionText(shown)).toMatchObject({ lead: i18nT('c125'), time: '不到 1 分', rest: '・200 m' });
    expect(sectionSpeech(shown)).toBe('移動 不到 1 分鐘，200 公尺');
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
    expect(sectionText(move('walking', T0, T0 + 20000, 2))).toMatchObject({ time: '0 分', rest: '・0 m' });
    expect(sectionText(move('walking', T0, T0 + 20000, 4))).toMatchObject({ time: '不到 1 分', rest: '・5 m' });
  });
});

describe('在室內就不要出發了: a day that begins indoors has no 出發 row', () => {
  const departure = { type: 'departure', start: T0, end: T0, latitude: 24.98931, longitude: 121.31321 };
  const indoor = start => ({ type: 'indoor', start, end: start + 40 * MINUTE, latitude: 24.98922, longitude: 121.3132 });

  test('a hold within a minute, nothing counted before it: the list starts with 室內', () => {
    const nodes = [departure, move('walking', T0, T0 + 30000, 0), indoor(T0 + 30000), move('walking', T0 + 40 * MINUTE + 30000, T0 + 50 * MINUTE, 600)];
    const before = JSON.stringify(nodes);
    const shown = timelinePresentation(nodes);
    expect(shown.map(n => n.type)).toEqual(['indoor', 'movement']);
    expect(JSON.stringify(nodes)).toBe(before);
    // The PNG list is the screen's list.
    expect(exportTimelineRows(nodes, () => '虛構地址').map(row => row.type)).toEqual(['indoor', 'movement']);
  });

  test('directly adjacent and across a short weak-GPS row', () => {
    expect(timelinePresentation([departure, indoor(T0 + 20000)]).map(n => n.type)).toEqual(['indoor']);
    expect(timelinePresentation([departure, { type: 'gap', mode: 'gap', reason: 'uncertain', start: T0, end: T0 + 20000 },
      indoor(T0 + 20000)]).map(n => n.type)).toEqual(['indoor']);
  });

  test.each([
    ['counted distance before it', [departure, move('moving', T0, T0 + 30000, 12), indoor(T0 + 30000)]],
    ['more than a minute later', [departure, move('walking', T0, T0 + 90000, 0), indoor(T0 + 90000)]],
    ['a vehicle before it', [departure, move('ride', T0, T0 + 30000, 300), indoor(T0 + 30000)]],
    ['a signal break before it', [departure, { type: 'gap', mode: 'gap', reason: 'no-signal', start: T0, end: T0 + 30000 },
      indoor(T0 + 30000)]],
  ])('other days still start with 出發: %s', (_, nodes) => {
    expect(timelinePresentation(nodes)[0]).toMatchObject({ type: 'departure', latitude: departure.latitude });
  });

  // 2026-10-14 (user): a day that begins with a stay starts with that stay,
  // 停留 1, not 出發 (the seconds before it are its time).
  test('a stay first: no 出發, the stay is the first row', () => {
    const nodes = [departure, { type: 'stop', number: 1, start: T0 + 30000, end: T0 + 10 * MINUTE,
      durationMs: 10 * MINUTE - 30000, latitude: 24.98922, longitude: 121.3132 }, indoor(T0 + 10 * MINUTE)];
    const shown = timelinePresentation(nodes);
    expect(shown.map(n => n.type)).toEqual(['stop', 'indoor']);
    expect(shown[0]).toMatchObject({ number: 1, start: T0, end: T0 + 10 * MINUTE, latitude: 24.98922 });
  });

  test('a dog history: first fix 4 m off, then a hold — the model keeps its departure, the list starts indoors', () => {
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
    expect(model.nodes[0].latitude).toBe(model.points[0].latitude);
    expect(timelinePresentation(model.nodes).map(n => n.type)).toEqual(['indoor']);
  });
});

describe('no 「接續隔天」 capsule', () => {
  const stay = { type: 'stop', number: 2, start: T0, end: T0 + 25 * MINUTE, durationMs: 25 * MINUTE,
    latitude: 24.9892, longitude: 121.3132, gaps: [] };
  const end = { type: 'end', start: T0 + 25 * MINUTE, end: T0 + 25 * MINUTE, latitude: 24.9892,
    longitude: 121.3132, label: i18nT('c330'), continuesNextDay: true };

  // 2026-10-14: the last stay is the last row (no end row), its minutes only.
  test('a last stay running past midnight shows only its minutes', () => {
    const shown = timelinePresentation([move('walking', T0 - 5 * MINUTE, T0, 300), stay, end]);
    expect(shown.at(-1)).toMatchObject({ type: 'stop', number: 2 });
    expect(nodePill(shown.at(-1))).toEqual({ text: '停 25 分', tone: 'stay' });
    // The PNG row is the same capsule.
    const rows = exportTimelineRows([move('walking', T0 - 5 * MINUTE, T0, 300), stay, end], () => '虛構地址');
    expect(rows.at(-1).pill).toEqual({ text: '停 25 分', tone: 'stay' });
  });

  test('a plain end has no capsule; TalkBack still reads place and time', () => {
    expect(nodePill(end)).toBeNull();
    expect(placeSpeech(end, '虛構地址')).toBe('虛構地址，09:25');
  });

  test('a hold running past midnight keeps 「在遮蔽處 N 分」', () => {
    expect(nodePill({ type: 'indoor', start: T0, end: T0 + 40 * MINUTE, continuesNextDay: true }))
      .toEqual({ text: '在遮蔽處 40 分', tone: 'indoor' });
  });

  test('the copy is gone from resources', () => {
    expect(Object.values(require('../src/i18n/zh-TW.json'))).not.toContain('接續隔天');
  });
});
