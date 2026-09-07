import React from 'react';
import { Text, View } from 'react-native';
import { ActionButton, ui } from '../components/ScreenUI';

export default function SettingsScreen({
  tracking,
  bleStatus,
  onConnect,
  onWifi,
  onDemo,
}) {
  return (
    <View>
      <Text style={ui.title}>設定</Text>
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
        <Text style={ui.text}>BLE 裝置：{bleStatus}</Text>
        <Text style={ui.hint}>
          真實硬體資料仍由既有 BLE 模組寫入 dog_status。Demo 不控制 BLE 連線。
        </Text>
        <ActionButton title="掃描並連線 DogGPS-Master3" onPress={onConnect} />
        <ActionButton title="Master3 Wi-Fi 設定" onPress={onWifi} secondary />
      </View>
    </View>
  );
}
