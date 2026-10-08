import { historyMovement } from '../src/history';
import { point, route } from '../__fixtures__/HistoryLogicFixtures';

// spec.txt「連續…每秒 5 m 以上、合計 30 秒以上」。
test('phone entry requires 30 continuous high seconds and backfills', () => {
  expect(historyMovement(route([6, 6]), { subject: 'phone' }).vehicles).toHaveLength(0);
  const m = historyMovement(route([4.5, 6, 6, 6]), { subject: 'phone' });
  expect(m.vehicles[0]).toMatchObject({ start: 0, end: 40000 });
  expect(m.edges.every(e => e.mode === 'driving')).toBe(true);
});
// spec.txt「直到…連續 30 秒都低於每秒 4 m…終點＝低速開始的那一筆」。
test('phone exit backfills walking and switch at low-speed onset', () => {
  const m = historyMovement(route([6, 6, 6, 4.5, 2, 2, 2]), { subject: 'phone' });
  expect(m.vehicles[0].end).toBe(40000);
  expect(m.switches.map(p => p.start)).toEqual([40000]);
  expect(m.edges.slice(-3).every(e => e.mode === 'walking')).toBe(true);
});
// spec.txt「之後所有線段（包括 4–5 m/s 的）都算開車」。
test('brief traffic light and interrupted exit remain driving', () => {
  const m = historyMovement(route([6, 6, 6, 0, 0, 4.5, 0, 0]), { subject: 'phone' });
  expect(m.vehicles[0].end).toBe(80000);
});
// spec.txt「狗…9 m 以上、合計 60 秒；不往前回推起步線段」。
test('dog entry takes 60 seconds without phone backtracking', () => {
  const m = historyMovement(route([5, ...Array(6).fill(10)]));
  expect(m.vehicles[0]).toMatchObject({ start: 10000, end: 70000 });
  expect(m.switches[0].start).toBe(10000);
  expect(historyMovement(route(Array(5).fill(10))).vehicles).toHaveLength(0);
});
// spec.txt「狗…連續 60 秒都低於每秒 4 m 才結束」。
test('dog exit needs 60 seconds and onset belongs to new movement', () => {
  const m = historyMovement(route([...Array(6).fill(10), ...Array(6).fill(2)]));
  expect(m.vehicles[0].end).toBe(60000); expect(m.edges[6].mode).toBe('moving');
});
// spec.txt「開車…不算距離」「移動小於定位誤差的不算」。
test('actual vehicle distance retained while counted distance excludes it and drift', () => {
  const drive = historyMovement(route([6, 6, 6]), { subject: 'phone' });
  expect(drive.distanceM).toBe(0); expect(drive.edges[0].distanceM).toBeCloseTo(60);
  const drift = historyMovement([point(0, 0, { accuracy: 10 }), point(10, 5, { accuracy: 10 })]);
  expect(drift.distanceM).toBe(0);
});
// stops.txt「中斷超過 3 分鐘時，畫線就斷開」。
test('exact three minutes connects, over three minutes is a zero-distance gap', () => {
  const m = historyMovement([point(0), point(180, 180), point(361, 361)]);
  expect(m.edges.map(e => e.mode)).toEqual(['moving', 'gap']);
  expect(m.edges[1].countedDistanceM).toBe(0);
});
// spec.txt「前後換算速度還…5 m 以上…同一段；中斷時間不算進 30 秒」。
test('vehicle continuity across a fast gap does not draw or create switch', () => {
  const points = [...route([6, 6, 6]), point(330, 1980), point(340, 2040)];
  const m = historyMovement(points, { subject: 'phone' });
  expect(m.vehicles).toHaveLength(1); expect(m.edges[3].mode).toBe('gap');
  expect(m.switches).toHaveLength(0);
  expect(historyMovement([point(0), point(300, 1800)], { subject: 'phone' }).vehicles).toHaveLength(0);
});
// spec.txt「前後換算速度不到…開車在中斷前最後一筆結束」。
test('slow gap terminates driving', () => {
  const m = historyMovement([...route([6, 6, 6]), point(330, 200), point(340, 210)], { subject: 'phone' });
  expect(m.vehicles[0].end).toBe(30000); expect(m.edges[4].mode).toBe('walking');
});
// spec.txt「中斷超過 30 分鐘一律結束」。
test('over thirty-minute gap terminates even high-speed travel', () => {
  const m = historyMovement([...route([6, 6, 6]), point(1831, 10986), point(1841, 11046)], { subject: 'phone' });
  expect(m.vehicles[0].end).toBe(30000);
});
// spec.txt「進入、結束坐車的 60 秒也不能跨過超過 3 分鐘的中斷」。
test('dog entry cannot accumulate high seconds across gap', () => {
  const points = [...route([10, 10, 10]), point(330, 3300), point(340, 3400), point(350, 3500), point(360, 3600)];
  expect(historyMovement(points).vehicles).toHaveLength(0);
});
// spec.txt「停住那段不算距離…放開後第一筆好定位和停住點…照一般規則」。
test('indoor interval is excluded; release edge counts', () => {
  const held = { heldReason: 'indoor', heldSince: 0 };
  const m = historyMovement([point(0, 0, held), point(10, 0, held), point(20, 10)]);
  expect(m.edges.map(e => e.mode)).toEqual(['indoor', 'moving']); expect(m.distanceM).toBeCloseTo(10);
});

// spec.txt「手機每秒5m以上30秒；狗每秒9m以上60秒」（含門檻）。
test.each([['phone', 5, 3], ['dog', 9, 6]])('inclusive vehicle entry threshold for %s', (subject, speed, count) => {
  expect(historyMovement(route(Array(count).fill(speed)), { subject }).vehicles).toHaveLength(1);
});
// spec.txt「直到連續…低於每秒4m才結束」（4m本身不結束）。
test.each([['phone', 6, 3], ['dog', 10, 6]])('exact four m/s does not end %s vehicle', (subject, speed, count) => {
  const m = historyMovement(route([...Array(count).fill(speed), ...Array(count).fill(4)]), { subject });
  expect(m.vehicles[0].end).toBe(count * 20000);
});
