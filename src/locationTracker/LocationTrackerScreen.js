import React from 'react';
import { Text, View } from 'react-native';
import { ActionButton, ui } from '../components/ScreenUI';
import { useLocationTracker } from './useLocationTracker';

const motionLabel = state => ({ moving: '移動', suspected_stationary: '疑似靜止', stationary: '靜止', unknown: '未知' }[state] || '未判定');

// The phone's recorded positions, page by page (記錄清單; reached from
// settings → 診斷 until S8, 051). Recording itself is switched on and off in
// settings → 手機 (S4).
export default function LocationTrackerScreen({ foreground }) {
  const tracker = useLocationTracker(foreground);
  return <View>
    <View style={ui.card}>
      {tracker.error ? <Text accessibilityRole="alert" style={ui.error}>{tracker.error}</Text> : null}
      <Text style={ui.text}>已儲存 {tracker.total.toLocaleString()} / 80,000 筆 · 第 {tracker.page} 頁</Text>
      <ActionButton title="回到最新資料" onPress={tracker.refresh} secondary />
      <ActionButton title="上一頁" onPress={tracker.previous} disabled={tracker.page === 1 || tracker.loading} secondary />
      <ActionButton title="下一頁" onPress={tracker.next} disabled={!tracker.hasMore || tracker.loading} secondary />
    </View>
    {!tracker.rows.length && !tracker.loading ? <Text style={ui.hint}>尚無定位記錄</Text> : null}
    {tracker.rows.map((row, index) => <View key={row.id} style={ui.card}>
      {(index === 0 || new Date(tracker.rows[index - 1].location_at).toDateString() !== new Date(row.location_at).toDateString()) && <Text style={ui.heading}>{new Date(row.location_at).toLocaleDateString()}</Text>}
      {index > 0 && (tracker.rows[index - 1].location_at - row.location_at > 120000 || tracker.rows[index - 1].session_id !== row.session_id) && <Text style={ui.hint}>──── 記錄中斷／不同記錄階段 ────</Text>}
      <Text style={ui.heading}>#{row.id} · {new Date(row.location_at).toLocaleString()}</Text>
      <Text style={ui.text}>{row.latitude.toFixed(6)}, {row.longitude.toFixed(6)}</Text>
      <Text style={ui.text}>精度 {row.accuracy_meters == null ? '—' : row.accuracy_meters.toFixed(1) + ' m'} · 速度 {row.speed_kmh == null ? '—' : row.speed_kmh.toFixed(1) + ' km/h'}</Text>
      <Text style={ui.hint}>海拔 {row.altitude_meters ?? '—'} m · 方向 {row.heading_degrees ?? '—'}°</Text>
      <Text style={ui.hint}>寫入時間 {new Date(row.recorded_at).toLocaleString()}</Text>
      {row.display_latitude != null && <Text style={ui.hint}>歷史顯示位置 {row.display_latitude.toFixed(6)}, {row.display_longitude.toFixed(6)} · {row.display_source === 'animated' ? '藍點動畫' : '定位管線'}</Text>}
      <Text style={ui.hint}>{motionLabel(row.motion_state)} · 原始速度 {row.raw_speed_kmh?.toFixed(1) ?? '—'} km/h · 速度估計精度 {row.speed_accuracy_mps?.toFixed(2) ?? '—'} m/s</Text>
      {row.raw_latitude != null && <Text style={ui.hint}>原始位置 {row.raw_latitude.toFixed(6)}, {row.raw_longitude.toFixed(6)}；上方為{row.motion_state === 'stationary' ? '靜止鎖定' : '平滑'}位置</Text>}
    </View>)}
  </View>;
}
