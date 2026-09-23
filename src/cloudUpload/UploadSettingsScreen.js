import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { ActionButton, ui } from '../components/ScreenUI';

export default function UploadSettingsScreen({ upload }) {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const change = async task => {
    setBusy(true); setError('');
    try { await task(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return <View>
    <Text style={ui.title}>BLE 雲端轉送</Text>
    <Text selectable style={ui.hint}>本手機 ID：{upload.phoneId || '準備中'}</Text>
    <Text style={ui.hint}>每台 Master 固定使用 Wi-Fi 或一支指定手機。選擇本手機前，請停用 Master 韌體的 Wi-Fi 上傳，並完成雲端手機授權。此設定不會修改 Master 韌體，也不會自動備援。</Text>
    {!upload.supported && <Text style={ui.error}>BLE 轉送需要 Android 原生接收服務。</Text>}
    {!upload.owner && <Text style={ui.hint}>請先到「雲端資料」登入。</Text>}
    {upload.error || error ? <Text style={ui.error}>{error || upload.error}</Text> : null}
    {upload.owner && [...new Set([...upload.masters, ...upload.settings.map(s => s.master_id)])].sort((a, b) => a - b).map(master => {
      const mode = upload.settingsReady ? upload.settings.find(s => s.master_id === master)?.mode || 'wifi' : null;
      return <View style={ui.card} key={master}>
        <Text style={ui.heading}>Master {master} · {mode === null ? '讀取設定中…' : mode === 'phone' ? '本手機 BLE' : 'Master Wi-Fi'}</Text>
        <ActionButton title="Master Wi-Fi（本手機不轉送）" secondary disabled={busy || mode === null || mode === 'wifi'} onPress={() => change(() => upload.setMode(master, 'wifi'))} />
        <ActionButton title="本手機 BLE 轉送" disabled={busy || mode === null || mode === 'phone' || !upload.masters.includes(master)} onPress={() => change(() => upload.setMode(master, 'phone'))} />
      </View>;
    })}
    {upload.owner && <View style={ui.card}>
      <Text style={ui.heading}>上傳狀態</Text>
      <Text style={ui.hint}>待傳 {upload.counts.find(c => c.status === 'pending')?.count || 0} 筆 · 需處理 {upload.counts.find(c => c.status === 'blocked')?.count || 0} 筆</Text>
      <Text style={ui.hint}>最後成功：{upload.last ? new Date(upload.last).toLocaleString() : '尚無'}</Text>
      <Text style={ui.hint}>前景每 10 秒嘗試上傳，背景只排隊。切換為 Wi-Fi 時保留待傳資料並暫停傳送；重試沿用原 UUID。</Text>
      <ActionButton title="修正授權後重試失敗資料" disabled={busy} onPress={() => change(upload.retry)} />
    </View>}
  </View>;
}
