import React, { useEffect, useRef, useState } from 'react';
import {
  PermissionsAndroid,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { decode as decodeBase64 } from 'base-64';
import { BleManager } from 'react-native-ble-plx';

const FONT_SCALE = 1.4;
const BLE_DEVICE_NAME = 'DogGPS-Master3';
const BLE_SERVICE_UUID = '7f510001-6d9e-4e2f-a671-8f3f2d49a001';
const BLE_DATA_UUID = '7f510002-6d9e-4e2f-a671-8f3f2d49a001';

export default function App() {
  const [bleManager] = useState(() => new BleManager());
  const blePayloadBuffer = useRef('');
  const bleReadTimer = useRef(null);
  const [bleStatus, setBleStatus] = useState('未連線');
  const [bleData, setBleData] = useState(null);
  const [blePayloadText, setBlePayloadText] = useState('');

  useEffect(() => () => {
    if (bleReadTimer.current) clearInterval(bleReadTimer.current);
    bleManager.destroy();
  }, [bleManager]);

  const requestBlePermissions = async () => {
    if (Platform.OS !== 'android') return true;

    if (Platform.Version < 31) {
      const locationPermission = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        {
          title: '需要位置權限',
          message: 'Android 8.1 需要位置權限才能掃描附近的 BLE 裝置。',
          buttonPositive: '允許',
          buttonNegative: '拒絕',
        },
      );

      return locationPermission === PermissionsAndroid.RESULTS.GRANTED;
    }

    const permissions = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    ]);

    return Object.values(permissions).every(
      (permission) => permission === PermissionsAndroid.RESULTS.GRANTED,
    );
  };

  const connectToDogGps = async () => {
    const permissionsGranted = await requestBlePermissions();
    if (!permissionsGranted) {
      setBleStatus('未授予 BLE 掃描權限');
      return;
    }

    setBleStatus('掃描中...');
    bleManager.stopDeviceScan();

    const scanTimeout = setTimeout(() => {
      bleManager.stopDeviceScan();
      setBleStatus('找不到裝置');
    }, 10000);

    bleManager.startDeviceScan(
      [BLE_SERVICE_UUID],
      null,
      async (error, device) => {
        if (error) {
          clearTimeout(scanTimeout);
          setBleStatus(`掃描失敗: ${error.message}`);
          return;
        }

        if (!device || (device.name !== BLE_DEVICE_NAME && device.localName !== BLE_DEVICE_NAME)) {
          return;
        }

        clearTimeout(scanTimeout);
        bleManager.stopDeviceScan();
        setBleStatus('連線中...');

        try {
          const connectedDevice = await device.connect();
          await connectedDevice.discoverAllServicesAndCharacteristics();
          blePayloadBuffer.current = '';
          setBleStatus(`已連線: ${BLE_DEVICE_NAME}`);

          const initialCharacteristic = await connectedDevice.readCharacteristicForService(
            BLE_SERVICE_UUID,
            BLE_DATA_UUID,
          );
          const updateFromCharacteristic = (characteristic) => {
            if (!characteristic?.value) return;

            const payload = decodeBase64(characteristic.value)
              .replace(/\0/g, '')
              .trim();
            setBlePayloadText(payload);

            try {
              const nextData = JSON.parse(payload);
              setBleData(nextData);
            } catch (parseError) {
              setBleStatus(`BLE 資料格式錯誤: ${parseError.message}`);
            }
          };

          updateFromCharacteristic(initialCharacteristic);

          if (bleReadTimer.current) clearInterval(bleReadTimer.current);
          bleReadTimer.current = setInterval(async () => {
            try {
              const latestCharacteristic = await connectedDevice.readCharacteristicForService(
                BLE_SERVICE_UUID,
                BLE_DATA_UUID,
              );
              updateFromCharacteristic(latestCharacteristic);
            } catch {
            }
          }, 2000);

          connectedDevice.monitorCharacteristicForService(
            BLE_SERVICE_UUID,
            BLE_DATA_UUID,
            (monitorError, characteristic) => {
              if (monitorError) {
                setBleStatus(`通知失敗: ${monitorError.message}`);
                return;
              }

              if (!characteristic?.value) return;

              try {
                const decodedPayload = decodeBase64(characteristic.value)
                  .replace(/\0/g, '')
                  .trim();
                blePayloadBuffer.current += decodedPayload;

                if (!blePayloadBuffer.current.endsWith('}')) return;

                const nextData = JSON.parse(blePayloadBuffer.current);
                setBlePayloadText(blePayloadBuffer.current);
                blePayloadBuffer.current = '';
                setBleData(nextData);
              } catch (parseError) {
                blePayloadBuffer.current = '';
                setBleStatus(`BLE 資料格式錯誤: ${parseError.message}`);
              }
            },
          );
        } catch (connectionError) {
          setBleStatus(`連線失敗: ${connectionError.message}`);
        }
      },
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#111827" />

      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>DogTracker Test</Text>
        <Text style={styles.subtitle}>LoRa GPS + BLE 即時資料</Text>

        <View style={styles.card}>
          <Text style={styles.label}>BLE 裝置</Text>
          <Text style={styles.value}>{bleStatus}</Text>
          <Pressable
            style={({ pressed }) => [
              styles.button,
              styles.bleButton,
              pressed && styles.buttonPressed,
            ]}
            onPress={connectToDogGps}
          >
            <Text style={styles.buttonText}>掃描並連線 DogGPS-Master3</Text>
          </Pressable>
          {bleData?.lat !== undefined || bleData?.slave_lat !== undefined ? (
            <View>
              <Text style={styles.meta}>
                Slave GPS: {bleData.slave_lat ?? bleData.lat}, {bleData.slave_lon ?? bleData.lon}
              </Text>
              <Text style={styles.meta}>
                Master GPS: {bleData.master_lat ?? '-'}, {bleData.master_lon ?? '-'}
              </Text>
              <Text style={styles.meta}>
                距離: {bleData.distance_m ?? '-'} m | 速度: {bleData.speed_kmh ?? '-'} km/h
              </Text>
              <Text style={styles.meta}>
                衛星: {bleData.sat ?? '-'} | HDOP: {bleData.hdop ?? '-'}
              </Text>
              <Text style={styles.meta}>
                活動: {bleData.activity ?? '-'} | 有效: {bleData.activity_valid ? '是' : '否'}
              </Text>
              <Text style={styles.meta}>
                GPS 時間: {bleData.gps_time ?? '-'} | 活動時間: {bleData.activity_time ?? '-'}
              </Text>
              <Text style={styles.meta}>
                電池: {bleData.battery_mv ?? '-'} mV | {bleData.battery_pct ?? '-'}%
                {' '}({bleData.battery_valid ? '有效' : '無效'})
              </Text>
              <Text style={styles.meta}>
                封包: type {bleData.type ?? '-'} | seq {bleData.seq ?? '-'} | len {bleData.len ?? '-'}
              </Text>
            </View>
          ) : blePayloadText ? (
            <Text style={styles.meta}>資料: {blePayloadText}</Text>
          ) : null}
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  container: {
    padding: 20,
    paddingBottom: 36,
    backgroundColor: '#0f172a',
  },
  title: {
    fontSize: 28 * FONT_SCALE,
    fontWeight: '700',
    color: '#f8fafc',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14 * FONT_SCALE,
    color: '#94a3b8',
    marginBottom: 18,
  },
  card: {
    backgroundColor: '#111827',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#374151',
    marginBottom: 18,
  },
  label: {
    color: '#9ca3af',
    fontSize: 12 * FONT_SCALE,
    marginBottom: 6,
  },
  value: {
    color: '#f8fafc',
    fontSize: 26 * FONT_SCALE,
    fontWeight: '700',
    marginBottom: 10,
  },
  meta: {
    color: '#cbd5e1',
    fontSize: 13 * FONT_SCALE,
    marginTop: 2,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 14,
  },
  button: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: {
    backgroundColor: '#2563eb',
  },
  secondaryButton: {
    backgroundColor: '#16a34a',
  },
  bleButton: {
    backgroundColor: '#f97316',
    flex: 0,
    marginTop: 8,
  },
  resetButton: {
    backgroundColor: '#374151',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 18,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15 * FONT_SCALE,
  },
  resetText: {
    color: '#f8fafc',
    fontWeight: '700',
    fontSize: 15 * FONT_SCALE,
  },
  buttonPressed: {
    opacity: 0.8,
  },
  listHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionTitle: {
    color: '#f8fafc',
    fontSize: 18 * FONT_SCALE,
    fontWeight: '700',
  },
  sectionHint: {
    color: '#94a3b8',
    fontSize: 12 * FONT_SCALE,
  },
  list: {
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#111827',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#374151',
    marginBottom: 10,
  },
  rowTitle: {
    color: '#f8fafc',
    fontWeight: '600',
    fontSize: 14 * FONT_SCALE,
  },
  rowText: {
    color: '#cbd5e1',
    fontSize: 13 * FONT_SCALE,
    marginTop: 4,
  },
  rowRight: {
    alignItems: 'flex-end',
  },
  speed: {
    color: '#93c5fd',
    fontWeight: '700',
    fontSize: 14 * FONT_SCALE,
  },
  time: {
    color: '#94a3b8',
    fontSize: 12 * FONT_SCALE,
    marginTop: 4,
  },
});
