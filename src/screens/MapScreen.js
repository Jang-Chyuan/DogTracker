import React from 'react';
import { Text, View } from 'react-native';
import { ui } from '../components/ScreenUI';
import TrackingStatusCard from '../components/TrackingStatusCard';

export default function MapScreen({ tracking }) {
  return (
    <View>
      <Text style={ui.title}>地圖</Text>
      <View style={ui.card}>
        <Text style={ui.heading}>Google Maps 尚未接入</Text>
        <Text style={ui.hint}>
          地圖、領犬員與狗的位置和路徑將在 Milestone C 加入。目前可先驗證下方由
          SQLite 讀取的資料。
        </Text>
      </View>
      {tracking.preferences.error && (
        <Text accessibilityRole="alert" style={ui.error}>
          模式設定讀取失敗：{tracking.preferences.error}。請至設定 → Demo
          設定重試。
        </Text>
      )}
      {!tracking.ready[tracking.mode] && !tracking.errors[tracking.mode] ? (
        <Text style={ui.hint}>正在準備 SQLite…</Text>
      ) : null}
      {tracking.errors[tracking.mode] ? (
        <View>
          <Text accessibilityRole="alert" style={ui.error}>
            讀取失敗：{tracking.errors[tracking.mode]}
          </Text>
          {tracking.ready[tracking.mode] ? (
            <Text style={ui.hint}>
              保留最後一次成功讀取的資料；App 在前景時會自動重試。
            </Text>
          ) : null}
        </View>
      ) : null}
      {!tracking.ready[tracking.mode] && tracking.errors[tracking.mode] ? (
        <Text style={ui.hint}>資料庫尚未就緒，請重新啟動 App 重試。</Text>
      ) : null}
      {tracking.mode === 'demo' && tracking.demoError ? (
        <Text accessibilityRole="alert" style={ui.error}>
          {tracking.demoError}。請至 Demo 控制頁處理；目前顯示最後保留資料。
        </Text>
      ) : null}
      <TrackingStatusCard point={tracking.point} mode={tracking.mode} />
    </View>
  );
}
