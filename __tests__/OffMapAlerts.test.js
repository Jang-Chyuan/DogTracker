// 058c: N3 and 「⚠ N」 off the live map (design v3 判定表「提醒入口（歷史畫面、
// 設定頁）」「歷史和設定的紅色「⚠ N」」「N3 同時有好幾件事」「S6 的開關管什麼」,
// cases「看歷史時有狗出事」). Each test names its rule.
import { alertBadge, n3Card, offMapAlerts, N3_CARD_MS } from '../src/alerts/OffMapAlerts';
import { openAlertTarget } from '../src/alerts/ReturnSnapshot';
import { scheduleAlerts } from '../src/alerts/AlertScheduler';
import { updateAlertEvents } from '../src/alerts/AlertEvents';

const SEVERITY = { 'receiver-disconnected': 6, 'dog-out-of-range': 5, storage: 4, 'dog-stale': 3, 'dog-battery': 2,
  'receiver-battery': 1 };
const event = (kind, subject = 4, extra = {}) => ({
  key: `${kind}:${subject}`, kind, subject, name: '豆豆', startedAt: new Date(2026, 9, 3, 10, 18).getTime(), level: 1,
  present: true, source: 'ble', severity: SEVERITY[kind], ...extra,
});
const map = list => Object.fromEntries(list.map(item => [item.key, item]));

// 「數的是目前還沒解除的問題件數：每隻狗算一件，接收器斷線、接收器電量低、位置存不進手機各算一件」.
test('「⚠ N」 counts each dog once and each device problem once', () => {
  const list = [event('dog-stale', 4), event('dog-battery', 4, { percentage: 15 }), event('dog-out-of-range', 6,
    { name: '小黑' }), event('receiver-battery', 7, { number: 7, percentage: 18 }), event('storage', 'phone',
    { storage: { full: true } })];
  expect(alertBadge(map(list))).toMatchObject({ count: 4, text: '⚠ 4' });
  expect(alertBadge([])).toBeNull();
});

// User 2026-10-09: a disconnected receiver is one problem, not one more per
// dog that went quiet because of it.
test('「⚠ N」: dogs gone quiet with the disconnected receiver are part of it', () => {
  const at = new Date(2026, 9, 3, 10, 18).getTime();
  const outage = event('receiver-disconnected', 'receiver', { startedAt: at, outage: { number: 7 } });
  const quietAfter = (id, extra = {}) => event('dog-stale', id, { startedAt: at + 60000, receiverAffected: true, ...extra });
  expect(alertBadge([outage, quietAfter(4), quietAfter(5), quietAfter(6)])).toMatchObject({ count: 1, text: '⚠ 1' });
  // Quiet before the disconnection, a cloud dog, or another problem of the dog: still counted.
  expect(alertBadge([outage, quietAfter(4, { startedAt: at - 60000 })]).count).toBe(2);
  expect(alertBadge([outage, quietAfter(4, { receiverAffected: false })]).count).toBe(2);
  expect(alertBadge([outage, quietAfter(4), event('dog-battery', 4, { percentage: 15 })]).count).toBe(2);
  // Without the disconnection every quiet dog counts.
  expect(alertBadge([quietAfter(4), quietAfter(5)]).count).toBe(2);
});

// The engine's own events: the disconnection, then the dogs it heard go quiet.
test('「⚠ N」 from AlertEvents: a disconnection that silenced two dogs is ⚠ 1', () => {
  const { alertProblemCount } = require('../src/alerts/AlertEvents');
  const since = 1000000;
  const outageEvent = { key: 'receiver-disconnected:receiver', kind: 'receiver-disconnected', subject: 'receiver',
    severity: 6, present: true, startedAt: since };
  const stale = id => ({ key: `dog-stale:${id}`, kind: 'dog-stale', subject: id, severity: 3, present: true,
    startedAt: since + 10 * 60000, receiverAffected: true });
  expect(alertProblemCount([outageEvent, stale(4), stale(5)])).toBe(1);
  expect(scheduleAlerts({}, { active: map([outageEvent, stale(4), stale(5)]), now: since + 11 * 60000,
    foreground: true, screen: 'history' }).effects.badgeCount).toBe(1);
});

// 「件數照目前畫面上的狀態算（電量 21% 以上就不算）」: a latched battery hidden at 21–30% is not counted.
test('a battery hidden at 21–30% does not count', () => {
  expect(alertBadge([event('dog-battery', 4, { present: false, percentage: 25 })])).toBeNull();
});

// 「點了打開最嚴重的那一項（同通知）」; 嚴重度 接收器斷線 ＞ 圈外 ＞ 存不進 ＞ 未更新 ＞ 狗電量低 ＞ 接收器電量低.
test.each([
  [[event('dog-stale', 5), event('dog-out-of-range', 4)], { screen: 'map', dogId: 4 }],
  [[event('dog-out-of-range', 4), event('receiver-disconnected', 'receiver', { outage: { number: 7 } })],
    { screen: 'receiver-settings' }],
  [[event('dog-battery', 4, { percentage: 15 }), event('storage', 'phone', { storage: { full: false } })],
    { screen: 'diagnostics' }],
  [[event('receiver-battery', 7, { number: 7, percentage: 18 })], { screen: 'receiver-settings' }],
])('「⚠ N」 opens the most severe', (list, target) => {
  expect(alertBadge(list).target).toEqual(target);
});

// mockup「N3 看歷史時」: 「豆豆 不在接收範圍」 over 「10:18」, the triangle, no button, no ✕.
test('the N3 card says the problem and when it started', () => {
  const card = n3Card(event('dog-out-of-range', 4), 1000);
  expect(card).toMatchObject({ title: '豆豆 不在接收範圍', detail: '10:18', icon: 'warning', kind: 'alert',
    target: { screen: 'map', dogId: 4 }, expiresAt: 1000 + N3_CARD_MS });
  expect(card.actions).toBeUndefined();
  expect(card.closable).toBeUndefined();
  expect(n3Card(event('receiver-disconnected', 'receiver', { outage: { number: 7, dogCount: 3 } }), 0))
    .toMatchObject({ title: '接收器 7 已斷線（3 隻狗收不到）', icon: 'receiver-off', target: { screen: 'receiver-settings' } });
  expect(n3Card(event('storage', 'phone', { storage: { full: true } }), 0))
    .toMatchObject({ icon: 'storage', target: { screen: 'system-storage' } });
  // A new delivery of the same problem slides down again.
  expect(n3Card(event('dog-stale'), 1).id).not.toBe(n3Card(event('dog-stale'), 2).id);
});

// 「提醒卡從上方滑下 5 秒…收起後…留紅色「⚠ N」」; only on history and settings.
test('the card shows its 5 s, then 「⚠ N」; nothing on the live map', () => {
  const list = [event('dog-out-of-range', 4), event('dog-stale', 5, { name: '狗 5' })];
  const card = n3Card(list[0], 1000);
  const at = now => offMapAlerts({ active: list, card, now, screen: 'history' });
  expect(at(1000)).toMatchObject({ card: { key: 'dog-out-of-range:4' }, badge: null });
  expect(at(1000 + N3_CARD_MS - 1).card).not.toBeNull();
  expect(at(1000 + N3_CARD_MS)).toMatchObject({ card: null, badge: { count: 2 } });
  expect(offMapAlerts({ active: list, card, now: 1000, screen: 'settings' }).card).not.toBeNull();
  expect(offMapAlerts({ active: list, card, now: 1000, screen: 'map' })).toEqual({ card: null, badge: null });
  expect(offMapAlerts({ active: list, card, now: 1000, screen: 'other' })).toEqual({ card: null, badge: null });
  // Its problem cleared meanwhile: the card goes at once.
  expect(offMapAlerts({ active: [list[1]], card, now: 1000, screen: 'history' }))
    .toMatchObject({ card: null, badge: { count: 1 } });
});

// 2026-10-09 rule (「S6 的開關管什麼」): switched off → no N3 card; 「⚠ N」 (state) stays.
test('S6 switched off: no N3 card, the badge still counts it', () => {
  const dog = { slaveId: 4, name: '豆豆', coordinate: { latitude: 0, longitude: 0 }, fixAt: 0, fixSource: 'ble',
    batteryPercentage: 80, range: { status: 'out' } };
  const { active } = updateAlertEvents({}, { now: 1000, dogs: [dog] });
  const off = scheduleAlerts({}, { now: 1000, active, screen: 'history', preferences: { dogOutOfRange: false } });
  expect(off.effects.card).toBeNull();
  expect(offMapAlerts({ active, card: null, now: 1000, screen: 'history' }).badge).toMatchObject({ count: 1 });
  const on = scheduleAlerts({}, { now: 1000, active, screen: 'history' });
  expect(n3Card(on.effects.card.event, 1000).title).toBe('豆豆 不在接收範圍');
});

// 「N3 同時有好幾件事：一次只滑下最嚴重的那一張；其他的…算進紅色「⚠ N」」; 接收器電量低 never slides down.
test('several at once: the most severe card, the rest in the badge', () => {
  const list = [event('dog-stale', 5, { name: '狗 5' }), event('dog-out-of-range', 4),
    event('receiver-battery', 7, { number: 7, percentage: 18 })];
  const { effects } = scheduleAlerts({}, { now: 0, active: map(list), screen: 'history' });
  const card = n3Card(effects.card.event, 0);
  expect(card.title).toBe('豆豆 不在接收範圍');
  expect(offMapAlerts({ active: list, card, now: N3_CARD_MS, screen: 'history' }).badge.count).toBe(3);
  const battery = scheduleAlerts({}, { now: 0, active: map([list[2]]), screen: 'history' });
  expect(battery.effects.card).toBeNull();
});

// The 058c fixtures on their fake clock, judged as App does on the page each opens.
import { stepAlerts } from '../src/alerts/AlertEngine';
import { buildFixture, FIXTURE_NOW } from '../src/dev/ScreenFixtures';
import { mergeDogMarkers, LIVE_PACKET_WINDOW_MS } from '../src/map/DogMerge';
import { dogName } from '../src/map/DogMarkers';

function firstStep(name, screen) {
  const fixture = buildFixture(name);
  const dogs = mergeDogMarkers({ point: fixture.tracking.point, samples: fixture.tracking.positionSamples,
    cloudRows: fixture.cloudDogs.rows, packetRows: fixture.cloudDogs.packets, holds: fixture.cloudDogs.holds,
    statuses: fixture.cloudDogs.statuses, now: FIXTURE_NOW, windowMs: LIVE_PACKET_WINDOW_MS })
    .map(item => ({ ...item, name: dogName(item.slaveId, fixture.dogAliases),
      range: fixture.cloudDogs.ranges[item.slaveId] ?? null }));
  const result = stepAlerts({}, { dogs, receiver: fixture.receiverState, cloud: fixture.cloudSync, now: FIXTURE_NOW,
    screen, preferences: fixture.alerts });
  const active = Object.values(result.state.events.active);
  const card = result.effects.card ? n3Card(result.effects.card.event, 0) : null;
  return { fixture, card, after: offMapAlerts({ active, card, now: N3_CARD_MS, screen }) };
}

test.each([
  ['alerts-in-history', 'history', '豆豆 不在接收範圍', 1],
  ['alerts-in-dog-history', 'history', '豆豆 不在接收範圍', 2],
  ['alerts-in-history-off', 'history', null, 2],
  ['alerts-history-receiver-down', 'history', '接收器 7 已斷線（3 隻狗收不到）', 1],
  ['alerts-in-settings', 'settings', '接收器 7 已斷線（3 隻狗收不到）', null],
])('%s: its N3 card and history-only badge', (name, screen, title, count) => {
  const { fixture, card, after } = firstStep(name, screen);
  expect(fixture.openRoute).toBe(screen === 'history' ? 'history' : 'alerts');
  expect(card?.title ?? null).toBe(title);
  expect(after.badge?.count ?? null).toBe(count);
});

// D17: settings keeps the tappable N3 for exactly 5 s, never a badge.
test('settings: new deliveries slide down for 5 s and leave no badge', () => {
  const list = [event('dog-out-of-range'), event('receiver-battery', 7)];
  const card = n3Card(list[0], 1000);
  const at = now => offMapAlerts({ active: list, card, now, screen: 'settings' });
  expect(at(999)).toEqual({ card: null, badge: null });
  expect(at(1000)).toEqual({ card, badge: null });
  expect(at(1000 + N3_CARD_MS - 1)).toEqual({ card, badge: null });
  expect(at(1000 + N3_CARD_MS)).toEqual({ card: null, badge: null });
  expect(offMapAlerts({ active: list, now: 1000, screen: 'settings' }))
    .toEqual({ card: null, badge: null });
  expect(offMapAlerts({ active: [list[1]], card, now: 1000, screen: 'settings' }))
    .toEqual({ card: null, badge: null });
  const next = n3Card(list[0], 1000 + N3_CARD_MS);
  expect(offMapAlerts({ active: list, card: next, now: next.deliveredAt, screen: 'settings' }))
    .toEqual({ card: next, badge: null });
});

test('alerts-in-settings: tapping N3 preserves the settings return stack', () => {
  const { card } = firstStep('alerts-in-settings', 'settings');
  const stack = [{ name: 'map' }, { name: 'settings' }, { name: 'alerts' }];
  const opened = openAlertTarget(stack, card.target, { settingsPages: new Set(['settings', 'alerts', 'receiver']),
    key: 17 });
  expect(opened.stack).toEqual([...stack, { name: 'receiver', alertReturn: true, key: 17 }]);
  expect(opened.stack.slice(0, -1)).toEqual(stack);
});
