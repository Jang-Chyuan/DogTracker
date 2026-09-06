import React, { useEffect, useRef, useState } from 'react';
import {
  AppState,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { createBleService } from './src/ble/BleService';
import { createDogDatabase } from './src/database/DogDatabase';
import { emptyTrackingPoint } from './src/models/TrackingPoint';
import { createRealTrackingRepository } from './src/repositories/RealTrackingRepository';
import WifiSettingsScreen from './src/screens/WifiSettingsScreen';
import { createTrackingFeed } from './src/tracking/TrackingFeed';

const FONT_SCALE = 1.4;
const DATABASE_SAVE_INTERVAL_MS = 1000;

function canReadTracking(appState) {
  return appState === 'active' || appState === 'unknown' || appState == null;
}

export default function App() {
  const [bleService] = useState(() => createBleService());
  const [dogDatabase] = useState(() => createDogDatabase());
  const [trackingRepository] = useState(
    () => createRealTrackingRepository(dogDatabase),
  );
  const databaseReadyRef = useRef(null);
  const lastSavedAtRef = useRef(0);
  const [bleStatus, setBleStatus] = useState('未連線');
  const [trackingData, setTrackingData] = useState(emptyTrackingPoint);
  const [screen, setScreen] = useState('home');

  useEffect(() => {
    let databaseReady = false;
    let disposed = false;
    const trackingFeed = createTrackingFeed(trackingRepository, {
      onRows(rows) {
        if (!disposed) setTrackingData(rows[rows.length - 1]);
      },
      onError(error) {
        console.error('讀取 SQLite tracking 資料失敗:', error);
      },
    });
    const appStateSubscription = AppState.addEventListener(
      'change',
      nextAppState => {
        if (canReadTracking(nextAppState) && databaseReady) {
          trackingFeed.start();
        } else {
          trackingFeed.stop();
        }
      },
    );

    const initialization = dogDatabase.initialize();
    databaseReadyRef.current = initialization;
    initialization.then(() => {
      databaseReady = true;
      if (!disposed && canReadTracking(AppState.currentState)) {
        trackingFeed.start();
      }
    }).catch(error => {
      console.error('SQLite 初始化失敗:', error);
    });

    return () => {
      disposed = true;
      appStateSubscription.remove();
      trackingFeed.stop();
      bleService.disconnect();
      dogDatabase.close();
    };
  }, [bleService, dogDatabase, trackingRepository]);

  useEffect(() => {
    if (screen !== 'wifi') return undefined;

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setScreen('home');
      return true;
    });

    return () => subscription.remove();
  }, [screen]);

  const connectToDogGps = async () => {
    await bleService.connect(
      setBleStatus,
      (nextData, payload) => {
        const now = Date.now();
        if (now - lastSavedAtRef.current >= DATABASE_SAVE_INTERVAL_MS) {
          lastSavedAtRef.current = now;
          databaseReadyRef.current
            ?.then(() => dogDatabase.saveStatus(nextData, payload))
            .then(insertId => {
              console.log('SQLite 寫入成功:', insertId);
            })
            .catch(error => {
              console.error('儲存 BLE dataset 失敗:', error);
            });
        }
      },
    );
  };

  const trackingUpdatedAt = trackingData.receivedAt === null
    ? '尚未收到資料'
    : new Date(trackingData.receivedAt).toLocaleTimeString('zh-TW', {
      hour12: false,
    });

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#111827" />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
      >
        {screen === 'wifi' ? (
          <WifiSettingsScreen bleService={bleService} onBack={() => setScreen('home')} />
        ) : (
          <>
        <Text style={styles.title}>DogTracker Test</Text>
        <Text style={styles.subtitle}>LoRa GPS + SQLite 即時資料</Text>

        <View style={styles.card}>
          <Text style={styles.label}>BLE 裝置</Text>
          <Text style={styles.value}>{bleStatus}</Text>
          <Text style={styles.meta}>資料庫最後更新: {trackingUpdatedAt}</Text>
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
          {trackingData.id !== null ? (
            <View>
              <Text style={styles.meta}>
                Master ID: {trackingData.masterId ?? '-'} | Slave ID: {trackingData.slaveId ?? '-'}
              </Text>
              <Text style={styles.meta}>
                Slave GPS: {trackingData.slaveLat ?? '-'}, {trackingData.slaveLon ?? '-'}
              </Text>
              <Text style={styles.meta}>
                Master GPS: {trackingData.masterLat ?? '-'}, {trackingData.masterLon ?? '-'}
              </Text>
              <Text style={styles.meta}>
                距離: {trackingData.distanceMeters ?? '-'} m | 速度: {trackingData.speedKmh ?? '-'} km/h
              </Text>
              <Text style={styles.meta}>
                衛星: {trackingData.satellites ?? '-'} | HDOP: {trackingData.hdop ?? '-'}
              </Text>
              <Text style={styles.meta}>
                活動: {trackingData.activity ?? '-'} | 有效: {trackingData.activityValid ? '是' : '否'}
              </Text>
              <Text style={styles.meta}>
                GPS 時間: {trackingData.gpsTime ?? '-'} | 活動時間: {trackingData.activityTime ?? '-'}
              </Text>
              <Text style={styles.meta}>
                電池: {trackingData.batteryMillivolts ?? '-'} mV | {trackingData.batteryPercentage ?? '-'}%
                {' '}({trackingData.batteryValid ? '有效' : '無效'})
              </Text>
              <Text style={styles.meta}>
                Master 電池: {trackingData.masterBatteryMillivolts ?? '-'} mV | {trackingData.masterBatteryPercentage ?? '-'}%
                {' '}({trackingData.masterBatteryValid ? '有效' : '無效'})
              </Text>
              <Text style={styles.meta}>
                RSSI: {trackingData.rssi ?? '-'} | SNR: {trackingData.snr ?? '-'}
              </Text>
              <Text style={styles.meta}>
                封包: type {trackingData.type ?? '-'} | seq {trackingData.sequence ?? '-'} | len {trackingData.length ?? '-'}
              </Text>
            </View>
          ) : null}
        </View>

        <Pressable
          style={({ pressed }) => [styles.wifiButton, pressed && styles.buttonPressed]}
          onPress={() => setScreen('wifi')}
        >
          <Text style={styles.buttonText}>Master3 Wi-Fi 設定</Text>
        </Pressable>
          </>
        )}

      </ScrollView>
      </KeyboardAvoidingView>
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
  keyboardView: {
    flex: 1,
  },
  wifiButton: {
    alignItems: 'center',
    backgroundColor: '#2563eb',
    borderRadius: 12,
    paddingVertical: 14,
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
