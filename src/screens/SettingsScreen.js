import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ActionButton, ui } from '../components/ScreenUI';
import { colors, radius, type } from '../theme/tokens';

/**
 * 「位置存不進手機」 above everything else (design 「位置存不進手機收起之後」):
 * phone full → 「手機空間不足，位置存不進手機」, opens the storage settings;
 * any other reason → the reason, opens where it is shown. Goes when writing
 * works again.
 */
export function StorageWarning({ storage, onPress }) {
  if (!storage) return null;
  const title = storage.full ? '手機空間不足，位置存不進手機' : '位置存不進手機';
  return (
    <Pressable testID="settings-storage-warning" accessibilityRole="button"
      accessibilityLabel={storage.full ? title : `${title}，${storage.reason}`} onPress={onPress}
      style={({ pressed }) => [styles.warning, pressed && styles.pressed]}>
      <View style={styles.bang}><Text style={styles.bangText}>!</Text></View>
      <View style={styles.body}>
        <Text style={styles.title}>{title}</Text>
        {!storage.full && <Text style={styles.reason} numberOfLines={2}>{storage.reason}</Text>}
      </View>
    </Pressable>
  );
}

export default function SettingsScreen({
  tracking,
  onHardware,
  onCloud,
  onLocationTracker,
  account = null,
  // TopAlerts.storageProblem of the last write, and where its warning leads.
  storage = null,
  onStorage,
}) {
  return (
    <View>
      <StorageWarning storage={storage} onPress={onStorage} />
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

const styles = StyleSheet.create({
  warning: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginBottom: 16,
    borderRadius: radius.alertCard, backgroundColor: colors.critBg, borderWidth: 1, borderColor: colors.alertBorder,
  },
  pressed: { opacity: 0.8 },
  bang: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.problemBadge, alignItems: 'center',
    justifyContent: 'center' },
  bangText: { ...type.captionBold, color: colors.surface },
  body: { flex: 1 },
  title: { ...type.cardTitle, color: colors.crit },
  reason: { ...type.small, color: colors.textMuted },
});
