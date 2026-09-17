import React from 'react';
import { Text, View } from 'react-native';
import { ActionButton, ui } from '../components/ScreenUI';
import { useLocationTracker } from './useLocationTracker';

export default function LocationTrackerScreen({ foreground }) {
  const tracker = useLocationTracker(foreground);
  return <View>
    <Text style={ui.title}>手機位置記錄</Text>
    <View style={ui.card}>
      <Text style={ui.heading}>myLocationTracker</Text>
      <Text style={ui.text}>{tracker.status}</Text>
      <Text style={ui.hint}>目標每 10 秒記錄一筆，最多保留最新 80,000 筆。只存本機，不上傳雲端。開始後可在背景持續記錄；沒有新定位時不寫入。</Text>
      <Text style={ui.hint}>只接受估計精度 ≤ 5 公尺的新定位；精度不足或未知時等待，不寫入。既有歷史資料仍保留。</Text>
      <Text style={ui.hint}>系統強制停止或手機重開機後，請重新開始記錄。</Text>
      {tracker.error ? <Text accessibilityRole="alert" style={ui.error}>{tracker.error}</Text> : null}
      <ActionButton title={tracker.busy ? '處理中…' : tracker.running ? '停止記錄' : '開始記錄'} onPress={tracker.toggle} disabled={tracker.busy || tracker.loading} />
      <Text style={ui.text}>已儲存 {tracker.total.toLocaleString()} / 80,000 筆 · 第 {tracker.page} 頁</Text>
      <ActionButton title="回到最新資料" onPress={tracker.refresh} secondary />
      <ActionButton title="上一頁" onPress={tracker.previous} disabled={tracker.page === 1 || tracker.loading} secondary />
      <ActionButton title="下一頁" onPress={tracker.next} disabled={!tracker.hasMore || tracker.loading} secondary />
    </View>
    {!tracker.rows.length && !tracker.loading ? <Text style={ui.hint}>尚無定位記錄</Text> : null}
    {tracker.rows.map(row => <View key={row.id} style={ui.card}>
      <Text style={ui.heading}>#{row.id} · {new Date(row.location_at).toLocaleString()}</Text>
      <Text style={ui.text}>{row.latitude.toFixed(6)}, {row.longitude.toFixed(6)}</Text>
      <Text style={ui.text}>精度 {row.accuracy_meters == null ? '—' : row.accuracy_meters.toFixed(1) + ' m'} · 速度 {row.speed_kmh == null ? '—' : row.speed_kmh.toFixed(1) + ' km/h'}</Text>
      <Text style={ui.hint}>海拔 {row.altitude_meters ?? '—'} m · 方向 {row.heading_degrees ?? '—'}°</Text>
      <Text style={ui.hint}>寫入時間 {new Date(row.recorded_at).toLocaleString()}</Text>
    </View>)}
  </View>;
}
