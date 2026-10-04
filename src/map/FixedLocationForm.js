import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { getCloudClient } from '../cloud/CloudClient';
import { readFixedLocation, saveFixedLocation } from '../cloud/FixedLocations';

export default function FixedLocationForm({ slaveId, masterId, owner }) {
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [reload, setReload] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    const token = ++generation.current;
    setDraft(null);
    setMessage('');
    setBusy(false);
    if (!owner) return undefined;
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
  }, [owner, slaveId, masterId, reload]);

  async function save() {
    const token = generation.current;
    setBusy(true);
    setMessage('');
    try {
      const row = await saveFixedLocation(getCloudClient(), owner, draft);
      if (generation.current !== token) return;
      setDraft({ ...row, latitude: String(row.latitude), longitude: String(row.longitude) });
      setMessage('已儲存至雲端，其他手機開啟此設定即可讀取。');
    } catch (error) {
      if (generation.current === token) setMessage(`尚未同步：${error.message}`);
    } finally {
      if (generation.current === token) setBusy(false);
    }
  }
  return <View style={styles.root}>
    <Text style={styles.title}>固定位置設定 · Slave {slaveId}</Text>
    {!owner && <Text>請先至設定 → 雲端資料登入。</Text>}
    {!!draft && <>
      <Text>共用於 Master {draft.master_id} 的授權成員</Text>
      {['name', 'latitude', 'longitude'].map((key, index) => {
        const label = ['位置名稱', '緯度', '經度'][index];
        return <View key={key}>
          <Text>{label}</Text>
          <TextInput accessibilityLabel={`固定位置${label}`} value={draft[key]}
            editable={!busy} maxLength={key === 'name' ? 80 : 24}
            autoCapitalize="none" autoCorrect={false} style={styles.input}
            onChangeText={text => setDraft(current => ({ ...current, [key]: text }))} />
        </View>;
      })}
      <View style={styles.toggle}><Text>啟用固定位置</Text>
        <Switch accessibilityLabel="啟用固定位置" disabled={busy} value={draft.enabled}
          onValueChange={enabled => setDraft(current => ({ ...current, enabled }))} /></View>
      <Pressable accessibilityRole="button" disabled={busy} onPress={save} style={styles.button}>
        <Text>{busy ? '處理中…' : '儲存固定位置'}</Text>
      </Pressable>
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
