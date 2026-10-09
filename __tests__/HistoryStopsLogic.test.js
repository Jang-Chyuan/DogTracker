import { t as i18nT } from '../src/i18n';
import { historyVisits, historyStops, historyIndoorNodes } from '../src/history';
import { point, visitsFixture } from '../__fixtures__/HistoryLogicFixtures';

// stops.txt「中心＝這次造訪的第一個實測點；離開 25 公尺超過 20 秒…至少 2 個」。
test('visit uses first fix as centre and requires both exit conditions', () => {
  const visits = historyVisits([point(0), point(10, 24), point(20, 40), point(40, 50), point(41, 60)]);
  expect(visits).toHaveLength(2); expect(visits[0].end).toBe(10000);
  expect(visits[1].start).toBe(20000); expect(visits[0].center.latitude).toBe(point(0).latitude);
});
// spec.txt「中途回到圈內就重新計算」。
test('return inside resets consecutive exit clock', () => {
  expect(historyVisits([point(0), point(10, 40), point(35, 0), point(40, 40), point(55, 40)])).toHaveLength(1);
});
// spec.txt「正在確認離開…暫定終點先停在最後一個圈內點」。
test('ongoing visit ends at last inside fix while exit is pending', () => {
  const [v] = historyVisits([point(0), point(180), point(190, 40)], { following: true });
  expect(v.end).toBe(180000); expect(v.durationMs).toBe(180000); expect(v.completed).toBe(false);
});
// stops.txt「每次造訪算一票，取中位數…≥3分鐘而且≥一般地方的3倍」。
test('five visits, one long stay, median counts visits rather than packets', () => {
  const result = historyStops(visitsFixture());
  expect(result.visits).toHaveLength(5); expect(result.typicalMs).toBe(60000);
  expect(result.stops).toHaveLength(1); expect(result.stops[0]).toMatchObject({ start: 0, end: 240000, number: 1, durationMs: 240000 });
});
// stops.txt「停留時間≥3分鐘而且≥一般地方的3倍」。
test('three-minute and three-times thresholds are inclusive and both required', () => {
  const base = visitsFixture();
  expect(historyStops(base.filter(p => p.time !== 240000)).stops[0].durationMs).toBe(180000);
  expect(historyStops(base.filter(p => p.time !== 240000 && p.time !== 180000)).stops).toHaveLength(0);
  expect(historyStops(base, { config: { radiusM: 25, leaveMs: 20000, stayMs: 180000, stayRatio: 5, minVisits: 5, gapMs: 180000, mergeGapMs: 600000, stayAccuracyM: 25 } }).stops).toHaveLength(0);
});
// stops.txt「範圍裡造訪不到5次…改用一整天…那樣也少於5次就不標」。
test('day fallback marks only selected range; fewer than five votes marks nothing', () => {
  const base = visitsFixture();
  const result = historyStops(base, { start: 0, end: 240000, dayStart: 0, dayEnd: 630000 });
  expect(result.fallback).toBe(true); expect(result.stops).toHaveLength(1);
  expect(historyStops(base.slice(0, 5)).stops).toHaveLength(0);
});
// spec.txt「中位數只用已經結束的造訪算；至少5次把進行中的也算」。
test('ongoing vote counts toward five but not median', () => {
  const result = historyStops(visitsFixture(), { following: true });
  expect(result.typicalMs).toBe(60000); expect(result.stops).toHaveLength(1);
  expect(result.visits[4].completed).toBe(false);
});
// edges.txt「中斷5分鐘…停留可以合併…中斷時間不算」。
// 067: the break at the same place is part of the stay (no deduction).
test('short same-place gap is one vote and counts as staying', () => {
  const [v] = historyVisits([point(0), point(180), point(480, 10), point(660)]);
  expect(v.durationMs).toBe(660000); expect(v.interruptionMs).toBe(0);
});
// spec.txt「中斷10分鐘以上或前後超過25公尺…中斷前結束」。
test('ten-minute gap and distant gap split visits', () => {
  // 067: at the same place a break of any length (to 16 h) is one stay.
  expect(historyVisits([point(0), point(600)])).toHaveLength(1);
  expect(historyVisits([point(0), point(17 * 3600)])).toHaveLength(2);
  expect(historyVisits([point(0), point(300, 26)])).toHaveLength(2);
});
// spec.txt「不同時間回到同一個地方是不同停留（不同編號）」。
test('return after confirmed exit is a new visit', () => {
  const v = historyVisits([point(0), point(180), point(190, 100), point(220, 100), point(250), point(280)]);
  expect(v).toHaveLength(3); expect(v[2].id).not.toBe(v[0].id);
});
// edges.txt「GPS精度很差（誤差>25m）…不拿來判斷停留」。
test('poor accuracy does not create votes or advance stay end', () => {
  const v = historyVisits([point(0, 0, { accuracy: 25 }), point(180, 0, { accuracy: 26 })]);
  expect(v[0].durationMs).toBe(0);
});
// spec.txt「開車段落裡的位置不參與造訪…下車後另起新的造訪」。
test('vehicle interval terminates visit and prevents gap-style merging', () => {
  const v = historyVisits([point(0), point(60), point(120), point(180), point(240)], { vehicles: [{ start: 120000, end: 180000 }] });
  expect(v.map(p => [p.start, p.end])).toEqual([[0, 60000], [180000, 240000]]);
});
// spec.txt「停住那段不參與…票數、中位數，也不當出發候選」。
test('hold observations close ordinary visits and never vote', () => {
  expect(historyVisits([point(0), point(60, 0, { heldReason: 'indoor' }), point(120)])).toHaveLength(2);
});
// spec.txt「一旦標成停留就不撤銷…之後只更新起訖、時間」。
test('append state retains stops while newer visits raise median', () => {
  const base = visitsFixture(), first = historyStops(base, { following: true, identity: 'same' });
  const next = [...base, point(810, 400), point(820, 500), point(850, 500), point(1030, 500), point(1040, 600), point(1070, 600), point(1250, 600)];
  const result = historyStops(next, { following: true, identity: 'same', state: first.state });
  expect(result.stops.some(s => s.id === first.stops[0].id)).toBe(true);
});
// spec.txt「換資料來源、換時區、已處理時間裡資料有變＝整份重算」。
test('identity or prefix changes clear retained markers', () => {
  const base = visitsFixture(), first = historyStops(base, { identity: 'a' });
  expect(historyStops(base.slice(0, 2), { identity: 'b', state: first.state }).stops).toHaveLength(0);
  expect(historyStops(base.map(p => ({ ...p, latitude: point(p.time / 1000, p.time / 100).latitude })), { identity: 'a', state: first.state }).stops).toHaveLength(0);
});
// spec.txt「開車段落第一次確認…只因為車上的點才成立的停留可以撤銷」。
test('new vehicle classification invalidates retained stay', () => {
  const base = visitsFixture(), first = historyStops(base, { identity: 'a' });
  expect(historyStops(base, { identity: 'a', state: first.state, vehicles: [{ start: 0, end: 300000 }] }).stops).toHaveLength(0);
});
// spec.txt「跨午夜…後一天…當天第一筆有效實測…接續前一天・停N分」。
test('midnight splits durations at actual fixes and preserves continuation', () => {
  const base = visitsFixture();
  const result = historyStops(base, { start: 60000, end: 240000, dayStart: 60000, dayEnd: 630000 });
  expect(result.stops[0]).toMatchObject({ start: 60000, end: 240000, durationMs: 180000, continuesPreviousDay: true });
  const before = historyStops(base, { end: 180000, dayStart: 0, dayEnd: 180000 });
  expect(before.stops).toHaveLength(0); // fewer than five day votes: no forced label
});
// spec.txt「整天停在原處…只有一個節點…封包起訖」「有缺口就拆成好幾個」。
test('indoor nodes use packet times, split gaps, and carry address placeholder', () => {
  const held = { heldReason: 'indoor', heldSince: -60000 };
  // A break at the same hold spot is one house (067); a new anchor after the
  // break is another.
  expect(historyIndoorNodes([point(0, 0, held), point(180, 0, held), point(400, 0, held), point(460, 0, held)],
    { dayStart: 0 })).toHaveLength(1);
  const nodes = historyIndoorNodes([point(0, 0, held), point(180, 0, held), point(400, 50, held), point(460, 50, held)], { dayStart: 0 });
  expect(nodes).toHaveLength(2);
  expect(nodes[0]).toMatchObject({ type: 'indoor', label: i18nT('c114'), start: 0, end: 180000, durationMs: 180000, continuesPreviousDay: true });
  expect(nodes[0].number).toBeUndefined();
});
// edges.txt「停住跨過午夜…前一天最後一個節點接續隔天」。
test('indoor midnight uses held identity to identify next-day continuation', () => {
  const held = { heldReason: 'indoor', heldSince: 0 };
  expect(historyIndoorNodes([point(0, 0, held), point(60, 0, held), point(120, 0, held)], { start: 0, end: 60000, dayEnd: 60000 })[0].continuesNextDay).toBe(true);
});

// spec.txt「一旦標成停留就不撤銷…例外只因為那些車上的點才成立」。
test('new trip strictly after processed observations retains old stop identity', () => {
  const base = visitsFixture(), first = historyStops(base, { following: true, identity: 'same' });
  const next = [...base, point(640, 460), point(650, 520), point(660, 580)];
  const result = historyStops(next, { following: true, identity: 'same', state: first.state,
    vehicles: [{ start: 640000, end: 660000 }] });
  expect(result.state.marked).toEqual(expect.arrayContaining(first.state.marked));
  expect(result.stops[0].id).toBe(first.stops[0].id);
});
// spec.txt「手動改範圍…整份重算」「跨午夜…接續前一天」。
test('manual clipping within same day does not claim previous-day continuation', () => {
  const result = historyStops(visitsFixture(), { start: 60000, end: 240000, dayStart: 0, dayEnd: 630000 });
  expect(result.stops[0].continuesPreviousDay).toBe(false);
});
// spec.txt「中斷時間不算」「造訪起訖…中途回到圈內就重新計算」。
test('brief excursion is not mistaken for missing data when range clips visit', () => {
  const base = [point(0), point(60), point(180), point(190, 40), point(210),
    ...visitsFixture().slice(5)];
  const result = historyStops(base, { start: 60000, end: 210000, dayStart: 0, dayEnd: 630000 });
  expect(result.visits[0].durationMs).toBe(150000); expect(result.visits[0].interruptionMs).toBe(0);
});

// stops.txt「25公尺內」；spec.txt「前後超過25公尺才切開」。
test('exact twenty-five metres is inside even across short gap', () => {
  const v = historyVisits([point(0), point(180, 25), point(480, 0), point(660, 25)]);
  // 067: the break at the same place counts as staying.
  expect(v).toHaveLength(1); expect(v[0].durationMs).toBe(660000);
});

// edges.txt「精度差的位置不拿來判斷停留，不硬標」。
test('unreliable coordinates cannot break same-place gap merging', () => {
  const visits = historyVisits([point(0), point(100, 100, { accuracy: 30 }), point(300)]);
  expect(visits).toHaveLength(1); expect(visits[0].end).toBe(300000);
});
