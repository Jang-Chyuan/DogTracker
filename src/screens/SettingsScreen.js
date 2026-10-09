import React from 'react';
import { Text, View } from 'react-native';
import { ActionButton, ui } from '../components/ScreenUI';

export default function SettingsScreen({
  tracking,
  onHardware,
  onCloud,
  onLocationTracker,
  account = null,
}) {
  return (
    <View>
      <View style={ui.card}>
        <Text style={ui.heading}>歷史地圖</Text>
        <Text style={ui.hint}>
          狗的軌跡從地圖上點狗、卡片的「看軌跡」進入；我的路線從地圖右下「今天 x km」進入。來源、Master／Slave 編號、查詢區間與匯出在歷史頁裡調整。
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
        {/* Not signed in is a choice, not an error; 登入失效 asks to sign in again. */}
        {account ? <Text style={!account.signedIn && account.expired ? ui.error : ui.text}>
          {account.signedIn ? account.email || '已登入' : account.expired ? '需要重新登入' : '未登入'}
        </Text> : null}
        <ActionButton title="雲端資料" onPress={onCloud} disabled={!tracking.ready.real} />
      </View>
      <View style={ui.card}>
        <Text style={ui.heading}>硬體連線</Text>
        <Text style={ui.hint}>
          Android 原生服務接收並儲存資料。
        </Text>
        {tracking.errors.real ? <Text style={ui.error}>{tracking.errors.real}</Text> : null}
        <ActionButton title="BLE／QR 與 Master 設定" onPress={onHardware} disabled={!tracking.ready.real} />
      </View>
    </View>
  );
}
