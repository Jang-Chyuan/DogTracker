// 058a: the alert events, their scheduling and the merged notification
// (design v3 N, 「提醒的規則」「每一項都可以關」「S6 的開關管什麼」「暫停」,
// edges「提醒」「電量」, 判定表「提醒通知只有一則」). Each test names its rule.
import { updateAlertEvents } from '../src/alerts/AlertEvents';
import { scheduleAlerts, pauseAlerts, resumeAlerts, pausePresentation, ALERT_CHANNELS, VIBRATION_PATTERNS }
  from '../src/alerts/AlertScheduler';
import { notificationContent, alertTarget, alertLine } from '../src/alerts/AlertContent';
import { stepAlerts, pauseAlertState, persistedAlertState, restoreAlertState, normalizeAlertState }
  from '../src/alerts/AlertEngine';
import { buildFixture, FIXTURE_NOW } from '../src/dev/ScreenFixtures';
import { mergeDogMarkers, LIVE_PACKET_WINDOW_MS } from '../src/map/DogMerge';
import { dogName } from '../src/map/DogMarkers';

const M = 60000;
const dog = { slaveId: 4, name: '豆豆', coordinate: { latitude: 0, longitude: 0 }, fixAt: 0, fixSource: 'ble',
  batteryPercentage: 80 };
const events = (now, dogs = [dog], extra = {}, previous = {}) => updateAlertEvents(previous, { now, dogs, ...extra });
const event = (kind, subject = 4, extra = {}) => ({
  key: `${kind}:${subject}`, kind, subject, name: '豆豆', startedAt: 0, level: 1, present: true, source: 'ble',
  severity: { 'receiver-disconnected': 6, 'dog-out-of-range': 5, storage: 4, 'dog-stale': 3, 'dog-battery': 2,
    'receiver-battery': 1 }[kind], ...extra,
});
const map = list => Object.fromEntries(list.map(item => [item.key, item]));
const tick = (now, list, previous = {}, extra = {}) => scheduleAlerts(previous, { now, active: map(list), ...extra });
// Runs ticks one after another: [[now, list, extra?], ...] → the effects of each.
function run(steps, state = {}) {
  const out = [];
  for (const [now, list, extra] of steps) {
    const result = tick(now, list, state, extra);
    state = result.state;
    out.push(result.effects);
  }
  return { out, state };
}

// ---- events ----------------------------------------------------------------

// notif「10 分鐘沒有新的有效位置」；解除照 DogFreshness。
test('沒有新位置: starts after 10 minutes, clears with a new position', () => {
  expect(Object.values(events(10 * M).active)).toHaveLength(0);
  const first = events(10 * M + 1);
  expect(first.events[0]).toMatchObject({ type: 'start', kind: 'dog-stale', startedAt: 10 * M + 1 });
  const next = events(11 * M, [dog], {}, first);
  expect(next.events).toEqual([]);
  expect(next.active['dog-stale:4'].startedAt).toBe(10 * M + 1);
  expect(events(12 * M, [{ ...dog, fixAt: 12 * M }], {}, next).events[0]).toMatchObject({ type: 'clear' });
});

// cases「從來沒定位過…不畫、不提醒」；notif「活動量不提醒」。
test('a dog never located, and activity, never alert', () => {
  expect(events(20 * M, [{ ...dog, coordinate: null, batteryPercentage: 5, activity: 'vigorous' }]).events).toEqual([]);
});

// notif「快離開…不提醒」「不在接收範圍…只有本機收到的狗」。
test('不在接收範圍 uses the range judgement handed in, local dogs only', () => {
  expect(events(0, [{ ...dog, range: { status: 'near' } }]).events).toEqual([]);
  expect(events(0, [{ ...dog, range: { status: 'out' } }]).events[0].kind).toBe('dog-out-of-range');
  expect(events(0, [{ ...dog, fixSource: 'cloud', range: { status: 'out' } }]).events).toEqual([]);
});

// 「每一項都可以關…開關只管通知…狀態，不是提醒」: every problem is an event.
test('the switches do not change which problems exist', () => {
  const result = events(20 * M, [{ ...dog, batteryPercentage: 5, range: { status: 'out' } }], {
    storageError: 'SQLITE_FULL', receiver: { enabled: true, running: true, disconnectedAt: 1, expectedMasterId: 7 },
    receiverBattery: { valid: true, percentage: 10 },
  });
  expect(Object.keys(result.active).sort()).toEqual(['dog-battery:4', 'dog-out-of-range:4', 'dog-stale:4',
    'receiver-battery:7', 'receiver-disconnected:receiver', 'storage:phone']);
});

// notif「連上之後斷掉…30 秒…沒設定、自己按中斷、還沒連上過都不送」。
test.each([
  [{ enabled: true, running: true, disconnectedAt: 1 }, 30000, false],
  [{ enabled: true, running: true, disconnectedAt: 1 }, 30001, true],
  [{ enabled: false, running: true, disconnectedAt: 1 }, 40000, false],
  [{ enabled: true, running: false, disconnectedAt: 1 }, 40000, false],
  [{ enabled: true, running: true }, 40000, false],
  [{ enabled: true, running: true, connected: true, disconnectedAt: 1 }, 40000, false],
])('接收器斷線 eligibility %j at %i', (receiver, now, expected) => {
  expect(events(now, [], { receiver }).events.length > 0).toBe(expected);
});

// 「接收器 7 斷線了（3 隻狗收不到）」: the dogs this phone's receiver hears.
test('a disconnection counts the local dogs; a new one is a new episode', () => {
  const receiver = { enabled: true, running: true, disconnectedAt: 1000, expectedMasterId: 7 };
  const dogs = [dog, { ...dog, slaveId: 5, name: '狗 5' }, { ...dog, slaveId: 6, fixSource: 'cloud' }];
  const first = events(5 * M, dogs, { receiver });
  expect(first.active['receiver-disconnected:receiver']).toMatchObject({ startedAt: 1000,
    outage: { number: 7, dogCount: 2 } });
  const again = events(9 * M, [], { receiver: { ...receiver, disconnectedAt: 8 * M } }, first);
  expect(again.events.map(item => item.type)).toContain('start');
});

// edges「21–29%…不重新提醒」「第一次收到…9%…只發 10% 那一次」「充電中…不發」。
test('battery: 20% once, 10% once more, cleared only over 30%; charging is not low', () => {
  let state = {};
  let scheduler = {};
  const alerted = [];
  for (const [index, percentage] of [20, 25, 20, 10, 9, 30, 31, 9].entries()) {
    const now = index * 3 * M;
    state = events(now, [{ ...dog, fixAt: now, batteryPercentage: percentage }], {}, state);
    const result = scheduleAlerts(scheduler, { now, active: state.active });
    scheduler = result.state;
    alerted.push(!!result.effects.vibration);
  }
  expect(alerted).toEqual([true, false, false, true, false, false, false, true]);
  expect(events(0, [{ ...dog, batteryPercentage: 9, charging: true }]).events).toEqual([]);
  // The first reading already 9%: one alert, at level 2.
  expect(events(0, [{ ...dog, batteryPercentage: 9 }]).active['dog-battery:4'].level).toBe(2);
});

// notif「接收器電量低…只提醒一次；充到 30% 以上才解除」。
test('the receiver battery has no 10% alert', () => {
  const receiver = { enabled: true, expectedMasterId: 7 };
  const first = events(0, [], { receiver, receiverBattery: { valid: true, percentage: 20 } });
  expect(events(M, [], { receiver, receiverBattery: { valid: true, percentage: 9 } }, first).events).toEqual([]);
});

// Codex review: a reading missing for a while is the same episode; another receiver is its own.
test('battery episodes survive a missing reading; each receiver has its own', () => {
  const receiver = { enabled: true, expectedMasterId: 7 };
  let state = events(0, [{ ...dog, batteryPercentage: 15 }], { receiver, receiverBattery: { valid: true, percentage: 15 } });
  let scheduler = scheduleAlerts({}, { now: 0, active: state.active }).state;
  state = events(M, [], { receiver: { ...receiver, enabled: false } }, state);
  expect(state.active['dog-battery:4']).toMatchObject({ present: false, startedAt: 0 });
  expect(state.active['receiver-battery:7']).toMatchObject({ present: false, startedAt: 0 });
  scheduler = scheduleAlerts(scheduler, { now: M, active: state.active }).state;
  state = events(5 * M, [{ ...dog, batteryPercentage: 15 }], { receiver, receiverBattery: { valid: true, percentage: 15 } },
    state);
  expect(scheduleAlerts(scheduler, { now: 5 * M, active: state.active }).effects.vibration).toBeNull();
  const other = events(6 * M, [], { receiver: { enabled: true, expectedMasterId: 8 },
    receiverBattery: { valid: true, percentage: 15 } }, state);
  expect(other.active['receiver-battery:8']).toMatchObject({ present: true, startedAt: 6 * M });
  expect(other.active['receiver-battery:7']).toBeUndefined();
});

// Codex review: the pause ending waits for the gap; a queued cloud dog never alerts in the background.
test('the pause end keeps the 2-minute gap; queued cloud dogs wait for the foreground', () => {
  const a = event('dog-stale');
  const b = event('dog-battery', 5);
  let state = pauseAlerts(tick(0, [a]).state, map([a]), 0);
  state = tick(29 * M, [a, b], state).state;
  const ended = tick(30 * M, [a, b], state);
  expect(ended.effects.vibration).toBeNull();
  expect(tick(31 * M, [a, b], ended.state).effects.delivered).toEqual(['dog-stale:4']);
  const cloud = event('dog-stale', 6, { source: 'cloud' });
  const queued = run([[0, [a]], [M, [a, cloud]]]).state;
  expect(tick(3 * M, [a, cloud], queued, { foreground: false }).effects.vibration).toBeNull();
  expect(tick(4 * M, [a, cloud], queued).effects.delivered).toEqual(['dog-stale:6']);
});

// ---- scheduling ----------------------------------------------------------

// notif「第一次提醒後再過 30 分鐘還沒恢復，就再提醒一次，之後不再提醒」。
test('沒有新位置 is reminded once, 30 minutes after the first alert', () => {
  const list = [event('dog-stale'), event('storage', 'phone', { storage: { full: false } })];
  const { out } = run([[0, list], [29 * M, list], [30 * M, list], [60 * M, list], [90 * M, list]]);
  expect(out.map(effects => !!effects.vibration)).toEqual([true, false, true, false, false]);
  expect(out[2].delivered).toEqual(['dog-stale:4']);
});

// notif「最多每 2 分鐘一次；間隔內的新問題排隊，下一次一起震動」；edges「排隊中的問題已經解除…不震」。
test('the 2-minute gap queues new problems and drops cleared ones', () => {
  const a = event('dog-stale');
  const b = event('dog-battery', 5, { name: '狗 5' });
  const { out } = run([[0, [a]], [M, [a, b]], [2 * M, [a, b]]]);
  expect(out.map(effects => !!effects.vibration)).toEqual([true, false, true]);
  expect(out[2].delivered).toEqual(['dog-battery:5']);
  expect(run([[0, [a]], [M, [a, b]], [2 * M, [a]]]).out[2].vibration).toBeNull();
  // A content update in between is silent.
  const bg = { foreground: false };
  expect(run([[0, [a], bg], [M, [a, b], bg]]).out.map(effects => effects.notification)).toEqual(['notify', 'update']);
});

// notif「危急的不等間隔…長－短－長，約 1.5 秒…震一次」。
test('不在接收範圍 and 接收器斷線 alert at once with the strong pattern, once', () => {
  const a = event('dog-stale');
  const b = event('dog-battery', 5);
  const c = event('dog-out-of-range', 6);
  const { out, state } = run([[0, [a]], [1000, [a, b]], [2000, [a, b, c]]]);
  expect(out[2].vibration).toEqual([...VIBRATION_PATTERNS.critical]);
  expect(out[2].critical).toBe(true);
  expect(out[2].delivered.sort()).toEqual(['dog-battery:5', 'dog-out-of-range:6']);
  expect(tick(3000, [a, b, c], state).effects.vibration).toBeNull();
  expect(VIBRATION_PATTERNS.critical.reduce((sum, value) => sum + value, 0)).toBe(1500);
});

// 「S6 的開關管什麼」: off → not listed, no vibration, no card, no reminder; on again → not sent late.
test('a switched-off kind never alerts, and is not sent late when switched on again', () => {
  const stale = event('dog-stale');
  const off = { dogStale: false };
  let { out, state } = run([[0, [stale], { preferences: off, foreground: false }]]);
  expect(out[0]).toMatchObject({ notification: 'cancel', vibration: null, content: null, badgeCount: 1 });
  ({ out, state } = run([[40 * M, [stale], { foreground: false }]], state));
  expect(out[0].vibration).toBeNull();
  expect(out[0].notification).toBe('update');
  // It clears and comes back: a new episode alerts.
  ({ out } = run([[41 * M, []], [42 * M, [{ ...stale, startedAt: 42 * M }]]], state));
  expect(out[1].vibration).not.toBeNull();
});

// 「關掉時正在發生的問題：通知裡馬上拿掉這一項」「只剩關掉的項目時整則不發」。
test('switching a kind off removes it from the notification at once', () => {
  const a = event('dog-out-of-range');
  const b = event('dog-stale', 5, { name: '狗 5', ageMs: 12 * M });
  const { out } = run([[0, [a, b], { foreground: false }], [M, [a, b], { foreground: false,
    preferences: { dogOutOfRange: false } }], [2 * M, [a, b], { foreground: false,
    preferences: { dogOutOfRange: false, dogStale: false } }]]);
  expect(out[0].content.lines).toEqual(['豆豆 不在接收範圍', '狗 5 12 分鐘沒有新位置']);
  expect(out[1]).toMatchObject({ notification: 'update', content: { lines: ['狗 5 12 分鐘沒有新位置'] } });
  expect(out[2]).toMatchObject({ notification: 'cancel', content: null });
});

// notif「斷線造成的多隻「未更新」合併成一則、寫原因（斷線這一項關掉時，狗的未更新照「狗」的開關各自提醒）」。
test('a disconnection speaks for its quiet dogs unless its switch is off', () => {
  const outage = event('receiver-disconnected', 'receiver', { startedAt: 0, outage: { number: 7, dogCount: 3 } });
  const quiet = event('dog-stale', 4, { receiverAffected: true, ageMs: 10 * M });
  const merged = tick(10 * M, [outage, quiet], {}, { foreground: false });
  expect(merged.effects.content).toMatchObject({ title: 'DogTracker・接收器與手機要注意',
    lines: ['接收器 7 斷線了（3 隻狗收不到）'] });
  expect(merged.effects.delivered).toEqual(['receiver-disconnected:receiver']);
  const off = tick(10 * M, [outage, quiet], {}, { foreground: false,
    preferences: { receiverDisconnectedStorage: false } });
  expect(off.effects.content).toMatchObject({ title: 'DogTracker・1 隻狗要注意', lines: ['豆豆 10 分鐘沒有新位置'] });
  expect(off.effects.delivered).toEqual(['dog-stale:4']);
});

// notif「暫停…只暫停已經知道的問題；暫停期間出現新的狗、新的問題或更嚴重的問題照樣提醒」「重開 App 仍記得暫停」。
test('a pause silences the known problems only', () => {
  const a = event('dog-battery', 4, { level: 1 });
  const first = tick(0, [a]);
  const paused = JSON.parse(JSON.stringify(pauseAlerts(first.state, map([a]), M)));
  expect(pausePresentation(paused.pause, M)).toMatchObject({ short: expect.stringMatching(/^暫停到 \d\d:\d\d$/),
    title: expect.stringMatching(/^已暫停提醒到 \d\d:\d\d$/), action: '恢復' });
  // Known: nothing, and no notification (「暫停提醒 30 分」 closes it).
  expect(tick(3 * M, [a], paused, { foreground: false }).effects).toMatchObject({ vibration: null,
    notification: 'cancel' });
  // A new dog, a worse level, the problem back after it cleared: alert.
  expect(tick(3 * M, [a, event('dog-battery', 5)], paused).effects.vibration).not.toBeNull();
  expect(tick(3 * M, [{ ...a, level: 2 }], paused).effects.vibration).not.toBeNull();
  expect(tick(3 * M, [{ ...a, startedAt: 2 * M }], paused).effects.vibration).not.toBeNull();
});

// notif「期滿時還存在、而且開關開著的問題合併提醒一次」；S6「恢復」。
test.each([false, true])('the pause ending (resumed: %s) alerts the paused problems once', manual => {
  const list = [event('dog-stale'), event('dog-battery', 5)];
  let state = pauseAlerts(tick(0, list).state, map(list), 0);
  if (manual) state = resumeAlerts(state, 5 * M);
  const now = manual ? 5 * M : 30 * M;
  const ended = tick(now, list, state, { foreground: false });
  expect(ended.effects.notification).toBe('notify');
  expect(ended.state.pause).toBeNull();
  expect(tick(now + 3 * M, list, ended.state, { foreground: false }).effects.notification).toBe('update');
  // Switched off meanwhile: not alerted at the end.
  const off = tick(now, list, state, { foreground: false, preferences: { dogStale: false, dogBattery: false } });
  expect(off.effects.vibration).toBeNull();
});

// edges「前景…不是即時地圖…滑下 5 秒」「接收器電量低…只算進「⚠ N」」「N3 同時有好幾件事：一次只滑下最嚴重的那一張」。
test.each(['map', 'history', 'settings', 'other'])('in front on %s: vibrate, no notification, one N3 card off the map', screen => {
  const list = [event('dog-stale'), event('dog-battery', 5), event('receiver-battery', 'receiver')];
  const { effects } = tick(0, list, {}, { screen });
  expect(effects.notification).toBe('cancel');
  expect(effects.vibration).not.toBeNull();
  expect(effects.badgeCount).toBe(3);
  // Not on the live map, nor on the guide or D1 ('other').
  if (screen === 'map' || screen === 'other') expect(effects.card).toBeNull();
  else expect(effects.card).toMatchObject({ event: { key: 'dog-stale:4' }, durationMs: 5000 });
  expect(tick(0, [event('receiver-battery', 'receiver')], {}, { screen }).effects.card).toBeNull();
});

// notif「雲端狗只在 App 開著時提醒」「通知權限…發不出去」「震動」「聲音…預設關」。
test('cloud dogs wait for the foreground; denied notifications; 震動 and 聲音', () => {
  const cloud = event('dog-stale', 6, { source: 'cloud' });
  const background = tick(0, [cloud], {}, { foreground: false });
  expect(background.effects).toMatchObject({ vibration: null, notification: 'cancel' });
  expect(tick(M, [cloud], background.state).effects.vibration).not.toBeNull();
  const denied = tick(0, [event('dog-stale')], {}, { foreground: false, notificationsAllowed: false,
    preferences: { vibrate: false, sound: true } });
  expect(denied.effects).toMatchObject({ notification: 'cancel', vibration: null, sound: true });
  expect(tick(0, [event('dog-stale')]).effects.sound).toBe(false);
});

// notif「恢復就解除…連上之後再斷才會再跳一次」；滑掉通知不算解除 (no reset here).
test('a cleared problem cancels; coming back is a new alert', () => {
  const { out } = run([[0, [event('dog-stale')], { foreground: false }], [3 * M, [], { foreground: false }],
    [4 * M, [event('dog-stale', 4, { startedAt: 4 * M })]]]);
  expect(out.map(effects => effects.notification)).toEqual(['notify', 'cancel', 'cancel']);
  expect(out[2].vibration).not.toBeNull();
});

// notif「Android 細節：提醒和常駐服務分開兩個通知頻道」。
test('two channels', () => {
  expect(ALERT_CHANNELS.map(channel => channel.name)).toEqual(['提醒', '常駐']);
  expect(ALERT_CHANNELS[1]).toMatchObject({ sound: false, vibrate: false });
});

// ---- the notification ----------------------------------------------------

// 判定表「提醒通知只有一則」, c168–c174, c304; cases「通知被點開」.
test('one notification: N1, N2 and mixed titles, severity order, actions and target', () => {
  const out = event('dog-out-of-range');
  const quiet = event('dog-stale', 8, { name: '狗 8', ageMs: 10 * M + 30000 });
  expect(notificationContent([quiet, out])).toMatchObject({ title: 'DogTracker・2 隻狗要注意',
    lines: ['豆豆 不在接收範圍', '狗 8 10 分鐘沒有新位置'], target: { screen: 'map', dogId: 4 } });
  const storage = event('storage', 'phone', { storage: { full: true } });
  expect(notificationContent([storage])).toMatchObject({ title: 'DogTracker・接收器與手機要注意',
    lines: ['手機空間不足，位置存不進手機'], target: { screen: 'system-storage' } });
  expect(notificationContent([quiet, out, storage])).toMatchObject({ title: 'DogTracker・3 件事要注意',
    lines: ['豆豆 不在接收範圍', '手機空間不足，位置存不進手機', '狗 8 10 分鐘沒有新位置'] });
  expect(notificationContent([out]).actions.map(action => action.label)).toEqual(['打開地圖', '暫停提醒 30 分']);
  expect(notificationContent([out]).actions[0].target).toEqual({ screen: 'map', frameAll: true });
  expect(notificationContent([])).toBeNull();
});

test('each line', () => {
  expect(alertLine(event('dog-battery', 4, { percentage: 15 }))).toBe('豆豆 電量低 15%');
  expect(alertLine(event('receiver-battery', 'receiver', { percentage: 15, number: 7 }))).toBe('接收器 7 電量低 15%');
  expect(alertLine(event('dog-stale', 4, { ageMs: 75 * M }))).toBe('豆豆 1 小時沒有新位置');
  // Held indoors: judged by its packets, as the card says.
  expect(alertLine(event('dog-stale', 4, { ageMs: 12 * M, basis: 'packet' }))).toBe('豆豆 12 分鐘沒有新資料');
  expect(alertLine(event('receiver-disconnected', 'receiver', { outage: { number: 7, dogCount: 0 } })))
    .toBe('接收器 7 斷線了');
  expect(alertLine(event('storage', 'phone', { storage: { full: false } }))).toBe('位置存不進手機');
});

// notif「空間不足→系統的儲存空間設定；其他原因→診斷（S8）」；接收器→S2。
test.each([
  [event('storage', 'phone', { storage: { full: true } }), 'system-storage'],
  [event('storage', 'phone', { storage: { full: false } }), 'diagnostics'],
  [event('receiver-battery', 'receiver'), 'receiver-settings'],
  [event('dog-battery'), 'map'],
])('tap target', (item, screen) => {
  expect(alertTarget(item).screen).toBe(screen);
});

// ---- the engine and its saved state ----------------------------------------

// 「同一件事只提醒一次」 across a restart; 「重開 App 仍記得暫停」.
test('the saved state keeps what was alerted and the pause over a restart', () => {
  const input = { dogs: [dog], now: 12 * M, foreground: true };
  const first = stepAlerts({}, input);
  expect(first.effects.vibration).not.toBeNull();
  const paused = pauseAlertState(first.state, 13 * M);
  const saved = JSON.parse(JSON.stringify(persistedAlertState(paused)));
  expect(normalizeAlertState(saved)).toEqual(saved);
  const restored = restoreAlertState(saved);
  const again = stepAlerts(restored, { ...input, now: 14 * M });
  expect(again.effects.vibration).toBeNull();
  expect(again.state.scheduler.pause.until).toBe(43 * M);
  // The pause ends: the problem still there comes once.
  expect(stepAlerts(again.state, { ...input, now: 43 * M }).effects.vibration).not.toBeNull();
  expect(restoreAlertState({ version: 2 })).toEqual({});
  expect(normalizeAlertState('broken')).toBeNull();
});

// alerts-two-dogs on its fake clock: the N1 mockup's two dogs.
test('alerts-two-dogs: one critical alert, 「DogTracker・2 隻狗要注意」, then quiet', () => {
  const fixture = buildFixture('alerts-two-dogs');
  const dogs = mergeDogMarkers({ point: fixture.tracking.point, samples: fixture.tracking.positionSamples,
    cloudRows: fixture.cloudDogs.rows, packetRows: fixture.cloudDogs.packets, holds: fixture.cloudDogs.holds,
    statuses: fixture.cloudDogs.statuses, now: FIXTURE_NOW, windowMs: LIVE_PACKET_WINDOW_MS })
    .map(item => ({ ...item, name: dogName(item.slaveId, fixture.dogAliases),
      range: fixture.cloudDogs.ranges[item.slaveId] ?? null }));
  const input = { dogs, receiver: fixture.receiverState, cloud: fixture.cloudSync, now: FIXTURE_NOW };
  const first = stepAlerts({}, input);
  expect(first.effects).toMatchObject({ critical: true, content: { title: 'DogTracker・2 隻狗要注意',
    lines: ['豆豆 不在接收範圍', '狗 5 10 分鐘沒有新位置'] } });
  expect(stepAlerts(first.state, { ...input, now: FIXTURE_NOW + 5000 }).effects.vibration).toBeNull();
});

// 模組契約：純函式。
test('the reducers do not change their inputs', () => {
  const initial = events(11 * M);
  const state = tick(11 * M, Object.values(initial.active)).state;
  const saved = JSON.stringify({ initial, state });
  events(12 * M, [], {}, initial);
  tick(42 * M, Object.values(initial.active), state);
  pauseAlerts(state, initial.active, 12 * M);
  expect(JSON.stringify({ initial, state })).toBe(saved);
});

// 「危急的不等間隔」 is for the moment it happens: the pause ending repeats a
// paused 不在接收範圍 with the normal pattern.
test('a paused critical problem comes back at the end with the normal pattern', () => {
  const out = [event('dog-out-of-range')];
  const state = pauseAlerts(tick(0, out).state, map(out), 0);
  const ended = tick(30 * M, out, state);
  expect(ended.effects).toMatchObject({ critical: false, vibration: [...VIBRATION_PATTERNS.normal] });
});
