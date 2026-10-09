import MapScreen from '../src/screens/MapScreen';
import { layout } from '../src/theme/tokens';
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import {
  Alert,
  AppState,
  BackHandler,
  Linking,
  NativeModules,
  PermissionsAndroid,
  Platform,
  StyleSheet,
} from 'react-native';
import MapView, { Circle, Marker, Polygon, Polyline } from 'react-native-maps';
import { mockDatabase, open } from 'react-native-nitro-sqlite';
import App from '../App';
import { createBleService } from '../src/ble/BleService';
import NativeTrackingPlatform from '../specs/NativeTrackingPlatform';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { trackingPoint } from '../__fixtures__/TrackingPointFixtures';

// Signed in unless a test signs out (mockAuth is read on every render).
let mockAuth;
jest.mock('../src/auth/AuthProvider', () => ({
  AuthProvider: ({ children }) => children,
  useAuth: () => mockAuth,
}));

jest.mock('../src/ble/BleService', () => ({
  DEFAULT_BLE_CONFIG: { bleName: 'DogGPS-Master3', serviceUuid: '7f510001-6d9e-4e2f-a671-8f3f2d49a001' },
  createBleService: jest.fn(() => ({
    connect: jest.fn(async () => true),
    scan: jest.fn(async () => {}),
    stopScan: jest.fn(),
    bluetoothState: jest.fn(async () => 'PoweredOn'),
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
// The live map's own dog-tap handler (GoogleTrackingMap calls it on a marker).
const tapDog = async slaveId => {
  const map = renderer.root.findAll(node => typeof node.props.onDogPress === 'function', { deep: false })[0];
  await act(async () => map.props.onDogPress(slaveId));
};
beforeEach(async () => {
  mockAuth = { loading: false, user: { id: 'test-account' }, available: true };
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
  const backHandlers = [];
  onBack = () => [...backHandlers].reverse().some(handler => handler());
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_, callback) => {
    backHandlers.push(callback);
    return { remove: jest.fn(() => { const index = backHandlers.indexOf(callback); if (index >= 0) backHandlers.splice(index, 1); }) };
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

test('first use shows the stored dog, no receiver marker, no ring without a connected receiver, no routes or automatic writer', async () => {
  await mount();
  expect(open).toHaveBeenCalledTimes(1);
  expect(rows('dog_status')).toHaveLength(1);
  // The receiver (25.0325, 121.5648) is not drawn (v3); the dog is.
  expect(
    renderer.root.findAllByType(Marker).map(node => node.props.coordinate),
  ).toEqual([
    { latitude: 25.033, longitude: 121.5654 },
  ]);
  // No receiver connection known here, so no range ring.
  expect(renderer.root.findAllByType(Polygon)).toHaveLength(0);
  expect(renderer.root.findAllByType(Circle)).toHaveLength(0);
  expect(renderer.root.findAllByType(Polyline)).toHaveLength(0);
  expect(text()).not.toMatch(/查看兩端|首頁路徑已達繪圖上限|失聯|通知未開啟/);
  // No dog list under the map (v3): a dog's card opens when it is tapped.
  expect(renderer.root.findAllByProps({ testID: 'tracking-sheet' })).toHaveLength(0);
  expect(renderer.root.findAllByProps({ testID: 'dog-card' })).toHaveLength(0);
  await advance(601000);
  expect(rows('dog_status')).toHaveLength(1);
  expect(ble.connect).not.toHaveBeenCalled();
});
const row = id => renderer.root.findAll(node => node.props.testID === id && typeof node.props.onPress === 'function')[0];
async function tap(id) {
  const control = row(id);
  expect(control).toBeDefined();
  await act(async () => { await control.props.onPress(); });
}
const title = () => renderer.root.findByProps({ testID: 'page-back' }).props.accessibilityLabel;

test('hidden diagnostics: consecutive taps, timeout, persistence across restart, and hide', async () => {
  await mount();
  await press('設定');
  expect(row('settings-row-diagnostics')).toBeUndefined();
  const version = row('settings-version');
  expect(version.props.accessibilityLabel).toBe('DogTracker 3.0.0，版本');
  expect(version.props.accessibilityHint).toBeUndefined();
  for (let i = 0; i < 3; i++) await tap('settings-version');
  expect(text()).not.toContain('再點');
  await tap('settings-version');
  expect(text()).toContain('再點 3 下開啟診斷');
  await advance(2001);
  await tap('settings-version');
  // The previous snackbar can remain, but this tap starts a new sequence.
  for (let i = 0; i < 2; i++) await tap('settings-version');
  expect(row('settings-row-diagnostics')).toBeUndefined();
  await tap('settings-version');
  expect(text()).toContain('再點 3 下開啟診斷');
  await tap('settings-version');
  expect(text()).toContain('再點 2 下開啟診斷');
  await tap('settings-version');
  expect(text()).toContain('再點 1 下開啟診斷');
  await tap('settings-version');
  expect(text()).toContain('已開啟診斷');
  expect(preferences().diagnosticsEnabled).toBe(true);
  expect(row('settings-row-diagnostics')).toBeDefined();
  await tap('settings-version');
  expect(text()).toContain('診斷已經開啟');
  await act(async () => renderer.unmount());
  await mount();
  await press('設定');
  expect(row('settings-row-diagnostics')).toBeDefined();
  await tap('settings-row-diagnostics');
  await tap('diagnostics-hide');
  expect(title()).toBe('返回，設定');
  expect(row('settings-row-diagnostics')).toBeUndefined();
  expect(preferences().diagnosticsEnabled).toBe(false);
  await act(async () => renderer.unmount());
  await mount();
  await press('設定');
  expect(row('settings-row-diagnostics')).toBeUndefined();
});

test('no bottom tabs: the gear opens the grouped settings home; each row opens its page and back returns', async () => {
  await mount();
  expect(renderer.root.findAllByProps({ testID: 'bottom-navigation' })).toHaveLength(0);
  expect(button('歷史軌跡', 'tab')).toBeUndefined();
  await press('設定');
  expect(text()).toContain('‹ 設定');
  // S1: four groups, no 地圖 row; the old dark settings cards are gone.
  for (const group of ['裝置', '帳號與資料', '提醒', '其他']) expect(text()).toContain(group);
  for (const id of ['receiver', 'phone', 'account', 'alerts', 'advanced']) {
    expect(row(`settings-row-${id}`)).toBeDefined();
  }
  expect(text()).not.toContain('BLE／QR 與 Master 設定');
  expect(text()).not.toContain('#111827');
  expect(text()).toContain('DogTracker 3.0.0');
  // S2 接收器: nothing set up yet → 「還沒設定接收器」, 「連接接收器」 opens
  // D3 (no guide progress, no old dark page); back returns to S2, then to S1.
  await tap('settings-row-receiver');
  expect(title()).toBe('返回，接收器');
  expect(text()).toContain('還沒設定接收器');
  await tap('receiver-connect');
  expect(renderer.root.findAllByProps({ testID: 'pair-scan' }).length).toBeGreaterThan(0);
  expect(progressBar()).toBe(false);
  expect(text()).not.toContain('自動 BLE QR Code 掃描');
  expect(text()).not.toContain('#0f172a');
  await act(async () => expect(onBack()).toBe(true));
  expect(title()).toBe('返回，接收器');
  expect(ble.disconnect).not.toHaveBeenCalled();
  await press('返回，接收器');
  expect(title()).toBe('返回，設定');
  // S4 手機.
  await tap('settings-row-phone');
  expect(title()).toBe('返回，手機');
  expect(text()).toContain('位置記錄');
  expect(text()).toContain('忽略電池最佳化');
  await act(async () => expect(onBack()).toBe(true));
  // Supabase 帳號 → S3 (signed in: the account, 下載, 上傳).
  await tap('settings-row-account');
  expect(title()).toBe('返回，Supabase 帳號');
  expect(renderer.root.findAllByProps({ testID: 'account-settings' }).length).toBeGreaterThan(0);
  expect(text()).toContain('已登入');
  // No phone upload route is loaded in this live navigation setup.
  expect(text()).not.toContain('最後上傳成功');
  expect(text()).not.toContain('轉送 Supabase');
  await press('返回，Supabase 帳號');
  expect(row('settings-row-diagnostics')).toBeUndefined();
  for (let i = 0; i < 7; i++) await tap('settings-version');
  // 診斷 (S8): its three data pages, all light v3 pages, back returns.
  await tap('settings-row-diagnostics');
  expect(title()).toBe('返回，診斷');
  expect(renderer.root.findAllByProps({ testID: 'diagnostics-settings' }).length).toBeGreaterThan(0);
  expect(row('settings-link-data')).toBeUndefined();
  await tap('diagnostics-liveData');
  expect(title()).toBe('返回，即時資料');
  expect(renderer.root.findAllByProps({ testID: 'live-data' }).length).toBeGreaterThan(0);
  await advance(100);
  // The stored packet in a table, columns to pick.
  expect(text()).toContain('選擇欄位（5）');
  expect(text()).toContain('接收時間');
  await act(async () => expect(onBack()).toBe(true));
  expect(title()).toBe('返回，診斷');
  await tap('diagnostics-cloudData');
  expect(title()).toBe('返回，本機／雲端資料');
  expect(renderer.root.findAllByProps({ testID: 'cloud-data' }).length).toBeGreaterThan(0);
  await act(async () => expect(onBack()).toBe(true));
  await tap('diagnostics-locationRecords');
  expect(title()).toBe('返回，記錄清單');
  expect(text()).toContain('80,000 筆');
  await act(async () => expect(onBack()).toBe(true));
  await act(async () => expect(onBack()).toBe(true));
  // 進階 (S7): 接收器 Wi-Fi (its own light page) and 刪除全部狗資料.
  await tap('settings-row-advanced');
  expect(title()).toBe('返回，進階');
  expect(text()).toContain('刪除全部狗資料');
  // No receiver connected: the Wi-Fi row says so; nothing is read.
  expect(text()).toContain('接收器連上後才能設定');
  await tap('advanced-wifi');
  expect(title()).toBe('返回，接收器 Wi-Fi');
  expect(renderer.root.findAllByProps({ testID: 'wifi-settings' }).length).toBeGreaterThan(0);
  expect(text()).toContain('沒有連線，連上後才能讀取和設定 Wi-Fi');
  await press('返回，接收器 Wi-Fi');
  expect(title()).toBe('返回，進階');
  expect(row('settings-link-upload')).toBeUndefined();
  // No old dark page is left behind S7/S8.
  expect(text()).not.toContain('#111827');
  await act(async () => expect(onBack()).toBe(true));
  // Settings' own 「‹ 設定」 (and the back key) return to the map.
  await press('返回，設定');
  expect(renderer.root.findByType(MapScreen).props.active).toBe(true);
  expect(renderer.root.findByType(MapScreen).props.historical).toBe(false);
});

test('S1 提醒 opens S6 (not the system settings); a switch is saved at once and S1 follows', async () => {
  await mount();
  await advance(100);
  await press('設定');
  Linking.sendIntent?.mockClear?.();
  expect(row('settings-row-alerts').props.accessibilityLabel).toBe('提醒，震動、聲音、各項開關，震動');
  await tap('settings-row-alerts');
  expect(title()).toBe('返回，提醒');
  expect(Linking.sendIntent?.mock?.calls?.length ?? 0).toBe(0);
  expect(text()).toContain('接收器斷線、位置存不進手機');
  const sound = renderer.root.findAll(node => node.props.testID === 'alerts-sound'
    && typeof node.props.onValueChange === 'function')[0];
  expect(sound.props.value).toBe(false);
  await act(async () => sound.props.onValueChange(true));
  await advance(100);
  expect(preferences().alerts).toMatchObject({ sound: true, vibrate: true, dogStale: true });
  expect(renderer.root.findAll(node => node.props.testID === 'alerts-sound'
    && typeof node.props.onValueChange === 'function')[0].props.value).toBe(true);
  const disconnectStorage = renderer.root.findAll(node => node.props.testID === 'alerts-receiverDisconnectedStorage'
    && typeof node.props.onValueChange === 'function')[0];
  expect(disconnectStorage.props.value).toBe(true);
  await act(async () => disconnectStorage.props.onValueChange(false));
  await advance(100);
  expect(preferences().alerts.receiverDisconnectedStorage).toBe(false);
  await act(async () => expect(onBack()).toBe(true));
  expect(title()).toBe('返回，設定');
  expect(row('settings-row-alerts').props.accessibilityLabel).toBe('提醒，震動、聲音、各項開關，震動、聲音');
});

test('a settings fixture opens its page over the map: S1 with red 「!」 rows, S2 中斷連線', async () => {
  // React Native's jest setup mocks Linking: answer once, for this mount.
  Linking.getInitialURL.mockResolvedValueOnce('dogtracker://dev/fixture?name=settings-problems');
  let emit;
  Linking.addEventListener.mockImplementationOnce((_, handler) => {
    emit = handler;
    return { remove: jest.fn() };
  });
  await mount();
  await advance(100);
  expect(title()).toBe('返回，設定');
  const label = id => row(`settings-row-${id}`).props.accessibilityLabel;
  expect(label('phone')).toBe('手機，有問題：定位服務關著、通知未允許');
  expect(label('account')).toBe('Supabase 帳號，有問題：連不上');
  expect(label('alerts')).toBe('提醒，有問題：通知未允許');
  expect(label('receiver')).toBe('接收器，接收器 7，已連線，電量 64%');
  // The map's gear says the same things need handling.
  await act(async () => emit({ url: 'dogtracker://dev/fixture?name=all-good&page=receiver' }));
  await advance(100);
  expect(title()).toBe('返回，接收器');
  expect(text()).toContain('DogGPS-Master7・已連線');
  await tap('receiver-disconnect');
  expect(ble.disconnect).toHaveBeenCalledTimes(1);
  // Back from S2 returns to S1, then to the map.
  await press('返回，接收器');
  expect(title()).toBe('返回，設定');
  await act(async () => emit({ url: 'dogtracker://dev/fixture?name=off' }));
});

test('S3 fixtures: the account page with its states, the switch confirmation, back to settings', async () => {
  Linking.getInitialURL.mockResolvedValueOnce('dogtracker://dev/fixture?name=upload-switch-confirm');
  let emit;
  Linking.addEventListener.mockImplementationOnce((_, handler) => {
    emit = handler;
    return { remove: jest.fn() };
  });
  await mount();
  await advance(100);
  expect(title()).toBe('返回，Supabase 帳號');
  expect(text()).toContain('這台接收器改由這支手機上傳。手機裡還有 120 筆沒上傳，會先上傳。');
  // The fixture's switch writes nothing; the dialog closes.
  await press('切換');
  expect(text()).not.toContain('會先上傳');
  expect(text()).toContain('由接收器的 Wi-Fi 上傳');
  await act(async () => emit({ url: 'dogtracker://dev/fixture?name=cloud-failing&page=cloud' }));
  await advance(100);
  expect(text()).toContain('下載失敗');
  expect(text()).toContain('連不上 Supabase・09:24 起');
  expect(text()).toContain('12 筆');
  mockAuth = { loading: false, user: null, available: true };
  await act(async () => emit({ url: 'dogtracker://dev/fixture?name=cloud-expired' }));
  await advance(100);
  expect(text()).toContain('需要重新登入');
  expect(text()).not.toContain('登入 Supabase 帳號');
  // 「登入」 opens D1 (no guide progress), 「稍後再說」 comes back to S3.
  await press('需要重新登入，登入');
  expect(renderer.root.findAllByProps({ testID: 'sign-in-page' }).length).toBeGreaterThan(0);
  expect(text()).toContain('登入 Supabase 帳號');
  expect(text()).toContain('需要重新登入');
  expect(renderer.root.findAllByProps({ testID: 'guide-progress' })).toHaveLength(0);
  await press('稍後再說');
  expect(title()).toBe('返回，Supabase 帳號');
  // The back key on D1 does the same.
  await press('需要重新登入，登入');
  await act(async () => expect(onBack()).toBe(true));
  expect(title()).toBe('返回，Supabase 帳號');
  await press('返回，Supabase 帳號');
  expect(title()).toBe('返回，設定');
  expect(row('settings-row-account').props.accessibilityLabel).toBe('Supabase 帳號，有問題：需要重新登入');
  await act(async () => emit({ url: 'dogtracker://dev/fixture?name=off' }));
});

test('刪除全部狗資料 (S7) on SQLite: asks, deletes only the dog rows, keeps faces and settings, reopens on S7', async () => {
  await mount();
  await advance(100);
  // A downloaded row, a dog's face and a saved setting from before.
  connection.sqlite.prepare(`INSERT INTO supabase_dog_status (received_at, master_id, slave_id, slave_lat, slave_lon)
    VALUES (?, 9, 6, 25.01, 121.3)`).run(Date.now() - 60000);
  connection.sqlite.exec(`INSERT OR REPLACE INTO dog_avatars (slave_id, value) VALUES (4, '{"kind":"art"}')`);
  await act(async () => renderer.root.findByType(MapScreen).props.tracking
    .saveTrackingPreferences({ noDataCardDismissed: true }));
  expect(rows('dog_status')).toHaveLength(1);
  const settingsBefore = connection.sqlite.prepare('SELECT COUNT(*) count FROM app_settings').get().count;
  await press('設定');
  await tap('settings-row-advanced');
  expect(row('settings-row-advanced')).toBeUndefined();
  await tap('advanced-delete');
  await advance(10);
  expect(text()).toContain('刪除全部狗資料？');
  expect(text()).toContain('雲端、手機路線、狗的名字和頭像都不會動');
  // 取消 deletes nothing.
  await press('取消');
  expect(rows('dog_status')).toHaveLength(1);
  await tap('advanced-delete');
  await advance(10);
  // Nothing waits to be uploaded: one 「刪除」.
  expect(button('先上傳')).toBeUndefined();
  await press('刪除');
  await advance(100);
  expect(rows('dog_status')).toHaveLength(0);
  expect(rows('supabase_dog_status')).toHaveLength(0);
  expect(connection.sqlite.prepare('SELECT COUNT(*) count FROM dog_avatars').get().count).toBe(1);
  expect(connection.sqlite.prepare('SELECT COUNT(*) count FROM app_settings').get().count).toBe(settingsBefore);
  // A6's ✕ comes back (判定表「A6 的 ✕ 什麼時候重來」).
  expect(preferences().noDataCardDismissed).toBe(false);
  // Every reader started over, on S7, saying it went through.
  expect(title()).toBe('返回，進階');
  expect(text()).toContain('已刪除・');
  await act(async () => expect(onBack()).toBe(true));
  await act(async () => expect(onBack()).toBe(true));
  expect(renderer.root.findByType(MapScreen).props.active).toBe(true);
  expect(renderer.root.findAllByType(Marker)).toHaveLength(0);
});

test('S7/S8 fixtures: diagnostics states, the delete question with rows to upload, Wi-Fi', async () => {
  Linking.getInitialURL.mockResolvedValueOnce('dogtracker://dev/fixture?name=diagnostics-ok');
  let emit;
  Linking.addEventListener.mockImplementationOnce((_, handler) => {
    emit = handler;
    return { remove: jest.fn() };
  });
  await mount();
  await advance(100);
  expect(title()).toBe('返回，診斷');
  for (const id of [4, 6, 8]) expect(renderer.root.findAllByProps({ testID: `diagnostics-dog-${id}` }).length).toBeGreaterThan(0);
  expect(text()).toContain('移動中');
  await act(async () => emit({ url: 'dogtracker://dev/fixture?name=diagnostics-error' }));
  await advance(100);
  expect(text()).toContain('attempt to write a readonly database');
  await act(async () => emit({ url: 'dogtracker://dev/fixture?name=diagnostics-read-failed&page=liveData' }));
  await advance(100);
  expect(title()).toBe('返回，即時資料');
  expect(text()).toContain('讀取失敗：database disk image is malformed');
  // The fixture's delete question: 「先上傳」 finds no network, nothing deleted.
  await act(async () => emit({ url: 'dogtracker://dev/fixture?name=advanced-delete-confirm' }));
  await advance(100);
  expect(title()).toBe('返回，進階');
  expect(text()).toContain('還有 120 筆沒上傳：先上傳／一起刪除');
  await press('先上傳');
  expect(text()).toContain('沒有網路，現在不能上傳。連上網路後再試，或選「一起刪除」');
  await press('一起刪除');
  expect(text()).not.toContain('還有 120 筆沒上傳');
  expect(text()).toContain('已刪除・09:30');
  expect(rows('dog_status')).toHaveLength(1);
  // Wi-Fi on the fixture's receiver 7: its two networks, deleting asks.
  expect(text()).toContain('家裡、辦公室');
  await tap('advanced-wifi');
  expect(title()).toBe('返回，接收器 Wi-Fi');
  expect(text()).toContain('接收器 7 存的 Wi-Fi');
  expect(text()).toContain('使用中');
  await tap('wifi-delete-辦公室');
  expect(text()).toContain('接收器 7 不會再連「辦公室」。');
  await press('刪除');
  expect(row('wifi-辦公室')).toBeUndefined();
  await act(async () => emit({ url: 'dogtracker://dev/fixture?name=off' }));
});

test('「今天 x km」 opens my route on the same map, with its own card, and back returns home', async () => {
  await mount();
  await advance();
  expect(renderer.root.findAllByProps({ testID: 'history-panel' })).toHaveLength(0);
  const map = renderer.root.findByType(MapView);
  await act(async () => map.props.onMapLoaded());
  const pill = renderer.root.findAll(node => node.props.testID === 'map-today'
    && typeof node.props.onPress === 'function')[0];
  expect(pill).toBeDefined();
  await act(async () => pill.props.onPress());
  await advance();
  // My route: today so far, the phone's own track, no dogs.
  const routeQuery = renderer.root.findByType(MapScreen).props.history.preferences;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  expect(routeQuery).toMatchObject({ timeMode: 'fixed', startAt: start.getTime(), phone: true, client: false });
  // The same native map is reused; only the card and its parameters change.
  expect(renderer.root.findByType(MapView) === map).toBe(true);
  // The v3 history screen: ‹ 回到現在, 我的路線, the date row; no old query card.
  const has = id => renderer.root.findAllByProps({ testID: id }).length > 0;
  expect(has('history-panel')).toBe(true);
  expect(has('history-back-now')).toBe(true);
  expect(has('history-date')).toBe(true);
  expect(has('history-export')).toBe(true);
  expect(has('history-dogs-sheet')).toBe(false);
  expect(text()).toContain('我的路線');
  expect(text()).toContain('今天');
  expect(button('重新查詢')).toBeUndefined();
  expect(button('套用（有未套用的變更）')).toBeUndefined();
  expect(renderer.root.findAllByProps({ testID: 'tracking-sheet' })).toHaveLength(0);
  // History has no gear (its top right is its own); back returns to the map.
  expect(renderer.root.findAllByProps({ testID: 'map-settings' })).toHaveLength(0);
  await act(async () => expect(onBack()).toBe(true));
  expect(renderer.root.findAllByProps({ testID: 'history-panel' })).toHaveLength(0);
  expect(renderer.root.findByType(MapScreen).props.historical).toBe(false);
  // Back from my route, not from a card's 看軌跡: no card opens.
  expect(renderer.root.findAllByProps({ testID: 'dog-card' })).toHaveLength(0);
  // Settings has no map or history options (v3: no 地圖 row).
  await press('設定');
  expect(button('顯示歷史地圖', 'switch')).toBeUndefined();
  expect(button('套用地圖設定')).toBeUndefined();
  expect(renderer.root.findAllByProps({ testID: 'settings-row-map' })).toHaveLength(0);
});

test('a tapped dog opens its card; 看軌跡 saves its query, and back reopens the card', async () => {
  await mount();
  await advance();
  await tapDog(7);
  expect(renderer.root.findAllByProps({ testID: 'dog-card' }).length).toBeGreaterThan(0);
  // The gear stays put over an open card (A3).
  expect(renderer.root.findAllByProps({ testID: 'map-settings' }).length).toBeGreaterThan(0);
  await act(async () => renderer.root.findAll(node => node.props.testID === 'dog-card-track'
    && typeof node.props.onPress === 'function')[0].props.onPress());
  await advance();
  const screen = renderer.root.findByType(MapScreen);
  expect(screen.props.historical).toBe(true);
  // The query was stored before the page opened: this dog, today so far.
  expect(screen.props.history.preferences).toMatchObject({ slaves: [7], timeMode: 'fixed', client: true });
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  expect(screen.props.history.preferences.startAt).toBe(start.getTime());
  expect(renderer.root.findAllByProps({ testID: 'dog-card' })).toHaveLength(0);
  // The history screen is this dog's: its capsule, ＋ 加入 (055b) and its target.
  expect(screen.props.historyTarget).toEqual({ subject: 'dog', slaveId: 7 });
  expect(renderer.root.findAllByProps({ testID: 'history-dogs-pill' }).length).toBeGreaterThan(0);
  // Back from that history returns to the live map with the dog's card open
  // (‹ 回到現在 does the same: onLeaveHistory is the same step back).
  expect(screen.props.onLeaveHistory).toBeInstanceOf(Function);
  await act(async () => expect(onBack()).toBe(true));
  await advance();
  expect(renderer.root.findByType(MapScreen).props.historical).toBe(false);
  expect(renderer.root.findAllByProps({ testID: 'dog-card' }).length).toBeGreaterThan(0);
});
test('a history map never carries the receiver range ring', async () => {
  await mount();
  await advance();
  await tapDog(7);
  await act(async () => renderer.root.findAll(node => node.props.testID === 'dog-card-track'
    && typeof node.props.onPress === 'function')[0].props.onPress());
  await advance();
  expect(renderer.root.findByType(MapScreen).props.historical).toBe(true);
  const maps = renderer.root.findAll(node => node.props.presentation && typeof node.props.onNativePhone === 'function');
  expect(maps.length).toBeGreaterThan(0);
  for (const map of maps) {
    expect(map.props.presentation.historyMode).toBe(true);
    expect(map.props.presentation.rangeRing).toBeNull();
    expect(map.props.presentation.rangeLines).toEqual([]);
  }
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
  await press('設定');
  expect(renderer.root.findByType(MapView) === map).toBe(true);
  expect(text()).toContain('‹ 設定');
  await press('返回，設定');
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

test('the live map has no eyes: every dog is drawn whatever older versions stored, phone location independent', async () => {
  jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(true);
  await mount();
  await act(async () => renderer.root.findByType(MapView).props.onMapReady());
  for (const showTrails of [false, true])
    for (const showSlaveMarker of [false, true]) {
      // What an older version could have stored: all dogs hidden, paths on.
      await act(async () => renderer.root.findByType(MapScreen).props.tracking
        .saveTrackingPreferences({ showSlaveMarker, showTrails }));
      expect(renderer.root.findAllByType(Marker)).toHaveLength(1);
      expect(renderer.root.findAllByType(Polyline)).toHaveLength(0);
      expect(renderer.root.findByType(MapView).props.showsUserLocation).toBe(true);
      expect(button('隱藏所有狗位置')).toBeUndefined();
      expect(button('顯示所有狗位置')).toBeUndefined();
      expect(button('隱藏領犬員位置')).toBeUndefined();
    }
});

test('all display values survive a cold remount without duplicating hardware rows', async () => {
  await mount();
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
  expect(renderer.root.findAllByType(Polygon)).toHaveLength(0);
  expect(renderer.root.findAllByProps({ testID: 'dog-card' })).toHaveLength(0);
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
  expect(renderer.root.findAllByType(Marker)).toHaveLength(1);
  // No location permission: the gear carries the red dot and says so (049).
  expect(button('設定')).toBeUndefined();
  const gear = renderer.root.findAll(node => node.props.testID === 'map-settings'
    && typeof node.props.onPress === 'function')[0];
  expect(gear.props.accessibilityLabel).toMatch(/^設定，有 \d 件事要處理$/);
  await act(async () => { await gear.props.onPress(); });
  await press('返回，設定');
  expect(request).toHaveBeenCalledTimes(1);
});

test('map preference save failures keep the markers and say so', async () => {
  await mount();
  connection.sqlite.exec(
    "CREATE TRIGGER fail_settings BEFORE INSERT ON app_settings BEGIN SELECT RAISE(ABORT, 'settings locked'); END",
  );
  await setTrails(true);
  expect(renderer.root.findAllByType(Marker)).toHaveLength(1);
  expect(text()).toContain('settings locked');
  connection.sqlite.exec('DROP TRIGGER fail_settings');
  await setTrails(true);
  expect(text()).not.toContain('settings locked');
});

test('hardware callback writes real rows, and failed hardware writes remain visible', async () => {
  await mount();
  await press('設定');
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
  for (const label of ['返回，設定', '設定']) {
    await press(label);
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
  await press('設定');
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
    expect(renderer.root.findAllByType(Marker)).toHaveLength(1);
    // Independent native writer inserts a DB row, never a BLE-to-map callback.
    connection.sqlite.prepare(
      'INSERT INTO dog_status (received_at, master_id, slave_id, master_lat, master_lon, slave_lat, slave_lon) VALUES (?,3,7,25.02,121.32,25.03,121.33)',
    ).run(Date.now());
    await advance();
    expect(renderer.root.findAllByType(Marker).map(node => node.props.coordinate)).toEqual([
      { latitude: 25.0315, longitude: 121.4477 },
    ]);
    expect(execute.mock.calls.some(([sql]) => sql.includes('WHERE id > ?'))).toBe(true);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    renderer = null;
    delete NativeModules.BleBackground;
  }
});

// ---- the start (052: D0, D1, 判定表「啟動與恢復登入」「D1 的四種入口」) ----------
const signInPage = () => renderer.root.findAllByProps({ testID: 'sign-in-page' }).length > 0;
const progressBar = () => renderer.root.findAllByProps({ testID: 'guide-progress' }).length > 0;
// A new phone: no dog data from before either.
const freshInstall = () => connection.sqlite.exec('DELETE FROM dog_status');
// Preferences saved by an earlier run (past the first-launch guide).
function usedBefore() {
  connection.sqlite.exec('CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)');
  connection.sqlite.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('map_preferences', ?)")
    .run(JSON.stringify({ mode: 'real', windowMinutes: 2 }));
}

const page = id => renderer.root.findAllByProps({ testID: id }).length > 0;
// Android 14: 附近的裝置, 精確位置, 通知 (判定表「權限和 Android 版本」).
function android14() {
  const original = Platform.Version;
  Object.defineProperty(Platform, 'Version', { configurable: true, value: 34 });
  return () => Object.defineProperty(Platform, 'Version', { configurable: true, value: original });
}

test('first launch, signed out: D1 with the guide progress; 稍後再說 opens the map and is remembered', async () => {
  freshInstall();
  mockAuth = { loading: false, user: null, available: true };
  // A fresh install: no location permission yet.
  jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(false);
  NativeTrackingPlatform.claimLocationPermissionPrompt.mockClear();
  await mount();
  await advance(100);
  expect(signInPage()).toBe(true);
  expect(progressBar()).toBe(true);
  for (const words of ['登入 Supabase 帳號', '登入後會把收到的位置上傳，也能看到隊友的狗。不登入也可以用，只顯示這支手機連到的接收器。',
    '電子郵件', '密碼', '顯示', '登入', '稍後再說']) expect(text()).toContain(words);
  expect(text()).not.toContain('需要重新登入');
  // No 「‹ 標題」 header on D1.
  expect(renderer.root.findAllByProps({ testID: 'page-back' })).toHaveLength(0);
  // No location question under D0 or over D1: it waits for the map.
  expect(NativeTrackingPlatform.claimLocationPermissionPrompt).not.toHaveBeenCalled();
  await press('稍後再說');
  await advance(100);
  expect(signInPage()).toBe(false);
  // D2 next (step 2), D3 after it (step 3); 稍後再說 on both ends on the map.
  expect(page('permissions-page')).toBe(true);
  expect(preferences().onboarding).toBe('permissions');
  await press('稍後再說');
  await advance(100);
  expect(page('pair-scan')).toBe(true);
  expect(preferences().onboarding).toBe('receiver');
  expect(text()).toContain('打開接收器電源，掃描機身上的 QR Code。');
  await press('稍後再說');
  await advance(100);
  expect(page('pair-scan')).toBe(false);
  expect(NativeTrackingPlatform.claimLocationPermissionPrompt).toHaveBeenCalled();
  expect(preferences().onboarding).toBe('done');
  const handlers = Linking.addEventListener.mock.calls.filter(call => call[0] === 'url').map(call => call[1]);
  await act(async () => handlers.forEach(handler => handler({ url: 'dogtracker://notification/receiver-settings' })));
  expect(page('receiver-settings')).toBe(true);

  await act(async () => renderer.unmount());
  await mount();
  await advance(100);
  expect(signInPage()).toBe(false);
  expect(page('permissions-page')).toBe(false);
});

test('D2 asks one permission after another, then 下一步; leaving midway resumes at that step', async () => {
  const restoreVersion = android14();
  try {
    freshInstall();
    mockAuth = { loading: false, user: null, available: true };
    const { PERMISSIONS } = PermissionsAndroid;
    const granted = new Set();
    jest.spyOn(PermissionsAndroid, 'check').mockImplementation(async name => granted.has(name));
    // 附近的裝置 allowed, location only 大概, notifications refused.
    const request = jest.spyOn(PermissionsAndroid, 'requestMultiple').mockImplementation(async names => {
      for (const name of names) {
        if (name === PERMISSIONS.BLUETOOTH_SCAN || name === PERMISSIONS.BLUETOOTH_CONNECT
          || name === PERMISSIONS.ACCESS_COARSE_LOCATION) granted.add(name);
      }
      return {};
    });
    await mount();
    await advance(100);
    await press('稍後再說');
    await advance(100);
    expect(page('permissions-page')).toBe(true);
    for (const words of ['App 需要這些權限', '附近的裝置', '連接接收器', '精確位置', '算出狗離你多遠、記錄你的路線；離開 App、鎖螢幕時也會繼續記錄，右下角或設定 → 手機可以隨時停止', '通知',
      '狗出問題時提醒你', '全部允許', '稍後再說']) expect(text()).toContain(words);
    // Quit on D2: the next start continues on D2.
    await act(async () => renderer.unmount());
    await mount();
    await advance(100);
    expect(signInPage()).toBe(false);
    expect(page('permissions-page')).toBe(true);
    // Each row shows 「詢問中…」 a moment before its system question.
    await act(async () => { button('全部允許').props.onPress(); });
    await advance(1000);
    // One system question per row, in order.
    expect(request.mock.calls.map(call => call[0])).toEqual([
      [PERMISSIONS.BLUETOOTH_SCAN, PERMISSIONS.BLUETOOTH_CONNECT],
      [PERMISSIONS.ACCESS_FINE_LOCATION, PERMISSIONS.ACCESS_COARSE_LOCATION],
      [PERMISSIONS.POST_NOTIFICATIONS]]);
    expect(text()).toContain('只給了大概位置，算不出距離');
    expect(text()).toContain('未允許');
    expect(text()).toContain('開系統設定 ›');
    expect(text()).not.toContain('全部允許');
    expect(preferences().askedPermissions).toEqual(['nearby', 'location', 'notifications']);
    // 開系統設定 › opens this app's settings; back in the app every row is
    // checked again.
    await tap('permission-location-settings');
    expect(Linking.openSettings).toHaveBeenCalled();
    granted.add(PERMISSIONS.ACCESS_FINE_LOCATION);
    await act(async () => onAppState('active'));
    await advance(100);
    expect(text()).not.toContain('只給了大概位置');
    // Back on D2 goes to D1 (the guide's step before), and a restart is D1.
    await act(async () => expect(onBack()).toBe(true));
    expect(signInPage()).toBe(true);
    expect(preferences().onboarding).toBe('signIn');
  } finally {
    restoreVersion();
  }
});

test('D3 in the guide: a QR code finds and connects its receiver, D4 lists the sources, 開始使用 ends on the map', async () => {
  const restoreVersion = android14();
  try {
    freshInstall();
    mockAuth = { loading: false, user: null, available: true };
    jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(true);
    await mount();
    await advance(100);
    await press('稍後再說');
    await press('下一步');
    await advance(100);
    expect(page('pair-scan')).toBe(true);
    // The camera is asked for once the page is on screen.
    const scan = renderer.root.findAll(node => node.props.testID === 'pair-scan'
      && typeof node.props.onLayout === 'function')[0];
    await act(async () => scan.props.onLayout({ nativeEvent: { layout: {} } }));
    const camera = renderer.root.findAll(node => node.props.testID === 'qr-camera'
      && typeof node.props.onScan === 'function')[0];
    expect(camera).toBeDefined();
    // Not a receiver's QR code: D3b.
    await act(async () => camera.props.onScan({ nativeEvent: { value: 'https://example.com' } }));
    expect(text()).toContain('這不是接收器的 QR Code');
    await tap('guide-dialog-rescan');
    // Receiver 7's code: found by its name, connected as Master 7.
    const device = { id: 'AA:BB:CC:00:00:07', name: 'DogGPS-Master7', rssi: -60 };
    ble.scan.mockImplementation(async (config, onStatus, onDevice) => { onDevice(device); });
    ble.connect.mockImplementation(async () => true);
    await act(async () => camera.props.onScan({ nativeEvent: { value: JSON.stringify({ v: 1, masterId: 7,
      bleName: 'DogGPS-Master7', serviceUuid: '7f510001-6d9e-4e2f-a671-8f3f2d49a001' }) } }));
    await advance(100);
    expect(ble.connect).toHaveBeenCalledWith(device, expect.any(Function), expect.any(Function),
      expect.objectContaining({ bleName: 'DogGPS-Master7', masterId: 7 }));
    expect(page('paired-page')).toBe(true);
    expect(text()).toContain('開始使用');
    await press('開始使用');
    await advance(100);
    expect(page('paired-page')).toBe(false);
    expect(preferences().onboarding).toBe('done');
  } finally {
    restoreVersion();
  }
});

test('first launch: the back key on D1 leaves the app, and the next start is D1 again', async () => {
  freshInstall();
  mockAuth = { loading: false, user: null, available: true };
  const exit = jest.spyOn(BackHandler, 'exitApp').mockImplementation(() => {});
  await mount();
  await advance(100);
  expect(signInPage()).toBe(true);
  await act(async () => expect(onBack()).toBe(true));
  expect(exit).toHaveBeenCalledTimes(1);
  await act(async () => renderer.unmount());
  await mount();
  await advance(100);
  expect(signInPage()).toBe(true);
});

test('signed in from before the guide existed: the map opens and the guide counts as passed', async () => {
  freshInstall();
  await mount();
  await advance(100);
  expect(signInPage()).toBe(false);
  expect(preferences().onboarding).toBe('done');
});

test('the sign-in restore still running holds the start under D0; nothing opens before it ends', async () => {
  freshInstall();
  mockAuth = { loading: true, user: null, available: true };
  await mount();
  await advance(100);
  expect(signInPage()).toBe(false);
  // Restored without a session (first launch): D1.
  mockAuth = { loading: false, user: null, available: true };
  await act(async () => renderer.update(<App />));
  await advance(100);
  expect(signInPage()).toBe(true);
});

test('登入失效 found by the restore: D1 with 需要重新登入; 稍後再說 opens the map', async () => {
  usedBefore();
  mockAuth = { loading: false, user: null, available: true, expired: true, expiredAtStart: true };
  await mount();
  await advance(100);
  expect(signInPage()).toBe(true);
  expect(progressBar()).toBe(false);
  expect(text()).toContain('需要重新登入');
  await press('稍後再說');
  expect(signInPage()).toBe(false);
  // The map (not settings) and the gear's red dot for the expired sign-in.
  expect(renderer.root.findAllByProps({ testID: 'map-settings-dot' }).length).toBeGreaterThan(0);
  const handlers = Linking.addEventListener.mock.calls.filter(call => call[0] === 'url').map(call => call[1]);
  await act(async () => handlers.forEach(handler => handler({ url: 'dogtracker://notification/receiver-settings' })));
  expect(page('receiver-settings')).toBe(true);

});

test('the database cannot be opened: 手機裡的資料打不開; 診斷 says why; 重試 opens it again', async () => {
  usedBefore();
  open.mockImplementationOnce(() => { throw new Error('SQLITE_CANTOPEN: unable to open database file'); });
  const exit = jest.spyOn(BackHandler, 'exitApp').mockImplementation(() => {});
  await mount();
  await advance(100);
  expect(renderer.root.findAllByProps({ testID: 'start-failed' }).length).toBeGreaterThan(0);
  expect(text()).toContain('手機裡的資料打不開');
  await press('診斷');
  expect(title()).toBe('返回，診斷');
  expect(text()).toContain('SQLITE_CANTOPEN');
  expect(preferences().diagnosticsEnabled).not.toBe(true);
  await act(async () => expect(onBack()).toBe(true));
  expect(text()).toContain('手機裡的資料打不開');
  // Nothing under it: back leaves the app.
  await act(async () => expect(onBack()).toBe(true));
  expect(exit).toHaveBeenCalledTimes(1);
  await press('重試');
  await advance(100);
  expect(renderer.root.findAllByProps({ testID: 'start-failed' })).toHaveLength(0);
  expect(open).toHaveBeenCalledTimes(2);
  expect(renderer.root.findAllByType(Marker)).toHaveLength(1);
});

test('A6 「登入 Supabase」 opens D1; back and 稍後再說 return to the map', async () => {
  usedBefore();
  mockAuth = { loading: false, user: null, available: true };
  Linking.getInitialURL.mockResolvedValueOnce('dogtracker://dev/fixture?name=no-data');
  await mount();
  await advance(100);
  await press('登入 Supabase');
  expect(signInPage()).toBe(true);
  expect(progressBar()).toBe(false);
  await act(async () => expect(onBack()).toBe(true));
  expect(signInPage()).toBe(false);
  await press('登入 Supabase');
  await press('稍後再說');
  expect(signInPage()).toBe(false);
  expect(text()).toContain('還沒有狗的資料');
});

test('start fixtures: first launch, restore past 10 s, expired at start, database failure', async () => {
  usedBefore();
  mockAuth = { loading: false, user: null, available: true };
  Linking.getInitialURL.mockResolvedValueOnce('dogtracker://dev/fixture?name=onboarding-first-launch');
  let emit;
  Linking.addEventListener.mockImplementationOnce((_, handler) => {
    emit = handler;
    return { remove: jest.fn() };
  });
  await mount();
  await advance(100);
  expect(signInPage()).toBe(true);
  expect(progressBar()).toBe(true);
  // A fixture's 稍後再說 saves nothing into this phone's preferences.
  await press('稍後再說');
  expect(signInPage()).toBe(false);
  expect(preferences()).toEqual({ mode: 'real', windowMinutes: 2 });
  await act(async () => emit({ url: 'dogtracker://dev/fixture?name=auth-expired' }));
  await advance(100);
  expect(signInPage()).toBe(true);
  expect(text()).toContain('需要重新登入');
  await act(async () => emit({ url: 'dogtracker://dev/fixture?name=db-open-failed' }));
  await advance(100);
  expect(text()).toContain('手機裡的資料打不開');
  await press('診斷');
  expect(text()).toContain('SQLITE_CANTOPEN');
  expect(preferences().diagnosticsEnabled).not.toBe(true);
  // Diagnostics not switched on: no 隱藏診斷 from D0's 診斷.
  expect(renderer.root.findAllByProps({ testID: 'diagnostics-hide' })).toHaveLength(0);
  await act(async () => emit({ url: 'dogtracker://dev/fixture?name=auth-restore-slow&page=cloud' }));
  await advance(100);
  expect(title()).toBe('返回，Supabase 帳號');
  expect(text()).toContain('暫時連不上，會自動重試');
  await act(async () => emit({ url: 'dogtracker://dev/fixture?name=auth-expired' }));
  await advance(100);
  expect(signInPage()).toBe(true);
  // Off: back on the live map.
  await act(async () => emit({ url: 'dogtracker://dev/fixture?name=off' }));
  await advance(100);
  expect(signInPage()).toBe(false);
  expect(renderer.root.findAllByProps({ testID: 'page-back' })).toHaveLength(0);
});

test('an update from a version without the guide, signed out, with dog data but no saved preferences: the map', async () => {
  mockAuth = { loading: false, user: null, available: true };
  await mount();
  await advance(100);
  expect(signInPage()).toBe(false);
  expect(renderer.root.findAllByType(Marker)).toHaveLength(1);
});

// 058b 判定表「通知本體和「打開地圖」按鈕」, 「常駐通知（三種）」: where a tap leads.
test('notification body opens receiver settings after cold launch settles', async () => {
  Linking.getInitialURL.mockResolvedValue('dogtracker://notification/receiver-settings');
  await mount();
  await advance(100);
  expect(title()).toBe('返回，接收器');
  Linking.getInitialURL.mockResolvedValue(null);
});

test('notification dog body opens its card; 打開地圖 closes it; an unknown link does nothing', async () => {
  Linking.getInitialURL.mockResolvedValue('dogtracker://notification/map?dogId=7');
  const handlers = [];
  Linking.addEventListener.mockImplementation((_, handler) => {
    handlers.push(handler);
    return { remove: jest.fn() };
  });
  await mount();
  await advance(100);
  expect(renderer.root.findAllByProps({ testID: 'dog-card' }).length).toBeGreaterThan(0);
  await act(async () => handlers.forEach(handler => handler({ url: 'dogtracker://notification/somewhere' })));
  await advance(100);
  expect(renderer.root.findAllByProps({ testID: 'dog-card' }).length).toBeGreaterThan(0);
  await act(async () => handlers.forEach(handler => handler({ url: 'dogtracker://notification/open-map' })));
  await advance(1000);
  expect(renderer.root.findAllByProps({ testID: 'dog-card' })).toHaveLength(0);
  await act(async () => handlers.forEach(handler => handler({ url: 'dogtracker://notification/cloud-settings' })));
  await advance(100);
  expect(title()).toBe('返回，Supabase 帳號');
  Linking.getInitialURL.mockResolvedValue(null);
});


test('the settings header stays above the page-colour map cover', async () => {
  const { StyleSheet } = require('react-native');
  await mount();
  await advance(100);
  await act(async () => {
    renderer.root.findAll(node => typeof node.props.onOpenSettings === 'function')[0].props.onOpenSettings();
  });
  await advance(100);
  const back = renderer.root.findAllByProps({ testID: 'page-back' })[0];
  let header = back.parent;
  while (header && !(header.props.style && StyleSheet.flatten(header.props.style).minHeight)) header = header.parent;
  const cover = StyleSheet.flatten(renderer.root.findAllByProps({ testID: 'map-cover' })[0].props.style);
  expect(StyleSheet.flatten(header.props.style).zIndex).toBeGreaterThan(cover.zIndex ?? 0);
});

test('K02: foreground settings keep polling the alert dog snapshot', async () => {
  await mount();
  await advance(100);
  await press('設定');
  const before = renderer.root.findByType(MapScreen).props.cloudDogs;
  await act(async () => { await renderer.root.findByType(MapScreen).props.tracking.hardwareDatabase.saveStatus({ ...trackingPoint, slaveId: 19, receivedAt: Date.now(), timestamp: Math.floor(Date.now() / 1000) }, 'settings-packet'); });
  await advance(10000);
  const after = renderer.root.findByType(MapScreen).props.cloudDogs;
  expect(after).not.toBe(before);
  expect(after.packets.some(row => row.slave_id === 19)).toBe(true);
});

test('K08: rerenders do not register a newer root back handler', async () => {
  await mount();
  await advance(100);
  const handlers = BackHandler.addEventListener.mock.calls.length;
  await act(async () => renderer.update(<App />));
  await advance(10000);
  expect(BackHandler.addEventListener.mock.calls.length).toBe(handlers);
});

test('E01/E16: A4 and A5 isolate background controls and accessibility', async () => {
  await mount();
  await advance(100);
  await tapDog(7);
  const DogCard = require('../src/map/DogCard').default;
  const card = renderer.root.findByType(DogCard);
  for (const action of ['onActivity', 'onEdit']) {
    await act(async () => card.props[action]());
    const layer = renderer.root.findAllByProps({ testID: 'map-background-layer' })[0];
    expect(layer.props).toMatchObject({ pointerEvents: 'none', accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' });
    // The map stays mounted under A4/A5 (display:none would detach the
    // native MapView, which leaks a GoogleMap per opening).
    expect(layer.props.collapsable).toBe(false);
    expect(StyleSheet.flatten(layer.props.style).display).toBeUndefined();
    // Off screen, so its surface cannot show in the status-bar inset.
    expect(StyleSheet.flatten(layer.props.style).transform).toEqual([{ translateX: layout.offscreen }]);
  }
});

test('leak: hiding the map layer never re-parents the native map', async () => {
  await mount();
  await advance(100);
  const layerStyle = () => {
    const layer = renderer.root.findAllByProps({ testID: 'persistent-map-layer' })[0];
    expect(layer.props.collapsable).toBe(false);
    return StyleSheet.flatten(layer.props.style);
  };
  const onMap = layerStyle();
  await act(async () => {
    renderer.root.findAll(node => typeof node.props.onOpenSettings === 'function')[0].props.onOpenSettings();
  });
  await advance(100);
  const onSettings = layerStyle();
  // Hidden by opacity only; the order (zIndex) and display never change.
  expect(onSettings.opacity).toBe(0);
  expect(onSettings.transform).toEqual([{ translateX: layout.offscreen }]);
  expect(onMap.transform).toBeUndefined();
  expect(onSettings.zIndex).toBe(onMap.zIndex);
  expect(onSettings.display).toBeUndefined();
});

test('E15: settings content reserves measured N3 height and restores spacing when hidden', () => {
  const source = require('fs').readFileSync(require.resolve('../App'), 'utf8');
  expect(source).not.toContain('<AlertBadge');
  expect(source).toContain('alertBadge={isHistory ? { badge: offMap.badge, onPress: pressAlertBadge } : null}');
  expect(source).toContain('paddingTop: light && n3Shown ? n3Height + space.s * 2 : 0');
  expect(source).toMatch(/top=\{layout.belowStatusBar\}\s*onHeight=\{setN3Height\}/);
});

test('E03: native phone fix participates in the first frame without recording', async () => {
  await mount();
  await advance(100);
  const map = renderer.root.findAll(node => typeof node.props.onNativePhone === 'function', { deep: false })[0];
  const coordinate = { latitude: 24.99, longitude: 121.31 };
  await act(async () => map.props.onNativePhone(coordinate));
  const updated = renderer.root.findAll(node => typeof node.props.onNativePhone === 'function', { deep: false })[0];
  expect(updated.props.presentation.cameraPositions).toEqual(expect.arrayContaining([coordinate]));
});

test.each(['com.antgo.dogtracker', 'com.antgo.dogtracker.debug'])(
  'notification settings targets the runtime package %s',
  async packageName => {
    const sendIntent = jest.spyOn(Linking, 'sendIntent').mockResolvedValue();
    NativeTrackingPlatform.packageName.mockReturnValueOnce(packageName);
    Linking.getInitialURL.mockResolvedValueOnce(
      'dogtracker://dev/fixture?name=settings-problems&page=alerts',
    );
    await mount();
    await advance(100);
    await press('通知權限，有問題：未允許，開系統設定');
    expect(NativeTrackingPlatform.packageName).toHaveBeenCalled();
    expect(sendIntent).toHaveBeenCalledWith(
      'android.settings.APP_NOTIFICATION_SETTINGS',
      [{ key: 'android.provider.extra.APP_PACKAGE', value: packageName }],
    );
    sendIntent.mockRestore();
  },
);

