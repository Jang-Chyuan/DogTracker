import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Alert } from 'react-native';
import { applyScreenFixture, buildFixture, FIXTURE_NOW } from '../src/dev/ScreenFixtures';
import {
  missingPermissions, phonePage, receivedSources, receiverPage, receiverPhase, settingsHome, settingsInput,
  settingsReasons,
} from '../src/settings/SettingsModel';
import { judgeSwitch, mismatchDialog, snapshotReceiver } from '../src/settings/ReceiverSwitch';
import { useReceiverControl } from '../src/settings/useReceiverControl';
import ReceiverSettings from '../src/settings/ReceiverSettings';
import PhoneSettings from '../src/settings/PhoneSettings';
import SettingsHome from '../src/settings/SettingsHome';
import { RECEIVER_MISSING_MS } from '../src/map/TopAlerts';
import { DEFAULT_TRACKING_PREFERENCES } from '../src/tracking/TrackingPreferences';
import { emptyLiveRoute } from '../src/tracking/LiveRouteWindow';

const MINUTE = 60000;

// What App hands the settings pages for a fixture.
function input(name, { page = null, wait = null } = {}) {
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
  return { fixture, data: settingsInput(inputs, { now: fixture.now, receiverState: fixture.receiverState,
    receiverWait: wait }) };
}
const rowsOf = home => Object.fromEntries(home.groups.flatMap(group => group.rows).map(row => [row.id, row]));
const text = renderer => JSON.stringify(renderer.toJSON());

// ---- S1 ---------------------------------------------------------------------

test('settings-all-ok: four groups, no 地圖 row, every row its usual status and no 「!」', () => {
  const { fixture, data } = input('settings-all-ok');
  expect(fixture.openRoute).toBe('settings');
  const home = settingsHome(data);
  expect(home.groups.map(group => group.title)).toEqual(['裝置', '帳號與資料', '提醒', '其他']);
  expect(home.groups.map(group => group.rows.map(row => row.id)))
    .toEqual([['receiver', 'phone'], ['account'], ['alerts'], ['advanced']]);
  const rows = rowsOf(home);
  expect(Object.values(rows).some(row => row.problem)).toBe(false);
  expect(rows.receiver).toMatchObject({ subtitle: '接收器 7', status: ['已連線', '電量 64%'] });
  expect(rows.phone).toMatchObject({ subtitle: '位置記錄、權限', status: ['記錄中'] });
  expect(rows.account).toMatchObject({ subtitle: 'tim@example.com', status: ['已登入'] });
  expect(rows.diagnostics).toBeUndefined();
  expect(rows.alerts).toMatchObject({ subtitle: '震動、聲音、各項開關', status: ['震動'] });
  expect(rows.receiver.label).toBe('接收器，接收器 7，已連線，電量 64%');
  expect(home.storage).toBeNull();
});

test('settings-problems: 手機, Supabase 帳號 and 提醒 carry only the red 「!」; TalkBack still says why', () => {
  const { fixture, data } = input('settings-problems');
  expect(fixture.openRoute).toBe('settings');
  const rows = rowsOf(settingsHome(data));
  expect(rows.receiver.problem).toBe(false);
  for (const id of ['phone', 'account', 'alerts']) {
    expect(rows[id].problem).toBe(true);
    expect(rows[id].status).toEqual([]);
  }
  expect(rows.phone.label).toBe('手機，有問題：定位服務關著、通知未允許');
  expect(rows.account.label).toBe('Supabase 帳號，有問題：連不上');
  expect(rows.alerts.label).toBe('提醒，有問題：通知未允許');
  expect(rows.diagnostics).toBeUndefined();
  expect(rows.advanced.problem).toBe(false);
});

test('every gear red-dot reason lands on its S1 row', () => {
  const base = input('settings-all-ok').data;
  const rows = data => rowsOf(settingsHome({ ...base, ...data }));
  // A receiver not found for two minutes (gear dot, never a card).
  const waiting = { ...base.receiverState, connected: false, receiving: false, lastReceivedAt: 0 };
  const missing = rows({ receiverState: waiting,
    receiverWait: { waitingSince: FIXTURE_NOW - RECEIVER_MISSING_MS, device: '' } });
  expect(missing.receiver).toMatchObject({ problem: true, label: '接收器，有問題：找不到接收器 7' });
  // Under two minutes it is only 連線中.
  const connecting = rows({ receiverState: waiting, receiverWait: { waitingSince: FIXTURE_NOW - MINUTE } });
  expect(connecting.receiver).toMatchObject({ problem: false, status: ['連線中'] });
  // A dropped link counts after 30 s whether or not its card was closed.
  const dropped = rows({ receiverState: { ...waiting, lastReceivedAt: FIXTURE_NOW - 5 * MINUTE,
    disconnectedAt: FIXTURE_NOW - 5 * MINUTE } });
  expect(dropped.receiver.label).toBe('接收器，有問題：接收器 7 斷線了');
  // The receiver's own battery low.
  const low = input('receiver-battery-low').data;
  expect(rowsOf(settingsHome(low)).receiver.label).toBe('接收器，有問題：接收器電量低');
  // Permissions: approximate only, nearby devices.
  expect(rows({ phone: { ...base.phone, permission: 'approximate' } }).phone.label)
    .toBe('手機，有問題：只給了大概位置');
  expect(rows({ permissions: { nearbyDenied: true } }).phone.label).toBe('手機，有問題：附近的裝置未允許');
  // The sign-in expired.
  expect(rows({ signInExpired: true }).account.label).toBe('Supabase 帳號，有問題：需要重新登入');
  // A storage failure is the warning card above the groups, not a row.
  const full = settingsHome({ ...base, storage: { full: true, reason: 'disk is full' } });
  expect(full.storage).toEqual({ full: true, reason: 'disk is full' });
  expect(settingsReasons({ ...base, storage: { full: true, reason: 'x' } })).toContain('storage');
});

test('S1: signed out is a plain 未登入; battery optimization is never a problem', () => {
  const { data } = input('signed-out-map');
  const rows = rowsOf(settingsHome(data));
  expect(rows.account).toMatchObject({ subtitle: '未登入', problem: false, status: [] });
  expect(rowsOf(settingsHome({ ...data, permissions: { batteryIgnored: false } })).phone.problem).toBe(false);
});

test('S1 draws the rows: status text on the right, only 「!」 for a problem, and the version last', async () => {
  const onOpen = jest.fn();
  let renderer;
  await act(async () => {
    renderer = Renderer.create(<SettingsHome home={settingsHome(input('settings-problems').data)} version="3.0.0"
      onOpen={onOpen} />);
  });
  const out = text(renderer);
  expect(out).toContain('已連線');
  expect(out).toContain('電量 64%');
  expect(out).toContain('DogTracker 3.0.0');
  expect(out).not.toContain('地圖與提醒');
  const row = id => renderer.root.findAll(node => node.props.testID === `settings-row-${id}`
    && typeof node.props.onPress === 'function')[0];
  // The phone row has no status words, only the 「!」.
  const words = node => node.findAll(child => child.type === 'Text' && typeof child.props.children === 'string')
    .map(child => child.props.children);
  expect(words(row('phone'))).toEqual(['手機', '位置記錄、權限', '!', '›']);
  expect(words(row('receiver'))).toEqual(['接收器', '接收器 7', '已連線', '電量 64%', '›']);
  await act(async () => row('receiver').props.onPress());
  expect(onOpen).toHaveBeenCalledWith('receiver');
  await act(async () => renderer.unmount());
});

// ---- S2 ---------------------------------------------------------------------

test('S2 all-good: receiver 7 connected, its battery, last packet, position and the dogs it hears', () => {
  const page = receiverPage(input('all-good').data);
  expect(page).toMatchObject({
    setUp: true, number: 7, title: '接收器 7', subtitle: 'DogGPS-Master7・已連線', subtitleProblem: false,
    battery: '電量 64%', lastHeard: '最後收訊 09:29', connectAction: 'disconnect',
  });
  expect(page.position).toMatch(/^24\.98\d\d, 121\.31\d\d$/);
  expect(page.sources).toEqual([
    { slaveId: 4, name: '豆豆', detail: '訊號源 4', right: '09:29', fixed: true },
  ]);
});

test('receiver-connecting: 連線中, and receiver 3\'s old packet gives no battery or position', () => {
  const page = receiverPage(input('receiver-connecting', { page: 'receiver' }).data);
  expect(buildFixture('receiver-connecting', FIXTURE_NOW, 'receiver').openRoute).toBe('receiver');
  expect(page.subtitle).toBe('DogGPS-Master7・連線中');
  expect(page.battery).toBeNull();
  expect(page.position).toBe('還沒定位');
  expect(page.lastHeard).toBeNull();
  // Receiver 3's dog is not one of receiver 7's sources.
  expect(page.sources).toEqual([]);
});

test('receiver-quiet: 「已連線・6 分鐘沒有新資料」', () => {
  const { fixture, data } = input('receiver-quiet');
  expect(fixture.openRoute).toBe('receiver');
  const page = receiverPage(data);
  expect(page.phase).toBe('silent');
  expect(page.subtitle).toBe('DogGPS-Master7・已連線・6 分鐘沒有新資料');
  expect(page.lastHeard).toBe('最後收訊 09:24');
});

test('receiver-sources-unfixed: located sources by name, a never-located one only as 訊號源 9 還沒定位', () => {
  const { fixture, data } = input('receiver-sources-unfixed');
  expect(fixture.openRoute).toBe('receiver');
  expect(receiverPage(data).sources).toEqual([
    { slaveId: 4, name: '豆豆', detail: '訊號源 4', right: '09:29', fixed: true },
    { slaveId: 5, name: '狗 5', detail: '訊號源 5', right: '09:28', fixed: true },
    { slaveId: 9, name: '訊號源 9', detail: null, right: '還沒定位', fixed: false },
  ]);
});

test('receiver-disconnected-by-user: 已中斷連線, the action becomes 重新連線, no 「!」', () => {
  const { fixture, data } = input('receiver-disconnected-by-user');
  expect(fixture.openRoute).toBe('receiver');
  const page = receiverPage(data);
  expect(page).toMatchObject({ phase: 'off', subtitle: 'DogGPS-Master7・已中斷連線', subtitleProblem: false,
    connectAction: 'reconnect', battery: null, lastHeard: '最後收訊 09:10' });
  // What it heard before stays listed, and its last position.
  expect(page.sources).toEqual([{ slaveId: 4, name: '豆豆', detail: '訊號源 4', right: '09:10', fixed: true }]);
  expect(page.position).toMatch(/^24\.98\d\d, 121\.31\d\d$/);
  expect(rowsOf(settingsHome(data)).receiver).toMatchObject({ problem: false, status: ['已中斷連線'] });
});

test('S2 phases: nothing set up, disconnected for 30 s, not found', () => {
  expect(receiverPage({ now: 0, receiverState: { enabled: false, deviceId: '' } })).toMatchObject({ setUp: false });
  const state = { enabled: true, running: true, connected: false, deviceId: 'x', deviceName: 'DogGPS-Master7',
    expectedMasterId: 7, lastReceivedAt: FIXTURE_NOW - 5 * MINUTE, disconnectedAt: FIXTURE_NOW - 5 * MINUTE };
  const dropped = receiverPage({ now: FIXTURE_NOW, receiverState: state });
  expect(dropped).toMatchObject({ subtitle: 'DogGPS-Master7・09:25 斷線・正在自動重連', subtitleProblem: true });
  // Within 30 s it is still reconnecting quietly.
  expect(receiverPhase({ ...state, disconnectedAt: FIXTURE_NOW - 10000 }, [], FIXTURE_NOW)).toBe('connecting');
  const missing = receiverPage({ now: FIXTURE_NOW, receiverState: { ...state, disconnectedAt: 0, lastReceivedAt: 0 },
    receiverWait: { waitingSince: FIXTURE_NOW - RECEIVER_MISSING_MS } });
  expect(missing).toMatchObject({ subtitle: 'DogGPS-Master7・找不到接收器 7', subtitleProblem: true });
  const waiting = receiverPage({ now: FIXTURE_NOW, receiverState: { ...state, connected: true, disconnectedAt: 0,
    lastReceivedAt: 0 } });
  expect(waiting.subtitle).toBe('DogGPS-Master7・已連線・還沒收到訊號源');
});

test('the sources are this receiver\'s only, located first', () => {
  const packets = [
    { source: 'ble', master_id: 7, slave_id: 2, track_at: 1000, slave_lat: 0, slave_lon: 0 },
    { source: 'ble', master_id: 3, slave_id: 6, track_at: 3000, slave_lat: 24.9, slave_lon: 121.3 },
    { source: 'cloud', master_id: 7, slave_id: 8, track_at: 4000, slave_lat: 24.9, slave_lon: 121.3 },
    { source: 'ble', master_id: 7, slave_id: 2, track_at: 500, slave_lat: 24.9, slave_lon: 121.3 },
  ];
  expect(receivedSources(packets, 7, { 2: ' 阿福 ' })).toEqual([
    { slaveId: 2, name: '阿福', detail: '訊號源 2', right: expect.any(String), fixed: true },
  ]);
});

test('S2 draws 中斷連線 in red under the receiver, or 重新連線 after it; sources can only be listed', async () => {
  const actions = { onDisconnect: jest.fn(), onReconnect: jest.fn(), onRescan: jest.fn(), onChange: jest.fn() };
  let renderer;
  await act(async () => {
    renderer = Renderer.create(<ReceiverSettings page={receiverPage(input('receiver-sources-unfixed').data)}
      {...actions} />);
  });
  const press = async id => act(async () => renderer.root.findAll(node => node.props.testID === id
    && typeof node.props.onPress === 'function')[0].props.onPress());
  const out = text(renderer);
  for (const words of ['目前的接收器', '接收器 7', 'DogGPS-Master7・已連線', '電量 64%', '最後收訊 09:29', '位置',
    '中斷連線', '中斷並重新掃描', '掃 QR Code 換接收器', '收到的訊號源', '訊號源 9', '還沒定位']) {
    expect(out).toContain(words);
  }
  // Order: the receiver, its position, then its actions, then the sources.
  const order = ['接收器 7', '位置', '中斷連線', '中斷並重新掃描', '掃 QR Code 換接收器', '收到的訊號源'];
  expect(order.map(words => out.indexOf(`"${words}"`))).toEqual([...order.map(words => out.indexOf(`"${words}"`))]
    .sort((left, right) => left - right));
  // A source row has nothing to press.
  expect(renderer.root.findAll(node => String(node.props.testID).startsWith('receiver-source-')
    && typeof node.props.onPress === 'function')).toHaveLength(0);
  await press('receiver-disconnect');
  expect(actions.onDisconnect).toHaveBeenCalled();
  await press('receiver-rescan');
  expect(actions.onRescan).toHaveBeenCalled();
  await press('receiver-change');
  expect(actions.onChange).toHaveBeenCalled();
  await act(async () => renderer.update(<ReceiverSettings
    page={receiverPage(input('receiver-disconnected-by-user').data)} {...actions} />));
  expect(text(renderer)).toContain('已中斷連線');
  expect(renderer.root.findAll(node => node.props.testID === 'receiver-disconnect')).toHaveLength(0);
  await press('receiver-reconnect');
  expect(actions.onReconnect).toHaveBeenCalled();
  await act(async () => renderer.unmount());
});

// ---- changing receivers -----------------------------------------------------

test('a change of receiver waits for the first packet; another Master puts the old one back', () => {
  const old = { enabled: true, deviceId: 'AA', deviceName: 'DogGPS-Master7', serviceUuid: 's', dataUuid: 'd',
    expectedMasterId: 7, sessionId: 'old' };
  const previous = snapshotReceiver(old);
  expect(previous).toEqual({ deviceId: 'AA', deviceName: 'DogGPS-Master7', serviceUuid: 's', dataUuid: 'd',
    expectedMasterId: 7, number: 7, enabled: true });
  expect(snapshotReceiver({ enabled: false, deviceId: '' })).toBeNull();
  // Nothing the old session reported counts.
  expect(judgeSwitch({ ...old, enabled: false, lastStatus: 'Master ID 不符合：QR=8，BLE=3' }, 8, 'old'))
    .toBe('pending');
  expect(judgeSwitch({ ...old, sessionId: 'new', expectedMasterId: 8, lastReceivedAt: 0 }, 8, 'old')).toBe('pending');
  expect(judgeSwitch({ ...old, sessionId: 'new', expectedMasterId: 8, lastReceivedAt: 5 }, 8, 'old')).toBe('matched');
  expect(judgeSwitch({ ...old, sessionId: 'new', enabled: false, lastStatus: 'Master ID 不符合：QR=8，BLE=3' }, 8, 'old'))
    .toEqual({ expected: 8, got: 3 });
  expect(mismatchDialog({ expected: 8, got: 3 }, previous)).toEqual({
    title: '這不是要連的接收器',
    message: '要連 8，收到的是 3，已中斷連線，改回接收器 7（已中斷連線）',
    buttons: [{ id: 'reconnect', label: '連線接收器 7' }, { id: 'rescan', label: '重新掃描' }],
  });
  expect(mismatchDialog({ expected: 8, got: 3 }, null).buttons.map(button => button.label))
    .toEqual(['稍後再說', '重新掃描']);
});

test('useReceiverControl: 中斷連線, 重新連線, and the wrong-receiver dialog with 「連線接收器 7」', async () => {
  const ble = { disconnect: jest.fn() };
  const native = { reconnect: jest.fn(async () => true), restoreReceiver: jest.fn(async () => true) };
  const onRescan = jest.fn();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  let control;
  function Probe({ state }) {
    control = useReceiverControl({ receiverState: state, onRescan, ble, native });
    return null;
  }
  const old = { enabled: true, running: true, connected: true, deviceId: 'AA', deviceName: 'DogGPS-Master7',
    serviceUuid: 's', dataUuid: 'd', expectedMasterId: 7, sessionId: 'old', lastReceivedAt: 1 };
  let renderer;
  await act(async () => { renderer = Renderer.create(<Probe state={old} />); });
  control.disconnect();
  expect(ble.disconnect).toHaveBeenCalled();
  await act(async () => control.reconnect());
  expect(native.reconnect).toHaveBeenCalledTimes(1);
  // The QR code picks receiver 8; receiver 3 answers.
  act(() => control.watchSwitch(8));
  await act(async () => renderer.update(<Probe state={{ ...old, sessionId: 'new', expectedMasterId: 8,
    deviceName: 'DogGPS-Master8', lastReceivedAt: 0 }} />));
  expect(alert).not.toHaveBeenCalled();
  await act(async () => renderer.update(<Probe state={{ ...old, sessionId: 'new', enabled: false, running: false,
    expectedMasterId: 8, deviceName: 'DogGPS-Master8', lastStatus: 'Master ID 不符合：QR=8，BLE=3' }} />));
  expect(native.restoreReceiver).toHaveBeenCalledWith('AA', 'DogGPS-Master7', 's', 'd', 7);
  // The shared BLE service let go of the attempt first: its callbacks for
  // Master 8 cannot act on receiver 7's packets after 「連線接收器 7」.
  expect(ble.disconnect).toHaveBeenCalledTimes(2);
  expect(ble.disconnect.mock.invocationCallOrder[1]).toBeLessThan(native.restoreReceiver.mock.invocationCallOrder[0]);
  expect(alert).toHaveBeenCalledTimes(1);
  const [title, message, buttons] = alert.mock.calls[0];
  expect(title).toBe('這不是要連的接收器');
  expect(message).toBe('要連 8，收到的是 3，已中斷連線，改回接收器 7（已中斷連線）');
  expect(buttons.map(button => button.text)).toEqual(['連線接收器 7', '重新掃描']);
  buttons[0].onPress();
  expect(native.reconnect).toHaveBeenCalledTimes(2);
  buttons[1].onPress();
  expect(onRescan).toHaveBeenCalled();
  // Only once.
  await act(async () => renderer.update(<Probe state={{ ...old, sessionId: 'new', enabled: false,
    lastStatus: 'Master ID 不符合：QR=8，BLE=3' }} />));
  expect(alert).toHaveBeenCalledTimes(1);
  // A change that works: nothing is put back.
  act(() => control.watchSwitch(9));
  await act(async () => renderer.update(<Probe state={{ ...old, sessionId: 'newer', expectedMasterId: 9,
    lastReceivedAt: 10 }} />));
  expect(native.restoreReceiver).toHaveBeenCalledTimes(1);
  // A first set up (D3) typed in by name: nothing to put back; another
  // Master forgets it and offers 重新搜尋 (back to D3c).
  act(() => control.watchSwitch(5, { previous: null, session: null, method: 'manual' }));
  await act(async () => renderer.update(<Probe state={{ ...old, sessionId: 'first', enabled: false,
    expectedMasterId: 5, lastStatus: 'Master ID 不符合：QR=5，BLE=2' }} />));
  expect(native.restoreReceiver).toHaveBeenLastCalledWith('', '', '', '', 0);
  const [, firstMessage, firstButtons] = alert.mock.calls.at(-1);
  expect(firstMessage).toBe('要連 5，收到的是 2，已中斷連線');
  expect(firstButtons.map(button => button.text)).toEqual(['稍後再說', '重新搜尋']);
  firstButtons[1].onPress();
  expect(onRescan).toHaveBeenLastCalledWith('manual');
  await act(async () => renderer.unmount());
  alert.mockRestore();
});

// ---- S4 ---------------------------------------------------------------------

test('phone-permissions-missing: one 權限 cell naming what is missing, 定位服務 打開, battery 已允許', () => {
  const { fixture, data } = input('phone-permissions-missing');
  expect(fixture.openRoute).toBe('phone');
  const page = phonePage(data);
  expect(page.recording).toMatchObject({ on: true, problem: false });
  expect(page.recording.detail).toMatch(/^今天 \d{3} 筆$/);
  expect(page.permission).toEqual({ problem: true, detail: '精確位置、通知未允許', status: null, action: '開系統設定 ›' });
  expect(page.services).toEqual({ problem: true, detail: '定位服務關著', status: null, action: '打開 ›' });
  expect(page.battery).toEqual({ status: '已允許', action: null });
  // The same problems put the 「!」 on S1's 手機 and 提醒 rows.
  const rows = rowsOf(settingsHome(data));
  expect(rows.phone.problem).toBe(true);
  expect(rows.alerts.problem).toBe(true);
});

test('S4 when all is given, and what each permission is called', () => {
  const page = phonePage(input('settings-all-ok').data);
  expect(page.permission).toEqual({ problem: false, detail: null, status: '已允許', action: null });
  expect(page.services).toMatchObject({ problem: false, status: '已開啟' });
  expect(page.recording.detail).toMatch(/^今天 \d{3} 筆$/);
  expect(phonePage({ phone: {}, todayCount: 1842 }).recording.detail).toBe('今天 1,842 筆');
  expect(phonePage({ phone: {}, permissions: { batteryIgnored: false } }).battery)
    .toEqual({ status: null, action: '開系統設定 ›' });
  expect(missingPermissions({ permission: 'approximate' }, {})).toBe('精確位置只給了大概');
  expect(missingPermissions({ permission: 'approximate' }, { nearbyDenied: true, notificationsDenied: true }))
    .toBe('精確位置只給了大概、附近的裝置、通知未允許');
  expect(missingPermissions({ permission: 'blocked' }, {})).toBe('精確位置未允許');
  expect(missingPermissions({ permission: 'precise' }, {})).toBe('');
  // Turning recording on failed: why, in red, in place of the count.
  expect(phonePage({ phone: {}, recording: { enabled: false, error: '請允許定位權限後再開始記錄' }, todayCount: 5 })
    .recording).toMatchObject({ on: false, detail: '請允許定位權限後再開始記錄', problem: true });
});

test('S4 draws the rows and opens the system pages', async () => {
  const actions = { onRecording: jest.fn(), onPermissions: jest.fn(), onLocationServices: jest.fn(),
    onBattery: jest.fn() };
  let renderer;
  await act(async () => {
    renderer = Renderer.create(<PhoneSettings page={phonePage(input('phone-permissions-missing').data)}
      {...actions} />);
  });
  const out = text(renderer);
  for (const words of ['位置記錄', '權限', '精確位置、通知未允許', '開系統設定 ›', '定位服務', '定位服務關著', '打開 ›',
    '忽略電池最佳化', '讓 App 在背景也能一直收資料', '已允許']) expect(out).toContain(words);
  const press = async id => act(async () => renderer.root.findAll(node => node.props.testID === id
    && typeof node.props.onPress === 'function')[0].props.onPress());
  await press('phone-permissions');
  expect(actions.onPermissions).toHaveBeenCalled();
  await press('phone-location-services');
  expect(actions.onLocationServices).toHaveBeenCalled();
  // Battery optimization already allowed: nothing to press.
  expect(renderer.root.findAll(node => node.props.testID === 'phone-battery'
    && typeof node.props.onPress === 'function')).toHaveLength(0);
  await act(async () => renderer.root.findByProps({ testID: 'phone-recording' }).props.onValueChange(false));
  expect(actions.onRecording).toHaveBeenCalledWith(false);
  await act(async () => renderer.unmount());
});

test('usePhonePermissions reads notifications, nearby devices and battery optimization on Android', async () => {
  const { PermissionsAndroid, Platform } = require('react-native');
  const { usePhonePermissions } = require('../src/app/usePhonePermissions');
  const os = Platform.OS;
  const version = Object.getOwnPropertyDescriptor(Platform, 'Version');
  Platform.OS = 'android';
  Object.defineProperty(Platform, 'Version', { configurable: true, get: () => 34 });
  const check = jest.spyOn(PermissionsAndroid, 'check').mockImplementation(async permission =>
    permission !== PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
      && permission !== PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN);
  const platform = { batteryOptimizationIgnored: jest.fn(async () => false) };
  let result;
  function Probe({ foreground }) {
    result = usePhonePermissions(foreground, platform);
    return null;
  }
  let renderer;
  await act(async () => { renderer = Renderer.create(<Probe foreground />); });
  expect(result).toEqual({ notificationsDenied: true, nearbyDenied: true, batteryIgnored: false });
  // Read again when the app comes back from the system settings.
  check.mockImplementation(async () => true);
  platform.batteryOptimizationIgnored.mockResolvedValue(true);
  await act(async () => renderer.update(<Probe foreground={false} />));
  await act(async () => renderer.update(<Probe foreground />));
  expect(result).toEqual({ notificationsDenied: false, nearbyDenied: false, batteryIgnored: true });
  await act(async () => renderer.unmount());
  check.mockRestore();
  Platform.OS = os;
  if (version) Object.defineProperty(Platform, 'Version', version);
});

test('settings-diagnostics-on adds diagnostics only beneath advanced in 其他', () => {
  const { data, fixture } = input('settings-diagnostics-on');
  expect(fixture.openRoute).toBe('settings');
  expect(settingsHome(data).groups.map(group => group.rows.map(row => row.id)))
    .toEqual([['receiver', 'phone'], ['account'], ['alerts'], ['advanced', 'diagnostics']]);
});
