import { useTheme, useStyles, makeStyles } from '../theme/ThemeProvider';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { space, type } from '../theme/tokens';
import { GroupCard, ListRow, getSettingsStyles } from './SettingsUI';

const AlertSwitch = ({ testID, label, value, onChange }) => {
  const { colors } = useTheme();
  return (
    <Switch
      testID={testID}
      accessibilityLabel={label}
      value={value}
      onValueChange={onChange}
      trackColor={{ false: colors.switchOff, true: colors.accent }}
      thumbColor={colors.avatarFrameMap}
    />
  );
};

/**
 * S6 提醒: while paused, 「已暫停提醒到 11:10」 with 「恢復」 first; 狗 (a group: 「全部開／部分開／全部關」, pressed it shows its three
 * switches), 接收器電量低, 接收器斷線、位置存不進手機 (a shared notification
 * switch), 震動 and 聲音 (shared by every alert), 通知權限 (未允許 →
 * 「開系統設定 ›」 opens the app's notification settings). Every change is
 * saved at once (`onChange(patch)`). `page` is AlertPreferences.alertsPage.
 */
export default function AlertSettings({
  page,
  onChange,
  onNotificationSettings,
  onResume,
  initiallyOpen = false,
}) {
  const settingsStyles = useStyles(getSettingsStyles);
  const styles = useStyles(getStyles);
  const [open, setOpen] = useState(initiallyOpen);
  const { dogs, notifications } = page;
  return (
    <ScrollView
      testID="alert-settings"
      style={settingsStyles.page}
      contentContainerStyle={[settingsStyles.content, settingsStyles.firstCard]}
    >
      <GroupCard flat>
        {page.pause && (
          <ListRow
            testID="alerts-paused"
            title={page.pause.title}
            label={page.pause.title}
            accessible={false}
          >
            <Pressable
              testID="alerts-resume"
              accessibilityRole="button"
              accessibilityLabel={`${page.pause.action}提醒`}
              onPress={onResume}
              hitSlop={8}
              style={({ pressed }) => [styles.resume, pressed && styles.pressed]}
            >
              <Text style={styles.resumeText}>{page.pause.action}</Text>
            </Pressable>
          </ListRow>
        )}
        <ListRow
          testID="alerts-dogs"
          title="狗"
          detail="沒有新位置、不在接收範圍、電量低"
          right={dogs.status}
          onPress={() => setOpen(value => !value)}
          label={`狗，沒有新位置、不在接收範圍、電量低，${dogs.status}`}
          accessibilityState={{ expanded: open }}
        >
          <Text
            style={[styles.toggle, open && styles.toggleOpen]}
            allowFontScaling={false}
          >
            ›
          </Text>
        </ListRow>
        {open &&
          dogs.items.map(item => (
            <View key={item.key} style={styles.nested}>
              <ListRow title={item.title} accessible={false}>
                <AlertSwitch
                  testID={`alerts-${item.key}`}
                  label={`狗：${item.title}`}
                  value={item.on}
                  onChange={on => onChange({ [item.key]: on })}
                />
              </ListRow>
            </View>
          ))}
        <ListRow title="接收器電量低" accessible={false}>
          <AlertSwitch
            testID="alerts-receiverBattery"
            label="接收器電量低"
            value={page.receiverBattery}
            onChange={on => onChange({ receiverBattery: on })}
          />
        </ListRow>
        <ListRow title="接收器斷線、位置存不進手機" accessible={false}>
          <AlertSwitch
            testID="alerts-receiverDisconnectedStorage"
            label="接收器斷線、位置存不進手機"
            value={page.receiverDisconnectedStorage}
            onChange={on => onChange({ receiverDisconnectedStorage: on })}
          />
        </ListRow>
        <ListRow title="震動" accessible={false}>
          <AlertSwitch
            testID="alerts-vibrate"
            label="震動"
            value={page.vibrate}
            onChange={on => onChange({ vibrate: on })}
          />
        </ListRow>
        <ListRow title="聲音" detail="跟著手機的通知音量" accessible={false}>
          <AlertSwitch
            testID="alerts-sound"
            label="聲音，跟著手機的通知音量"
            value={page.sound}
            onChange={on => onChange({ sound: on })}
          />
        </ListRow>
        {notifications && (
          <ListRow
            testID="alerts-notifications"
            title="通知權限"
            detail={notifications.detail}
            detailTone="warn"
            action={notifications.action}
            actionTone="plain"
            onPress={onNotificationSettings}
            label="通知權限，未允許，開系統設定"
          />
        )}
      </GroupCard>
    </ScrollView>
  );
}

const getStyles = makeStyles(theme => {
  const { colors } = theme;
  return StyleSheet.create({
    // The group's chevron turns down while its switches show.
    toggle: {
      fontSize: 20,
      lineHeight: 24,
      color: colors.iconMuted,
      marginLeft: space.s,
    },
    toggleOpen: { transform: [{ rotate: '90deg' }] },
    nested: { paddingLeft: space.l },
    // 「恢復」: a 48dp text button in tonalText (判定表「暫停提醒中的設定畫面」).
    resume: { minHeight: 48, minWidth: 48, justifyContent: 'center', alignItems: 'flex-end' },
    resumeText: { ...type.captionBold, color: colors.tonalText },
    pressed: { opacity: 0.6 },
  });
});
