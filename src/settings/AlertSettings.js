import { t } from '../i18n';
import { useStyles, makeStyles } from '../theme/ThemeProvider';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { space, type, touch } from '../theme/tokens';
import { GroupCard, ListRow, getSettingsStyles } from './SettingsUI';

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
              accessibilityLabel={t("c940", { action: page.pause.action })}
              onPress={onResume}
              hitSlop={space.s}
              style={({ pressed }) => [styles.resume, pressed && styles.pressed]}
            >
              <Text style={styles.resumeText}>{page.pause.action}</Text>
            </Pressable>
          </ListRow>
        )}
        <ListRow
          testID="alerts-dogs"
          title={t('c233')}
          detail={t('c234')}
          right={dogs.status}
          onPress={() => setOpen(value => !value)}
          label={t("c941", { status: dogs.status })}
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
              <ListRow
          title={item.title}
          label={t("c942", { title: item.title })}
          toggle={{ testID: `alerts-${item.key}`, value: item.on, onChange: on => onChange({ [item.key]: on }) }}
        />
            </View>
          ))}
        <ListRow
          title={t('c236')}
          label={t('c236')}
          toggle={{ testID: "alerts-receiverBattery", value: page.receiverBattery, onChange: on => onChange({ receiverBattery: on }) }}
        />
        <ListRow
          title={t('c238')}
          label={t('c238')}
          toggle={{ testID: "alerts-receiverDisconnectedStorage", value: page.receiverDisconnectedStorage, onChange: on => onChange({ receiverDisconnectedStorage: on }) }}
        />
        <ListRow
          title={t('c241')}
          label={t('c241')}
          toggle={{ testID: "alerts-vibrate", value: page.vibrate, onChange: on => onChange({ vibrate: on }) }}
        />
        <ListRow
          title={t('c242')} detail={t('c243')}
          label={t("c943")}
          toggle={{ testID: "alerts-sound", value: page.sound, onChange: on => onChange({ sound: on }) }}
        />
        {notifications && (
          <ListRow
            testID="alerts-notifications"
            title={t('c245')}
            detail={notifications.detail}
            problem
            action={notifications.action}
            onPress={onNotificationSettings}
            label={t("c944")}
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
      fontSize: type.title.fontSize,
      lineHeight: type.body.lineHeight,
      color: colors.iconMuted,
      marginLeft: space.s,
    },
    toggleOpen: { transform: [{ rotate: '90deg' }] },
    nested: { paddingLeft: space.l },
    // 「恢復」: a 48dp text button in tonalText (判定表「暫停提醒中的設定畫面」).
    resume: { minHeight: touch.min, minWidth: touch.min, justifyContent: 'center', alignItems: 'flex-end' },
    resumeText: { ...type.captionBold, color: colors.tonalText },
    pressed: { opacity: 0.6 },
  });
});
