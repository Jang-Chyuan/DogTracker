import { useTheme, makeStyles } from '../theme/ThemeProvider';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import DogAvatar from '../dogs/DogAvatar';
import { historyDogsSheet } from '../history/screen/HistoryDogsPill';
import HistoryBottomSheet from './HistoryBottomSheet';

/** Dog choices take effect while the window remains open. */
export const DogsSheet = forwardRef(function DogsSheet(
  { dogs, candidates, checkDay, onAdd, onSelect, onRemove, onClosed, bottomInset }, ref,
) {
  const styles = getStyles(useTheme());
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
          <DogAvatar avatar={dog.avatar} size={28} border={0} />
          <Text style={styles.name} numberOfLines={1}>{dog.name}</Text>
          {dog.protagonist && <View style={styles.tag}><Text style={styles.tagText}>主角</Text></View>}
          <View style={[styles.radio, dog.protagonist && styles.radioOn]} />
        </Pressable>
        {dog.removable && <Pressable testID={`history-remove-${dog.id}`} accessibilityRole="button"
          accessibilityLabel={`移除${dog.name}`} onPress={() => onRemove(dog.id)} style={styles.remove}>
          <Text style={styles.detail}>✕</Text>
        </Pressable>}
      </View>)}
      <View style={model.full && styles.faded} testID="history-dogs-add-section">
        <Text style={styles.section}>加入</Text>
        {model.note && <Text style={styles.detail}>{model.note}</Text>}
        {model.addable.map(dog => <Pressable key={dog.id} testID={`history-add-${dog.id}`}
          accessibilityRole="button" accessibilityState={{ disabled: dog.disabled }}
          accessibilityLabel={`${dog.name}，訊號源 ${dog.id}${dog.hasData ? '' : '，這天沒有紀錄'}`}
          disabled={dog.disabled} onPress={() => onAdd(dog)}
          style={({ pressed }) => [styles.row, !model.full && !dog.hasData && styles.faded, pressed && styles.pressed]}>
          <DogAvatar avatar={dog.avatar} size={28} border={0} />
          <Text style={styles.name} numberOfLines={1}>{dog.name}</Text>
          <Text style={styles.detail}>{dog.detail}</Text>
          <Text style={styles.detail}>＋</Text>
        </Pressable>)}
        {!model.addable.length && <Text style={styles.detail}>沒有其他狗</Text>}
      </View>
      <Text style={styles.note}>最多同時 4 隻；選了就生效，點空白處或返回鍵關掉。</Text>
    </HistoryBottomSheet>
  );
});

const getStyles = makeStyles(theme => {
  const { colors } = theme;
  return StyleSheet.create({
    section: { fontSize: 11, fontWeight: '700', color: colors.textMuted, marginTop: 10, marginBottom: 2 },
    row: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10,
      borderTopWidth: 1, borderTopColor: colors.line },
    choice: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10 },
    name: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.text },
    detail: { fontSize: 12, color: colors.textMuted },
    tag: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1, backgroundColor: colors.tonal },
    tagText: { fontSize: 11, color: colors.tonalText },
    radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.textMuted },
    radioOn: { borderWidth: 6, borderColor: colors.accent },
    remove: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
    faded: { opacity: 0.4 },
    pressed: { backgroundColor: colors.pressedOverlay },
    note: { fontSize: 12, color: colors.textMuted, marginTop: 8 },
  });
});
