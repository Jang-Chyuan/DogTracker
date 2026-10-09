import { t } from '../i18n';
import { useTheme, useStyles, makeStyles } from '../theme/ThemeProvider';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { radius, space, touch, type, size as sizes } from '../theme/tokens';

/**
 * The v3 confirmation dialog (design 「確認對話框（切換上傳、登出、關閉 App、
 * 刪除資料）」): rounded 24, 24dp padding, title 20sp, body 16sp that says
 * what changes, 48dp buttons with 「取消」 on the left and the action on the
 * right. `problem` is a crit line under the body (why it cannot go ahead
 * now); the action is then disabled, unless `problemBlocks` is false (the
 * action is still a way out, as 「一起刪除」). `busy` turns the action into a
 * spinner; `secondary` ({ label, onPress, busy }) is a second action between
 * 「取消」 and the main one (S7 「先上傳」). `note` is a bold line under the body
 * (S7 「還有 120 筆沒上傳：先上傳／一起刪除」).
 */
export default function ConfirmDialog({
  visible,
  title,
  body,
  note = null,
  problem = null,
  confirm,
  onConfirm,
  onCancel,
  busy = false,
  destructive = false,
  secondary = null,
  problemBlocks = true,
  testID,
}) {
  const { colors } = useTheme();
  const styles = useStyles(getStyles);
  const working = busy || !!secondary?.busy;
  const disabled = working || (problemBlocks && !!problem);
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onCancel}
    >
      <View style={styles.scrim}>
        <View testID={testID} style={styles.dialog} accessibilityViewIsModal>
          <Text style={styles.title} accessibilityRole="header">
            {title}
          </Text>
          <Text style={styles.body}>{body}</Text>
          {note ? (
            <Text testID={testID && `${testID}-note`} style={styles.note}>
              {note}
            </Text>
          ) : null}
          {problem ? (
            <Text
              testID={testID && `${testID}-problem`}
              accessibilityLiveRegion="polite"
              style={styles.problem}
            >
              {problem}
            </Text>
          ) : null}
          <View style={styles.buttons}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('c046')}
              onPress={onCancel}
              style={({ pressed }) => [
                styles.button,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.cancel}>{t('c046')}</Text>
            </Pressable>
            {secondary ? (
              <Pressable
                testID={testID && `${testID}-secondary`}
                accessibilityRole="button"
                accessibilityLabel={secondary.label}
                accessibilityState={{
                  disabled: working,
                  busy: !!secondary.busy,
                }}
                disabled={working}
                onPress={secondary.onPress}
                style={({ pressed }) => [
                  styles.button,
                  pressed && styles.pressed,
                ]}
              >
                {secondary.busy ? (
                  <ActivityIndicator
                    color={colors.tonalText}
                    accessibilityLabel={t("c945", { label: secondary.label })}
                  />
                ) : (
                  <Text style={[styles.action, working && styles.disabled]}>
                    {secondary.label}
                  </Text>
                )}
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={confirm}
              testID={testID && `${testID}-confirm`}
              accessibilityState={{ disabled, busy }}
              disabled={disabled}
              onPress={onConfirm}
              style={({ pressed }) => [
                styles.button,
                pressed && styles.pressed,
              ]}
            >
              {busy ? (
                <ActivityIndicator
                  color={colors.tonalText}
                  accessibilityLabel={t("c946", { confirm: confirm })}
                />
              ) : (
                <Text
                  style={[
                    styles.action,
                    destructive && styles.destructive,
                    disabled && styles.disabled,
                  ]}
                >
                  {confirm}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const getStyles = makeStyles(theme => {
  const { colors } = theme;
  return StyleSheet.create({
    scrim: {
      flex: 1,
      backgroundColor: colors.scrim,
      alignItems: 'center',
      justifyContent: 'center',
      padding: space.xl,
    },
    dialog: {
      width: '100%',
      maxWidth: sizes.dialog.contentLimit,
      backgroundColor: colors.elevated,
      borderRadius: radius.dialog,
      // S7 確認對話框・深色: a 1dp floatingOutline edge (none in light).
      ...theme.floatingBorder,
      padding: space.xl,
    },
    title: { ...type.title, color: colors.text, marginBottom: space.l },
    body: { ...type.body, color: colors.textMuted },
    note: {
      ...type.body,
      fontWeight: type.status.fontWeight,
      color: colors.text,
      marginTop: space.m,
    },
    problem: {
      ...type.body,
      fontWeight: type.status.fontWeight,
      color: colors.crit,
      marginTop: space.m,
    },
    buttons: {
      flexDirection: 'row',
      // With a large system font three buttons do not fit one line: they wrap
      // (still 取消 first), never past the dialog's edge.
      flexWrap: 'wrap',
      justifyContent: 'flex-end',
      marginTop: space.xl,
      gap: space.s,
    },
    button: {
      minHeight: touch.secondary,
      minWidth: sizes.dialog.actionMinimum,
      paddingHorizontal: space.m,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.button,
    },
    pressed: { backgroundColor: colors.pressedOverlay },
    // 取消: light as before; dark tonalText (S7 確認對話框・深色).
    cancel: {
      ...type.status,
      color: theme.isDark ? colors.tonalText : colors.textMuted,
    },
    action: { ...type.status, color: colors.tonalText },
    destructive: { color: colors.crit },
    disabled: { opacity: 0.4 },
  });
});
