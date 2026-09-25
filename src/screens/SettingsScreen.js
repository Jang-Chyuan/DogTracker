import React from 'react';
import { Text, View } from 'react-native';
import { ActionButton, ui } from '../components/ScreenUI';

export default function SettingsScreen({
  tracking,
  onHardware,
  onDemo,
  onCloud,
  onLocationTracker,
}) {
  return (
    <View>
      <Text style={ui.title}>設定</Text>
      <View style={ui.card}>
        <Text style={ui.heading}>歷史地圖</Text>
        <Text style={ui.hint}>
          來源、Master／Slave 編號、查詢區間與匯出都移到下方的「歷史」分頁。即時地圖的狗圖示超過 2 分鐘未更新就隱藏；歷史軌跡保留查詢區間內的最後位置。
        </Text>
      </View>
      <View style={ui.card}>
        <Text style={ui.heading}>手機位置記錄</Text>
        <Text style={ui.hint}>GPS Timeline：約每秒定位與平滑，依速度每 1～5 秒保存，最多保留 80,000 筆。</Text>
        <ActionButton title="手機位置記錄" onPress={onLocationTracker} disabled={!tracking.ready.real} />
      </View>
      <View style={ui.card}>
        <Text style={ui.heading}>雲端資料</Text>
        <Text style={ui.hint}>登入後下載已授權 Master 的資料，儲存到手機查看。</Text>
        <ActionButton title="雲端資料" onPress={onCloud} disabled={!tracking.ready.real} />
      </View>
      <View style={ui.card}>
        <ActionButton title="Demo 設定" onPress={onDemo} secondary />
        <Text style={ui.hint}>
          {!tracking.preferences.ready
            ? '讀取設定中…'
            : tracking.mode === 'demo'
            ? 'Demo 模式開啟'
            : '正式模式'}
        </Text>
      </View>
      <View style={ui.card}>
        <Text style={ui.heading}>硬體連線</Text>
        <Text style={ui.hint}>
          Android 原生服務接收並儲存正式資料。Demo 不控制 BLE 連線。
        </Text>
        {tracking.errors.real ? <Text style={ui.error}>{tracking.errors.real}</Text> : null}
        <ActionButton title="BLE／QR 與 Master 設定" onPress={onHardware} disabled={!tracking.ready.real} />
      </View>
    </View>
  );
}
