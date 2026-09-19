import React from 'react';
import { Text, View } from 'react-native';
import { ActionButton, ui } from '../components/ScreenUI';
import { useLocationTracker } from './useLocationTracker';
import { useLiveLocation } from './useLiveLocation';

const motionLabel = state => ({ moving: '移動', suspected_stationary: '疑似靜止', stationary: '靜止', unknown: '未知' }[state] || '未判定');

export default function LocationTrackerScreen({ foreground }) {
  const tracker = useLocationTracker(foreground);
  const live = useLiveLocation(foreground);
  return <View>
    <Text style={ui.title}>手機 GPS Timeline</Text>
    <View style={ui.card}>
      <Text style={ui.heading}>myLocationTracker</Text>
      <Text style={ui.text}>{live?.status || tracker.status}</Text>
      <Text style={ui.hint}>約每秒取得高精度 GPS，以最近 3 個有效點平滑，超過 10 km/h 時偏重最新位置。依原始速度保存：≤ 10 km/h 每 5 秒、> 10 且 ≤ 20 km/h 每 3 秒、> 20 km/h 每 1 秒。最多保留 80,000 筆，只存本機。</Text>
      <Text style={ui.hint}>原始速度 > 20 km/h 時接受估計精度小於 50 公尺；其餘情況需 ≤ 30 公尺。沒有新定位時不補點，平滑不代表精度提升。</Text>
      <Text style={ui.hint}>確認靜止後速度歸零，座標鎖定於確認時的平滑位置；恢復移動或有效樣本中斷超過 3 秒後重新判定。原始座標仍保留。</Text>
      {live?.running && <Text style={ui.text}>本次接收 {live.received || 0} · 合格 {live.accepted || 0} · 略過 {live.rejected || 0} · 已存 {live.saved || 0} · 寫入失敗 {live.writeErrors || 0}</Text>}
      {live?.running && <Text style={ui.text}>目前保存間隔：{live.intervalSeconds || 5} 秒</Text>}
      {live?.position && <Text style={ui.hint}>最新位置 {live.position.latitude.toFixed(6)}, {live.position.longitude.toFixed(6)} · 估計精度 {live.position.accuracy.toFixed(1)} m · {Math.floor(live.ageSeconds || 0)} 秒前</Text>}
      <Text style={ui.hint}>系統強制停止或手機重開機後，請重新開始記錄。</Text>
      {live?.running && live.position && <Text style={ui.text}>狀態：{motionLabel(live.position.motionState)} · 原始速度 {live.position.rawSpeedKmh?.toFixed(1) ?? '—'} km/h · 處理後 {live.position.speedKmh?.toFixed(1) ?? '—'} km/h</Text>}
      {tracker.error ? <Text accessibilityRole="alert" style={ui.error}>{tracker.error}</Text> : null}
      <ActionButton title={tracker.busy ? '處理中…' : tracker.running ? '停止記錄' : '開始記錄'} onPress={tracker.toggle} disabled={tracker.busy || tracker.loading} />
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
