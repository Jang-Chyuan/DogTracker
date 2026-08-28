import React, { useEffect, useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { createBleService } from './src/ble/BleService';
import { emptyDogStatus } from './src/models/DogStatus';

const FONT_SCALE = 1.4;

export default function App() {
  const [bleService] = useState(() => createBleService());
  const [bleStatus, setBleStatus] = useState('未連線');
  const [bleData, setBleData] = useState(emptyDogStatus);
  const [blePayloadText, setBlePayloadText] = useState('');
  const [bleUpdatedAt, setBleUpdatedAt] = useState('尚未收到資料');

  useEffect(() => () => bleService.disconnect(), [bleService]);

  const connectToDogGps = async () => {
    await bleService.connect(
      setBleStatus,
      (nextData, payload) => {
        setBleData(nextData);
        setBlePayloadText(payload);
        setBleUpdatedAt(new Date().toLocaleTimeString('zh-TW', { hour12: false }));
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
          <Text style={styles.meta}>最後更新: {bleUpdatedAt}</Text>
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
          {bleData.slaveLat !== null ? (
            <View>
              <Text style={styles.meta}>
                Slave GPS: {bleData.slaveLat}, {bleData.slaveLon}
              </Text>
              <Text style={styles.meta}>
                Master GPS: {bleData.masterLat ?? '-'}, {bleData.masterLon ?? '-'}
              </Text>
              <Text style={styles.meta}>
                距離: {bleData.distanceMeters ?? '-'} m | 速度: {bleData.speedKmh ?? '-'} km/h
              </Text>
              <Text style={styles.meta}>
                衛星: {bleData.satellites ?? '-'} | HDOP: {bleData.hdop ?? '-'}
              </Text>
              <Text style={styles.meta}>
                活動: {bleData.activity ?? '-'} | 有效: {bleData.activityValid ? '是' : '否'}
              </Text>
              <Text style={styles.meta}>
                GPS 時間: {bleData.gpsTime ?? '-'} | 活動時間: {bleData.activityTime ?? '-'}
              </Text>
              <Text style={styles.meta}>
                電池: {bleData.batteryMillivolts ?? '-'} mV | {bleData.batteryPercentage ?? '-'}%
                {' '}({bleData.batteryValid ? '有效' : '無效'})
              </Text>
              <Text style={styles.meta}>
                Master 電池: {bleData.masterBatteryMillivolts ?? '-'} mV | {bleData.masterBatteryPercentage ?? '-'}%
                {' '}({bleData.masterBatteryValid ? '有效' : '無效'})
              </Text>
              <Text style={styles.meta}>
                RSSI: {bleData.rssi ?? '-'} | SNR: {bleData.snr ?? '-'}
              </Text>
              <Text style={styles.meta}>
                封包: type {bleData.type ?? '-'} | seq {bleData.sequence ?? '-'} | len {bleData.length ?? '-'} | OLED {bleData.source === 'oled' ? '是' : '否'}
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
