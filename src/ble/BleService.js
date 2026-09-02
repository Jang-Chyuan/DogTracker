import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager } from 'react-native-ble-plx';
import { decode as decodeBase64, encode as encodeBase64 } from 'base-64';
import { parseBlePayload } from './BleParser';
import { scanForDevices } from './BleScanner';
import { toDogStatus } from '../models/DogStatus';

export const BLE_DEVICE_NAME = 'DogGPS-Master3';
export const BLE_SERVICE_UUID = '7f510001-6d9e-4e2f-a671-8f3f2d49a001';
export const BLE_DATA_UUID = '7f510002-6d9e-4e2f-a671-8f3f2d49a001';
export const BLE_WIFI_CONFIG_UUID = '7f510003-6d9e-4e2f-a671-8f3f2d49a001';

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
  let buffer = '';

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

  return {
    isConnected() {
      return device !== null;
    },

    async scan(onStatus, onDevice, onFinished) {
      if (!(await requestPermissions())) {
        onStatus('未取得 BLE 掃描權限');
        onFinished?.();
        return;
      }
      if (cancelScan) cancelScan();
      onStatus('掃描中...');
      cancelScan = scanForDevices(
        manager,
        BLE_SERVICE_UUID,
        onDevice,
        error => onStatus(`掃描失敗：${error.message}`),
        () => {
          cancelScan = null;
          onStatus('掃描完成');
          onFinished?.();
        },
      );
    },

    async connect(foundDevice, onStatus, onData) {
      try {
        if (cancelScan) cancelScan();
        onStatus('連線中...');
        device = await foundDevice.connect();
        await device.requestMTU(320);
        await device.discoverAllServicesAndCharacteristics();
        disconnectSubscription?.remove();
        disconnectSubscription = manager.onDeviceDisconnected(
          device.id,
          error => {
            device = null;
            monitorSubscription?.remove();
            monitorSubscription = null;
            onStatus(error ? `BLE 已斷線：${error.message}` : 'BLE 已斷線');
          },
        );
        buffer = '';
        onStatus(`已連線並訂閱：${device.name || device.localName || device.id}`);
        const initial = await device.readCharacteristicForService(
          BLE_SERVICE_UUID,
          BLE_DATA_UUID,
        );
        handleValue(initial?.value, onData, onStatus);
        monitorSubscription?.remove();
        monitorSubscription = device.monitorCharacteristicForService(
          BLE_SERVICE_UUID,
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
        onStatus(`連線失敗：${error.message}`);
        return false;
      }
    },

    async configureWifi(ssid, password) {
      if (!device || !(await device.isConnected())) {
        device = null;
        throw new Error('請先連線 DogGPS-Master3');
      }
      const payload = JSON.stringify({ action: 'upsert', ssid, password });
      await device.writeCharacteristicWithResponseForService(
        BLE_SERVICE_UUID,
        BLE_WIFI_CONFIG_UUID,
        encodeUtf8Base64(payload),
      );
    },

    async removeWifi(ssid) {
      if (!device || !(await device.isConnected())) {
        device = null;
        throw new Error('BLE 已斷線，請重新連線');
      }
      const payload = JSON.stringify({ action: 'remove', ssid });
      await device.writeCharacteristicWithResponseForService(
        BLE_SERVICE_UUID,
        BLE_WIFI_CONFIG_UUID,
        encodeUtf8Base64(payload),
      );
    },

    async getWifiList() {
      if (!device || !(await device.isConnected())) {
        device = null;
        throw new Error('BLE 已斷線，請重新連線');
      }
      const ssids = [];
      let activeSsid = '';
      let offset = 0;
      do {
        const payload = JSON.stringify({ action: 'list', offset });
        await device.writeCharacteristicWithResponseForService(
          BLE_SERVICE_UUID,
          BLE_WIFI_CONFIG_UUID,
          encodeUtf8Base64(payload),
        );
        const response = await device.readCharacteristicForService(
          BLE_SERVICE_UUID,
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
      cancelScan?.();
      monitorSubscription?.remove();
      disconnectSubscription?.remove();
      device?.cancelConnection();
      device = null;
      manager.destroy();
    },
  };
}
