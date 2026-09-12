import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

export default function WifiSettingsScreen({ bleService, masterName = 'DogGPS Master', onBack }) {
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [deletingSsid, setDeletingSsid] = useState('');
  const [wifiList, setWifiList] = useState([]);
  const [activeSsid, setActiveSsid] = useState('');
  const [message, setMessage] = useState('');
  const connected = bleService.isConnected();

  const loadWifiList = async () => {
    if (!connected) return;
    setLoading(true);
    setMessage('');
    try {
      const result = await bleService.getWifiList();
      setWifiList(result.ssids);
      setActiveSsid(result.activeSsid);
    } catch (error) {
      setMessage(`讀取失敗：${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWifiList();
    // Only load when this screen is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    const trimmedSsid = ssid.trim();
    if (!trimmedSsid) {
      setMessage('請輸入 Wi-Fi 名稱（SSID）');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      await bleService.configureWifi(trimmedSsid, password);
      setMessage(`Wi-Fi 設定已傳送至 ${masterName}`);
      await loadWifiList();
    } catch (error) {
      setMessage(`傳送失敗：${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const removeWifi = network => {
    Alert.alert(
      '刪除 Wi-Fi',
      `確定要從 ${masterName} 刪除「${network}」嗎？`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '刪除',
          style: 'destructive',
          onPress: async () => {
            setDeletingSsid(network);
            setMessage('');
            try {
              await bleService.removeWifi(network);
              if (ssid === network) {
                setSsid('');
                setPassword('');
              }
              setWifiList(current => current.filter(item => item !== network));
              setMessage(`已刪除 ${network}`);
            } catch (error) {
              setMessage(`刪除失敗：${error.message}`);
            } finally {
              setDeletingSsid('');
            }
          },
        },
      ],
    );
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>{masterName} Wi-Fi 設定</Text>
        <Pressable onPress={onBack} hitSlop={12}><Text style={styles.link}>返回</Text></Pressable>
      </View>
      <Text style={[styles.status, connected ? styles.connected : styles.disconnected]}>
        {connected ? 'BLE 已連線' : 'BLE 尚未連線，請先返回主畫面連線'}
      </Text>
      <View style={styles.listHeader}>
        <Text style={styles.sectionTitle}>{masterName} 現有網路</Text>
        <Pressable disabled={!connected || loading} onPress={loadWifiList}>
          <Text style={styles.link}>{loading ? '讀取中…' : '重新整理'}</Text>
        </Pressable>
      </View>
      <Text style={styles.activeNetwork}>
        目前使用：{activeSsid || '未連接 Wi-Fi'}
      </Text>
      {loading ? <ActivityIndicator color="#93c5fd" style={styles.loader} /> : null}
      {!loading && wifiList.length === 0 ? <Text style={styles.empty}>尚無已儲存的 Wi-Fi</Text> : null}
      {wifiList.map(network => (
        <View key={network} style={styles.networkRow}>
          <Pressable onPress={() => setSsid(network)} style={styles.networkSelect}>
            <Text style={styles.networkName}>{network}</Text>
            <Text style={network === activeSsid ? styles.activeBadge : styles.selectText}>
              {network === activeSsid ? '使用中' : '選用'}
            </Text>
          </Pressable>
          <Pressable
            disabled={deletingSsid !== ''}
            hitSlop={8}
            onPress={() => removeWifi(network)}
            style={styles.deleteButton}
          >
            {deletingSsid === network
              ? <ActivityIndicator color="#fca5a5" size="small" />
              : <Text style={styles.deleteText}>刪除</Text>}
          </Pressable>
        </View>
      ))}
      <Text style={styles.label}>Wi-Fi 名稱（SSID）</Text>
      <TextInput autoCapitalize="none" autoCorrect={false} onChangeText={setSsid} placeholder="輸入 SSID" placeholderTextColor="#64748b" style={styles.input} value={ssid} />
      <Text style={styles.label}>Wi-Fi 密碼</Text>
      <View style={styles.passwordRow}>
        <TextInput autoCapitalize="none" autoCorrect={false} onChangeText={setPassword} placeholder="輸入密碼" placeholderTextColor="#64748b" secureTextEntry={!showPassword} style={[styles.input, styles.passwordInput]} value={password} />
        <Pressable onPress={() => setShowPassword(value => !value)} style={styles.showButton}><Text style={styles.link}>{showPassword ? '隱藏' : '顯示'}</Text></Pressable>
      </View>
      <Pressable disabled={!connected || saving} onPress={save} style={({ pressed }) => [styles.saveButton, (!connected || saving) && styles.disabled, pressed && styles.pressed]}>
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>傳送設定</Text>}
      </Pressable>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      <Text style={styles.hint}>只讀取網路名稱，{masterName} 不會傳回已儲存的密碼。</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#111827', borderColor: '#374151', borderRadius: 16, borderWidth: 1, padding: 18 },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  title: { color: '#f8fafc', fontSize: 22, fontWeight: '700' }, link: { color: '#93c5fd', fontSize: 15 },
  status: { borderRadius: 8, marginBottom: 18, padding: 10 }, connected: { backgroundColor: '#14532d', color: '#bbf7d0' }, disconnected: { backgroundColor: '#7f1d1d', color: '#fecaca' },
  listHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }, sectionTitle: { color: '#f8fafc', fontSize: 16, fontWeight: '700' },
  loader: { marginVertical: 12 }, empty: { color: '#94a3b8', marginBottom: 18 }, networkRow: { alignItems: 'center', backgroundColor: '#1f2937', borderRadius: 8, flexDirection: 'row', marginBottom: 8 }, networkSelect: { alignItems: 'center', flex: 1, flexDirection: 'row', padding: 11 }, networkName: { color: '#e2e8f0', flex: 1 }, selectText: { color: '#93c5fd', marginLeft: 12 },
  deleteButton: { alignItems: 'center', borderLeftColor: '#4b5563', borderLeftWidth: 1, justifyContent: 'center', minHeight: 48, paddingHorizontal: 12 }, deleteText: { color: '#fca5a5', fontWeight: '700' },
  activeNetwork: { color: '#86efac', marginBottom: 12 }, activeBadge: { backgroundColor: '#166534', borderRadius: 8, color: '#bbf7d0', marginLeft: 12, overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 3 },
  label: { color: '#cbd5e1', fontSize: 14, marginBottom: 7, marginTop: 8 }, input: { backgroundColor: '#1f2937', borderColor: '#4b5563', borderRadius: 10, borderWidth: 1, color: '#fff', fontSize: 16, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 12 },
  passwordRow: { flexDirection: 'row' }, passwordInput: { flex: 1 }, showButton: { alignItems: 'center', height: 48, justifyContent: 'center', marginLeft: 8, paddingHorizontal: 12 },
  saveButton: { alignItems: 'center', backgroundColor: '#2563eb', borderRadius: 12, minHeight: 48, justifyContent: 'center', marginTop: 8 }, saveText: { color: '#fff', fontSize: 16, fontWeight: '700' }, disabled: { opacity: 0.45 }, pressed: { opacity: 0.8 },
  message: { color: '#e2e8f0', marginTop: 14, textAlign: 'center' }, hint: { color: '#94a3b8', fontSize: 12, marginTop: 18, textAlign: 'center' },
});
