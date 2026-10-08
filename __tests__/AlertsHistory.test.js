import { alertsHistory, n3Presentation, notificationTap, alertText } from '../src/alerts/AlertsHistory';
import { scheduleAlerts } from '../src/alerts/AlertScheduler';
const range = { key: 'range', kind: 'dog-out-of-range', subject: 8, name: '豆豆', severity: 5, startedAt: 100, at: 100, type: 'start' };
const battery = { key: 'battery', kind: 'receiver-battery', subject: 'receiver', severity: 1, percentage: 20, startedAt: 100 };

test('history filters bounds, subjects, clears and duplicate events without mutating', () => {
  const located = { ...range, coordinate: { latitude: 25, longitude: 121 } };
  const events = [located, located, { ...range, type: 'clear', at: 200 }, { ...range, type: 'escalate', at: 300 }];
  const saved = JSON.stringify(events);
  const result = alertsHistory(events, { start: 100, end: 300, dogIds: [8] });
  expect(result.timeline).toHaveLength(2);
  expect(result.markers).toHaveLength(1);
  expect(result.timeline[0]).toMatchObject({ text: '豆豆 不在接收範圍', icon: 'warning', target: { screen: 'map', dogId: 8, openDogCard: true } });
  expect(alertsHistory(events, { dogIds: [] }).timeline).toEqual([]);
  expect(alertsHistory(events, { start: 101, end: 299 }).timeline).toEqual([]);
  result.markers[0].coordinate.latitude = 0;
  expect(JSON.stringify(events)).toBe(saved);
});

test('device events have no dog and missing/invalid positions do not invent markers', () => {
  const storage = { key: 'storage', kind: 'storage', storage: { full: true }, type: 'start', at: 100 };
  expect(alertsHistory([storage]).timeline[0]).toMatchObject({ dogId: null, text: '位置存不進手機・手機空間不足' });
  expect(alertsHistory([{ ...range, coordinate: { latitude: NaN, longitude: 121 } }]).markers).toEqual([]);
  expect(alertsHistory()).toEqual({ timeline: [], markers: [] });
});

test.each([
  [{ ...range, kind: 'dog-stale' }, '豆豆 10 分鐘沒有新位置'],
  [{ ...range, kind: 'dog-stale', basis: 'packet' }, '豆豆 10 分鐘沒有新資料'],
  [{ ...range, kind: 'dog-battery', percentage: 10 }, '豆豆 電量低 10%'],
  [battery, '接收器電量低 20%'],
  [{ kind: 'receiver-disconnected', outage: { number: 7 } }, '接收器 7 斷線了'],
])('exact copy %j', (event, text) => expect(alertText(event)).toBe(text));

test('N3 consumes scheduler delivery, lasts exactly five seconds, receiver battery badge only', () => {
  const active = { range, battery };
  const { effects } = scheduleAlerts({}, { active, now: 100, screen: 'history' });
  const input = { active, cards: effects.cards, deliveredAt: 100, now: 5099 };
  expect(n3Presentation(input)).toMatchObject({ badge: '⚠ 2', cards: [{ text: '豆豆 不在接收範圍', dismissible: false, actions: [], expiresAt: 5100 }] });
  expect(n3Presentation({ ...input, now: 5100 }).cards).toEqual([]);
  expect(n3Presentation({ ...input, screen: 'map' }).badge).toBeNull();
  expect(n3Presentation({ ...input, foreground: false }).cards).toEqual([]);
  expect(n3Presentation({ ...input, active: [battery] }).cards).toEqual([]);
  expect(n3Presentation({ ...input, active: [{ ...range, startedAt: 200 }] }).cards).toEqual([]);
});

test('tap priority ignores hidden latches, opens live map then correct destination', () => {
  expect(notificationTap([battery, range]).destination.dogId).toBe(8);
  expect(notificationTap([range, { key: 'outage', kind: 'receiver-disconnected' }]).destination.screen).toBe('receiver-settings');
  expect(notificationTap([{ key: 's', kind: 'storage', storage: { full: false } }]).destination.screen).toBe('diagnostics');
  expect(notificationTap([{ key: 's', kind: 'storage', storage: { full: true } }]).destination.screen).toBe('system-storage');
  expect(notificationTap([{ ...range, present: false }])).toEqual({ screen: 'map', destination: null });
});
