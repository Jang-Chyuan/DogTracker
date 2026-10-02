import MapScreen from '../src/screens/MapScreen';
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import {
  Alert,
  AppState,
  BackHandler,
  NativeModules,
  PermissionsAndroid,
  Platform,
} from 'react-native';
import MapView, { Circle, Marker, Polyline } from 'react-native-maps';
import { mockDatabase, open } from 'react-native-nitro-sqlite';
import App from '../App';
import { createBleService } from '../src/ble/BleService';
import NativeTrackingPlatform from '../specs/NativeTrackingPlatform';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { trackingPoint } from '../__fixtures__/TrackingPointFixtures';

jest.mock('../src/auth/AuthProvider', () => ({
  AuthProvider: ({ children }) => children,
  useAuth: () => ({ loading: false, user: { id: 'test-account' } }),
}));

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
// Legacy path settings remain persisted even though the live map hides them.
async function setTrails(value) {
  await act(async () => renderer.root.findByType(MapScreen).props.tracking.saveTrackingPreferences({ showTrails: value }));
}
async function mount() {
  await act(async () => {
    renderer = Renderer.create(<App />);
  });
}
async function advance(ms = 1000) {
  await act(async () => jest.advanceTimersByTimeAsync(ms));
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

test('first use shows stored hardware markers, circle, no routes or automatic writer', async () => {
  await mount();
  expect(open).toHaveBeenCalledTimes(1);
  expect(rows('dog_status')).toHaveLength(1);
  expect(
    renderer.root.findAllByType(Marker).map(node => node.props.coordinate),
  ).toEqual([
    { latitude: 25.0325, longitude: 121.5648 },
    { latitude: 25.033, longitude: 121.5654 },
  ]);
  expect(renderer.root.findByType(Circle).props.radius).toBe(1000);
  expect(renderer.root.findAllByType(Polyline)).toHaveLength(0);
  expect(text()).not.toMatch(/查看兩端|首頁路徑已達繪圖上限|失聯|通知未開啟/);
  expect(
    renderer.root.findAllByProps({ testID: 'tracking-sheet-summary' })[0].props
      .children,
  ).toBe('最新詳細資訊');
  await advance(601000);
  expect(rows('dog_status')).toHaveLength(1);
  expect(ble.connect).not.toHaveBeenCalled();
});
test('map/history/settings tabs and hardware preserve correct back destinations', async () => {
  await mount();
  expect(button('歷史軌跡', 'tab')).toBeDefined();
  await press('設定', 'tab');
  expect(button('登入')).toBeUndefined();
  expect(text()).not.toContain('允許手機定位');
  await press('BLE／QR 與 Master 設定');
  expect(text()).toContain('自動 BLE QR Code 掃描');
  expect(text()).toContain('手動 BLE 掃描');
  await act(async () => expect(onBack()).toBe(true));
  expect(text()).toContain('硬體連線');
  expect(ble.disconnect).not.toHaveBeenCalled();
});

test('the history tab keeps the same map, carries its own card, and back returns home', async () => {
  await mount();
  expect(renderer.root.findAllByProps({ testID: 'history-sheet' })).toHaveLength(0);
  const map = renderer.root.findByType(MapView);
  await press('歷史軌跡', 'tab');
  // The same native map is reused; only the card and its parameters change.
  expect(renderer.root.findByType(MapView) === map).toBe(true);
  expect(renderer.root.findAllByProps({ testID: 'history-sheet' }).length)
    .toBeGreaterThan(0);
  expect(renderer.root.findAllByProps({ testID: 'tracking-sheet' })).toHaveLength(0);
  await act(async () => renderer.root.findByProps({ testID: 'history-sheet-handle' })
    .props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }));
  expect(text()).toContain('歷史軌跡');
  // The card's sections are folded until opened, so it stays about a screen high.
  expect(button('雲端下載的（Supabase）')).toBeUndefined();
  await press('資料來源');
  expect(button('雲端下載的（Supabase）')).toBeDefined();
  expect(button('重新查詢')).toBeDefined();
  expect(button('匯出')).toBeDefined();
  // The settings page only points at the tab now.
  await press('設定', 'tab');
  expect(button('顯示歷史地圖', 'switch')).toBeUndefined();
  expect(button('套用地圖設定')).toBeUndefined();
  expect(text()).toContain('移到下方的「歷史」分頁');
  await press('歷史軌跡', 'tab');
  await act(async () => expect(onBack()).toBe(true));
  expect(renderer.root.findAllByProps({ testID: 'tracking-sheet' }).length)
    .toBeGreaterThan(0);
});
test('page changes keep the same native map, source and saved switches', async () => {
  await mount();
  await setTrails(true);
  const map = renderer.root.findByType(MapView);
  const initialRegion = map.props.initialRegion;
  const saved = preferences();
  await advance();
  expect(renderer.root.findByType(MapView) === map).toBe(true);
  expect(renderer.root.findByType(MapView).props.initialRegion).toEqual(initialRegion);
  await press('設定', 'tab');
  expect(renderer.root.findByType(MapView) === map).toBe(true);
  expect(text()).toContain('正式 · SQLite');
  await press('即時位置', 'tab');
  expect(renderer.root.findByType(MapView) === map).toBe(true);
  expect(preferences()).toEqual(saved);
  expect(renderer.root.findByType(MapScreen).props.tracking.mode).toBe('real');
});
test('native BLE replay does not write again or move stored map markers', async () => {
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
  expect(markerCoordinates()).toEqual(markers);
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
          [showSlaveMarker, '所有狗'],
          [showMasterMarker, '領犬員'],
        ]) {
          const current = button('隱藏' + role + '位置') !== undefined;
          if (current !== next)
            await press((current ? '隱藏' : '顯示') + role + '位置');
        }
        await setTrails(showTrails);
        expect(renderer.root.findAllByType(Marker)).toHaveLength(
          Number(showMasterMarker) + Number(showSlaveMarker),
        );
        expect(renderer.root.findAllByType(Circle)).toHaveLength(
          Number(showMasterMarker),
        );
        expect(renderer.root.findAllByType(Polyline)).toHaveLength(
          0,
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

test('all display values survive a cold remount without duplicating hardware rows', async () => {
  await mount();
  await expand();
  await press('隱藏所有狗位置');
  await setTrails(true);
  const saved = preferences();
  const hardwareRows = rows('dog_status');
  await act(async () => renderer.unmount());
  renderer = null;
  expect(mockDatabase.close).toHaveBeenCalledTimes(1);
  await mount();
  expect(preferences()).toEqual(saved);
  expect(renderer.root.findAllByType(Marker)).toHaveLength(1);
  expect(rows('dog_status')).toEqual(hardwareRows);
  expect(renderer.root.findAllByType(Polyline)).toHaveLength(0);
});

test('background and foreground never generate rows; real mode with empty DB remains empty', async () => {
  await mount();
  await act(async () => onAppState('background'));
  await advance(600000);
  await act(async () => onAppState('active'));
  await advance();
  expect(rows('dog_status')).toHaveLength(1);
  await act(async () => renderer.unmount());
  renderer = null;
  connection.sqlite.exec('DELETE FROM dog_status');
  await mount();
  expect(renderer.root.findAllByType(Marker)).toHaveLength(0);
  expect(renderer.root.findAllByType(Circle)).toHaveLength(0);
  expect(text()).toContain('等待硬體資料');
  expect(text()).not.toContain('首頁路徑已達繪圖上限');
});
test('first map asks permission once; denial does not affect hardware locations', async () => {
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
  await press('設定', 'tab');
  await press('即時位置', 'tab');
  expect(request).toHaveBeenCalledTimes(1);
});

test('eye save failures preserve markers and remain retryable', async () => {
  await mount();
  connection.sqlite.exec(
    "CREATE TRIGGER fail_settings BEFORE INSERT ON app_settings BEGIN SELECT RAISE(ABORT, 'settings locked'); END",
  );
  await expand();
  await press('隱藏所有狗位置');
  expect(renderer.root.findAllByType(Marker)).toHaveLength(2);
  expect(text()).toContain('settings locked');
  connection.sqlite.exec('DROP TRIGGER fail_settings');
  await press('隱藏所有狗位置');
  expect(renderer.root.findAllByType(Marker)).toHaveLength(1);
});

test('hardware callback writes real rows, and failed hardware writes remain visible', async () => {
  await mount();
  await press('設定', 'tab');
  const onData = ble.restoreBackground.mock.calls.at(-1)[1];
  await act(async () =>
    onData({ ...trackingPoint, slaveLon: 120 }, 'hardware'),
  );
  expect(rows('dog_status').at(-1).slave_lon).toBe(120);
  connection.sqlite.exec(
    "CREATE TRIGGER fail_real BEFORE INSERT ON dog_status BEGIN SELECT RAISE(ABORT, 'hardware disk full'); END",
  );
  await advance();
  await act(async () => onData(trackingPoint, 'failed'));
  for (const label of ['即時位置', '設定']) {
    await press(label, 'tab');
    expect(text()).toContain('hardware disk full');
  }
  connection.sqlite.exec('DROP TRIGGER fail_real');
  await advance();
  await act(async () => onData(trackingPoint, 'recovered'));
  expect(text()).not.toContain('hardware disk full');
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

test('Android map uses the native SQL adapter without opening Nitro', async () => {
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
    expect(renderer.root.findAllByType(Marker)).toHaveLength(2);
    // Independent native writer inserts a DB row, never a BLE-to-map callback.
    connection.sqlite.prepare(
      'INSERT INTO dog_status (received_at, master_id, slave_id, master_lat, master_lon, slave_lat, slave_lon) VALUES (?,3,7,25.02,121.32,25.03,121.33)',
    ).run(Date.now());
    await advance();
    expect(renderer.root.findAllByType(Marker).map(node => node.props.coordinate)).toEqual([
      { latitude: 25.02, longitude: 121.32 },
      { latitude: 25.0315, longitude: 121.4477 },
    ]);
    expect(execute.mock.calls.some(([sql]) => sql.includes('WHERE id > ?'))).toBe(true);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    renderer = null;
    delete NativeModules.BleBackground;
  }
});
