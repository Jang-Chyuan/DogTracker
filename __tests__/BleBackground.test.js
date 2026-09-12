import { NativeModules, Platform } from 'react-native';
import { encode } from 'base-64';
import { createBleService } from '../src/ble/BleService';
import { createDogDatabase } from '../src/database/DogDatabase';
import { open } from 'react-native-nitro-sqlite';

let native;
beforeEach(() => {
  jest.clearAllMocks();
  Platform.OS = 'android';
  native = {
    addListener: jest.fn(), removeListeners: jest.fn(), stop: jest.fn(),
    connect: jest.fn(async () => 'session'),
    getState: jest.fn(async () => ({ sessionId: 'session', enabled: true, running: true, connected: true })),
    wifiCommand: jest.fn(async () => '{}'),
    initializeDatabase: jest.fn(async () => true),
    listHistory: jest.fn(async () => '[{"id":1,"received_at":123}]'),
    deleteHistory: jest.fn(async () => true),
    executeDatabase: jest.fn(async () => '{"results":[]}'),
    executeDatabaseBatch: jest.fn(async () => true),
  };
  NativeModules.BleBackground = native;
});
afterEach(() => { delete NativeModules.BleBackground; });

test('Android connects and subscribes only through the native service', async () => {
  const manager = { connectToDevice: jest.fn(), onDeviceDisconnected: jest.fn() };
  const device = { id: '11:22:33:44:55:66', name: 'DogGPS-Master3', connect: jest.fn() };
  const ble = createBleService(manager);
  expect(await ble.connect(device, jest.fn(), jest.fn(), {
    bleName: device.name, serviceUuid: 'service', masterId: 3,
  })).toBe(true);
  expect(native.connect).toHaveBeenCalledWith(device.id, device.name, 'service', expect.any(String), 3);
  expect(device.connect).not.toHaveBeenCalled();
  expect(manager.connectToDevice).not.toHaveBeenCalled();
  expect(manager.onDeviceDisconnected).not.toHaveBeenCalled();
  expect(ble.isConnected()).toBe(true);
  ble.disconnect();
  expect(native.stop).toHaveBeenCalledTimes(1);
  expect(ble.isConnected()).toBe(false);
});

test('a running foreground service alone is not treated as a BLE connection', async () => {
  native.getState.mockResolvedValue({ running: true, connected: false, enabled: true });
  const ble = createBleService({});
  await ble.restoreBackground(jest.fn(), jest.fn());
  expect(ble.isConnected()).toBe(false);
});

test('switching masters does not replay the previous session into the new QR callback', async () => {
  native.getState.mockResolvedValueOnce({ sessionId: 'old', running: true, connected: true,
    enabled: true, lastReceivedAt: 123, lastPayload: encode('{"mid":5,"sid":1}') });
  const ble = createBleService({});
  const onData = jest.fn();
  jest.useFakeTimers();
  const pending = ble.connect({ id: '11:22:33:44:55:66', name: 'DogGPS-Master3' }, jest.fn(), onData);
  await jest.advanceTimersByTimeAsync(500);
  expect(await pending).toBe(true);
  expect(onData).not.toHaveBeenCalled();
  jest.useRealTimers();
});

test('restoring cached data preserves reception time and does not replay it each poll', async () => {
  native.getState.mockResolvedValue({
    enabled: true, running: true, connected: false, lastReceivedAt: 123,
    lastPayload: encode('{"mid":3,"sid":1,"dst":12}'),
  });
  const ble = createBleService({});
  const onData = jest.fn();
  await ble.restoreBackground(jest.fn(), onData);
  await ble.getBackgroundState();
  expect(onData).toHaveBeenCalledTimes(1);
  expect(onData).toHaveBeenCalledWith(expect.objectContaining({ masterId: 3, slaveId: 1 }),
    expect.any(String), { receivedAt: 123, persistedNatively: true });
  expect(ble.isConnected()).toBe(false);
});

test('Wi-Fi uses the native connection and supports paginated responses', async () => {
  const ble = createBleService({});
  await ble.configureWifi('中文 WiFi', 'password');
  expect(native.wifiCommand).toHaveBeenCalledWith(
    JSON.stringify({ action: 'upsert', ssid: '中文 WiFi', password: 'password' }), false,
  );
  native.wifiCommand.mockResolvedValueOnce('{"ok":true,"ssids":["a"],"next":1}')
    .mockResolvedValueOnce('{"ok":true,"ssids":["b"],"active":"b"}');
  expect(await ble.getWifiList()).toEqual({ ssids: ['a', 'b'], activeSsid: 'b' });
});

test('Android history shares native storage and never duplicates native inserts in JS', async () => {
  const db = createDogDatabase();
  await db.initialize();
  await db.saveStatus({ slaveId: 1 });
  expect(await db.listHistory(9000)).toEqual([{ id: 1, received_at: 123 }]);
  expect(native.listHistory).toHaveBeenCalledWith(1000);
  // Never open a second SQLite engine on this file in the same Android process.
  expect(open).not.toHaveBeenCalled();
  expect(native.initializeDatabase).toHaveBeenCalledTimes(1);
  expect(native.executeDatabase.mock.calls.map(([sql]) => sql).join('\n'))
    .not.toMatch(/INSERT INTO dog_status|DELETE FROM dog_status/);
  await db.deleteAll();
  expect(native.deleteHistory).toHaveBeenCalledTimes(1);
});
