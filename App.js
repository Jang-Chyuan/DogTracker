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
import { createBleService, DEFAULT_BLE_CONFIG } from './src/ble/BleService';
import { createDogDatabase } from './src/database/DogDatabase';
import { getDeviceProfile } from './src/config/DeviceProfiles';
import { parseMasterQr } from './src/qr/MasterQrParser';
import { emptyDogStatus } from './src/models/DogStatus';
import DataTableScreen from './src/screens/DataTableScreen';
import WifiSettingsScreen from './src/screens/WifiSettingsScreen';

const sharedBleService = createBleService();
const sharedDogDatabase = createDogDatabase();

export default function App() {
  const [bleService] = useState(() => sharedBleService);
  const [dogDatabase] = useState(() => sharedDogDatabase);
  const databaseReadyRef = useRef(null);
  const lastSavedAtRef = useRef(0);
  const [screen, setScreen] = useState('scan');
  const [devices, setDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [qrScanning, setQrScanning] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [backgroundRunning, setBackgroundRunning] = useState(false);
  const [bleStatus, setBleStatus] = useState('尚未掃描');
  const [bleData, setBleData] = useState(emptyDogStatus);
  const [updatedAt, setUpdatedAt] = useState('-');
  const [activeProfile, setActiveProfile] = useState(() => getDeviceProfile('default'));

  useEffect(() => {
    databaseReadyRef.current = dogDatabase.initialize();
    databaseReadyRef.current.catch(error => console.error('SQLite 初始化失敗', error));
    NativeModules.BleBackground?.isRunning?.().then(running => {
      if (!running) return;
      setBackgroundRunning(true);
      setConnected(true);
      setBleStatus('背景接收資料中');
      setScreen('scan');
    });
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
    if (now - lastSavedAtRef.current < activeProfile.databaseSaveIntervalMs) return;
    lastSavedAtRef.current = now;
    databaseReadyRef.current
      ?.then(() => dogDatabase.saveStatus(nextData, payload))
      .catch(error => console.error('儲存 BLE 資料失敗', error));
  };

  const applyProfile = profileName => {
    const profile = getDeviceProfile(profileName);
    setActiveProfile(profile);
    return profile;
  };

  const handleConnectionStatus = status => {
    setBleStatus(status);
    if (status.startsWith('BLE 已斷線')) setConnected(false);
    if (status.startsWith('已連線並訂閱')) {
      setConnected(true);
      setBackgroundRunning(true);
    }
  };

  const scan = async () => {
    setDevices([]);
    setSelectedDevice(null);
    setScanning(true);
    await bleService.scan(
      DEFAULT_BLE_CONFIG,
      setBleStatus,
      device => setDevices(current => current.some(item => item.id === device.id)
        ? current
        : [...current, device]),
      () => setScanning(false),
    );
  };

  const scanMasterQr = async () => {
    if (!NativeModules.QrScanner?.scan) {
      setBleStatus('此裝置不支援 QR Scanner');
      return;
    }
    setQrScanning(true);
    try {
      const config = parseMasterQr(await NativeModules.QrScanner.scan());
      applyProfile(config.profile);
      setDevices([]);
      setSelectedDevice(null);
      setScanning(true);
      setBleStatus(`QR 已識別 Master ${config.masterId}，正在尋找 ${config.bleName}`);

      let connectingFromQr = false;
      await bleService.scan(
        config,
        setBleStatus,
        async device => {
          if (connectingFromQr) return;
          connectingFromQr = true;
          setScanning(false);
          setSelectedDevice(device);
          setConnecting(true);

          const onQrData = (nextData, payload) => {
            if (nextData.masterId !== null && nextData.masterId !== config.masterId) {
              setBleStatus(`Master ID 不符合：QR=${config.masterId}，BLE=${nextData.masterId}`);
              bleService.disconnect();
              setConnected(false);
              setBackgroundRunning(false);
              return;
            }
            receiveData(nextData, payload);
          };

          const ok = await bleService.connect(
            device,
            handleConnectionStatus,
            onQrData,
            config,
          );
          setConnecting(false);
          setConnected(ok);
          if (ok) setScreen('menu');
        },
        () => {
          setScanning(false);
          if (!connectingFromQr) setBleStatus(`找不到 ${config.bleName}`);
        },
      );
    } catch (error) {
      if (error.code !== 'SCAN_CANCELED') {
        setBleStatus(`QR 設定失敗：${error.message}`);
      }
    } finally {
      setQrScanning(false);
    }
  };

  const connectAndSubscribe = async () => {
    if (!selectedDevice) return;
    setConnecting(true);
    const ok = await bleService.connect(selectedDevice, handleConnectionStatus, receiveData);
    setConnecting(false);
    setConnected(ok);
    if (ok) {
      applyProfile('default');
      setScreen('menu');
    }
  };

  const stopBackgroundReception = () => {
    bleService.disconnect();
    setConnected(false);
    setBackgroundRunning(false);
    setBleStatus('背景接收已停止');
  };

  const stopAndScanAgain = () => {
    stopBackgroundReception();
    setDevices([]);
    setSelectedDevice(null);
    setScreen('scan');
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
              <Pressable
                disabled={qrScanning || scanning || connecting}
                onPress={scanMasterQr}
                style={[styles.qrButton, (qrScanning || scanning || connecting) && styles.disabled]}
              >
                <Text style={styles.buttonText}>{qrScanning ? 'QR 掃描中...' : '自動 BLE QR Code 掃描'}</Text>
              </Pressable>
              <Pressable disabled={scanning} onPress={scan} style={[styles.primaryButton, scanning && styles.disabled]}>
                <Text style={styles.buttonText}>{scanning ? 'BLE 掃描中...' : '手動 BLE 掃描'}</Text>
              </Pressable>
              {backgroundRunning ? (
                <View style={styles.backgroundDeviceRow}>
                  <Pressable onPress={() => setScreen('menu')} style={styles.backgroundDeviceSelect}>
                  <View style={styles.flex}>
                    <Text style={styles.deviceName}>DogGPS-Master3</Text>
                    <Text style={styles.backgroundDeviceStatus}>
                      ● {connected ? '背景接收資料中' : '背景服務執行中，等待自動重連'}
                    </Text>
                  </View>
                  <Text style={styles.select}>選擇 ›</Text>
                  </Pressable>
                  <Pressable onPress={stopBackgroundReception} style={styles.scanStopButton}>
                    <Text style={styles.scanStopText}>停止</Text>
                  </Pressable>
                </View>
              ) : null}
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
              {!scanning && devices.length === 0 && !backgroundRunning ? <Text style={styles.hint}>可使用自動 BLE QR Code 掃描，或手動 BLE 掃描。</Text> : null}
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
              <Text style={connected ? styles.connected : styles.disconnected}>
                ● {connected ? '背景接收資料中' : 'BLE 未連線'}
              </Text>
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
              <Pressable onPress={stopBackgroundReception} style={styles.stopButton}>
                <Text style={styles.buttonText}>停止背景接收</Text>
              </Pressable>
              <Pressable onPress={stopAndScanAgain} style={styles.secondaryButton}>
                <Text style={styles.secondaryText}>停止並重新掃描</Text>
              </Pressable>
            </View>
          ) : null}

          {screen === 'data' ? (
            <DataTableScreen
              dogDatabase={dogDatabase}
              onBack={() => setScreen('menu')}
              profile={activeProfile}
            />
          ) : null}
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
  qrButton: { alignItems: 'center', backgroundColor: '#7c3aed', borderRadius: 11, marginBottom: 10, padding: 14 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  secondaryButton: { alignItems: 'center', marginTop: 14, padding: 10 },
  secondaryText: { color: '#93c5fd', fontWeight: '600' },
  disabled: { opacity: 0.5 },
  deviceRow: { alignItems: 'center', backgroundColor: '#1f2937', borderRadius: 10, flexDirection: 'row', marginTop: 10, padding: 13 },
  backgroundDeviceRow: { alignItems: 'center', backgroundColor: '#14532d', borderColor: '#22c55e', borderRadius: 10, borderWidth: 1, flexDirection: 'row', marginTop: 12, padding: 13 },
  backgroundDeviceSelect: { alignItems: 'center', flex: 1, flexDirection: 'row' },
  backgroundDeviceStatus: { color: '#86efac', fontSize: 12, marginTop: 4 },
  scanStopButton: { borderLeftColor: '#4ade80', borderLeftWidth: 1, marginLeft: 10, paddingHorizontal: 10, paddingVertical: 8 },
  scanStopText: { color: '#fecaca', fontWeight: '700' },
  deviceName: { color: '#f8fafc', fontSize: 16, fontWeight: '700' },
  deviceId: { color: '#94a3b8', fontSize: 11, marginTop: 4 },
  select: { color: '#93c5fd', fontWeight: '700', marginLeft: 10 },
  hint: { color: '#94a3b8', fontSize: 12, marginTop: 12 },
  connected: { color: '#86efac', marginBottom: 4 },
  disconnected: { color: '#fca5a5', marginBottom: 4 },
  menuButton: { backgroundColor: '#1e3a8a', borderColor: '#3b82f6', borderRadius: 12, borderWidth: 1, marginTop: 14, padding: 16 },
  menuTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  menuDescription: { color: '#bfdbfe', fontSize: 12, marginTop: 5 },
  backgroundButton: { alignItems: 'center', backgroundColor: '#15803d', borderRadius: 11, marginTop: 16, padding: 14 },
  stopButton: { alignItems: 'center', backgroundColor: '#b91c1c', borderRadius: 11, marginTop: 12, padding: 14 },
});
