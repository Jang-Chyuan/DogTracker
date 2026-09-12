import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Alert, AppState, BackHandler, Switch } from 'react-native';
import { mockDatabase, open } from 'react-native-nitro-sqlite';
import App from '../App';
import { createBleService } from '../src/ble/BleService';
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
let connection, renderer, ble, onBack;
const text = () => JSON.stringify(renderer.toJSON());
const rows = table =>
  connection.sqlite.prepare('SELECT * FROM ' + table + ' ORDER BY id').all();
async function press(label, role = 'button') {
  const control = renderer.root.findAll(
    node =>
      node.props.accessibilityLabel === label &&
      node.props.accessibilityRole === role &&
      typeof node.props.onPress === 'function',
  )[0];
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
async function demoPage() {
  await press('設定', 'tab');
  await press('Demo 設定');
}
async function setMode(value) {
  await act(async () =>
    renderer.root.findByType(Switch).props.onValueChange(value),
  );
}
beforeEach(async () => {
  jest.useFakeTimers();
  connection = createMemoryConnection();
  await createDogDatabase(connection).initialize();
  await createDogDatabase(connection).saveStatus(trackingPoint, 'hardware');
  mockDatabase.executeAsync
    .mockReset()
    .mockImplementation(connection.executeAsync);
  mockDatabase.executeBatchAsync
    .mockReset()
    .mockImplementation(connection.executeBatchAsync);
  mockDatabase.close.mockClear();
  open.mockImplementation(() => mockDatabase);
  ble = createBleService.mock.results[0].value;
  ble.disconnect.mockClear();
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'active',
  });
  jest
    .spyOn(AppState, 'addEventListener')
    .mockReturnValue({ remove: jest.fn() });
  jest
    .spyOn(BackHandler, 'addEventListener')
    .mockImplementation((_, callback) => {
      onBack = callback;
      return { remove: jest.fn() };
    });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  await mount();
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  renderer = null;
  connection.close();
  jest.restoreAllMocks();
  jest.useRealTimers();
});
test('defaults to three seeded Demo rows with no automatic writes', async () => {
  expect(text()).toContain('DEMO · 模擬資料');
  expect(rows('demo_dog_status').map(row => row.packet_type)).toEqual([
    'DEMO_A',
    'DEMO_B',
    'DEMO_C',
  ]);
  await act(async () => jest.advanceTimersByTimeAsync(601000));
  expect(rows('demo_dog_status')).toHaveLength(3);
  expect(text()).not.toContain('開始 Demo');
});
test('restored native events never duplicate SQLite rows or change Demo mode', async () => {
  const before = rows('dog_status');
  const receive = ble.restoreBackground.mock.calls.at(-1)[1];
  await act(async () => receive(trackingPoint, 'native replay', {
    receivedAt: Date.now(), persistedNatively: true,
  }));
  expect(rows('dog_status')).toEqual(before);
  expect(rows('demo_dog_status')).toHaveLength(3);
  expect(text()).toContain('DEMO · 模擬資料');
});
test('native write failures are reported outside the hardware page and recover independently', async () => {
  ble.getBackgroundState.mockResolvedValue({ storageError: 'native disk full' });
  await act(async () => jest.advanceTimersByTimeAsync(2000));
  expect(text()).toContain('native disk full');
  await press('設定', 'tab');
  expect(text()).toContain('native disk full');
  ble.getBackgroundState.mockResolvedValue({ storageError: '' });
  await act(async () => jest.advanceTimersByTimeAsync(2000));
  expect(text()).not.toContain('native disk full');
});
test('two tabs and nested Demo return to Settings; hardware Wi-Fi remains available', async () => {
  const tabs = renderer.root.findAll(
    node =>
      node.props.accessibilityRole === 'tab' &&
      typeof node.props.onPress === 'function',
  );
  expect(tabs.map(node => node.props.accessibilityLabel)).toEqual([
    '地圖',
    '設定',
  ]);
  await demoPage();
  await act(async () => expect(onBack()).toBe(true));
  expect(text()).toContain('BLE／QR 與 Master 設定');
  await press('BLE／QR 與 Master 設定');
  expect(text()).toContain('自動 BLE QR Code 掃描');
  expect(text()).toContain('手動 BLE 掃描');
  expect(rows('demo_dog_status')).toHaveLength(3);
  await act(async () => onBack());
  expect(text()).toContain('Demo 設定');
  expect(ble.disconnect).not.toHaveBeenCalled();
});
test('preset menu appends exactly one chosen DB row without switching the current mode', async () => {
  await demoPage();
  await setMode(false);
  await press('選擇 Demo 預設點');
  await press('點 B', 'radio');
  await press('寫入 1 筆到 Demo DB');
  expect(rows('demo_dog_status')).toHaveLength(4);
  expect(rows('demo_dog_status').at(-1).packet_type).toBe('DEMO_B');
  expect(text()).toContain('目前 4 筆 · 最新點 B');
  await press('回到地圖');
  expect(text()).toContain('正式 · SQLite');
});
test('reset restores only Demo rows and preserves real data and saved mode', async () => {
  const real = rows('dog_status');
  await demoPage();
  await setMode(false);
  await press('寫入 1 筆到 Demo DB');
  await press('重設 Demo');
  const confirm = Alert.alert.mock.calls
    .at(-1)[2]
    .find(button => button.text === '確認重設');
  await act(async () => confirm.onPress());
  expect(rows('demo_dog_status').map(row => row.packet_type)).toEqual([
    'DEMO_A',
    'DEMO_B',
    'DEMO_C',
  ]);
  expect(rows('demo_dog_status')[0].id).toBeGreaterThan(4);
  expect(rows('dog_status')).toEqual(real);
  expect(text()).toContain('正式 · SQLite');
});
test('a new App owner restores saved real mode and does not append a second seed', async () => {
  await demoPage();
  await setMode(false);
  await act(async () => renderer.unmount());
  renderer = null;
  await mount();
  expect(text()).toContain('正式 · SQLite');
  expect(rows('demo_dog_status')).toHaveLength(3);
});
test('failed manual writes retain prior data, show the error and can be retried', async () => {
  await demoPage();
  connection.sqlite.exec(
    "CREATE TRIGGER reject_demo BEFORE INSERT ON demo_dog_status BEGIN SELECT RAISE(ABORT, 'demo write rejected'); END",
  );
  await press('寫入 1 筆到 Demo DB');
  expect(rows('demo_dog_status')).toHaveLength(3);
  expect(text()).toContain('demo write rejected');
  connection.sqlite.exec('DROP TRIGGER reject_demo');
  await press('寫入 1 筆到 Demo DB');
  expect(rows('demo_dog_status')).toHaveLength(4);
});
