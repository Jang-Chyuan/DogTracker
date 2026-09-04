import { NativeEventEmitter, NativeModules, PermissionsAndroid, Platform } from 'react-native';
import { BleManager } from 'react-native-ble-plx';
import { decode as decodeBase64, encode as encodeBase64 } from 'base-64';
import { parseBlePayload } from './BleParser';
import { scanForDevices } from './BleScanner';
import { toDogStatus } from '../models/DogStatus';

export const BLE_DEVICE_NAME = 'DogGPS-Master3';
export const BLE_SERVICE_UUID = '7f510001-6d9e-4e2f-a671-8f3f2d49a001';
export const BLE_DATA_UUID = '7f510002-6d9e-4e2f-a671-8f3f2d49a001';
export const BLE_WIFI_CONFIG_UUID = '7f510003-6d9e-4e2f-a671-8f3f2d49a001';
export const DEFAULT_BLE_CONFIG = Object.freeze({
  bleName: BLE_DEVICE_NAME,
  serviceUuid: BLE_SERVICE_UUID,
});

function normalizeBleConfig(config = DEFAULT_BLE_CONFIG) {
  const bleName = config.bleName?.trim();
  const serviceUuid = config.serviceUuid?.trim().toLowerCase();
  if (!bleName || !serviceUuid) {
    throw new Error('BLE 設定缺少 bleName 或 serviceUuid');
  }
  return { bleName, serviceUuid };
}

function normalizeDeviceName(value) {
  return typeof value === 'string'
    ? value.toLowerCase().replace(/[^a-z0-9]/g, '')
    : '';
}

function encodeUtf8Base64(value) {
  const bytes = encodeURIComponent(value).replace(
    /%([0-9A-F]{2})/g,
    (_, hex) => String.fromCharCode(parseInt(hex, 16)),
  );
  return encodeBase64(bytes);
}

function decodeUtf8Base64(value) {
  const bytes = decodeBase64(value);
  const encoded = Array.from(bytes, character =>
    `%${character.charCodeAt(0).toString(16).padStart(2, '0')}`,
  ).join('');
  return decodeURIComponent(encoded);
}

async function requestPermissions() {
  if (Platform.OS !== 'android') return true;
  const permissions = Platform.Version < 31
    ? [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION]
    : [
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    ];
  if (Platform.Version >= 33 && PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS) {
    permissions.push(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  }
  const result = await PermissionsAndroid.requestMultiple(permissions);
  return Object.values(result).every(
    permission => permission === PermissionsAndroid.RESULTS.GRANTED,
  );
}

export function createBleService(manager = new BleManager()) {
  let device = null;
  let cancelScan = null;
  let monitorSubscription = null;
  let disconnectSubscription = null;
  let reconnectTimer = null;
  let reconnectAttempt = 0;
  let reconnecting = false;
  let manualDisconnect = false;
  let lastDevice = null;
  let lastOnStatus = () => {};
  let lastOnData = () => {};
  let buffer = '';
  let activeConfig = DEFAULT_BLE_CONFIG;
  const nativeBle = Platform.OS === 'android' ? NativeModules.BleBackground : null;

  const startBackgroundService = status => {
    if (Platform.OS === 'android') NativeModules.BleBackground?.start(status);
  };

  const stopBackgroundService = () => {
    if (Platform.OS === 'android') NativeModules.BleBackground?.stop();
  };

  const handleValue = (value, onData, onStatus = () => {}) => {
    if (!value) return;
    try {
      const parsed = parseBlePayload(value);
      const combined = buffer + parsed.payload;
      const start = combined.indexOf('{');
      const end = combined.indexOf('}', start);
      if (start < 0 || end < start) {
        buffer = combined;
        return;
      }
      const payload = combined.slice(start, end + 1);
      buffer = combined.slice(end + 1);
      onData(toDogStatus(JSON.parse(payload)), payload);
    } catch (error) {
      buffer = '';
      onStatus(`BLE 資料解析錯誤：${error.message}`);
    }
  };

  const nativeEmitter = nativeBle ? new NativeEventEmitter(nativeBle) : null;
  nativeEmitter?.addListener('BleBackgroundStatus', status => {
    lastOnStatus(status);
  });
  nativeEmitter?.addListener('BleBackgroundData', value => {
    handleValue(value, lastOnData, lastOnStatus);
  });

  let connectInternal;

  const scheduleReconnect = () => {
    if (manualDisconnect || reconnectTimer || !lastDevice) return;
    const delay = Math.min(2000 * (2 ** reconnectAttempt), 30000);
    reconnectAttempt += 1;
    lastOnStatus(`BLE 已斷線，${Math.round(delay / 1000)} 秒後自動重連`);
    startBackgroundService('BLE 已斷線，等待自動重連');
    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null;
      if (manualDisconnect || reconnecting) return;
      reconnecting = true;
      lastOnStatus(`自動重連中（第 ${reconnectAttempt} 次）...`);
      const ok = await connectInternal(lastDevice, lastOnStatus, lastOnData, true);
      reconnecting = false;
      if (!ok) scheduleReconnect();
    }, delay);
  };

  connectInternal = async (foundDevice, onStatus, onData, isReconnect = false) => {
    try {
      onStatus(isReconnect ? '自動重連中...' : '連線中...');
      device = isReconnect
        ? await manager.connectToDevice(foundDevice.id)
        : await foundDevice.connect();
      await device.requestMTU(320);
      await device.discoverAllServicesAndCharacteristics();
      disconnectSubscription?.remove();
      disconnectSubscription = manager.onDeviceDisconnected(device.id, error => {
        device = null;
        monitorSubscription?.remove();
        monitorSubscription = null;
        if (!manualDisconnect) {
          lastOnStatus(error ? `BLE 已斷線：${error.message}` : 'BLE 已斷線');
          scheduleReconnect();
        }
      });
      buffer = '';
      reconnectAttempt = 0;
      onStatus(`已連線並訂閱：${device.name || device.localName || device.id}`);
      if (nativeBle?.connect) {
        await nativeBle.connect(
          device.id,
          device.name || device.localName || 'DogGPS Master',
          activeConfig.serviceUuid,
          BLE_DATA_UUID,
        );
      } else {
        startBackgroundService('BLE 已連線，背景接收資料中');
      }
      const initial = await device.readCharacteristicForService(
        activeConfig.serviceUuid,
        BLE_DATA_UUID,
      );
      handleValue(initial?.value, onData, onStatus);
      monitorSubscription?.remove();
      monitorSubscription = device.monitorCharacteristicForService(
        activeConfig.serviceUuid,
        BLE_DATA_UUID,
        (error, characteristic) => {
          if (error) {
            onStatus(`訂閱錯誤：${error.message}`);
            return;
          }
          handleValue(characteristic?.value, onData, onStatus);
        },
      );
      return true;
    } catch (error) {
      device = null;
      onStatus(`${isReconnect ? '自動重連' : '連線'}失敗：${error.message}`);
      return false;
    }
  };

  return {
    isConnected() {
      return device !== null;
    },

    async restoreBackground(onStatus, onData) {
      if (!nativeBle?.getState) return null;
      lastOnStatus = onStatus;
      lastOnData = onData;
      const state = await nativeBle.getState();
      if (state.lastPayload) handleValue(state.lastPayload, onData, onStatus);
      return state;
    },

    async scan(config, onStatus, onDevice, onFinished) {
      if (!(await requestPermissions())) {
        onStatus('未取得 BLE 掃描權限');
        onFinished?.();
        return;
      }
      const manualMasterScan = config === DEFAULT_BLE_CONFIG;
      activeConfig = normalizeBleConfig(config);
      const expectedName = normalizeDeviceName(activeConfig.bleName);
      cancelScan?.();
      onStatus('掃描中...');
      cancelScan = scanForDevices(
        manager,
        activeConfig.serviceUuid,
        foundDevice => {
          const foundName = foundDevice.name || foundDevice.localName;
          const normalizedName = normalizeDeviceName(foundName);
          console.info('BLE 廣播', {
            id: foundDevice.id,
            name: foundName || null,
            localName: foundDevice.localName || null,
            serviceUUIDs: foundDevice.serviceUUIDs || [],
          });
          const isDogGpsMaster = /^doggpsmaster[0-9]+$/.test(normalizedName);
          if (
            (manualMasterScan && isDogGpsMaster) ||
            (!manualMasterScan && normalizedName === expectedName)
          ) {
            onDevice(foundDevice);
          }
        },
        error => onStatus(`掃描失敗：${error.message}`),
        () => {
          cancelScan = null;
          onStatus('掃描完成');
          onFinished?.();
        },
      );
    },

    async connect(foundDevice, onStatus, onData, config = activeConfig) {
      cancelScan?.();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      manualDisconnect = false;
      reconnectAttempt = 0;
      activeConfig = normalizeBleConfig(config);
      lastDevice = foundDevice;
      lastOnStatus = onStatus;
      lastOnData = onData;
      return connectInternal(foundDevice, onStatus, onData);
    },

    async configureWifi(ssid, password) {
      if (!device || !(await device.isConnected())) {
        device = null;
        throw new Error('請先連線 DogGPS Master 裝置');
      }
      await device.writeCharacteristicWithResponseForService(
        activeConfig.serviceUuid,
        BLE_WIFI_CONFIG_UUID,
        encodeUtf8Base64(JSON.stringify({ action: 'upsert', ssid, password })),
      );
    },

    async removeWifi(ssid) {
      if (!device || !(await device.isConnected())) {
        device = null;
        throw new Error('BLE 已斷線，請等待自動重連');
      }
      await device.writeCharacteristicWithResponseForService(
        activeConfig.serviceUuid,
        BLE_WIFI_CONFIG_UUID,
        encodeUtf8Base64(JSON.stringify({ action: 'remove', ssid })),
      );
    },

    async getWifiList() {
      if (!device || !(await device.isConnected())) {
        device = null;
        throw new Error('BLE 已斷線，請等待自動重連');
      }
      const ssids = [];
      let activeSsid = '';
      let offset = 0;
      do {
        await device.writeCharacteristicWithResponseForService(
          activeConfig.serviceUuid,
          BLE_WIFI_CONFIG_UUID,
          encodeUtf8Base64(JSON.stringify({ action: 'list', offset })),
        );
        const response = await device.readCharacteristicForService(
          activeConfig.serviceUuid,
          BLE_WIFI_CONFIG_UUID,
        );
        const result = JSON.parse(decodeUtf8Base64(response.value));
        if (!result.ok || !Array.isArray(result.ssids)) {
          throw new Error(result.error || '無法讀取 Wi-Fi 清單');
        }
        if (typeof result.active === 'string') activeSsid = result.active;
        ssids.push(...result.ssids);
        offset = Number.isInteger(result.next) ? result.next : null;
      } while (offset !== null);
      return { ssids, activeSsid };
    },

    disconnect() {
      manualDisconnect = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      cancelScan?.();
      monitorSubscription?.remove();
      disconnectSubscription?.remove();
      device?.cancelConnection();
      device = null;
      lastDevice = null;
      stopBackgroundService();
    },
  };
}
