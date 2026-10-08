import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
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
  NativeModules,
} from 'react-native';
import { DEFAULT_BLE_CONFIG } from '../ble/BleService';
import { sharedBleService } from '../ble/sharedBle';
import { getDeviceProfile } from '../config/DeviceProfiles';
import { parseMasterQr } from '../qr/MasterQrParser';

// The one old hardware page v3 has not replaced yet: the BLE / QR scan
// (until D3, 053). Settings → 接收器 (S2) has the connection itself; 接收器
// Wi-Fi is on S7 and the live data table on S8. `entry` ({ screen: 'scan' |
// 'qr', key }) is the page to open, 'qr' starting the QR scanner at once;
// back from it leaves the hardware pages (onBack). backRequest: a new value
// is the page header's 「‹ 標題」, which goes back exactly like the back key.
// onConnected: a receiver was connected (back to where the user came from);
// onQrTarget(masterId): a QR code chose this receiver (settings watches its
// first packet); onMismatch({ expected, got }): another Master answered.
// While mounted it also reports the receiver service's storage error
// (onStorageError), which the map's 「位置存不進手機」 and S8 show.
export default function HardwareScreen({ dogDatabase, active = true, onBack, onStorageError, backRequest = 0,
  entry = null, onConnected, onConnectFailed, onQrTarget, onMismatch }) {
  const [bleService] = useState(() => sharedBleService);
  const databaseReadyRef = useRef(null);
  const lastSavedAtBySlaveRef = useRef(new Map());
  const [screen, setScreen] = useState('scan');
  const [devices, setDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [qrScanning, setQrScanning] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [backgroundRunning, setBackgroundRunning] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [bleStatus, setBleStatus] = useState('尚未掃描');
  const [activeProfile, setActiveProfile] = useState(() => getDeviceProfile('default'));

  useEffect(() => {
    databaseReadyRef.current = dogDatabase.initialize();
    databaseReadyRef.current.catch(error => console.error('SQLite 初始化失敗', error));
    bleService.restoreBackground(handleConnectionStatus, receiveData).then(state => {
      if (!state?.enabled) return;
      setBackgroundRunning(state.running);
      setConnected(state.connected);
      setBleStatus(state.lastStatus || '背景 BLE 正在恢復');
      setScreen('scan');
    }).catch(error => console.error('恢復背景 BLE 狀態失敗', error));
    // Initialization intentionally runs once for the shared service instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bleService, dogDatabase]);

  useEffect(() => {
    let disposed = false;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing || AppState.currentState !== 'active') return;
      refreshing = true;
      try {
        const state = await bleService.getBackgroundState();
        if (disposed || !state) return;
        setBackgroundRunning(Boolean(state.running && state.enabled));
        setConnected(Boolean(state.running && state.enabled && state.connected));
        setStorageError(state.storageError || '');
        onStorageError?.(state.storageError || null);
        if (state.enabled && !scanning && !connecting && !qrScanning) {
          setBleStatus(state.running ? state.lastStatus : (state.resumeError || '背景服務已停止，請重新連線'));
        }
      } catch (error) {
        console.error('讀取背景狀態失敗', error);
      } finally {
        refreshing = false;
      }
    };
    refresh();
    const timer = setInterval(refresh, 2000);
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') refresh();
    });
    return () => {
      disposed = true;
      clearInterval(timer);
      subscription.remove();
    };
  }, [bleService, scanning, connecting, qrScanning, onStorageError]);

  // Leaving the page stops a scan still running; a connection that finishes
  // after the user left does not navigate (onConnected) from another page.
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    if (active) return;
    bleService.stopScan?.();
    setScanning(false);
    setQrScanning(false);
  }, [active, bleService]);
  const finishConnect = ok => {
    if (ok && activeRef.current) onConnected?.();
  };

  const goBack = useRef(null);
  goBack.current = () => {
    if (screen === 'connect') setScreen('scan');
    else if (onBack) onBack();
  };
  const lastBackRequest = useRef(backRequest);
  useEffect(() => {
    if (backRequest === lastBackRequest.current) return;
    lastBackRequest.current = backRequest;
    if (active) goBack.current();
  }, [active, backRequest]);
  useEffect(() => {
    if (!active) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (screen === 'connect') setScreen('scan');
      else if (onBack) onBack();
      else if (connected || backgroundRunning) {
        NativeModules.BleBackground?.moveToBackground();
      } else {
        Alert.alert(
          '退出 DogTracker',
          '目前沒有 BLE 背景連線，確定要退出 App 嗎？',
          [
            { text: '取消', style: 'cancel' },
            { text: '退出', style: 'destructive', onPress: () => BackHandler.exitApp() },
          ],
        );
      }
      return true;
    });
    return () => subscription.remove();
  }, [active, backgroundRunning, connected, onBack, screen]);

  const receiveData = (nextData, payload, metadata) => {
    if (metadata?.persistedNatively) return;

    const slaveId = Number(nextData.slaveId);
    if (!Number.isInteger(slaveId) || slaveId <= 0) return;

    const now = Date.now();
    const lastSavedAt = lastSavedAtBySlaveRef.current.get(slaveId) ?? 0;
    if (now - lastSavedAt < activeProfile.databaseSaveIntervalMs) return;
    lastSavedAtBySlaveRef.current.set(slaveId, now);
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
    if (!NativeModules.BleBackground?.getState && status.startsWith('已連線並訂閱')) {
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
      onQrTarget?.(config.masterId);
      setDevices([]);
      setSelectedDevice(null);
      setScanning(true);
      setBleStatus(`QR 已識別 Master ${config.masterId}，正在尋找 ${config.bleName}`);

      let connectingFromQr = false;
      await bleService.scan(
        config,
        setBleStatus,
        async device => {
          if (connectingFromQr || !activeRef.current) return;
          connectingFromQr = true;
          setScanning(false);
          setSelectedDevice(device);
          setConnecting(true);

          const onQrData = (nextData, payload, metadata) => {
            if (nextData.masterId !== null && nextData.masterId !== config.masterId) {
              setBleStatus(`Master ID 不符合：QR=${config.masterId}，BLE=${nextData.masterId}`);
              bleService.disconnect();
              setConnected(false);
              setBackgroundRunning(false);
              onMismatch?.({ expected: config.masterId, got: nextData.masterId });
              return;
            }
            receiveData(nextData, payload, metadata);
          };

          const ok = await bleService.connect(
            device,
            handleConnectionStatus,
            onQrData,
            config,
          );
          setConnecting(false);
          setConnected(ok);
          // Not connected (yet): the change of receiver did not happen.
          if (!ok) onConnectFailed?.();
          finishConnect(ok);
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
      finishConnect(ok);
    }
  };

  const steps = [
    { key: 'scan', number: 1, label: '掃描' },
    { key: 'connect', number: 2, label: '連線訂閱' },
  ];
  const activeStep = screen === 'scan' ? 1 : 2;

  // Each new entry opens its page; 'qr' starts the QR scanner right away.
  const scanQr = useRef(null);
  scanQr.current = scanMasterQr;
  const entryKey = entry?.key ?? null;
  const entryScreen = entry?.screen ?? null;
  useEffect(() => {
    if (!entryScreen) return;
    setScreen(entryScreen === 'qr' ? 'scan' : entryScreen);
    if (entryScreen === 'qr') scanQr.current();
  }, [entryKey, entryScreen]);

  if (!active) return null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#0f172a" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          {(screen === 'scan' || screen === 'connect') && <View style={styles.steps}>
            {steps.map(step => (
              <View key={step.key} style={styles.step}>
                <View style={[styles.stepCircle, activeStep >= step.number && styles.stepCircleActive]}>
                  <Text style={styles.stepNumber}>{step.number}</Text>
                </View>
                <Text style={[styles.stepLabel, activeStep === step.number && styles.stepLabelActive]}>{step.label}</Text>
              </View>
            ))}
          </View>}

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
              {!scanning && devices.length === 0 ? <Text style={styles.hint}>可使用自動 BLE QR Code 掃描，或手動 BLE 掃描。</Text> : null}
            </View>
          ) : null}

          {storageError ? <Text style={styles.status}>{storageError}</Text> : null}

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
