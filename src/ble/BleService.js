import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager } from 'react-native-ble-plx';
import { parseBlePayload } from './BleParser';
import { toDogStatus } from '../models/DogStatus';
import { scanForDevice } from './BleScanner';
import { decode as decodeBase64, encode as encodeBase64 } from 'base-64';

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
    (permission) => permission === PermissionsAndroid.RESULTS.GRANTED,
  );
}

export function createBleService(manager = new BleManager()) {
  let device = null;
  let cancelScan = null;
  let monitorSubscription = null;
  let disconnectSubscription = null;
  let buffer = '';

  return {
    isConnected() {
      return device !== null;
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
        throw new Error('BLE 已斷線，請返回主畫面重新連線');
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
        throw new Error('BLE 已斷線，請返回主畫面重新連線');
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

    async connect(onStatus, onData) {
      if (!(await requestPermissions())) {
        onStatus('未授予 BLE 掃描權限');
        return;
      }

      onStatus('掃描中...');
      cancelScan = scanForDevice(
        manager,
        BLE_DEVICE_NAME,
        BLE_SERVICE_UUID,
        async (foundDevice) => {
          try {
            onStatus('連線中...');
            device = await foundDevice.connect();
            await device.requestMTU(247);
            await device.discoverAllServicesAndCharacteristics();
            if (disconnectSubscription) disconnectSubscription.remove();
            disconnectSubscription = manager.onDeviceDisconnected(
              device.id,
              (error) => {
                device = null;
                if (monitorSubscription) {
                  monitorSubscription.remove();
                  monitorSubscription = null;
                }
                onStatus(error
                  ? `BLE 已斷線：${error.message}`
                  : 'BLE 已斷線，請重新連線');
              },
            );
            buffer = '';
            onStatus(`已連線: ${BLE_DEVICE_NAME}`);

            const initial = await device.readCharacteristicForService(
              BLE_SERVICE_UUID,
              BLE_DATA_UUID,
            );
            this._handleValue(initial?.value, onData);

            monitorSubscription = device.monitorCharacteristicForService(
              BLE_SERVICE_UUID,
              BLE_DATA_UUID,
              (error, characteristic) => {
                if (error) {
                  onStatus(`通知失敗: ${error.message}`);
                  return;
                }
                this._handleValue(characteristic?.value, onData, onStatus);
              },
            );
          } catch (error) {
            onStatus(`連線失敗: ${error.message}`);
          }
        },
        (error) => onStatus(error.message),
      );
    },

    _handleValue(value, onData, onStatus = () => {}) {
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
        const data = JSON.parse(combined.slice(start, end + 1));
        buffer = combined.slice(end + 1);
        onData(toDogStatus(data), combined.slice(start, end + 1));
      } catch (error) {
        buffer = '';
        onStatus(`BLE 資料格式錯誤: ${error.message}`);
      }
    },

    disconnect() {
      if (cancelScan) cancelScan();
      if (monitorSubscription) monitorSubscription.remove();
      if (disconnectSubscription) disconnectSubscription.remove();
      if (device) device.cancelConnection();
      device = null;
      manager.destroy();
    },
  };
}
