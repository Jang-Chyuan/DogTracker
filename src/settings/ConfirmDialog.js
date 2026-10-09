import React from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, space, touch, type } from '../theme/tokens';

/**
 * The v3 confirmation dialog (design 「確認對話框（切換上傳、登出、關閉 App、
 * 刪除資料）」): rounded 24, 24dp padding, title 20sp, body 16sp that says
 * what changes, 48dp buttons with 「取消」 on the left and the action on the
 * right. `problem` is a crit line under the body (why it cannot go ahead
 * now); the action is then disabled. `busy` turns the action into a spinner.
 */
export default function ConfirmDialog({ visible, title, body, problem = null, confirm, onConfirm, onCancel,
  busy = false, destructive = false, testID }) {
  const disabled = busy || !!problem;
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onCancel}>
      <View style={styles.scrim}>
        <View testID={testID} style={styles.dialog} accessibilityViewIsModal>
          <Text style={styles.title} accessibilityRole="header">{title}</Text>
          <Text style={styles.body}>{body}</Text>
          {problem ? <Text testID={testID && `${testID}-problem`} accessibilityLiveRegion="polite"
            style={styles.problem}>{problem}</Text> : null}
          <View style={styles.buttons}>
            <Pressable accessibilityRole="button" accessibilityLabel="取消" onPress={onCancel}
              style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
              <Text style={styles.cancel}>取消</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={confirm}
              accessibilityState={{ disabled, busy }} disabled={disabled} onPress={onConfirm}
              style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
              {busy ? <ActivityIndicator color={colors.tonalText} accessibilityLabel={`${confirm}中`} />
                : <Text style={[styles.action, destructive && styles.destructive, disabled && styles.disabled]}>
                  {confirm}</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: colors.scrim, alignItems: 'center', justifyContent: 'center',
    padding: space.xl },
  dialog: { width: '100%', maxWidth: 400, backgroundColor: colors.surface, borderRadius: radius.dialog,
    padding: 24 },
  title: { ...type.title, color: colors.text, marginBottom: space.l },
  body: { ...type.body, color: colors.textMuted },
  problem: { ...type.body, fontWeight: '700', color: colors.crit, marginTop: space.m },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: space.xl, gap: space.s },
  button: { minHeight: touch.secondary, minWidth: 64, paddingHorizontal: space.m, alignItems: 'center',
    justifyContent: 'center', borderRadius: radius.button },
  pressed: { backgroundColor: colors.pressedOverlay },
  cancel: { ...type.status, color: colors.textMuted },
  action: { ...type.status, color: colors.tonalText },
  destructive: { color: colors.crit },
  disabled: { opacity: 0.4 },
});
