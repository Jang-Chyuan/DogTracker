import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { AppState, Linking, PermissionsAndroid, Platform, Text } from 'react-native';
import { androidPermissions, askableIds, grantOf, neededPermissions, permissionsPage } from '../src/onboarding/Permissions';
import {
  addNearby, CONNECT_TIMEOUT_MS, FIRST_PACKET_MS, pairedPage, pairingDialog, pairingFlow, parseReceiverName,
  signalBars, signalBarsLabel, SEARCH_MS,
} from '../src/onboarding/Pairing';
import { usePairing } from '../src/onboarding/usePairing';
import { usePermissionsGuide } from '../src/onboarding/usePermissionsGuide';
import { useReceiverService } from '../src/ble/useReceiverService';
import PermissionsScreen from '../src/onboarding/PermissionsScreen';
import PairingScreen from '../src/onboarding/PairingScreen';
import PairedScreen from '../src/onboarding/PairedScreen';
import { buildFixture } from '../src/dev/ScreenFixtures';
import { receiverNumber } from '../src/map/ReceiverState';

const P = PermissionsAndroid.PERMISSIONS;
const QR7 = JSON.stringify({ v: 1, masterId: 7, bleName: 'DogGPS-Master7',
  serviceUuid: '7f510001-6d9e-4e2f-a671-8f3f2d49a001' });
const QR8 = JSON.stringify({ v: 1, masterId: 8, bleName: 'DogGPS-Master8',
  serviceUuid: '7f510001-6d9e-4e2f-a671-8f3f2d49a001' });
const words = renderer => JSON.stringify(renderer.toJSON());

// ---- D2 -------------------------------------------------------------------

test('D2 asks only what this Android version needs (判定表「權限和 Android 版本」)', () => {
  expect(neededPermissions(30)).toEqual(['location']);
  expect(neededPermissions(31)).toEqual(['nearby', 'location']);
  expect(neededPermissions(32)).toEqual(['nearby', 'location']);
  expect(neededPermissions(33)).toEqual(['nearby', 'location', 'notifications']);
  expect(androidPermissions('nearby', P)).toEqual([P.BLUETOOTH_SCAN, P.BLUETOOTH_CONNECT]);
  expect(androidPermissions('location', P)).toEqual([P.ACCESS_FINE_LOCATION, P.ACCESS_COARSE_LOCATION]);
  // Never background location, never the camera.
  expect(['nearby', 'location', 'notifications'].flatMap(id => androidPermissions(id, P)))
    .not.toEqual(expect.arrayContaining([P.ACCESS_BACKGROUND_LOCATION, P.CAMERA]));
  expect(grantOf('location', { [P.ACCESS_COARSE_LOCATION]: true }, P)).toBe('approximate');
  expect(grantOf('location', { [P.ACCESS_FINE_LOCATION]: true }, P)).toBe('granted');
  expect(grantOf('nearby', { [P.BLUETOOTH_SCAN]: true }, P)).toBe('denied');
});

test('D2a → D2b → D2c / D2d: rows and the button', () => {
  const needed = ['nearby', 'location', 'notifications'];
  const nothing = { nearby: 'denied', location: 'denied', notifications: 'denied' };
  // D2a: what each one is for; 全部允許 and 稍後再說.
  const a = permissionsPage({ needed, grants: nothing });
  expect(a.rows.map(row => [row.number, row.title, row.detail, row.state])).toEqual([
    [1, '附近的裝置', '連接接收器', 'todo'], [2, '精確位置', '算出狗離你多遠、記錄你的路線', 'todo'],
    [3, '通知', '狗出問題時提醒你', 'todo']]);
  expect(a.primary).toEqual({ id: 'allowAll', label: '全部允許', disabled: false });
  expect(a.later).toBe(true);
  // Not checked yet: the button waits.
  expect(permissionsPage({ needed }).primary.disabled).toBe(true);
  // D2b: 附近的裝置 answered, 精確位置 being asked, 通知 waiting.
  const b = permissionsPage({ needed, grants: { ...nothing, nearby: 'granted' }, asked: ['nearby', 'location'],
    asking: 'location' });
  expect(b.rows.map(row => [row.detail, row.state])).toEqual([['已允許', 'ok'], ['詢問中…', 'asking'],
    ['等一下', 'waiting']]);
  expect(b.primary).toEqual({ id: 'asking', label: '詢問中…', disabled: true });
  expect(b.later).toBe(true);
  // D2c: only 大概, and refused → red 「!」 with 「開系統設定 ›」 (c027's
  // suggestion); 下一步 only.
  const c = permissionsPage({ needed, grants: { nearby: 'granted', location: 'approximate', notifications: 'denied' },
    asked: needed });
  expect(c.rows.map(row => [row.detail, row.state, row.action])).toEqual([['已允許', 'ok', null],
    ['只給了大概位置，算不出距離', 'problem', '開系統設定 ›'], ['未允許', 'problem', '開系統設定 ›']]);
  expect(c.primary).toEqual({ id: 'next', label: '下一步', disabled: false });
  expect(c.later).toBe(false);
  // D2d, also on a later visit with everything allowed already.
  const all = { nearby: 'granted', location: 'granted', notifications: 'granted' };
  const d = permissionsPage({ needed, grants: all });
  expect(d.rows.every(row => row.state === 'ok' && row.detail === '已允許')).toBe(true);
  expect(d.primary.label).toBe('下一步');
  // 大概 location is a problem even before the questions (an earlier answer).
  expect(permissionsPage({ needed, grants: { ...nothing, location: 'approximate' } }).rows[1].state).toBe('problem');
  // Only 附近的裝置 was asked (in D3, D2 skipped): the other two are still
  // asked by 全部允許, never 附近的裝置 again.
  const partly = permissionsPage({ needed, grants: nothing, asked: ['nearby'] });
  expect(partly.rows.map(row => row.state)).toEqual(['problem', 'todo', 'todo']);
  expect(partly.primary.label).toBe('全部允許');
  expect(askableIds({ needed, grants: nothing, asked: ['nearby'] })).toEqual(['location', 'notifications']);
});

function renderHook(hook, props) {
  let result;
  function Probe(current) { result = hook(current); return null; }
  let renderer;
  act(() => { renderer = Renderer.create(<Probe {...props} />); });
  return { get: () => result, update: next => act(() => renderer.update(<Probe {...props} {...next} />)),
    unmount: () => act(() => renderer.unmount()) };
}

test('usePermissionsGuide: one question at a time, each row as it comes back; the answer is checked again later', async () => {
  const granted = new Set();
  let onActive;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_, callback) => {
    onActive = callback;
    return { remove: jest.fn() };
  });
  const order = [];
  const permissions = {
    PERMISSIONS: P, RESULTS: PermissionsAndroid.RESULTS,
    check: jest.fn(async name => granted.has(name)),
    requestMultiple: jest.fn(async names => {
      order.push(names);
      if (names.includes(P.BLUETOOTH_SCAN)) { granted.add(P.BLUETOOTH_SCAN); granted.add(P.BLUETOOTH_CONNECT); }
      if (names.includes(P.ACCESS_COARSE_LOCATION)) granted.add(P.ACCESS_COARSE_LOCATION);
      return {};
    }),
  };
  const onAsked = jest.fn();
  const hook = renderHook(usePermissionsGuide, { permissions, version: 34, android: true, onAsked });
  await act(async () => {});
  expect(hook.get().primary.label).toBe('全部允許');
  jest.useFakeTimers();
  await act(async () => { hook.get().allowAll(); });
  // The row being asked shows first, then its question comes.
  expect(hook.get().rows.map(row => row.detail)).toEqual(['詢問中…', '等一下', '等一下']);
  expect(order).toEqual([]);
  await act(async () => { await jest.advanceTimersByTimeAsync(1000); });
  jest.useRealTimers();
  // Each question saved as it is sent.
  expect(onAsked.mock.calls.map(call => call[0])).toEqual([['nearby'], ['nearby', 'location'],
    ['nearby', 'location', 'notifications']]);
  expect(order).toEqual([[P.BLUETOOTH_SCAN, P.BLUETOOTH_CONNECT], [P.ACCESS_FINE_LOCATION, P.ACCESS_COARSE_LOCATION],
    [P.POST_NOTIFICATIONS]]);
  expect(hook.get().rows.map(row => row.state)).toEqual(['ok', 'problem', 'problem']);
  expect(hook.get().primary.label).toBe('下一步');
  // Precise location given in the system settings: checked on the way back.
  granted.add(P.ACCESS_FINE_LOCATION);
  await act(async () => { onActive('active'); });
  expect(hook.get().rows.map(row => row.state)).toEqual(['ok', 'ok', 'problem']);
  hook.unmount();
  jest.restoreAllMocks();
});

test('D2 page: rows, 開系統設定 › and the buttons', () => {
  const page = { ...permissionsPage({ needed: ['nearby', 'location', 'notifications'],
    grants: { nearby: 'granted', location: 'approximate', notifications: 'denied' },
    asked: ['nearby', 'location', 'notifications'] }), allowAll: jest.fn() };
  const onNext = jest.fn(), onSystemSettings = jest.fn();
  let renderer;
  act(() => { renderer = Renderer.create(<PermissionsScreen page={page} step={2} onNext={onNext}
    onSystemSettings={onSystemSettings} />); });
  const text = words(renderer);
  for (const expected of ['App 需要這些權限', '按一次就會依序跳出系統的詢問；每一個都可以之後再開。', '已允許',
    '只給了大概位置，算不出距離', '未允許', '開系統設定 ›', '下一步']) expect(text).toContain(expected);
  expect(text).not.toContain('稍後再說');
  act(() => renderer.root.findByProps({ testID: 'permission-notifications-settings' }).props.onPress());
  expect(onSystemSettings).toHaveBeenCalled();
  act(() => renderer.root.findByProps({ testID: 'permissions-primary' }).props.onPress());
  expect(onNext).toHaveBeenCalled();
  expect(renderer.root.findByProps({ testID: 'guide-progress' }).props.accessibilityLabel).toBe('第 2 步，共 4 步');
});

// ---- D3 -------------------------------------------------------------------

test('typed names: case and spaces ignored (c262), signal words, the nearby list', () => {
  expect(parseReceiverName('DogGPS-Master 7')).toEqual({ name: 'DogGPS-Master7', number: 7 });
  expect(parseReceiverName(' dogGPS-master7 ')).toEqual({ name: 'DogGPS-Master7', number: 7 });
  expect(parseReceiverName('DogGPS-Master')).toBeNull();
  expect(parseReceiverName('Master7')).toBeNull();
  expect(parseReceiverName('DogGPS-Master0')).toBeNull();
  expect(signalBarsLabel(signalBars(-58))).toBe('訊號強');
  expect(signalBarsLabel(signalBars(-86))).toBe('訊號弱');
  expect(signalBarsLabel(signalBars(null))).toBe('');
  let list = [];
  list = addNearby(list, { id: 'a', name: 'DogGPS-Master3', rssi: -86 });
  list = addNearby(list, { id: 'b', localName: 'DogGPS-Master7', rssi: -58 });
  list = addNearby(list, { id: 'c', name: 'Headphones', rssi: -40 });
  list = addNearby(list, { id: 'a', name: 'DogGPS-Master3', rssi: -80 });
  expect(list.map(item => [item.name, item.rssi])).toEqual([['DogGPS-Master7', -58], ['DogGPS-Master3', -80]]);
});

test('D3 dialogs say what the copy deck says', () => {
  expect(pairingDialog('wrongQr')).toMatchObject({ title: '這不是接收器的 QR Code',
    body: '請掃接收器機身上的 QR Code（DogGPS-Master 開頭）。' });
  expect(pairingDialog('wrongQr').buttons.map(button => button.label)).toEqual(['手動輸入', '再掃一次']);
  const failed = pairingDialog('failed', { number: 7 });
  expect(failed).toMatchObject({ title: '連不上接收器 7', body: '已經試了 30 秒。請確認接收器有開機、在 10 公尺內。' });
  expect(failed.buttons.map(button => button.label)).toEqual(['手動輸入', '重試']);
  // 判定表「D3c 連不上」.
  expect(pairingDialog('failed', { number: 7, method: 'manual' }).buttons.map(button => button.label))
    .toEqual(['回到搜尋', '重試']);
  const mismatch = pairingDialog('mismatch', { expected: 7, got: 3 });
  expect(mismatch).toMatchObject({ title: '這不是要連的接收器', body: '要連 7，收到的是 3，已中斷連線' });
  expect(mismatch.buttons.map(button => button.label)).toEqual(['稍後再說', '重新掃描']);
  expect(pairingDialog('mismatch', { expected: 7, got: 3, method: 'manual' }).buttons[1].label).toBe('重新搜尋');
  expect(pairingDialog('mismatch', { expected: 8, got: 3, mode: 'change', previous: { number: 7 } }).body)
    .toBe('要連 8，收到的是 3，已中斷連線。沒有更換，還是接收器 7');
  expect(pairingDialog('noData', { number: 8, mode: 'change', previous: { number: 7 } }))
    .toMatchObject({ title: '接收器 8 還沒有送資料' });
  expect(pairingDialog('noData', { number: 8, mode: 'change', previous: { number: 7 } }).buttons
    .map(button => button.label)).toEqual(['恢復接收器 7', '先換過去']);
  expect(pairingDialog('noData', { number: 8, mode: 'rescan', previous: { number: 7 } }).buttons[0].label).toBe('不換');
  expect(pairingDialog('bluetoothOff').title).toBe('請打開藍牙');
  expect(pairingDialog('locationOff').title).toBe('請打開定位');
  expect(pairingDialog('nearbyDenied').title).toBe('需要『附近的裝置』才能連接接收器');
  expect(pairingDialog('locationDenied').title).toBe('需要位置權限才能找接收器');
  expect(pairingDialog('nearbyDenied').buttons[1].label).toBe('開系統設定 ›');
  expect(pairingFlow('receiver', 'change')).toMatchObject({ waitForData: true, restoreConnected: true, guide: false });
  expect(pairingFlow('receiver', 'rescan')).toMatchObject({ waitForData: true, restoreConnected: false });
  expect(pairingFlow('onboarding')).toMatchObject({ guide: true, waitForData: false });
});

// A BLE service whose scan finds `devices` and whose connect answers `ok`.
function fakeBle({ devices = [], ok = true, power = 'PoweredOn' } = {}) {
  return {
    scan: jest.fn(async (config, onStatus, onDevice, onFinished, options) => {
      fakeBle.finish = onFinished;
      fakeBle.options = options;
      devices.forEach(device => onDevice(device));
    }),
    stopScan: jest.fn(),
    connect: jest.fn(async () => (typeof ok === 'function' ? ok() : ok)),
    disconnect: jest.fn(),
    bluetoothState: jest.fn(async () => power),
  };
}
const allowAll = (extra = {}) => ({ PERMISSIONS: P, RESULTS: PermissionsAndroid.RESULTS,
  check: jest.fn(async () => true), request: jest.fn(async () => 'granted'), requestMultiple: jest.fn(async () => ({})),
  ...extra });
const receiver7 = { enabled: true, running: true, connected: true, deviceId: 'AA:07', deviceName: 'DogGPS-Master7',
  serviceUuid: 's', dataUuid: 'd', expectedMasterId: 7, sessionId: 'old', lastReceivedAt: 1 };
const device8 = { id: 'AA:08', name: 'DogGPS-Master8', rssi: -60 };

// D3 as shown on screen (its page laid out: the camera may be asked).
function pairing(props) {
  const hook = renderHook(usePairing, { android: true, version: 34, permissions: allowAll(), native: null,
    restore: jest.fn(async () => {}), ...props });
  act(() => hook.get().onShown());
  return hook;
}

beforeEach(() => {
  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('D3a: a wrong QR code (D3b), then the receiver\'s: found by name and connected as Master 7', async () => {
  const ble = fakeBle({ devices: [{ id: 'AA:07', name: 'DogGPS-Master7' }] });
  const onConnected = jest.fn();
  const hook = pairing({ flow: pairingFlow('onboarding'), ble, onConnected });
  await act(async () => {});
  expect(hook.get().view).toBe('scan');
  expect(hook.get().camera).toBe('granted');
  act(() => hook.get().onQr('hello'));
  expect(hook.get().dialog.kind).toBe('wrongQr');
  // A code is not read while the dialog is open.
  act(() => hook.get().onQr(QR7));
  expect(ble.connect).not.toHaveBeenCalled();
  act(() => hook.get().press('rescan'));
  await act(async () => { hook.get().onQr(QR7); });
  expect(ble.connect).toHaveBeenCalledWith({ id: 'AA:07', name: 'DogGPS-Master7' }, expect.any(Function),
    expect.any(Function), expect.objectContaining({ bleName: 'DogGPS-Master7', masterId: 7 }));
  // A first set up is done when the link stands (D4 waits for nothing).
  expect(onConnected).toHaveBeenCalledWith(expect.objectContaining({ number: 7, method: 'qr' }));
  hook.unmount();
});

test('D3d: 30 s without a link → 連不上接收器 7 (手動輸入 / 重試); 取消 stops and stays', async () => {
  jest.useFakeTimers();
  const ble = fakeBle({ devices: [] });
  const restore = jest.fn(async () => {});
  const hook = pairing({ flow: pairingFlow('onboarding'), ble, restore });
  await act(async () => {});
  await act(async () => { hook.get().onQr(QR7); });
  expect(hook.get().view).toBe('connecting');
  expect(hook.get().target.name).toBe('DogGPS-Master7');
  await act(async () => { jest.advanceTimersByTime(CONNECT_TIMEOUT_MS); });
  expect(hook.get().view).toBe('stopped');
  expect(hook.get().dialog).toMatchObject({ title: '連不上接收器 7' });
  // The attempted receiver is forgotten (a first set up: nothing to put back).
  expect(ble.disconnect).toHaveBeenCalled();
  expect(restore).toHaveBeenCalledWith(null);
  // 重試 tries the same one again; 取消 stops it, still on D3.
  await act(async () => { hook.get().press('retry'); });
  expect(hook.get().view).toBe('connecting');
  act(() => hook.get().cancel());
  expect(hook.get().view).toBe('scan');
  expect(hook.get().dialog).toBeNull();
  hook.unmount();
});

test('D3c: the receivers nearby for 30 s, the typed name checked, searched, not found (c263)', async () => {
  jest.useFakeTimers();
  const ble = fakeBle({ devices: [{ id: 'AA:03', name: 'DogGPS-Master3', rssi: -86 },
    { id: 'AA:07', name: 'DogGPS-Master7', rssi: -58 }] });
  const onConnected = jest.fn();
  const hook = pairing({ flow: pairingFlow('onboarding'), ble, onConnected });
  await act(async () => {});
  await act(async () => { hook.get().openManual(); });
  expect(hook.get().view).toBe('manual');
  expect(ble.scan).toHaveBeenCalledTimes(1);
  expect(fakeBle.options).toEqual({ timeoutMs: SEARCH_MS });
  expect(hook.get().nearby.list.map(item => item.name)).toEqual(['DogGPS-Master7', 'DogGPS-Master3']);
  await act(async () => { fakeBle.finish(); });
  expect(hook.get().nearby).toMatchObject({ searching: false, done: true });
  // Not a receiver's name.
  act(() => hook.get().typeName('Master7'));
  act(() => hook.get().searchName());
  expect(hook.get().inputError).toBe('名稱是 DogGPS-Master 加數字');
  // A name nobody nearby has: searched for 30 s, then the red line.
  act(() => hook.get().typeName('dogGPS-master 9'));
  await act(async () => { hook.get().searchName(); });
  expect(hook.get().nameSearch).toMatchObject({ name: 'DogGPS-Master9', searching: true });
  await act(async () => { fakeBle.finish(); });
  expect(hook.get().inputError).toBe('附近找不到 DogGPS-Master9');
  // A receiver from the list: connected at once, the field shows its name.
  await act(async () => { hook.get().pickNearby(hook.get().nearby.list[0]); });
  expect(hook.get().input).toBe('DogGPS-Master7');
  expect(onConnected).toHaveBeenCalledWith(expect.objectContaining({ number: 7, method: 'manual' }));
  hook.unmount();
});

test('D3: Bluetooth off, 附近的裝置 refused (asked once), location off on Android 11', async () => {
  const off = fakeBle({ power: 'PoweredOff' });
  let hook = pairing({ flow: pairingFlow('onboarding'), ble: off });
  await act(async () => {});
  await act(async () => { hook.get().onQr(QR7); });
  expect(hook.get().dialog).toMatchObject({ title: '請打開藍牙' });
  const send = jest.spyOn(Linking, 'sendIntent').mockResolvedValue();
  act(() => hook.get().press('open'));
  expect(send).toHaveBeenCalledWith('android.bluetooth.adapter.action.REQUEST_ENABLE');
  hook.unmount();
  // Never asked (D2 skipped): asked now; refused → the reason and 開系統設定 ›.
  const permissions = allowAll({ check: jest.fn(async name => name === P.CAMERA) });
  const onAsked = jest.fn();
  hook = pairing({ flow: pairingFlow('onboarding'), ble: fakeBle(), permissions, onAsked });
  await act(async () => {});
  await act(async () => { hook.get().onQr(QR7); });
  expect(permissions.requestMultiple).toHaveBeenCalledWith([P.BLUETOOTH_SCAN, P.BLUETOOTH_CONNECT]);
  expect(onAsked).toHaveBeenCalledWith(['nearby']);
  expect(hook.get().dialog).toMatchObject({ title: '需要『附近的裝置』才能連接接收器' });
  hook.unmount();
  // Asked before: no second question.
  const again = allowAll({ check: jest.fn(async name => name === P.CAMERA) });
  hook = pairing({ flow: pairingFlow('onboarding'), ble: fakeBle(), permissions: again, asked: ['nearby'] });
  await act(async () => {});
  await act(async () => { hook.get().onQr(QR7); });
  expect(again.requestMultiple).not.toHaveBeenCalled();
  hook.unmount();
  // Android 11: location permission and the location switch.
  const old = allowAll({ check: jest.fn(async name => name === P.CAMERA) });
  hook = pairing({ flow: pairingFlow('onboarding'), ble: fakeBle(), permissions: old, version: 30,
    asked: ['location'] });
  await act(async () => {});
  await act(async () => { hook.get().onQr(QR7); });
  expect(hook.get().dialog).toMatchObject({ title: '需要位置權限才能找接收器' });
  hook.unmount();
  hook = pairing({ flow: pairingFlow('onboarding'), ble: fakeBle(), version: 30, locationServices: false });
  await act(async () => {});
  await act(async () => { hook.get().onQr(QR7); });
  expect(hook.get().dialog).toMatchObject({ title: '請打開定位' });
  hook.unmount();
});

test('the camera: asked once in D3a, only once it is on screen; refused → 需要相機才能掃描 (c259)', async () => {
  const early = allowAll({ check: jest.fn(async () => false) });
  const unseen = renderHook(usePairing, { android: true, version: 34, permissions: early, native: null,
    flow: pairingFlow('onboarding'), ble: fakeBle() });
  await act(async () => {});
  expect(early.request).not.toHaveBeenCalled();
  unseen.unmount();
  const permissions = allowAll({ check: jest.fn(async () => false), request: jest.fn(async () => 'denied') });
  const onAsked = jest.fn();
  let hook = pairing({ flow: pairingFlow('onboarding'), ble: fakeBle(), permissions, onAsked });
  await act(async () => {});
  expect(permissions.request).toHaveBeenCalledWith(P.CAMERA);
  expect(onAsked).toHaveBeenCalledWith(['camera']);
  expect(hook.get().camera).toBe('denied');
  hook.unmount();
  const again = allowAll({ check: jest.fn(async () => false) });
  hook = pairing({ flow: pairingFlow('onboarding'), ble: fakeBle(), permissions: again, asked: ['camera'] });
  await act(async () => {});
  expect(again.request).not.toHaveBeenCalled();
  expect(hook.get().camera).toBe('denied');
  hook.unmount();
});

test('換接收器: the old link pauses, the first packet decides; 60 s quiet asks 先換過去／恢復接收器 7', async () => {
  jest.useFakeTimers();
  const ble = fakeBle({ devices: [device8] });
  const native = { reconnect: jest.fn(async () => true), getState: jest.fn(async () => null) };
  const restore = jest.fn(async () => {});
  const onConnected = jest.fn(), onLeave = jest.fn();
  const toast = jest.fn();
  const { ToastAndroid } = require('react-native');
  jest.spyOn(ToastAndroid, 'show').mockImplementation(toast);
  const originalOS = Platform.OS;
  Platform.OS = 'android';
  const hook = pairing({ flow: pairingFlow('receiver', 'change'), ble, native, restore, onConnected, onLeave,
    receiverState: receiver7 });
  try {
    await act(async () => {});
    // The old link pauses while scanning.
    expect(ble.disconnect).toHaveBeenCalledTimes(1);
        await act(async () => { hook.get().onQr(QR8); });
    expect(onConnected).not.toHaveBeenCalled();
    expect(hook.get().view).toBe('connecting');
    // Receiver 8 connected but quiet for 60 s.
    hook.update({ receiverState: { ...receiver7, sessionId: 'new', expectedMasterId: 8, lastReceivedAt: 0 } });
    await act(async () => { jest.advanceTimersByTime(FIRST_PACKET_MS); });
    expect(hook.get().dialog.buttons.map(button => button.label)).toEqual(['恢復接收器 7', '先換過去']);
    // 先換過去: in use; its first packet is still watched (by App).
    act(() => hook.get().press('keep'));
    expect(onConnected).toHaveBeenCalledWith(expect.objectContaining({ number: 8, kept: true,
      previous: expect.objectContaining({ number: 7 }) }));
    hook.unmount();
    expect(restore).not.toHaveBeenCalled();
  } finally {
    Platform.OS = originalOS;
  }
});

test('換接收器: the first packet from 8 takes it; leaving without one puts 7 back, connected (c294)', async () => {
  jest.useFakeTimers();
  const originalOS = Platform.OS;
  Platform.OS = 'android';
  const { ToastAndroid } = require('react-native');
  const toast = jest.spyOn(ToastAndroid, 'show').mockImplementation(() => {});
  try {
    const native = { reconnect: jest.fn(async () => true), getState: jest.fn(async () => null) };
    let ble = fakeBle({ devices: [device8] });
    const onConnected = jest.fn();
    let hook = pairing({ flow: pairingFlow('receiver', 'change'), ble, native, onConnected, receiverState: receiver7 });
    await act(async () => {});
    await act(async () => { hook.get().onQr(QR8); });
    hook.update({ receiverState: { ...receiver7, sessionId: 'new', expectedMasterId: 8, lastReceivedAt: 50 } });
    expect(onConnected).toHaveBeenCalledWith(expect.objectContaining({ number: 8, kept: false }));
    hook.unmount();
    // Another Master answers instead: 編號不符, the change does not happen.
    ble = fakeBle({ devices: [device8] });
    const restore = jest.fn(async () => {});
    const onLeave = jest.fn();
    hook = pairing({ flow: pairingFlow('receiver', 'change'), ble, native, restore, onLeave, receiverState: receiver7 });
    await act(async () => {});
    await act(async () => { hook.get().onQr(QR8); });
    hook.update({ receiverState: { ...receiver7, sessionId: 'new', enabled: false, expectedMasterId: 8,
      lastStatus: 'Master ID 不符合：QR=8，BLE=3' } });
    expect(hook.get().dialog).toMatchObject({ title: '這不是要連的接收器',
      body: '要連 8，收到的是 3，已中斷連線。沒有更換，還是接收器 7' });
    await act(async () => { hook.get().press('later'); });
    expect(onLeave).toHaveBeenCalledWith('later');
    expect(restore).toHaveBeenCalledWith(expect.objectContaining({ deviceId: 'AA:07', number: 7 }));
    expect(native.reconnect).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('沒有更換，還是接收器 7', expect.anything());
    hook.unmount();
    expect(restore).toHaveBeenCalledTimes(1);
    // 中斷並重新掃描: back out → the old receiver stays disconnected.
    native.reconnect.mockClear();
    const rescanRestore = jest.fn(async () => {});
    hook = pairing({ flow: pairingFlow('receiver', 'rescan'), ble: fakeBle(), native, restore: rescanRestore,
      receiverState: { ...receiver7, enabled: false }, onLeave: jest.fn() });
    await act(async () => {});
    await act(async () => { hook.get().back(); });
    expect(rescanRestore).toHaveBeenCalled();
    expect(native.reconnect).not.toHaveBeenCalled();
    hook.unmount();
  } finally {
    Platform.OS = originalOS;
  }
});

test('換接收器: 取消 or 30 s puts receiver 7 back at once, connected; another try pauses it again', async () => {
  jest.useFakeTimers();
  const native = { reconnect: jest.fn(async () => true), getState: jest.fn(async () => null) };
  const restore = jest.fn(async () => {});
  const ble = fakeBle({ devices: [] });
  const hook = pairing({ flow: pairingFlow('receiver', 'change'), ble, native, restore, receiverState: receiver7,
    onLeave: jest.fn() });
  await act(async () => {});
  await act(async () => { hook.get().onQr(QR8); });
  act(() => hook.get().cancel());
  await act(async () => {});
  expect(restore).toHaveBeenCalledWith(expect.objectContaining({ number: 7 }));
  expect(native.reconnect).toHaveBeenCalledTimes(1);
  // Trying again: the old link pauses first; 30 s later it is back again.
  const pauses = ble.disconnect.mock.calls.length;
  await act(async () => { hook.get().onQr(QR8); });
  expect(ble.disconnect.mock.calls.length).toBeGreaterThan(pauses);
  await act(async () => { jest.advanceTimersByTime(CONNECT_TIMEOUT_MS); });
  await act(async () => {});
  expect(hook.get().dialog).toMatchObject({ title: '連不上接收器 8' });
  expect(restore).toHaveBeenCalledTimes(2);
  expect(native.reconnect).toHaveBeenCalledTimes(2);
  // Leaving now restores nothing more.
  await act(async () => { hook.get().press('later'); });
  expect(restore).toHaveBeenCalledTimes(2);
  hook.unmount();
});

test('D3 back: a dialog first, D3c → D3a, connecting → 取消, then out', async () => {
  const onLeave = jest.fn();
  const hook = pairing({ flow: pairingFlow('onboarding'), ble: fakeBle(), onLeave });
  await act(async () => {});
  act(() => hook.get().onQr('nope'));
  act(() => hook.get().back());
  expect(hook.get().dialog).toBeNull();
  await act(async () => { hook.get().openManual(); });
  act(() => hook.get().back());
  expect(hook.get().view).toBe('scan');
  act(() => hook.get().back());
  expect(onLeave).toHaveBeenCalledWith('back');
  hook.unmount();
});

test('back on D3 from D4: 已連上 接收器 7 with 下一步 / 換一台; nothing moves on by itself', async () => {
  const onConnected = jest.fn();
  const hook = pairing({ flow: pairingFlow('onboarding'), ble: fakeBle(), onConnected, receiverState: receiver7 });
  await act(async () => {});
  expect(hook.get().view).toBe('connected');
  expect(onConnected).not.toHaveBeenCalled();
  let renderer;
  act(() => { renderer = Renderer.create(<PairingScreen pairing={hook.get()} step={3} camera={false} />); });
  expect(words(renderer)).toContain('已連上 接收器 7');
  expect(words(renderer)).toContain('換一台');
  act(() => hook.get().next());
  expect(onConnected).toHaveBeenCalledWith(expect.objectContaining({ number: 7, again: true }));
  act(() => hook.get().changeReceiver());
  expect(hook.get().view).toBe('scan');
  hook.unmount();
});

// ---- D4 -------------------------------------------------------------------

test('D4 lists the sources heard as 訊號源 N; D4b when none (c050–c054)', () => {
  const packets = [
    { source: 'ble', master_id: 7, slave_id: 4, slave_lat: 24.99, slave_lon: 121.31, received_at: 30 },
    { source: 'ble', master_id: 7, slave_id: 9, slave_lat: 0, slave_lon: 0, received_at: 40 },
    { source: 'ble', master_id: 3, slave_id: 5, slave_lat: 24.99, slave_lon: 121.31, received_at: 50 },
    { source: 'cloud', master_id: 7, slave_id: 6, slave_lat: 24.99, slave_lon: 121.31, received_at: 50 },
  ];
  expect(pairedPage(7, packets)).toEqual({ title: '已連上接收器 7',
    body: '收到 2 個訊號源。狗定位後會出現在地圖上，點狗就能改名字和頭像。',
    sources: [{ slaveId: 4, label: '訊號源 4' }, { slaveId: 9, label: '訊號源 9' }] });
  expect(pairedPage(7, [])).toEqual({ title: '已連上接收器 7', body: '還沒收到訊號源。項圈開機後，訊號源會出現在這裡。',
    sources: [] });
  let renderer;
  const onStart = jest.fn();
  act(() => { renderer = Renderer.create(<PairedScreen page={pairedPage(7, packets)} step={4} onStart={onStart} />); });
  expect(renderer.root.findAllByProps({ testID: 'paired-source-4' }).length).toBeGreaterThan(0);
  act(() => renderer.root.findByProps({ testID: 'paired-start' }).props.onPress());
  expect(onStart).toHaveBeenCalled();
});

// ---- the fixtures -----------------------------------------------------------

function fixtureScreen(name) {
  const fixture = buildFixture(name);
  return fixture;
}

test('onboard-permissions-partial / -done draw D2c and D2d', () => {
  for (const [name, states] of [['onboard-permissions-partial', ['ok', 'problem', 'problem']],
    ['onboard-permissions-done', ['ok', 'ok', 'ok']]]) {
    const fixture = fixtureScreen(name);
    expect(fixture.openRoute).toBe('permissions');
    const page = permissionsPage({ needed: neededPermissions(34), ...fixture.permissionsGuide });
    expect(page.rows.map(row => row.state)).toEqual(states);
    expect(page.primary.label).toBe('下一步');
  }
});

test('pair-* fixtures draw the D3 state their names say', async () => {
  const expectations = {
    'pair-wrong-qr': { view: 'scan', dialog: '這不是接收器的 QR Code' },
    'pair-camera-denied': { view: 'scan', text: '需要相機才能掃描' },
    'pair-manual-nearby': { view: 'manual', text: 'DogGPS-Master3' },
    'pair-connecting': { view: 'connecting', text: '正在連 DogGPS-Master7…' },
    'pair-failed': { view: 'stopped', dialog: '連不上接收器 7' },
    'pair-mismatch': { view: 'stopped', dialog: '這不是要連的接收器' },
  };
  for (const [name, expected] of Object.entries(expectations)) {
    const fixture = fixtureScreen(name);
    expect(fixture.openRoute).toBe('pair');
    const ble = fakeBle();
    const hook = pairing({ flow: pairingFlow('onboarding'), ble, fixture: fixture.pairing,
      receiverState: fixture.receiverState });
    await act(async () => {});
    expect(hook.get().view).toBe(expected.view);
    if (expected.dialog) expect(hook.get().dialog.title).toBe(expected.dialog);
    let renderer;
    act(() => { renderer = Renderer.create(<PairingScreen pairing={hook.get()} step={3} camera={false} />); });
    if (expected.text) expect(words(renderer)).toContain(expected.text);
    if (name === 'pair-manual-nearby') {
      expect(renderer.root.findAllByType(Text).map(node => node.props.children).join()).not.toMatch(/訊號[強中弱]/);
      expect(renderer.root.findByProps({ testID: 'pair-nearby-DogGPS-Master7' })
        .props.accessibilityLabel).toBe('DogGPS-Master7，訊號強');
      expect(renderer.root.findAllByProps({ testID: 'pair-signal-bars' }).length).toBeGreaterThan(0);
    }
    // A fixture scans, asks and connects nothing.
    expect(ble.scan).not.toHaveBeenCalled();
    expect(ble.connect).not.toHaveBeenCalled();
    expect(ble.disconnect).not.toHaveBeenCalled();
    act(() => renderer.unmount());
    hook.unmount();
  }
  const manual = fixtureScreen('pair-manual-nearby').pairing;
  expect(manual.nearby.map(item => signalBarsLabel(signalBars(item.rssi)))).toEqual(['訊號強', '訊號弱']);
});

test('pair-done-sources / pair-done-empty draw D4 and D4b', () => {
  const sources = fixtureScreen('pair-done-sources');
  expect(sources.openRoute).toBe('paired');
  const number = receiverNumber(sources.receiverState);
  expect(pairedPage(number, sources.cloudDogs.packets)).toMatchObject({ title: '已連上接收器 7',
    sources: [{ slaveId: 4, label: '訊號源 4' }, { slaveId: 7, label: '訊號源 7' }, { slaveId: 9, label: '訊號源 9' }] });
  const empty = fixtureScreen('pair-done-empty');
  expect(pairedPage(receiverNumber(empty.receiverState), empty.cloudDogs.packets).sources).toEqual([]);
});

// ---- the receiver's background work (was HardwareScreen's) -------------------

test('native storage errors reach the App with no receiver page open, then recover', async () => {
  jest.useFakeTimers();
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  const ble = { restoreBackground: jest.fn(async () => null), getBackgroundState: jest.fn(async () => ({
    storageError: 'SQLite disk full' })), disconnect: jest.fn() };
  const database = { initialize: jest.fn(async () => {}), saveStatus: jest.fn(async () => {}) };
  const report = jest.fn();
  const hook = renderHook(useReceiverService, { dogDatabase: database, onStorageError: report, ble });
  await act(async () => {});
  expect(report).toHaveBeenLastCalledWith('SQLite disk full');
  ble.getBackgroundState.mockResolvedValue({ storageError: '' });
  await act(async () => jest.advanceTimersByTimeAsync(2000));
  expect(report).toHaveBeenLastCalledWith(null);
  // Packets the JS side receives itself are stored; the native service's not.
  const [, onData] = ble.restoreBackground.mock.calls[0];
  await act(async () => { onData({ slaveId: 4 }, 'payload'); });
  expect(database.saveStatus).toHaveBeenCalledWith({ slaveId: 4 }, 'payload');
  await act(async () => { onData({ slaveId: 5 }, 'payload', { persistedNatively: true }); });
  expect(database.saveStatus).toHaveBeenCalledTimes(1);
  expect(ble.disconnect).not.toHaveBeenCalled();
  hook.unmount();
});

test('signal bars include RSSI boundaries and unknown readings', () => {
  expect([-59, -60, -61, -70, -71, -80, -81, null, undefined, NaN, Infinity]
    .map(signalBars)).toEqual([4, 4, 3, 3, 2, 2, 1, 0, 0, 0, 0]);
  expect([0, 1, 2, 3, 4].map(signalBarsLabel))
    .toEqual(['', '訊號弱', '訊號中', '訊號強', '訊號強']);
});
