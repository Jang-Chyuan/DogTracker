import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, radius, space, type } from '../theme/tokens';
import { GroupCard, GroupTitle, HomeRow, ProblemBang, settingsStyles } from './SettingsUI';

/**
 * 「位置存不進手機」 above the groups (design 「位置存不進手機收起之後」): phone
 * full → 「手機空間不足，位置存不進手機」, opens the storage settings; any other
 * reason → the reason, opens where it is shown. Goes when writing works again.
 */
export function StorageWarning({ storage, onPress }) {
  if (!storage) return null;
  const title = storage.full ? '手機空間不足，位置存不進手機' : '位置存不進手機';
  return (
    <Pressable testID="settings-storage-warning" accessibilityRole="button"
      accessibilityLabel={storage.full ? title : `${title}，${storage.reason}`} onPress={onPress}
      style={({ pressed }) => [styles.warning, pressed && styles.pressed]}>
      <ProblemBang />
      <View style={styles.body}>
        <Text style={styles.title}>{title}</Text>
        {!storage.full && <Text style={styles.reason} numberOfLines={2}>{storage.reason}</Text>}
      </View>
    </Pressable>
  );
}

/**
 * S1 設定首頁: four groups (裝置; 帳號與資料; 提醒; 其他), each row with its
 * usual status, or only a red 「!」 when it has something to handle
 * (SettingsModel.settingsHome). `onOpen(rowId)` opens the row's page; the
 * version is the last line.
 */
export default function SettingsHome({ home, version, onOpen, onStorage }) {
  return (
    <ScrollView testID="settings-home" style={settingsStyles.page} contentContainerStyle={settingsStyles.content}>
      <StorageWarning storage={home.storage} onPress={onStorage} />
      {home.groups.map(group => (
        <View key={group.title}>
          <GroupTitle>{group.title}</GroupTitle>
          <GroupCard>
            {group.rows.map(row => <HomeRow key={row.id} row={row} onPress={() => onOpen(row.id)} />)}
          </GroupCard>
        </View>
      ))}
      {version ? <Text style={settingsStyles.footer}>{`DogTracker ${version}`}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  warning: {
    flexDirection: 'row', alignItems: 'center', gap: space.m, padding: 14, marginTop: space.s,
    borderRadius: radius.alertCard, backgroundColor: colors.critBg, borderWidth: 1, borderColor: colors.alertBorder,
  },
  pressed: { opacity: 0.8 },
  body: { flex: 1 },
  title: { ...type.cardTitle, color: colors.crit },
  reason: { ...type.small, color: colors.textMuted },
});
