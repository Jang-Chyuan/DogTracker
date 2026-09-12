import React from 'react';
import { Text, View } from 'react-native';
import { ActionButton, ui } from '../components/ScreenUI';

export default function SettingsScreen({
  tracking,
  onHardware,
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
        <Text style={ui.hint}>
          Android 原生服務接收並儲存正式資料。Demo 不控制 BLE 連線。
        </Text>
        {tracking.errors.real ? <Text style={ui.error}>{tracking.errors.real}</Text> : null}
        <ActionButton title="BLE／QR 與 Master 設定" onPress={onHardware} disabled={!tracking.ready.real} />
      </View>
    </View>
  );
}
