import React, { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { getCloudClient } from '../cloud/CloudClient';
import { readFixedLocation, saveFixedLocation, unlockFixedLocation } from '../cloud/FixedLocations';

export default function FixedLocationForm({ slaveId, masterId, owner }) {
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [reload, setReload] = useState(0);
  const [password, setPassword] = useState('');
  const [askingPassword, setAskingPassword] = useState(false);
  const [unlock, setUnlock] = useState(null);
  const [foreground, setForeground] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  const generation = useRef(0);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') {
        ++generation.current;
        setUnlock(null);
        setPassword('');
        setAskingPassword(false);
      }
      setForeground(state === 'active');
    });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (!unlock) return undefined;
    const timer = setTimeout(() => {
      setUnlock(null);
      setMessage('解鎖已到期，請重新輸入密碼。');
    }, Math.max(0, unlock.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [unlock]);
  useEffect(() => {
    const token = ++generation.current;
    setDraft(null);
    setMessage('');
    setBusy(false);
    setUnlock(null);
    setPassword('');
    setAskingPassword(false);
    if (!owner || !foreground) return undefined;
    setBusy(true);
    Promise.resolve().then(() => readFixedLocation(getCloudClient(), owner, slaveId)).then(row => {
      if (generation.current !== token) return;
      setDraft(row ? { ...row, latitude: String(row.latitude), longitude: String(row.longitude) }
        : { slave_id: slaveId, master_id: masterId, name: '', latitude: '', longitude: '', enabled: true });
    }).catch(error => {
      if (generation.current === token) setMessage(`讀取失敗：${error.message}`);
    }).finally(() => {
      if (generation.current === token) setBusy(false);
    });
    return () => { generation.current = token + 1; };
  }, [owner, slaveId, masterId, reload, foreground]);

  const unlocked = !!unlock && unlock.owner === owner && unlock.slaveId === slaveId
    && unlock.masterId === masterId && unlock.expiresAt > Date.now() && foreground;
  async function verifyPassword() {
    if (busy || !password) return;
    const token = generation.current;
    const submittedPassword = password;
    setPassword('');
    setBusy(true);
    setMessage('');
    try {
      const result = await unlockFixedLocation(getCloudClient(), owner, slaveId, masterId, submittedPassword);
      if (generation.current !== token) return;
      setUnlock({ ...result, owner, slaveId, masterId });
      setAskingPassword(false);
      setMessage('已解鎖，請於五分鐘內完成儲存。');
    } catch (error) {
      if (generation.current === token) setMessage(error.message);
    } finally {
      if (generation.current === token) setBusy(false);
    }
  }

  async function save() {
    if (busy || !unlocked) return;
    const token = generation.current;
    setBusy(true);
    setMessage('');
    try {
      const row = await saveFixedLocation(getCloudClient(), owner, draft, unlock);
      if (generation.current !== token) return;
      setDraft({ ...row, latitude: String(row.latitude), longitude: String(row.longitude) });
      setUnlock(null);
      setMessage('已儲存至雲端，其他手機開啟此設定即可讀取。');
    } catch (error) {
      if (generation.current === token) {
        setUnlock(null);
        setMessage(`尚未同步：${error.message}；請重新解鎖後確認設定。`);
      }
    } finally {
      if (generation.current === token) setBusy(false);
    }
  }
  return <View style={styles.root}>
    <Text style={styles.title}>固定位置設定 · Slave {slaveId}</Text>
    {!owner && <Text>請先至設定 → 雲端資料登入。</Text>}
    {!!draft && <>
      <Text>共用於 Master {draft.master_id} 的授權成員</Text>
      {!unlocked && !askingPassword && <Pressable accessibilityRole="button"
        accessibilityLabel="修改固定位置設定" disabled={busy}
        onPress={() => { setAskingPassword(true); setMessage(''); }} style={styles.button}>
        <Text>修改設定</Text>
      </Pressable>}
      {!unlocked && askingPassword && <>
        <Text>請輸入目前登入的雲端帳號密碼</Text>
        <TextInput accessibilityLabel="雲端帳號密碼" value={password} secureTextEntry
          editable={!busy} autoCapitalize="none" autoCorrect={false} maxLength={4096}
          onChangeText={setPassword} style={styles.input} />
        <Pressable accessibilityRole="button" accessibilityLabel="解鎖固定位置設定"
          disabled={busy || !password} onPress={verifyPassword} style={styles.button}>
          <Text>{busy ? '驗證中…' : '解鎖設定'}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" disabled={busy} accessibilityLabel="取消密碼驗證"
          onPress={() => { setAskingPassword(false); setPassword(''); setMessage(''); }} style={styles.button}>
          <Text>取消</Text>
        </Pressable>
      </>}
      {['name', 'latitude', 'longitude'].map((key, index) => {
        const label = ['位置名稱', '緯度', '經度'][index];
        return <View key={key}>
          <Text>{label}</Text>
          <TextInput accessibilityLabel={`固定位置${label}`} value={draft[key]}
            editable={unlocked && !busy} maxLength={key === 'name' ? 80 : 24}
            autoCapitalize="none" autoCorrect={false} style={styles.input}
            onChangeText={text => { if (unlocked && !busy) setDraft(current => ({ ...current, [key]: text })); }} />
        </View>;
      })}
      <View style={styles.toggle}><Text>啟用固定位置</Text>
        <Switch accessibilityLabel="啟用固定位置" disabled={busy || !unlocked} value={draft.enabled}
          onValueChange={enabled => { if (unlocked && !busy) setDraft(current => ({ ...current, enabled })); }} /></View>
      {unlocked && <Pressable accessibilityRole="button" accessibilityLabel="儲存固定位置"
        disabled={busy} onPress={save} style={styles.button}>
        <Text>{busy ? '處理中…' : '儲存固定位置'}</Text>
      </Pressable>}
      <Text>室內、窗邊或 USB 已連接時，地圖與歷史軌跡套用此位置。儲存後約 10 秒同步。</Text>
    </>}
    {busy && !draft && <Text>讀取中…</Text>}
    {!!message && <Text accessibilityLiveRegion="polite">{message}</Text>}
    {!!owner && !draft && !busy && <Pressable accessibilityRole="button"
      onPress={() => setReload(value => value + 1)} style={styles.button}><Text>重新讀取</Text></Pressable>}
  </View>;
}
const styles = StyleSheet.create({
  root: { gap: 8, marginTop: 16 },
  title: { fontSize: 15, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: '#999', borderRadius: 8, padding: 10, color: '#222' },
  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  button: { backgroundColor: '#E3EFE9', borderRadius: 8, padding: 12, alignItems: 'center' },
});
