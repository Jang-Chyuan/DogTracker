import { historyDeparture, historyMovement } from '../src/history';
import { point, route } from '../__fixtures__/HistoryLogicFixtures';
const walking = () => route(Array(48).fill(1));

// spec.txt「候選經過3.5分鐘才選點並定案…之前等待中」。
test('three-minute gate is announced only at three and a half minutes', () => {
  const points = walking();
  expect(historyDeparture(points.filter(p => p.time <= 200000), { subject: 'phone', today: true, now: 200000 }).status).toBe('not-departed');
  const result = historyDeparture(points.filter(p => p.time <= 210000), { subject: 'phone', today: true, now: 210000 });
  expect(result.status).toBe('confirming'); expect(result.range.start).toBe(0);
});
// spec.txt「2.5–3.5分鐘最接近3分鐘…同樣接近取較早」。
test('nearest three-minute sample, tie uses earlier', () => {
  const points = [point(0), point(150, 10), point(210, 200), point(480, 500)];
  expect(historyDeparture(points, { subject: 'phone' }).status).toBe('undetermined');
});
// spec.txt「第7–8分鐘最接近第8分鐘…要離候選超過80公尺」。
test('confirmation waits eight minutes and uses latest seven-to-eight sample', () => {
  const points = walking();
  expect(historyDeparture(points, { subject: 'phone', today: true, now: 479999 }).status).toBe('confirming');
  expect(historyDeparture(points, { subject: 'phone', today: true, now: 480000 }).status).toBe('confirmed');
});
// spec.txt「資料在第8分鐘前結束也一樣…有第7–8分鐘的點就照判斷」。
test('historical truncated data confirms with minute-seven fix, fails without it', () => {
  expect(historyDeparture(walking().filter(p => p.time <= 420000), { subject: 'phone' }).status).toBe('confirmed');
  expect(historyDeparture(walking().filter(p => p.time < 420000), { subject: 'phone' }).status).toBe('undetermined');
});
// stops.txt「平均速度手機0.3–3公尺；狗0.3–15公尺」。
test('phone rejects running-speed candidate that dog accepts', () => {
  const points = route(Array(48).fill(4));
  expect(historyDeparture(points, { subject: 'phone' }).status).toBe('undetermined');
  expect(historyDeparture(points, { subject: 'dog' }).status).toBe('confirmed');
});
// spec.txt「中間有中斷…不通過的時機＝過了第8分鐘」。
test('gap invalidates at decision time, not during confirmation', () => {
  const points = [point(0), point(180, 180), point(210, 210), point(420, 420), point(480, 480)];
  expect(historyDeparture(points, { subject: 'phone', today: true, now: 450000 }).status).toBe('confirming');
  expect(historyDeparture(points, { subject: 'phone', today: true, now: 480000 }).status).not.toBe('confirmed');
});
// spec.txt「候選…前面緊接開車段落…出發時間就是候選自己」。
test('walk after driving starts at vehicle endpoint', () => {
  const points = route([...Array(6).fill(6), ...Array(48).fill(1)]);
  const result = historyDeparture(points, { subject: 'phone' });
  expect(result.status).toBe('confirmed'); expect(result.automaticRange.start).toBe(60000);
});
// spec.txt「其他情況→候選的前一筆」。
test('ordinary candidate departure uses its previous observation', () => {
  const points = [point(0), point(10), ...route(Array(48).fill(1)).slice(1).map(p => ({ ...p, time: p.time + 10000 }))];
  expect(historyDeparture(points, { subject: 'phone' }).automaticRange.start).toBe(0);
});
// spec.txt「和前一筆相差超過3分鐘→候選自己」。
test('departure after gap uses candidate itself', () => {
  const points = [point(0), ...walking().map(p => ({ ...p, time: p.time + 300000 }))];
  expect(historyDeparture(points, { subject: 'phone' }).automaticRange.start).toBe(300000);
});
// spec.txt「第一次確認後鎖定…第二次出勤都不重設」。
test('later vehicle trip does not reset first departure', () => {
  const points = route([...Array(50).fill(1), ...Array(6).fill(6), ...Array(50).fill(1)]);
  expect(historyDeparture(points, { subject: 'phone' }).automaticRange.start).toBe(0);
});
// spec.txt「之後確認的開車…和出發時間～定案時間…重疊→撤銷」。
test('later-confirmed dog ride revokes overlapping first confirmation', () => {
  const points = route([...Array(45).fill(1), ...Array(6).fill(10), ...Array(54).fill(1)]);
  const before = points.filter(p => p.time <= 480000);
  expect(historyDeparture(before).automaticRange.start).toBe(0);
  const result = historyDeparture(points);
  expect(result.status).toBe('confirmed'); expect(result.automaticRange.start).toBe(510000);
});
// spec.txt「只有手機…第8分鐘正在高速…延後到最晚8分30秒」。
test('phone suspicion retains provisional range until high run resolves', () => {
  const points = route([...Array(47).fill(1), 6]);
  const result = historyDeparture(points, { subject: 'phone', today: true, now: 480000 });
  expect(result.status).toBe('confirming'); expect(result.decisionTime).toBe(510000);
  expect(historyDeparture(points, { subject: 'phone', today: true, now: 510000 }).status).toBe('confirmed');
});
// spec.txt「延後…確認是開車→不通過」。
test('vehicle confirmed during phone grace rejects original candidate', () => {
  const points = route([...Array(47).fill(1), 6, 6, 6]);
  expect(historyDeparture(points, { subject: 'phone', today: true, now: 510000 }).status).not.toBe('confirmed');
});
// spec.txt「手動改過…撤銷只更新自動偵測…手動範圍不動」。
test('manual range remains when automatic result changes', () => {
  const points = route([...Array(45).fill(1), ...Array(6).fill(10), ...Array(54).fill(1)]);
  const result = historyDeparture(points, { manualRange: { start: 10000, end: 900000 } });
  expect(result.range).toEqual({ start: 10000, end: 900000 }); expect(result.automaticRange.start).toBe(510000);
});
// cases.txt「今天一直原地還沒出發；過去找不到沒辦法自動判斷」。
test('stationary and empty streams have explicit statuses and full range', () => {
  const points = route(Array(48).fill(0));
  expect(historyDeparture(points, { today: true }).status).toBe('not-departed');
  expect(historyDeparture(points).status).toBe('undetermined');
  expect(historyDeparture([]).range).toEqual({ start: null, end: null });
});
// spec.txt「停住那段…不當出發候選」。
test('indoor observations cannot initiate departure', () => {
  expect(historyDeparture(walking().map(p => ({ ...p, heldReason: 'indoor' }))).status).toBe('undetermined');
});
// spec.txt「出發偵測…都用同一組開車段落」。
test('explicit movement calculation matches automatic calculation', () => {
  const points = walking(), movement = historyMovement(points);
  expect(historyDeparture(points, { movement })).toEqual(historyDeparture(points));
});
