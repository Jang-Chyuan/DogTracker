import { historyDeparture, historyMovement, historyTimeline } from '../src/history';
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
// 判定表「出發偵測怎麼找」(2026-10)：一天從開車開始，出發就是開車的起點（不是下車後的走路）。
test('a day that starts with a drive departs at the drive, not the walk after it', () => {
  const points = route([...Array(6).fill(6), ...Array(48).fill(1)]);
  const result = historyDeparture(points, { subject: 'phone' });
  expect(result.status).toBe('confirmed'); expect(result.automaticRange.start).toBe(0);
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
// 判定表「出發偵測怎麼找」(2026-10)：走了 3 分鐘接著坐車，之後確認的坐車不再撤銷，走路的起點就是出發。
test('a later-confirmed dog ride the walk led into keeps the walk as the departure', () => {
  const points = route([...Array(45).fill(1), ...Array(6).fill(10), ...Array(54).fill(1)]);
  const before = points.filter(p => p.time <= 480000);
  expect(historyDeparture(before).automaticRange.start).toBe(0);
  const result = historyDeparture(points);
  expect(result.status).toBe('confirmed'); expect(result.automaticRange.start).toBe(0);
});
// spec.txt「只有手機…第8分鐘正在高速…延後到最晚8分30秒」。
test('phone suspicion retains provisional range until high run resolves', () => {
  const points = route([...Array(47).fill(1), 6]);
  const result = historyDeparture(points, { subject: 'phone', today: true, now: 480000 });
  expect(result.status).toBe('confirming'); expect(result.decisionTime).toBe(510000);
  expect(historyDeparture(points, { subject: 'phone', today: true, now: 510000 }).status).toBe('confirmed');
});
// spec.txt「延後…確認是開車」：2026-10 起走路接著開車＝出發，候選照樣通過。
test('vehicle confirmed during phone grace confirms the walk that led into it', () => {
  const points = route([...Array(47).fill(1), 6, 6, 6]);
  const result = historyDeparture(points, { subject: 'phone', today: true, now: 510000 });
  expect(result.status).toBe('confirmed'); expect(result.automaticRange.start).toBe(0);
});
// spec.txt「手動改過…撤銷只更新自動偵測…手動範圍不動」。
test('manual range remains whatever the automatic detection finds', () => {
  const points = route([...Array(45).fill(1), ...Array(6).fill(10), ...Array(54).fill(1)]);
  const result = historyDeparture(points, { manualRange: { start: 10000, end: 900000 } });
  expect(result.range).toEqual({ start: 10000, end: 900000 });
  expect(result.automaticRange).toEqual(historyDeparture(points).automaticRange);
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

// 判定表「出發偵測怎麼找」(2026-10 使用者回報)：在 A 待了很久 → 開車到 B → 在 B 走路。
// 預設範圍的出發要是離開 A（開車的起點），不是到 B 之後的第一段走路。全部是虛構資料。
describe('a day that leaves by car (fictional A → drive → walk at B)', () => {
  const STAY = 180, DRIVE = 60, WALK = 90; // 10-second steps: 30 min, 10 min, 15 min
  const day = ({ walkToCar = 0, carSpeed = 15 } = {}) => route([...Array(STAY).fill(0),
    ...Array(walkToCar).fill(1), ...Array(DRIVE).fill(carSpeed), ...Array(WALK).fill(1)]);
  const rideStart = (STAY + 0) * 10000;

  test('phone: the departure is where the drive set off from A, not the walk at B', () => {
    const points = day();
    const result = historyDeparture(points, { subject: 'phone' });
    expect(result.status).toBe('confirmed');
    // 出發時間＝開車第一筆的前一筆（判定表「其他情況→候選的前一筆」）。
    expect(result.automaticRange.start).toBe(rideStart - 10000);
    expect(result.automaticRange.start).toBeLessThan((STAY + DRIVE) * 10000);
  });

  test('phone: a walk to the car of a few minutes is part of the departure', () => {
    const walkToCar = 24; // 4 minutes at 1 m/s
    const result = historyDeparture(day({ walkToCar }), { subject: 'phone' });
    expect(result.status).toBe('confirmed');
    // Like any walk: the first fix 40 m away three minutes later, a little before the first step.
    expect(result.automaticRange.start).toBeGreaterThanOrEqual(rideStart - 140000);
    expect(result.automaticRange.start).toBeLessThanOrEqual(rideStart);
  });

  test('dog: a day that starts with a ride departs at the ride, like the phone', () => {
    const result = historyDeparture(day({ carSpeed: 12 }), { subject: 'dog' });
    expect(result.status).toBe('confirmed');
    expect(result.automaticRange.start).toBe(rideStart - 10000);
  });

  test('today: still at A is not departed; once the drive is a drive, the departure is A', () => {
    const points = day();
    const at = now => historyDeparture(points.filter(p => p.time <= now), { subject: 'phone', today: true, now });
    expect(at(rideStart).status).toBe('not-departed');
    expect(at(rideStart + 120000)).toMatchObject({ status: 'confirmed', automaticRange: { start: rideStart - 10000 } });
    expect(at(points[points.length - 1].time).automaticRange.start).toBe(rideStart - 10000);
  });

  test('a drive right after a recording break starts at its own first fix', () => {
    const before = route(Array(STAY).fill(0));
    const after = route([...Array(DRIVE).fill(15), ...Array(WALK).fill(1)])
      .map(p => ({ ...p, time: p.time + rideStart + 600000 }));
    const result = historyDeparture([...before, ...after], { subject: 'phone' });
    expect(result).toMatchObject({ status: 'confirmed', automaticRange: { start: rideStart + 600000 } });
  });

  test('a day that never leaves A still starts at the first record', () => {
    // 3 m jitter at A all day: no walk, no drive.
    const points = Array.from({ length: 2000 }, (_, i) => point(i * 10, i % 2 ? 3 : 0));
    const result = historyDeparture(points, { subject: 'phone' });
    expect(result.status).toBe('undetermined'); expect(result.automaticRange.start).toBe(0);
  });

  test('GPS drift jumping fast about A for two minutes is no drive and no departure', () => {
    // 40 m back and forth every 5 s (8 m/s, car speed) but never going anywhere.
    const points = Array.from({ length: 1000 }, (_, i) => i >= 400 && i < 424
      ? point(i * 5, i % 2 ? 40 : 0) : point(i * 5, i % 2 ? 3 : 0));
    expect(historyMovement(points, { subject: 'phone' }).vehicles.length).toBeGreaterThan(0);
    const result = historyDeparture(points, { subject: 'phone' });
    expect(result.status).toBe('undetermined'); expect(result.automaticRange.start).toBe(0);
  });

  test('the history list starts with the departure at A, before the drive', () => {
    const rows = day().map(p => ({ ...p, accuracy: 5 }));
    const model = historyTimeline(rows, { subject: 'phone', dayStart: 0, dayEnd: 86400000 });
    expect(model.range.start).toBe(rideStart - 10000);
    expect(model.nodes[0]).toMatchObject({ type: 'departure', start: rideStart - 10000 });
    expect(model.sections.some(s => s.mode === 'driving')).toBe(true);
  });
});
