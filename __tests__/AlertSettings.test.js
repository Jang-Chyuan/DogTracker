import { t as i18nT } from '../src/i18n';
import { formatClock } from '../src/map/MapFormat';
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Switch } from 'react-native';
import {
  ALERT_KINDS, DEFAULT_ALERT_PREFERENCES, alertDelivery, alertEnabled, alertsHomeStatus, alertsPage,
  changeAlertPreferences, groupStatus, normalizeAlertPreferences,
} from '../src/alerts/AlertPreferences';
import AlertSettings from '../src/settings/AlertSettings';
import { useAlertPreferences } from '../src/settings/useAlertPreferences';
import { applyScreenFixture, buildFixture, FIXTURE_NOW, FIXTURE_PAGES, fixturePageFromUrl }
  from '../src/dev/ScreenFixtures';
import { settingsHome, settingsInput } from '../src/settings/SettingsModel';
import { DEFAULT_TRACKING_PREFERENCES } from '../src/tracking/TrackingPreferences';
import { emptyLiveRoute } from '../src/tracking/LiveRouteWindow';

// ---- AlertPreferences (pure) -------------------------------------------------

test('defaults: every alert on, 震動 on, 聲音 off (design 「聲音」 預設關)', () => {
  expect(DEFAULT_ALERT_PREFERENCES).toEqual({ dogStale: true, dogOutOfRange: true, dogBattery: true,
    receiverBattery: true, receiverDisconnectedStorage: true, vibrate: true, sound: false });
  expect(normalizeAlertPreferences(undefined)).toEqual(DEFAULT_ALERT_PREFERENCES);
  expect(normalizeAlertPreferences(null)).toEqual(DEFAULT_ALERT_PREFERENCES);
  expect(normalizeAlertPreferences('on')).toEqual(DEFAULT_ALERT_PREFERENCES);
});

test('normalize keeps booleans, drops malformed and unknown keys', () => {
  expect(normalizeAlertPreferences({ sound: true, vibrate: 0, dogStale: false, receiverDisconnectedStorage: false, x: 1 }))
    .toEqual({ ...DEFAULT_ALERT_PREFERENCES, sound: true, dogStale: false, receiverDisconnectedStorage: false });
  expect(changeAlertPreferences({ sound: true }, { vibrate: false, storage: false }))
    .toEqual({ ...DEFAULT_ALERT_PREFERENCES, sound: true, vibrate: false });
});

test('every notification category follows its switch', () => {
  const allOff = { dogStale: false, dogOutOfRange: false, dogBattery: false, receiverBattery: false,
    receiverDisconnectedStorage: false };
  expect(alertEnabled(allOff, 'receiver-disconnected')).toBe(false);
  expect(alertEnabled(allOff, 'storage')).toBe(false);
  for (const kind of ALERT_KINDS) {
    expect(alertEnabled(allOff, kind)).toBe(false);
    expect(alertEnabled({}, kind)).toBe(true);
  }
  expect(ALERT_KINDS).toEqual(['dog-stale', 'dog-out-of-range', 'dog-battery', 'receiver-battery',
    'receiver-disconnected', 'storage']);
  // An unknown kind is never silenced by accident.
  expect(alertEnabled(allOff, 'something-new')).toBe(true);
  expect(alertDelivery({})).toEqual({ vibrate: true, sound: false });
  expect(alertDelivery({ vibrate: false, sound: true })).toEqual({ vibrate: false, sound: true });
});

test('group status: 全部開／部分開／全部關 (c300)', () => {
  const keys = ['dogStale', 'dogOutOfRange', 'dogBattery'];
  expect(groupStatus({}, keys)).toBe(i18nT("c472"));
  expect(groupStatus({ dogOutOfRange: false }, keys)).toBe(i18nT("c473"));
  expect(groupStatus({ dogStale: false, dogOutOfRange: false, dogBattery: false }, keys)).toBe(i18nT("c474"));
});

test('S1 提醒 row: how alerts arrive (c193 「震動」), including notification-only delivery', () => {
  expect(alertsHomeStatus({})).toEqual([i18nT('c241')]);
  expect(alertsHomeStatus({ sound: true })).toEqual(['震動、聲音']);
  expect(alertsHomeStatus({ vibrate: false, sound: true })).toEqual([i18nT('dev.alertPreview.AlertPreview.detail')]);
  expect(alertsHomeStatus({ vibrate: false })).toEqual([i18nT('c414')]);
  expect(alertsHomeStatus({ receiverBattery: false })).toEqual([i18nT('c241')]);
  expect(alertsHomeStatus({ dogStale: false, dogOutOfRange: false, dogBattery: false, receiverBattery: false }))
    .toEqual([i18nT('c241')]);
});

test('S6 page model: the 狗 group, the switches, 通知權限', () => {
  const page = alertsPage({ dogBattery: false, sound: true }, { notificationsDenied: false });
  expect(page.dogs).toEqual({ status: i18nT("c473"), items: [
    { key: 'dogStale', title: i18nT("c475"), on: true },
    { key: 'dogOutOfRange', title: i18nT('c078'), on: true },
    { key: 'dogBattery', title: i18nT("c476"), on: false },
  ] });
  // 判定表「S6 的「通知權限」列」: a row only while not allowed.
  expect(page).toMatchObject({ receiverBattery: true, vibrate: true, sound: true, notifications: null,
    pause: null });
  expect(alertsPage({}, { notificationsDenied: true }).notifications)
    .toEqual({ denied: true, detail: i18nT('c028'), action: i18nT('c225') });
  // 「已暫停提醒到 11:10」＋「恢復」 (c298, c299) while a pause is in force.
  const until = new Date(2026, 9, 7, 11, 10).getTime();
  expect(alertsPage({}, {}, { until }, until - 60000).pause).toEqual({ title: '已暫停提醒到 11:10', action: i18nT('dev.alertPreview.AlertPreview.label') });
  expect(alertsPage({}, {}, { until }, until).pause).toBeNull();
});

// ---- S6 page -----------------------------------------------------------------

const text = renderer => JSON.stringify(renderer.toJSON());
const byId = (renderer, id) => renderer.root.findAll(node => node.props.testID === id
  && (typeof node.props.onPress === 'function' || typeof node.props.onValueChange === 'function'))[0];

test('S6: rows in order; disconnect/storage has a default-on switch', async () => {
  let renderer;
  await act(async () => {
    renderer = Renderer.create(<AlertSettings page={alertsPage({}, {})} onChange={jest.fn()} />);
  });
  const shown = text(renderer);
  const order = ['狗', '沒有新位置、不在接收範圍、電量低', '全部開', '接收器電量低', '接收器斷線、位置存不進手機', '震動', '聲音', '跟著手機的通知音量'];
  let at = -1;
  for (const words of order) {
    const next = shown.indexOf(`"${words}"`, at + 1);
    expect(next).toBeGreaterThan(at);
    at = next;
  }
  // No 「可以關」 subtitle (c237: removed; the switch says it); 通知權限 allowed: no row.
  expect(shown).not.toContain('可以關');
  expect(shown).not.toContain(i18nT('c245'));
  // Four switches while the 狗 group is closed.
  expect(renderer.root.findAllByType(Switch).map(item => item.props.testID))
    .toEqual(['alerts-receiverBattery', 'alerts-receiverDisconnectedStorage', 'alerts-vibrate', 'alerts-sound']);
  expect(byId(renderer, 'alerts-receiverDisconnectedStorage').props.value).toBe(true);
  expect(renderer.root.findAllByType(Switch)[0].props.value).toBe(true);
  const sound = renderer.root.findAllByType(Switch).find(item => item.props.testID === 'alerts-sound');
  expect(sound.props.value).toBe(false);
});

test('S6: pressing 狗 shows its three switches; each change goes out at once', async () => {
  const onChange = jest.fn();
  let renderer;
  await act(async () => {
    renderer = Renderer.create(<AlertSettings page={alertsPage({ dogOutOfRange: false }, {})} onChange={onChange} />);
  });
  expect(text(renderer)).toContain(i18nT("c473"));
  await act(async () => byId(renderer, 'alerts-dogs').props.onPress());
  expect(byId(renderer, 'alerts-dogs').props.accessibilityState).toEqual({ expanded: true });
  for (const words of ['沒有新位置', '不在接收範圍', '電量低']) expect(text(renderer)).toContain(`"${words}"`);
  expect(byId(renderer, 'alerts-dogOutOfRange').props.value).toBe(false);
  await act(async () => byId(renderer, 'alerts-dogOutOfRange').props.onValueChange(true));
  expect(onChange).toHaveBeenLastCalledWith({ dogOutOfRange: true });
  await act(async () => byId(renderer, 'alerts-sound').props.onValueChange(true));
  expect(onChange).toHaveBeenLastCalledWith({ sound: true });
  await act(async () => byId(renderer, 'alerts-vibrate').props.onValueChange(false));
  expect(onChange).toHaveBeenLastCalledWith({ vibrate: false });
  await act(async () => byId(renderer, 'alerts-receiverBattery').props.onValueChange(false));
  expect(onChange).toHaveBeenLastCalledWith({ receiverBattery: false });
  await act(async () => byId(renderer, 'alerts-receiverDisconnectedStorage').props.onValueChange(false));
  expect(onChange).toHaveBeenLastCalledWith({ receiverDisconnectedStorage: false });
  // Pressed again, the group closes.
  await act(async () => byId(renderer, 'alerts-dogs').props.onPress());
  expect(byId(renderer, 'alerts-dogOutOfRange')).toBeUndefined();
});

test('S6: notifications not allowed → 未允許 and 「開系統設定 ›」 opens the system settings', async () => {
  const onNotificationSettings = jest.fn();
  let renderer;
  await act(async () => {
    renderer = Renderer.create(<AlertSettings page={alertsPage({}, { notificationsDenied: true })}
      onChange={jest.fn()} onNotificationSettings={onNotificationSettings} />);
  });
  expect(text(renderer)).toContain(i18nT('c028'));
  expect(text(renderer)).toContain(i18nT('c225'));
  expect(text(renderer)).not.toContain(i18nT('c017'));
  // E11: same problem-row contract as S4 permissions.
  expect(byId(renderer, 'alerts-notifications').props.problem).toBe(true);
  expect(byId(renderer, 'alerts-notifications').props.actionTone).toBeUndefined();
  expect(byId(renderer, 'alerts-notifications').props.detailTone).toBeUndefined();
  await act(async () => byId(renderer, 'alerts-notifications').props.onPress());
  expect(onNotificationSettings).toHaveBeenCalledTimes(1);
});

// User 2026-10-09: 通知權限 moves up — under the pause row, above 狗.
test('S6: 通知權限 comes first, under 「已暫停提醒到」 while paused', async () => {
  const now = new Date(2026, 9, 3, 10, 20).getTime();
  let renderer;
  await act(async () => {
    renderer = Renderer.create(<AlertSettings page={alertsPage({}, { notificationsDenied: true },
      { until: now + 50 * 60000 }, now)} onChange={jest.fn()} />);
  });
  const shown = text(renderer);
  const order = ['已暫停提醒到 11:10', '通知權限', '未允許', '狗', '接收器電量低', '震動', '聲音'];
  let at = -1;
  for (const words of order) {
    const next = shown.indexOf(`"${words}"`, at + 1);
    expect(next).toBeGreaterThan(at);
    at = next;
  }
});

test('S6: allowed → 已允許, the row does nothing', async () => {
  let renderer;
  await act(async () => {
    renderer = Renderer.create(<AlertSettings page={alertsPage({}, {})} onChange={jest.fn()} />);
  });
  expect(byId(renderer, 'alerts-notifications')).toBeUndefined();
});

// ---- useAlertPreferences ---------------------------------------------------------

function Probe({ saved, save, onValue, source = null }) {
  const alerts = useAlertPreferences(saved, save, source);
  onValue(alerts);
  return null;
}

test('a switch shows at once, is saved at once, and goes back if the save fails', async () => {
  let latest;
  let resolveSave;
  const save = jest.fn(() => new Promise(resolve => { resolveSave = resolve; }));
  let renderer;
  await act(async () => {
    renderer = Renderer.create(<Probe saved={undefined} save={save} onValue={value => { latest = value; }} />);
  });
  expect(latest.value).toEqual(DEFAULT_ALERT_PREFERENCES);
  await act(async () => latest.change({ sound: true }));
  expect(latest.value.sound).toBe(true);
  expect(save).toHaveBeenCalledWith({ alerts: { ...DEFAULT_ALERT_PREFERENCES, sound: true } });
  // Saved: the stored value catches up.
  await act(async () => resolveSave(true));
  await act(async () => renderer.update(<Probe saved={{ ...DEFAULT_ALERT_PREFERENCES, sound: true }} save={save}
    onValue={value => { latest = value; }} />));
  expect(latest.value.sound).toBe(true);
  // A failed save: back to what is stored.
  await act(async () => latest.change({ vibrate: false }));
  expect(latest.value.vibrate).toBe(false);
  await act(async () => resolveSave(false));
  expect(latest.value).toEqual({ ...DEFAULT_ALERT_PREFERENCES, sound: true });
});

test('quick changes build on each other, not on the stored value', async () => {
  let latest;
  const save = jest.fn(() => new Promise(() => {}));
  await act(async () => {
    Renderer.create(<Probe saved={{}} save={save} onValue={value => { latest = value; }} />);
  });
  await act(async () => {
    latest.change({ sound: true });
    latest.change({ dogStale: false });
  });
  expect(save).toHaveBeenLastCalledWith({ alerts: { ...DEFAULT_ALERT_PREFERENCES, sound: true, dogStale: false } });
  expect(latest.value).toMatchObject({ sound: true, dogStale: false });
});

// ---- fixtures ----------------------------------------------------------------------

function settingsOf(name, page = null) {
  const fixture = buildFixture(name, FIXTURE_NOW, page);
  const live = {
    tracking: { mode: 'real', point: {}, route: emptyLiveRoute(), positionSamples: [], ready: { real: true },
      errors: {}, initialSnapshotReady: true, foreground: true,
      preferences: { ready: true, busy: false, value: DEFAULT_TRACKING_PREFERENCES } },
    phone: { enabled: true }, cloudDogs: { rows: [] }, cloudSync: { ownerId: 'real' },
    history: { key: 'live', preferences: { source: 'local', dogAliases: {} }, save: jest.fn() },
    dogAvatars: { avatars: {}, save: jest.fn() },
  };
  const inputs = applyScreenFixture(fixture, live);
  return { fixture, inputs,
    data: settingsInput(inputs, { now: fixture.now, receiverState: fixture.receiverState }) };
}
const alertsRow = data => settingsHome(data).groups.flatMap(group => group.rows).find(row => row.id === 'alerts');

test('alerts-default: opens S6; every alert on; S1 says 「震動」', () => {
  const { fixture, data } = settingsOf('alerts-default');
  expect(fixture.openRoute).toBe('alerts');
  expect(data.alerts).toEqual(DEFAULT_ALERT_PREFERENCES);
  expect(alertsPage(data.alerts, data.permissions)).toMatchObject({ dogs: { status: i18nT("c472") },
    receiverBattery: true, vibrate: true, sound: false, notifications: null });
  expect(alertsRow(data)).toMatchObject({ problem: false, status: [i18nT('c241')] });
});

test('alerts-some-off: 不在接收範圍 and 接收器電量低 off, 聲音 on, the 狗 group open', () => {
  const { fixture, data } = settingsOf('alerts-some-off');
  expect(fixture.alertsOpen).toBe(true);
  const page = alertsPage(data.alerts, data.permissions);
  expect(page.dogs.status).toBe(i18nT("c473"));
  expect(page.dogs.items.map(item => item.on)).toEqual([true, false, true]);
  expect(page).toMatchObject({ receiverBattery: false, receiverDisconnectedStorage: false, vibrate: true, sound: true });
  expect(alertsRow(data)).toMatchObject({ problem: false, status: ['震動、聲音'] });
});

test('alerts-all-off: every notification disabled and S1 says 全部關閉', () => {
  const { fixture, data } = settingsOf('alerts-all-off');
  expect(fixture.alertsOpen).toBe(true);
  for (const kind of ALERT_KINDS) expect(alertEnabled(data.alerts, kind)).toBe(false);
  expect(Object.values(data.alerts).every(value => value === false)).toBe(true);
  expect(alertsRow(data)).toMatchObject({ problem: false, status: [i18nT('c413')] });
  // Delivery controls may remain enabled while every category is disabled.
  expect(alertsHomeStatus({ ...data.alerts, vibrate: true, sound: true })).toEqual([i18nT('c413')]);
});

test('notifications-denied: S6 未允許; S1 提醒 (and 手機) only the red 「!」', () => {
  const { fixture, data } = settingsOf('notifications-denied');
  expect(fixture.openRoute).toBe('alerts');
  expect(alertsPage(data.alerts, data.permissions).notifications.denied).toBe(true);
  expect(alertsRow(data)).toMatchObject({ problem: true, status: [], label: '提醒，有問題：通知未允許' });
  const phone = settingsHome(data).groups[0].rows[1];
  expect(phone.problem).toBe(true);
});

test('&page=alerts opens any state on S6; a fixture switch changes only memory', async () => {
  expect(FIXTURE_PAGES).toContain('alerts');
  expect(fixturePageFromUrl('dogtracker://dev/fixture?name=all-good&page=alerts')).toBe('alerts');
  expect(buildFixture('settings-problems', FIXTURE_NOW, 'alerts').openRoute).toBe('alerts');
  const fixture = buildFixture('alerts-default');
  const setAlerts = jest.fn();
  const live = settingsOf('alerts-default').inputs;
  const inputs = applyScreenFixture(fixture, { ...live, tracking: { ...live.tracking } }, { setAlerts });
  expect(await inputs.tracking.saveTrackingPreferences({ alerts: { sound: true } })).toBe(true);
  expect(setAlerts).toHaveBeenCalledWith({ sound: true });
  // The edit is what the fixture then shows.
  const edited = applyScreenFixture(fixture, live, { alerts: { ...DEFAULT_ALERT_PREFERENCES, sound: true } });
  expect(edited.tracking.preferences.value.alerts.sound).toBe(true);
});

test('on, then off before the first write ends: the first refused, the second saved → the stored value shows', async () => {
  let latest;
  const answers = [];
  const save = jest.fn(() => new Promise(resolve => answers.push(resolve)));
  const saved = { ...DEFAULT_ALERT_PREFERENCES };
  let renderer;
  await act(async () => {
    renderer = Renderer.create(<Probe saved={saved} save={save} onValue={value => { latest = value; }} />);
  });
  await act(async () => latest.change({ sound: true }));
  await act(async () => latest.change({ sound: false }));
  await act(async () => answers[0](false));
  expect(latest.value.sound).toBe(false);
  await act(async () => answers[1](true));
  // Nothing stored changed, and nothing is left in flight: a later stored
  // value is shown as it is.
  await act(async () => renderer.update(<Probe saved={{ ...saved, vibrate: false }} save={save}
    onValue={value => { latest = value; }} />));
  expect(latest.value).toEqual({ ...DEFAULT_ALERT_PREFERENCES, vibrate: false });
});

test('a change in flight is dropped when the source changes (live ↔ fixture)', async () => {
  let latest;
  const save = jest.fn(() => new Promise(() => {}));
  const probe = (source, saved) => <Probe saved={saved} save={save} source={source}
    onValue={value => { latest = value; }} />;
  let renderer;
  await act(async () => { renderer = Renderer.create(probe('live', {})); });
  await act(async () => latest.change({ sound: true }));
  expect(latest.value.sound).toBe(true);
  await act(async () => renderer.update(probe('alerts-default', {})));
  expect(latest.value.sound).toBe(false);
});

test('S6: each switch row is one TalkBack switch — its label and on/off — and the whole row toggles it (060)', async () => {
  let renderer;
  const onChange = jest.fn();
  await act(async () => {
    renderer = Renderer.create(<AlertSettings page={alertsPage({}, {})} onChange={onChange} />);
  });
  const rows = renderer.root.findAll(node => node.props.accessibilityRole === 'switch' && node.props.onPress);
  expect(rows.length).toBeGreaterThanOrEqual(4);
  for (const row of rows) {
    expect(row.props.accessibilityLabel).toBeTruthy();
    expect(typeof row.props.accessibilityState.checked).toBe('boolean');
  }
  // The switch itself is drawn but not a second TalkBack item.
  for (const item of renderer.root.findAllByType(Switch)) {
    expect(item.parent.props.importantForAccessibility).toBe('no-hide-descendants');
  }
  const vibrate = rows.find(row => row.props.accessibilityLabel === '震動');
  await act(async () => vibrate.props.onPress());
  expect(onChange).toHaveBeenCalledWith({ vibrate: !vibrate.props.accessibilityState.checked });
});

test('S1 priority: permission denied, all off, active pause, delivery; expired pause clears', () => {
  const { data } = settingsOf('alerts-all-off');
  const pausedUntil = FIXTURE_NOW + 60000;
  data.alertPause = { until: pausedUntil };
  data.alerts = { ...data.alerts, vibrate: true, sound: true };
  expect(alertsRow(data)).toMatchObject({ status: [i18nT('c413')], statusTone: 'muted' });
  data.permissions = { ...data.permissions, notificationsDenied: true };
  expect(alertsRow(data)).toMatchObject({ problem: true, status: [], label: '提醒，有問題：通知未允許' });
  data.alerts = { ...DEFAULT_ALERT_PREFERENCES };
  expect(alertsRow(data).problem).toBe(true);
  data.permissions.notificationsDenied = false;
  expect(alertsRow(data)).toMatchObject({ status: [`暫停到 ${formatClock(pausedUntil)}`], statusTone: 'warn' });
  data.now = pausedUntil;
  expect(alertsRow(data)).toMatchObject({ status: [i18nT('c241')], statusTone: null });
  data.alerts = { ...DEFAULT_ALERT_PREFERENCES, vibrate: false, sound: false };
  expect(alertsRow(data).status).toEqual([i18nT('c414')]);
  expect(alertsRow(data).label).toBe('提醒，震動、聲音、各項開關，只有通知');
});

test('S6 dog group says paused until the pause expires, preserving its switches', () => {
  const preferences = { dogOutOfRange: false };
  const pause = { until: 120000 };
  const active = alertsPage(preferences, {}, pause, 60000);
  expect(active.dogs.status).toBe('暫停中');
  expect(active.dogs.items.map(item => item.on)).toEqual([true, false, true]);
  expect(alertsPage(preferences, {}, pause, 120000).dogs.status).toBe('部分開');
});
