import { size as sizes, type, space, touch, border, radius } from '../theme/tokens';
import { useTheme, makeStyles } from '../theme/ThemeProvider';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import DogAvatar from '../dogs/DogAvatar';
import { historyDogsSheet, routeTint } from '../history/screen/HistoryDogsPill';
import HistoryBottomSheet from './HistoryBottomSheet';
import { linesFor } from '../utils/textScale';

/** Dog choices take effect while the window remains open. */
export const DogsSheet = forwardRef(function DogsSheet(
  { dogs, candidates, checkDay, onAdd, onSelect, onRemove, onClosed, bottomInset }, ref,
) {
  const theme = useTheme();
  const styles = getStyles(theme);
  const sheet = useRef(null);
  const [days, setDays] = useState({});
  useImperativeHandle(ref, () => ({ back: () => { sheet.current?.close(); return true; } }), []);
  const idsKey = candidates.map(dog => dog.id).join(',');
  useEffect(() => {
    let alive = true;
    Promise.all(candidates.map(dog => Promise.resolve(checkDay?.(dog.id) ?? true)
      .then(value => [dog.id, value !== false]).catch(() => [dog.id, true])))
      .then(entries => { if (alive) setDays(Object.fromEntries(entries)); });
    return () => { alive = false; };
    // idsKey represents the catalogue IDs.
  }, [idsKey, checkDay]); // eslint-disable-line react-hooks/exhaustive-deps
  const model = historyDogsSheet(dogs, candidates, days);
  return (
    <HistoryBottomSheet ref={sheet} title="看哪幾隻狗" onClosed={onClosed}
      bottomInset={bottomInset} testID="history-dogs-sheet" closeLabel="關閉看哪幾隻狗">
      <Text style={styles.section}>一起看的狗（點一下換主角）</Text>
      {model.shown.map(dog => <View key={dog.id} style={styles.row}>
        <Pressable testID={`history-dog-${dog.id}`} accessibilityRole="radio"
          accessibilityState={{ checked: dog.protagonist }}
          accessibilityLabel={`${dog.name}${dog.protagonist ? '，主角' : '，換成主角'}`}
          onPress={() => onSelect(dog.id)} style={({ pressed }) => [styles.choice, pressed && styles.pressed]}>
          <DogAvatar avatar={dog.avatar} size={sizes.historyPicker.avatar} border={0} tint={routeTint(dog, theme.colors)} />
          <Text style={styles.name} numberOfLines={linesFor(1)}>{dog.name}</Text>
          {dog.downloadFailed && <Text style={styles.failure}>!</Text>}
          {dog.protagonist && <View style={styles.tag}><Text style={styles.tagText}>主角</Text></View>}
          <View style={styles.spacer} />
          <View style={[styles.radio, dog.protagonist && styles.radioOn]} />
        </Pressable>
        {dog.removable && <Pressable testID={`history-remove-${dog.id}`} accessibilityRole="button"
          accessibilityLabel={`移除${dog.name}`} onPress={() => onRemove(dog.id)} style={({ pressed }) => [styles.remove, pressed && styles.pressedRow]}>
          <Text style={styles.detail} allowFontScaling={false}>✕</Text>
        </Pressable>}
      </View>)}
      {(model.full || model.addable.length > 0) && <View testID="history-dogs-add-section">
        <View style={styles.sectionRow}>
          <Text style={[styles.section, model.full && styles.faded]}>加入</Text>
          {model.note && <Text style={[styles.section, styles.sectionNote]}>{model.note}</Text>}
        </View>
        {model.addable.map(dog => <Pressable key={dog.id} testID={`history-add-${dog.id}`}
          accessibilityRole="button" accessibilityState={{ disabled: dog.disabled }}
          accessibilityLabel={`${dog.name}，訊號源 ${dog.id}${dog.hasData ? '' : '，這天沒有紀錄'}`}
          disabled={dog.disabled} onPress={() => onAdd(dog)}
          style={({ pressed }) => [styles.row, dog.opacity < 1 && styles.faded, pressed && styles.pressed]}>
          <DogAvatar avatar={dog.avatar} size={sizes.historyPicker.avatar} border={0} />
          <Text style={styles.name} numberOfLines={linesFor(1)}>{dog.name}</Text>
          <Text style={styles.detail} numberOfLines={linesFor(1)}>{dog.detail}</Text>
          <View style={styles.spacer} />
          <Text style={styles.plus} allowFontScaling={false}>＋</Text>
        </Pressable>)}
      </View>}
    </HistoryBottomSheet>
  );
});

const getStyles = makeStyles(theme => {
  const { colors } = theme;
  return StyleSheet.create({
    // 設計稿「元件狀態」: the pressed state.
    pressedRow: { backgroundColor: colors.brandSoft },
    section: { fontSize: type.micro.fontSize, fontWeight: type.micro.fontWeight, color: colors.textMuted, marginTop: space.s, marginBottom: space.xs },
    row: { minHeight: touch.min, flexDirection: 'row', alignItems: 'center', gap: space.s,
      borderTopWidth: border.hairline, borderTopColor: colors.line },
    choice: { flex: 1, minHeight: touch.min, flexDirection: 'row', alignItems: 'center', gap: space.s },
    name: { flexShrink: 1, fontSize: type.value.fontSize, fontWeight: type.value.fontWeight, color: colors.text },
    failure: { color: colors.crit, fontWeight: type.status.fontWeight },
    spacer: { flex: 1 },
    sectionRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
    sectionNote: { marginLeft: space.s },
    plus: { width: touch.min, textAlign: 'center', fontSize: sizes.historyPicker.addGlyph, color: colors.tonalText },
    detail: { fontSize: type.small.fontSize, color: colors.textMuted },
    tag: { borderRadius: radius.full, paddingHorizontal: space.s, paddingVertical: space.xs, backgroundColor: colors.tonal },
    tagText: { fontSize: type.micro.fontSize, color: colors.tonalText },
    radio: { width: sizes.historyPicker.radio, height: sizes.historyPicker.radio, borderRadius: sizes.historyPicker.radio / 2, borderWidth: border.strong, borderColor: colors.textMuted },
    radioOn: { borderWidth: sizes.historyPicker.radioFillRing, borderColor: colors.accent },
    remove: { width: touch.min, height: touch.min, alignItems: 'center', justifyContent: 'center' },
    faded: { opacity: 0.4 },
    pressed: { backgroundColor: colors.pressedOverlay },
  });
});
