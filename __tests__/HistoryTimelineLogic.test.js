import { historyTimeline } from '../src/history';
import { point, route, visitsFixture } from '../__fixtures__/HistoryLogicFixtures';

// hist.txt H1/H2「出發、停留、交通方式切換點、現在…同一套編號」。
test('timeline alternates locations and single-mode sections with shared numbering', () => {
  const points = route([...Array(6).fill(1), ...Array(3).fill(6), ...Array(3).fill(1)]);
  const model = historyTimeline(points, { subject: 'phone', range: { start: 0, end: 120000 } });
  expect(model.nodes.map(n => n.type)).toEqual(['departure', 'movement', 'switch', 'movement', 'switch', 'movement', 'end']);
  expect(model.locations.filter(n => n.type === 'switch').map(n => [n.start, n.number])).toEqual([[60000, 1], [90000, 2]]);
  expect(model.sections.map(s => s.mode)).toEqual(['walking', 'driving', 'walking']);
  expect(model.distanceM).toBeCloseTo(90); expect(model.sections[1].distanceM).toBeCloseTo(180);
});
// spec.txt 2026-10-06「切換點…不算停留、沒有停留時間…第一行地址、第二行座標」。
test('switch locations carry coordinates and time without boarding text or stay duration', () => {
  const model = historyTimeline(route([6, 6, 6, 1, 1, 1]), { subject: 'phone' });
  const s = model.locations.find(n => n.type === 'switch');
  expect(s).toMatchObject({ start: 30000, end: 30000, latitude: expect.any(Number), longitude: 121, number: 1 });
  expect(s.durationMs).toBeUndefined(); expect(s.label).toBeUndefined();
});
// spec.txt「中間隔著沒有資料時不另外加點」。
test('gap splits different transport modes without switch point', () => {
  const model = historyTimeline([...route([6, 6, 6]), point(330, 200), point(340, 210)], { subject: 'phone' });
  expect(model.sections.map(s => s.mode)).toEqual(['driving', 'gap', 'walking']);
  expect(model.locations.filter(n => n.type === 'switch')).toHaveLength(0);
  expect(model.hasGaps).toBe(true); expect(model.sections[1]).toMatchObject({ start: 30000, end: 330000, distanceM: 0, countedDistanceM: 0, line: 'long-dashed' });
});
// spec.txt「停留和切換點同一套編號…後面的點往後編號」。
test('stops and switches share chronological numbering', () => {
  const points = [...visitsFixture(), point(640, 460), point(650, 520), point(660, 580), point(670, 590), point(680, 600), point(690, 610)];
  const model = historyTimeline(points, { subject: 'phone', range: { start: 0, end: 690000 } });
  expect(model.locations.filter(n => n.number).map(n => [n.type, n.number])).toEqual([['stop', 1], ['switch', 2], ['switch', 3]]);
  expect(model.locations.find(n => n.type === 'stop').durationMs).toBe(240000);
});
// cases.txt「沒有明顯停留點…清單仍有出發、終點和中間移動段」。
test('uniform movement does not create turn or arbitrary numbered points', () => {
  const model = historyTimeline(route(Array(30).fill(1)));
  expect(model.locations.map(n => n.type)).toEqual(['departure', 'end']);
  expect(model.sections).toHaveLength(1);
});
// cases.txt「只有一筆…距離0…把手停用，可以匯出」。
test('one actual observation remains in export stream with no invented edge', () => {
  const model = historyTimeline([point(0)]);
  expect(model.points).toHaveLength(1); expect(model.distanceM).toBe(0);
  expect(model.sections).toHaveLength(0); expect(model.rangeEnabled).toBe(false);
});
// cases.txt「目前範圍裡沒有資料…這段時間沒有紀錄」。
test('empty range and empty day return empty models', () => {
  expect(historyTimeline([point(0)], { range: { start: 1, end: 2 } }).nodes).toEqual([]);
  expect(historyTimeline([]).points).toEqual([]);
});
// stops.txt「跟著現在…最後一筆在2分鐘內才寫現在…否則最後」。
test('following end distinguishes fresh and stale, fixed end is end', () => {
  const points = route(Array(48).fill(1));
  expect(historyTimeline(points, { today: true, now: 600000 }).locations.pop().label).toBe('現在');
  expect(historyTimeline(points, { today: true, now: 600001 }).locations.pop().label).toBe('最後');
  expect(historyTimeline(points, { today: true, now: 600000, following: false }).locations.pop().label).toBe('結束');
});
// spec.txt「整天都停在原處…沒有出發、終點節點，也不畫軌道」。
test('all-indoor day contains only house node', () => {
  const held = { heldReason: 'indoor', heldSince: -1, locationTime: null };
  const model = historyTimeline([point(0, 0, held), point(60, 0, held)]);
  expect(model.nodes.map(n => n.type)).toEqual(['indoor']); expect(model.distanceM).toBe(0);
});
// spec.txt「有缺口…拆成好幾個停在原處節點，中間插沒有資料」。
test('indoor packet gaps split houses with a no-data row', () => {
  const held = { heldReason: 'indoor', heldSince: -1, locationTime: null };
  const model = historyTimeline([point(0, 0, held), point(60, 0, held), point(300, 0, held), point(360, 0, held)]);
  expect(model.nodes.map(n => n.type)).toEqual(['indoor', 'gap', 'indoor']);
  expect(model.nodes.filter(n => n.type === 'indoor').map(n => n.durationMs)).toEqual([60000, 60000]);
});
// edges.txt「停留可以合併…不含中斷5分…地圖上不連線」。
test('merged stay still exposes gap row and deduction', () => {
  const points = [...[0, 180, 480, 660].map(t => point(t)),
    ...visitsFixture().slice(5).map(p => ({ ...p, time: p.time + 500000 }))];
  const model = historyTimeline(points, { range: { start: 0, end: 1130000 } });
  expect(model.locations.find(n => n.type === 'stop')).toMatchObject({ type: 'stop', interruptionMs: 300000, durationMs: 360000 });
  expect(model.sections.some(s => s.type === 'gap')).toBe(true);
});
// spec.txt「資料來源整個歷史…清單、地圖、月曆、匯出都照這個來源」。
test('returned common stream and list obey the same source selection', () => {
  const rows = [point(0, 0, { source: 'ble' }), point(10, 10, { source: 'ble' }), point(20, 20, { source: 'cloud' })];
  const model = historyTimeline(rows, { source: 'cloud' });
  expect(model.packets).toHaveLength(1); expect(model.points).toHaveLength(1);
  expect(model.locations[0].start).toBe(20000);
});
// spec.txt「手動改過開始…出發（手動）」「只改開始結束照樣跟著現在」。
test('manual extending range is honored by list and counted distance', () => {
  const model = historyTimeline(route(Array(48).fill(1)), { subject: 'phone', today: true, now: 480000, manualRange: { start: 100000 } });
  expect(model.range).toEqual({ start: 100000, end: 480000 });
  expect(model.locations[0]).toMatchObject({ type: 'departure', start: 100000, manual: true });
  expect(model.distanceM).toBeCloseTo(380);
});
// spec.txt「跨午夜…在移動就畫出發節點…接續前一天」。
test('midnight movement begins at first actual new-day fix', () => {
  const model = historyTimeline([point(0), point(60, 60), point(120, 120)], { dayStart: 30000, dayEnd: 150000 });
  expect(model.locations[0]).toMatchObject({ type: 'departure', start: 60000, continuesPreviousDay: true });
});
// spec.txt「出發偵測、畫線、距離、匯出都用同一組開車段落」。
test('range clipping does not lose a vehicle confirmation outside range', () => {
  const model = historyTimeline(route([6, 6, 6, 6]), { subject: 'phone', range: { start: 10000, end: 20000 } });
  expect(model.sections[0].mode).toBe('driving'); expect(model.distanceM).toBe(0);
});

// spec.txt「和即時同一套…照時間逐筆重算…封包…不是GPS時間」。
test('raw collar packets replay the existing indoor hold logic before GPS dedupe', () => {
  const rows = [point(0, 0, { satellites: 9, hdop: 0.9 }), point(5, 0, { satellites: 9, hdop: 0.9 }), point(10, 0, { satellites: 9, hdop: 0.9 })];
  for (let second = 15; second <= 300; second += 5) rows.push(point(second, 0, { latitude: 0, longitude: 0, satellites: 0, hdop: 655.35, locationTime: null }));
  const model = historyTimeline(rows, { holdOptions: { classify: () => null } });
  expect(model.locations.some(n => n.type === 'indoor')).toBe(true);
  expect(model.points[model.points.length - 1].time).toBe(300000);
  expect(model.packets[model.packets.length - 1].latitude).toBe(0);
  expect(rows[rows.length - 1].heldReason).toBeUndefined();
});

// spec.txt「出發點：清單第一個節點」「終點…跟著現在時現在」（室內另有例外）。
test('ordinary stays at range endpoints retain departure and end rows', () => {
  const model = historyTimeline(visitsFixture(), { range: { start: 0, end: 630000 } });
  expect(model.nodes[0].type).toBe('departure'); expect(model.locations[1].type).toBe('stop');
  expect(model.nodes[model.nodes.length - 1].type).toBe('end');
});
