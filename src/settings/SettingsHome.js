import { useRef, useState, useCallback } from 'react';
import { MapTip } from '../map/MapControls';
import { useStyles, makeStyles } from '../theme/ThemeProvider';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { radius, space, type } from '../theme/tokens';
import {
  GroupCard,
  GroupTitle,
  HomeRow,
  ProblemBang,
  getSettingsStyles,
} from './SettingsUI';

/**
 * 「位置存不進手機」 above the groups (design 「位置存不進手機收起之後」): phone
 * full → 「手機空間不足，位置存不進手機」, opens the storage settings; any other
 * reason → the reason, opens where it is shown. Goes when writing works again.
 */
export function StorageWarning({
  storage,
  onPress,
  testID = 'settings-storage-warning',
}) {
  const styles = useStyles(getStyles);
  if (!storage) return null;
  // `heading`: a problem of its own (D0 「手機裡的資料打不開」 opening 診斷).
  const title =
    storage.heading ??
    (storage.full ? '手機空間不足，位置存不進手機' : '位置存不進手機');
  // On 診斷 (S8, no onPress) the whole reason, also when the phone is full.
  const reason = onPress ? !storage.full && storage.reason : storage.reason;
  const body = (
    <>
      <ProblemBang />
      <View style={styles.body}>
        <Text style={styles.title}>{title}</Text>
        {reason ? (
          <Text style={styles.reason} numberOfLines={onPress ? 2 : undefined}>
            {reason}
          </Text>
        ) : null}
      </View>
    </>
  );

  const label = reason ? `${title}，${reason}` : title;
  if (!onPress) {
    return (
      <View
        testID={testID}
        accessible
        accessibilityLabel={label}
        style={styles.warning}
      >
        {body}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.warning, pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

/**
 * S1 設定首頁: four groups (裝置; 帳號與資料; 提醒; 其他), each row with its
 * usual status, or only a red 「!」 when it has something to handle
 * (SettingsModel.settingsHome). `onOpen(rowId)` opens the row's page; the
 * version is the last line.
 */
export default function SettingsHome({
  home,
  version,
  onOpen,
  onStorage,
  onEnableDiagnostics,
}) {
  const settingsStyles = useStyles(getSettingsStyles);
  const taps = useRef({ count: 0, at: null, saving: false });
  const [message, setMessage] = useState(null);
  const clearMessage = useCallback(() => setMessage(null), []);
  const versionTap = async () => {
    const show = text => setMessage({ text, key: {} });
    if (
      home.groups.some(group =>
        group.rows.some(row => row.id === 'diagnostics'),
      )
    ) {
      show('診斷已經開啟');
      return;
    }
    if (taps.current.saving) return;
    const now = Date.now();
    const count =
      taps.current.at == null || now - taps.current.at > 2000
        ? 1
        : taps.current.count + 1;
    taps.current = { count, at: now, saving: count === 7 };
    if (count === 7) {
      const saved = await onEnableDiagnostics?.();
      taps.current = { count: 0, at: null, saving: false };
      if (saved) show('已開啟診斷');
    } else if (count >= 4) show(`再點 ${7 - count} 下開啟診斷`);
  };
  return (
    <View style={settingsStyles.page}>
      <ScrollView
        testID="settings-home"
        style={settingsStyles.page}
        contentContainerStyle={settingsStyles.content}
      >
        <StorageWarning storage={home.storage} onPress={onStorage} />
        {home.groups.map(group => (
          <View key={group.title}>
            <GroupTitle>{group.title}</GroupTitle>
            <GroupCard>
              {group.rows.map(row => (
                <HomeRow
                  key={row.id}
                  row={row}
                  onPress={() => onOpen(row.id)}
                />
              ))}
            </GroupCard>
          </View>
        ))}
        {version ? (
          <Pressable
            testID="settings-version"
            accessibilityRole="button"
            accessibilityLabel={`DogTracker ${version}，版本`}
            onPress={versionTap}
          >
            <Text style={settingsStyles.footer}>{`DogTracker ${version}`}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
      <MapTip message={message} bottom={space.l} onDone={clearMessage} />
    </View>
  );
}

const getStyles = makeStyles(theme => {
  const { colors } = theme;
  return StyleSheet.create({
    warning: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.m,
      padding: 14,
      marginTop: space.s,
      borderRadius: radius.alertCard,
      backgroundColor: colors.critBg,
      borderWidth: 1,
      borderColor: colors.alertBorder,
    },
    pressed: { opacity: 0.8 },
    body: { flex: 1 },
    title: { ...type.cardTitle, color: colors.crit },
    reason: { ...type.small, color: colors.textMuted },
  });
});
