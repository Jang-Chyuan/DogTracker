import React, { useEffect, useRef, useState } from 'react';
import {
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
  NativeModules,
} from 'react-native';
import { createBleService } from './src/ble/BleService';
import { createDogDatabase } from './src/database/DogDatabase';
import { emptyDogStatus } from './src/models/DogStatus';
import DataTableScreen from './src/screens/DataTableScreen';
import WifiSettingsScreen from './src/screens/WifiSettingsScreen';

const DATABASE_SAVE_INTERVAL_MS = 1000;

export default function App() {
  const [bleService] = useState(() => createBleService());
  const [dogDatabase] = useState(() => createDogDatabase());
  const databaseReadyRef = useRef(null);
  const lastSavedAtRef = useRef(0);
  const [screen, setScreen] = useState('scan');
  const [devices, setDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [bleStatus, setBleStatus] = useState('尚未掃描');
  const [bleData, setBleData] = useState(emptyDogStatus);
  const [updatedAt, setUpdatedAt] = useState('-');

  useEffect(() => {
    databaseReadyRef.current = dogDatabase.initialize();
    databaseReadyRef.current.catch(error => console.error('SQLite 初始化失敗', error));
  }, [bleService, dogDatabase]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (screen === 'wifi' || screen === 'data') setScreen('menu');
      else if (screen === 'connect' || screen === 'menu') setScreen('scan');
      else NativeModules.BleBackground?.moveToBackground();
      return true;
    });
    return () => subscription.remove();
  }, [screen]);

  const receiveData = (nextData, payload) => {
    setBleData(nextData);
    setUpdatedAt(new Date().toLocaleTimeString('zh-TW', { hour12: false }));
    const now = Date.now();
    if (now - lastSavedAtRef.current < DATABASE_SAVE_INTERVAL_MS) return;
    lastSavedAtRef.current = now;
    databaseReadyRef.current
      ?.then(() => dogDatabase.saveStatus(nextData, payload))
      .catch(error => console.error('儲存 BLE 資料失敗', error));
  };

  const scan = async () => {
    setDevices([]);
    setSelectedDevice(null);
    setScanning(true);
    await bleService.scan(
      setBleStatus,
      device => setDevices(current => current.some(item => item.id === device.id)
        ? current
        : [...current, device]),
      () => setScanning(false),
    );
  };

  const connectAndSubscribe = async () => {
    if (!selectedDevice) return;
    setConnecting(true);
    const ok = await bleService.connect(selectedDevice, status => {
      setBleStatus(status);
      if (status.startsWith('BLE 已斷線')) setConnected(false);
      if (status.startsWith('已連線並訂閱')) setConnected(true);
    }, receiveData);
    setConnecting(false);
    setConnected(ok);
    if (ok) setScreen('menu');
  };

  const steps = [
    { key: 'scan', number: 1, label: '掃描' },
    { key: 'connect', number: 2, label: '連線訂閱' },
    { key: 'menu', number: 3, label: '功能' },
  ];
  const activeStep = screen === 'scan' ? 1 : screen === 'connect' ? 2 : 3;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#0f172a" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>DogTracker</Text>
          <View style={styles.steps}>
            {steps.map(step => (
              <View key={step.key} style={styles.step}>
                <View style={[styles.stepCircle, activeStep >= step.number && styles.stepCircleActive]}>
                  <Text style={styles.stepNumber}>{step.number}</Text>
                </View>
                <Text style={[styles.stepLabel, activeStep === step.number && styles.stepLabelActive]}>{step.label}</Text>
              </View>
            ))}
          </View>

          {screen === 'scan' ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>1. 掃描 BLE 裝置</Text>
              <Text style={styles.status}>{bleStatus}</Text>
              <Pressable disabled={scanning} onPress={scan} style={[styles.primaryButton, scanning && styles.disabled]}>
                <Text style={styles.buttonText}>{scanning ? '掃描中...' : '開始掃描'}</Text>
              </Pressable>
              {devices.map(device => (
                <Pressable
                  key={device.id}
                  onPress={() => { setSelectedDevice(device); setScreen('connect'); }}
                  style={styles.deviceRow}
                >
                  <View style={styles.flex}>
                    <Text style={styles.deviceName}>{device.name || device.localName || '未命名裝置'}</Text>
                    <Text style={styles.deviceId}>{device.id}</Text>
                  </View>
                  <Text style={styles.select}>選擇 ›</Text>
                </Pressable>
              ))}
              {!scanning && devices.length === 0 ? <Text style={styles.hint}>按下開始掃描以尋找 DogGPS 裝置。</Text> : null}
            </View>
          ) : null}

          {screen === 'connect' ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>2. 連線並訂閱</Text>
              <Text style={styles.label}>選擇的裝置</Text>
              <Text style={styles.deviceName}>{selectedDevice?.name || selectedDevice?.localName || '-'}</Text>
              <Text style={styles.deviceId}>{selectedDevice?.id || '-'}</Text>
              <Text style={styles.status}>{bleStatus}</Text>
              <Pressable disabled={connecting} onPress={connectAndSubscribe} style={[styles.primaryButton, connecting && styles.disabled]}>
                <Text style={styles.buttonText}>{connecting ? '連線中...' : '連線並訂閱資料'}</Text>
              </Pressable>
              <Pressable onPress={() => setScreen('scan')} style={styles.secondaryButton}>
                <Text style={styles.secondaryText}>返回重新掃描</Text>
              </Pressable>
            </View>
          ) : null}

          {screen === 'menu' ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>3. 選擇功能</Text>
              <Text style={styles.connected}>● {connected ? 'BLE 已連線並訂閱' : 'BLE 未連線'}</Text>
              <Text style={styles.hint}>最後資料：{updatedAt}　Master {bleData.masterId ?? '-'} / Slave {bleData.slaveId ?? '-'}</Text>
              <Pressable onPress={() => setScreen('data')} style={styles.menuButton}>
                <Text style={styles.menuTitle}>即時資料顯示</Text>
                <Text style={styles.menuDescription}>SQLite 表格、最近 100 筆、可選欄位</Text>
              </Pressable>
              <Pressable onPress={() => setScreen('wifi')} style={styles.menuButton}>
                <Text style={styles.menuTitle}>Wi-Fi 設定</Text>
                <Text style={styles.menuDescription}>查看、新增或刪除 Master3 Wi-Fi</Text>
              </Pressable>
              <Pressable
                onPress={() => NativeModules.BleBackground?.moveToBackground()}
                style={styles.backgroundButton}
              >
                <Text style={styles.buttonText}>切到背景執行</Text>
              </Pressable>
              <Pressable onPress={() => setScreen('scan')} style={styles.secondaryButton}>
                <Text style={styles.secondaryText}>返回裝置掃描</Text>
              </Pressable>
            </View>
          ) : null}

          {screen === 'data' ? <DataTableScreen dogDatabase={dogDatabase} onBack={() => setScreen('menu')} /> : null}
          {screen === 'wifi' ? <WifiSettingsScreen bleService={bleService} onBack={() => setScreen('menu')} /> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: '#0f172a', flex: 1 },
  flex: { flex: 1 },
  container: { backgroundColor: '#0f172a', flexGrow: 1, padding: 18, paddingBottom: 36 },
  title: { color: '#f8fafc', fontSize: 28, fontWeight: '800', marginBottom: 18 },
  steps: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 20 },
  step: { alignItems: 'center', flex: 1 },
  stepCircle: { alignItems: 'center', backgroundColor: '#334155', borderRadius: 16, height: 32, justifyContent: 'center', width: 32 },
  stepCircleActive: { backgroundColor: '#2563eb' },
  stepNumber: { color: '#fff', fontWeight: '700' },
  stepLabel: { color: '#64748b', fontSize: 12, marginTop: 5 },
  stepLabelActive: { color: '#bfdbfe', fontWeight: '700' },
  card: { backgroundColor: '#111827', borderColor: '#374151', borderRadius: 16, borderWidth: 1, padding: 18 },
  cardTitle: { color: '#f8fafc', fontSize: 21, fontWeight: '700', marginBottom: 14 },
  status: { color: '#cbd5e1', marginBottom: 14 },
  label: { color: '#94a3b8', fontSize: 12, marginBottom: 4 },
  primaryButton: { alignItems: 'center', backgroundColor: '#2563eb', borderRadius: 11, padding: 14 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  secondaryButton: { alignItems: 'center', marginTop: 14, padding: 10 },
  secondaryText: { color: '#93c5fd', fontWeight: '600' },
  disabled: { opacity: 0.5 },
  deviceRow: { alignItems: 'center', backgroundColor: '#1f2937', borderRadius: 10, flexDirection: 'row', marginTop: 10, padding: 13 },
  deviceName: { color: '#f8fafc', fontSize: 16, fontWeight: '700' },
  deviceId: { color: '#94a3b8', fontSize: 11, marginTop: 4 },
  select: { color: '#93c5fd', fontWeight: '700', marginLeft: 10 },
  hint: { color: '#94a3b8', fontSize: 12, marginTop: 12 },
  connected: { color: '#86efac', marginBottom: 4 },
  menuButton: { backgroundColor: '#1e3a8a', borderColor: '#3b82f6', borderRadius: 12, borderWidth: 1, marginTop: 14, padding: 16 },
  menuTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  menuDescription: { color: '#bfdbfe', fontSize: 12, marginTop: 5 },
  backgroundButton: { alignItems: 'center', backgroundColor: '#15803d', borderRadius: 11, marginTop: 16, padding: 14 },
});
