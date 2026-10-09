// What the card's 活動量 row and pencil open until their own screens exist:
// the old activity chart on a page of its own (A4 comes in PR 057), and a
// small rename dialog over the same stored names (the A5 edit page comes in
// PR 047). Both return to the card: back key, ‹, 取消.
import React, { useEffect, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ActivityHistoryChart from './ActivityHistoryChart';
import Glyph from './Glyph';
import { colors, layout, radius, touch, type } from '../theme/tokens';

// The back key closes the top-most of these first.
function useBack(onBack) {
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => subscription.remove();
  }, [onBack]);
}

/** ‹ 小黑・活動量, with the existing 24-hour chart of that dog. */
export function ActivityPage({ name, slaveId, database, owner, active, dogAliases, onBack }) {
  const insets = useSafeAreaInsets();
  useBack(onBack);
  return (
    <View style={[StyleSheet.absoluteFill, styles.page, { paddingTop: insets.top }]} testID="activity-page">
      <View style={styles.pageHeader}>
        <Pressable accessibilityRole="button" accessibilityLabel="返回" onPress={onBack}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
          <Glyph name="back" color={colors.text} size={22} />
        </Pressable>
        <Text style={styles.pageTitle} accessibilityRole="header" numberOfLines={1}>{`${name}・活動量`}</Text>
      </View>
      <View style={styles.pageBody}>
        <ActivityHistoryChart database={database} owner={owner} active={active} dogAliases={dogAliases}
          slaveId={slaveId} key={slaveId} />
      </View>
    </View>
  );
}

export const NAME_MAX = 20;

/**
 * The dog's name, at most 20 characters; an empty name restores 「狗 4」.
 * `onSave(name)` resolves true once stored.
 */
export function RenameDialog({ name, initial, defaultName, onSave, onCancel }) {
  const [value, setValue] = useState(initial || '');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useBack(onCancel);
  const save = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    const saved = await onSave(value.trim());
    setBusy(false);
    if (!saved) setFailed(true);
  };
  return (
    <View style={[StyleSheet.absoluteFill, styles.scrim]} testID="rename-dialog">
      <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="取消" onPress={onCancel} />
      <View style={styles.dialog} accessibilityViewIsModal>
        <Text style={styles.dialogTitle} accessibilityRole="header">{`${name}的名字`}</Text>
        <View style={styles.inputRow}>
          <TextInput accessibilityLabel="狗的名字" value={value} onChangeText={setValue} maxLength={NAME_MAX}
            placeholder={defaultName} placeholderTextColor={colors.textMuted} autoFocus
            returnKeyType="done" onSubmitEditing={save} editable={!busy} style={styles.input} />
          <Text style={styles.count}>{`${value.length}/${NAME_MAX}`}</Text>
        </View>
        {failed && <Text accessibilityRole="alert" style={styles.error}>沒有存成功，再試一次</Text>}
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" onPress={onCancel}
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
            <Text style={styles.cancelText}>取消</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy}
            onPress={save} style={({ pressed }) => [styles.action, styles.done, pressed && styles.pressed]}>
            <Text style={styles.doneText}>完成</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { zIndex: 40, elevation: 12, backgroundColor: colors.bg },
  pageHeader: { flexDirection: 'row', alignItems: 'center', minHeight: touch.subpageHeader,
    paddingHorizontal: 4 },
  back: { width: touch.min, height: touch.min, alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.full },
  pageTitle: { ...type.title, color: colors.text, flexShrink: 1 },
  pageBody: { paddingHorizontal: layout.screenEdge },
  scrim: { zIndex: 45, elevation: 14, backgroundColor: colors.scrim, justifyContent: 'center',
    paddingHorizontal: 24 },
  dialog: { backgroundColor: colors.surface, borderRadius: radius.dialog, padding: 24 },
  dialogTitle: { ...type.title, color: colors.text, marginBottom: 16 },
  inputRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: colors.accent,
    borderRadius: radius.input, paddingHorizontal: 12, minHeight: 56 },
  input: { ...type.body, flex: 1, color: colors.text, paddingVertical: 8 },
  count: { ...type.caption, color: colors.textMuted, marginLeft: 8 },
  error: { ...type.caption, color: colors.crit, marginTop: 8 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 20 },
  action: { minHeight: touch.secondary, minWidth: 72, paddingHorizontal: 16, borderRadius: radius.button,
    alignItems: 'center', justifyContent: 'center' },
  done: { backgroundColor: colors.tonal },
  cancelText: { ...type.status, color: colors.textMuted },
  doneText: { ...type.status, color: colors.tonalText },
  pressed: { backgroundColor: colors.pressedOverlay },
});
