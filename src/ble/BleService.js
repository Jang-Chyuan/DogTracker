import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager } from 'react-native-ble-plx';
import { parseBlePayload } from './BleParser';
import { toDogStatus } from '../models/DogStatus';
import { scanForDevice } from './BleScanner';

export const BLE_DEVICE_NAME = 'DogGPS-Master3';
export const BLE_SERVICE_UUID = '7f510001-6d9e-4e2f-a671-8f3f2d49a001';
export const BLE_DATA_UUID = '7f510002-6d9e-4e2f-a671-8f3f2d49a001';

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
  let buffer = '';

  return {
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
      if (device) device.cancelConnection();
      manager.destroy();
    },
  };
}
