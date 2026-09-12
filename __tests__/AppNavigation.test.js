import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import {
  Alert,
  AppState,
  BackHandler,
  NativeModules,
  PermissionsAndroid,
  Platform,
  Switch,
} from 'react-native';
import MapView, { Circle, Marker, Polyline } from 'react-native-maps';
import { mockDatabase, open } from 'react-native-nitro-sqlite';
import App from '../App';
import { createBleService } from '../src/ble/BleService';
import NativeTrackingPlatform from '../specs/NativeTrackingPlatform';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { trackingPoint } from '../__fixtures__/TrackingPointFixtures';

jest.mock('../src/ble/BleService', () => ({
  createBleService: jest.fn(() => ({
    connect: jest.fn(async () => true),
    disconnect: jest.fn(),
    isConnected: jest.fn(() => false),
    restoreBackground: jest.fn(async () => null),
    getBackgroundState: jest.fn(async () => null),
  })),
}));
let connection, renderer, ble, onAppState, onBack;
const originalOS = Platform.OS;
const text = () => JSON.stringify(renderer.toJSON());
const rows = table =>
  connection.sqlite.prepare('SELECT * FROM ' + table + ' ORDER BY id').all();
const preferences = () =>
  JSON.parse(
    connection.sqlite
      .prepare("SELECT value FROM app_settings WHERE key = 'map_preferences'")
      .get().value,
  );
const button = (label, role = 'button') =>
  renderer.root.findAll(
    node =>
      node.props.accessibilityLabel === label &&
      node.props.accessibilityRole === role &&
      typeof node.props.onPress === 'function',
  )[0];
async function press(label, role) {
  const control = button(label, role);
  expect(control).toBeDefined();
  expect(control.props.disabled).not.toBe(true);
  await act(async () => {
    await control.props.onPress();
  });
}
async function mount() {
  await act(async () => {
    renderer = Renderer.create(<App />);
  });
}
async function advance(ms = 1000) {
  await act(async () => jest.advanceTimersByTimeAsync(ms));
}
async function demoPage() {
  await press('設定', 'tab');
  await press('Demo 設定');
}
async function setMode(demo) {
  await act(async () =>
    renderer.root.findByType(Switch).props.onValueChange(demo),
  );
}
async function expand() {
  const handle = renderer.root.findAllByProps({
    testID: 'tracking-sheet-handle',
  })[0];
  await act(async () =>
    handle.props.onAccessibilityAction({
      nativeEvent: { actionName: 'increment' },
    }),
  );
  await act(async () =>
    handle.props.onAccessibilityAction({
      nativeEvent: { actionName: 'increment' },
    }),
  );
}
beforeEach(async () => {
  jest.useFakeTimers();
  Platform.OS = 'android';
  connection = createMemoryConnection();
  const real = createDogDatabase(connection);
  await real.initialize();
  await real.saveStatus(trackingPoint, 'original-hardware');
  mockDatabase.executeAsync
    .mockReset()
    .mockImplementation(connection.executeAsync);
  mockDatabase.executeBatchAsync
    .mockReset()
    .mockImplementation(connection.executeBatchAsync);
  mockDatabase.close.mockClear();
  // Closing a connection owner leaves the simulated disk contents available to
  // the next mount; the SQLite test engine itself closes in afterEach.
  open.mockClear();
  open.mockImplementation(() => mockDatabase);
  ble = createBleService.mock.results[0].value;
  ble.disconnect.mockClear();
  ble.connect.mockClear();
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'active',
  });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_, callback) => {
    onAppState = callback;
    return { remove: jest.fn() };
  });
  jest
    .spyOn(BackHandler, 'addEventListener')
    .mockImplementation((_, callback) => {
      onBack = callback;
      return {
        remove: jest.fn(() => {
          if (onBack === callback) onBack = null;
        }),
      };
    });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  NativeTrackingPlatform.claimLocationPermissionPrompt.mockResolvedValue(false);
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  renderer = null;
  connection.close();
  jest.restoreAllMocks();
  jest.useRealTimers();
  Platform.OS = originalOS;
});

test('first use seeds three rows and shows C markers, circle, no routes or automatic writer', async () => {
  await mount();
  expect(open).toHaveBeenCalledTimes(1);
  expect(rows('demo_dog_status')).toHaveLength(3);
  expect(text()).toContain('DEMO · 模擬資料');
  expect(
    renderer.root.findAllByType(Marker).map(node => node.props.coordinate),
  ).toEqual([
    { latitude: 25.0181, longitude: 121.3257 },
    { latitude: 25.01765, longitude: 121.3267 },
  ]);
  expect(renderer.root.findByType(Circle).props.radius).toBe(1000);
  expect(renderer.root.findAllByType(Polyline)).toHaveLength(0);
  expect(text()).not.toMatch(/查看兩端|首頁路徑已達繪圖上限|失聯|通知未開啟/);
  expect(
    renderer.root.findAllByProps({ testID: 'tracking-sheet-summary' })[0].props
      .children,
  ).toBe('最新詳細資訊');
  await advance(601000);
  expect(rows('demo_dog_status')).toHaveLength(3);
  expect(ble.connect).not.toHaveBeenCalled();
});
test('only map/settings tabs remain; Demo and original Wi-Fi preserve correct back destinations', async () => {
  await mount();
  expect(button('Demo', 'tab')).toBeUndefined();
  expect(button('歷史', 'tab')).toBeUndefined();
  await demoPage();
  expect(text()).toContain('手動逐筆');
  expect(button('開始 Demo')).toBeUndefined();
  expect(button('停止 Demo')).toBeUndefined();
  await act(async () => expect(onBack()).toBe(true));
  expect(button('Demo 設定')).toBeDefined();
  expect(button('登入')).toBeUndefined();
  expect(text()).not.toContain('允許手機定位');
  await press('BLE／QR 與 Master 設定');
  expect(text()).toContain('自動 BLE QR Code 掃描');
  expect(text()).toContain('手動 BLE 掃描');
  await act(async () => expect(onBack()).toBe(true));
  expect(text()).toContain('硬體連線');
  expect(ble.disconnect).not.toHaveBeenCalled();
  await demoPage();
  await press('‹ 設定');
  expect(button('Demo 設定')).toBeDefined();
});
test('page changes keep the same native map, source and saved switches', async () => {
  await mount();
  const map = renderer.root.findByType(MapView),
    props = map.props;
  await advance();
  expect(renderer.root.findByType(MapView).props).toBe(props);
  await demoPage();
  expect(renderer.root.findByType(MapView)).toBe(map);
  await press('回到地圖');
  expect(renderer.root.findByType(MapView)).toBe(map);
  expect(text()).toContain('DEMO · 模擬資料');
});
test('native BLE replay does not write again or move Demo map markers', async () => {
  await mount();
  const before = rows('dog_status');
  const markerCoordinates = () => renderer.root.findAllByType(Marker).map(node => node.props.coordinate);
  const markers = markerCoordinates();
  const receive = ble.restoreBackground.mock.calls.at(-1)[1];
  await act(async () => receive(trackingPoint, 'native replay', {
    receivedAt: Date.now(), persistedNatively: true,
  }));
  await advance();
  expect(rows('dog_status')).toEqual(before);
  expect(rows('demo_dog_status')).toHaveLength(3);
  expect(markerCoordinates()).toEqual(markers);
});
test('manual A/B writes update latest DB markers; common paths stay off until explicitly enabled', async () => {
  await mount();

  await demoPage();
  await press('寫入 1 筆到 Demo DB');
  expect(rows('demo_dog_status')).toHaveLength(4);
  expect(text()).toContain('目前 4 筆');
  await press('回到地圖');
  await advance();
  expect(renderer.root.findAllByType(Marker)[1].props.coordinate).toEqual({
    latitude: 25.01825,
    longitude: 121.3258,
  });
  await demoPage();
  await press('選擇 Demo 預設點');
  await press('點 B', 'radio');
  await press('寫入 1 筆到 Demo DB');
  expect(rows('demo_dog_status')).toHaveLength(5);
  await press('回到地圖');
  await advance();
  expect(renderer.root.findAllByType(Marker)[1].props.coordinate).toEqual({
    latitude: 25.0189,
    longitude: 121.32645,
  });
  expect(renderer.root.findAllByType(Polyline)).toHaveLength(0);
  await expand();
  await press('顯示路徑');
  expect(renderer.root.findAllByType(Polyline)).toHaveLength(2);
});
test('all eight visibility states gate overlays, retain card controls, and leave phone location independent', async () => {
  jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(true);
  await mount();
  await act(async () => renderer.root.findByType(MapView).props.onMapReady());
  await expand();
  for (const showTrails of [false, true])
    for (const showSlaveMarker of [false, true])
      for (const showMasterMarker of [false, true]) {
        for (const [next, role] of [
          [showSlaveMarker, '狗'],
          [showMasterMarker, '領犬員'],
        ]) {
          const current = button('隱藏' + role + '位置') !== undefined;
          if (current !== next)
            await press((current ? '隱藏' : '顯示') + role + '位置');
        }
        if (button('顯示路徑').props.accessibilityState.selected !== showTrails)
          await press('顯示路徑');
        expect(renderer.root.findAllByType(Marker)).toHaveLength(
          Number(showMasterMarker) + Number(showSlaveMarker),
        );
        expect(renderer.root.findAllByType(Circle)).toHaveLength(
          Number(showMasterMarker),
        );
        expect(renderer.root.findAllByType(Polyline)).toHaveLength(
          showTrails ? Number(showMasterMarker) + Number(showSlaveMarker) : 0,
        );
        expect(renderer.root.findByType(MapView).props.showsUserLocation).toBe(
          true,
        );
        expect(
          button((showMasterMarker ? '隱藏' : '顯示') + '領犬員位置'),
        ).toBeDefined();
        expect(preferences()).toMatchObject({
          showTrails,
          showMasterMarker,
          showSlaveMarker,
        });
      }
});
test('confirmed reset restores A/B/C and preserves real rows, mode and visibility values', async () => {
  await mount();
  const real = rows('dog_status');
  await expand();
  await press('顯示路徑');
  await press('隱藏狗位置');
  const saved = preferences();
  await demoPage();
  await press('寫入 1 筆到 Demo DB');
  const old = rows('demo_dog_status');
  await press('重設 Demo');
  expect(rows('demo_dog_status')).toEqual(old);
  const options = Alert.alert.mock.calls.at(-1)[2];
  expect(options[0].style).toBe('cancel');
  await act(async () => options[1].onPress());
  expect(rows('demo_dog_status')).toHaveLength(3);
  expect(rows('demo_dog_status')[0].id).toBeGreaterThan(old.at(-1).id);
  expect(rows('dog_status')).toEqual(real);
  expect(preferences()).toEqual(saved);
  await press('回到地圖');
  await advance();
  expect(renderer.root.findAllByType(Marker)).toHaveLength(1);
  expect(renderer.root.findAllByType(Polyline)).toHaveLength(1);
  expect(renderer.root.findByType(Circle).props.center).toEqual({
    latitude: 25.0181,
    longitude: 121.3257,
  });
});
test('mode and all display values survive a cold remount without duplicating seed rows', async () => {
  await mount();
  await expand();
  await press('隱藏狗位置');
  await press('顯示路徑');
  await demoPage();
  await setMode(false);
  const saved = preferences();
  await act(async () => renderer.unmount());
  renderer = null;
  expect(mockDatabase.close).toHaveBeenCalledTimes(1);
  await mount();
  expect(text()).toContain('正式 · SQLite');
  expect(preferences()).toEqual(saved);
  expect(renderer.root.findAllByType(Marker)).toHaveLength(1);
  expect(rows('demo_dog_status')).toHaveLength(3);
  await demoPage();
  await setMode(true);
  await press('回到地圖');
  expect(renderer.root.findAllByType(Polyline)).toHaveLength(1);
  await act(async () => renderer.unmount());
  renderer = null;
  await mount();
  expect(text()).toContain('DEMO · 模擬資料');
  expect(rows('demo_dog_status')).toHaveLength(3);
});
test('background and foreground never generate rows; real mode with empty DB remains empty', async () => {
  await mount();
  await act(async () => onAppState('background'));
  await advance(600000);
  await act(async () => onAppState('active'));
  await advance();
  expect(rows('demo_dog_status')).toHaveLength(3);
  connection.sqlite.exec('DELETE FROM dog_status');
  await demoPage();
  await setMode(false);
  await press('回到地圖');
  await advance();
  expect(renderer.root.findAllByType(Marker)).toHaveLength(0);
  expect(renderer.root.findAllByType(Circle)).toHaveLength(0);
  expect(text()).toContain('等待硬體資料');
  expect(text()).not.toContain('首頁路徑已達繪圖上限');
});
test('first map asks permission once; denial affects neither seeded DB nor hardware locations', async () => {
  NativeTrackingPlatform.claimLocationPermissionPrompt.mockResolvedValueOnce(
    true,
  );
  jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(false);
  const request = jest
    .spyOn(PermissionsAndroid, 'requestMultiple')
    .mockResolvedValue({
      [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION]: 'denied',
      [PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION]: 'denied',
    });
  await mount();
  expect(request).toHaveBeenCalledTimes(1);
  expect(renderer.root.findAllByType(Marker)).toHaveLength(2);
  await demoPage();
  await press('回到地圖');
  expect(request).toHaveBeenCalledTimes(1);
});
test('write and reset failures preserve DB and expose errors; successful operations remain retryable', async () => {
  await mount();
  await demoPage();
  const before = rows('demo_dog_status');
  connection.sqlite.exec(
    "CREATE TRIGGER fail_demo BEFORE INSERT ON demo_dog_status BEGIN SELECT RAISE(ABORT, 'demo disk full'); END",
  );
  await press('寫入 1 筆到 Demo DB');
  expect(rows('demo_dog_status')).toEqual(before);
  expect(text()).toContain('demo disk full');
  await press('重設 Demo');
  await act(async () => Alert.alert.mock.calls.at(-1)[2][1].onPress());
  expect(rows('demo_dog_status')).toEqual(before);
  expect(text()).toContain('demo disk full');
  connection.sqlite.exec('DROP TRIGGER fail_demo');
  await press('寫入 1 筆到 Demo DB');
  expect(rows('demo_dog_status')).toHaveLength(4);
});
test('mode/eye save failures do not switch sources or hide markers', async () => {
  await mount();
  connection.sqlite.exec(
    "CREATE TRIGGER fail_settings BEFORE INSERT ON app_settings BEGIN SELECT RAISE(ABORT, 'settings locked'); END",
  );
  await expand();
  await press('隱藏狗位置');
  expect(renderer.root.findAllByType(Marker)).toHaveLength(2);
  await demoPage();
  await setMode(false);
  expect(renderer.root.findByType(Switch).props.value).toBe(true);
  expect(text()).toContain('settings locked');
  connection.sqlite.exec('DROP TRIGGER fail_settings');
  await setMode(false);
  expect(renderer.root.findByType(Switch).props.value).toBe(false);
});
test('a summary read failure after commit does not report a failed insert or encourage duplicate writes', async () => {
  await mount();
  await demoPage();
  mockDatabase.executeAsync.mockImplementation((sql, params) =>
    sql.includes('COUNT(*)')
      ? Promise.reject(new Error('summary locked'))
      : connection.executeAsync(sql, params),
  );
  await press('寫入 1 筆到 Demo DB');
  expect(rows('demo_dog_status')).toHaveLength(4);
  expect(text()).toContain('已寫入點');
  expect(text()).toContain('請勿因此重複寫入');
  expect(text()).not.toContain('寫入 Demo失敗');
  mockDatabase.executeAsync.mockImplementation(connection.executeAsync);
  await press('重新讀取筆數');
  expect(text()).toContain('目前 4 筆');
});
test('hardware callback still writes only real rows in Demo, and failed hardware writes remain visible', async () => {
  await mount();
  await press('設定', 'tab');
  const onData = ble.restoreBackground.mock.calls.at(-1)[1];
  await act(async () =>
    onData({ ...trackingPoint, slaveLon: 120 }, 'hardware'),
  );
  expect(rows('dog_status').at(-1).slave_lon).toBe(120);
  expect(rows('demo_dog_status')).toHaveLength(3);
  connection.sqlite.exec(
    "CREATE TRIGGER fail_real BEFORE INSERT ON dog_status BEGIN SELECT RAISE(ABORT, 'hardware disk full'); END",
  );
  await advance();
  await act(async () => onData(trackingPoint, 'failed'));
  for (const label of ['地圖', '設定']) {
    await press(label, 'tab');
    expect(text()).toContain('hardware disk full');
  }
  connection.sqlite.exec('DROP TRIGGER fail_real');
  await advance();
  await act(async () => onData(trackingPoint, 'recovered'));
  expect(text()).not.toContain('hardware disk full');
});
test('a Demo migration failure cannot block the hardware writer or switching to real DB', async () => {
  mockDatabase.executeAsync.mockImplementation((sql, params) =>
    sql.includes('CREATE TABLE IF NOT EXISTS demo_dog_status')
      ? Promise.reject(new Error('demo migration failed'))
      : connection.executeAsync(sql, params),
  );
  await mount();
  await press('設定', 'tab');
  await act(async () =>
    ble.restoreBackground.mock.calls.at(-1)[1](trackingPoint, 'hardware'),
  );
  expect(rows('dog_status')).toHaveLength(2);
  await press('Demo 設定');
  expect(text()).toContain('demo migration failed');
  await setMode(false);
  await press('回到地圖');
  expect(renderer.root.findAllByType(Marker)).toHaveLength(2);
});

test('native disk failures remain visible on map/settings and clear on recovery', async () => {
  await mount();
  ble.getBackgroundState.mockResolvedValue({ storageError: 'native disk full' });
  await advance(2000);
  expect(text()).toContain('native disk full');
  await press('設定', 'tab');
  expect(text()).toContain('native disk full');
  ble.getBackgroundState.mockResolvedValue({ storageError: '' });
  await advance(2000);
  expect(text()).not.toContain('native disk full');
});

test('Android map and Demo use the native SQL adapter without opening Nitro', async () => {
  Platform.OS = 'android';
  const execute = jest.fn(async (sql, params) =>
    JSON.stringify(await connection.executeAsync(sql, JSON.parse(params))),
  );
  NativeModules.BleBackground = {
    initializeDatabase: async () => true,
    executeDatabase: execute,
    executeDatabaseBatch: commands => connection.executeBatchAsync(JSON.parse(commands)),
  };
  try {
    await mount();
    expect(open).not.toHaveBeenCalled();
    expect(rows('demo_dog_status')).toHaveLength(3);
    expect(renderer.root.findAllByType(Marker)).toHaveLength(2);
    await demoPage();
    await setMode(false);
    await press('回到地圖');
    // Independent native writer inserts a DB row, never a BLE-to-map callback.
    connection.sqlite.prepare(
      'INSERT INTO dog_status (received_at, master_id, slave_id, master_lat, master_lon, slave_lat, slave_lon) VALUES (?,3,7,25.02,121.32,25.03,121.33)',
    ).run(Date.now());
    await advance();
    expect(renderer.root.findAllByType(Marker).map(node => node.props.coordinate)).toEqual([
      { latitude: 25.02, longitude: 121.32 },
      { latitude: 25.03, longitude: 121.33 },
    ]);
    expect(execute.mock.calls.some(([sql]) => sql.includes('WHERE id > ?'))).toBe(true);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    renderer = null;
    delete NativeModules.BleBackground;
  }
});
