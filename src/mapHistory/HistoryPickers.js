// The two small windows of the dog history (H7, 「展開後的歷史面板」):
// 「＋ 加入」's list of dogs and 資料來源's three choices. Both rise from the
// bottom (HistoryBottomSheet) and close on a choice — 選了就生效, no 套用.
import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import DogAvatar from '../dogs/DogAvatar';
import { HISTORY_SOURCE_OPTIONS } from '../history/screen/HistoryMultiSources';
import { colors, layout, opacity, size as sizes, space, touch, type } from '../theme/tokens';
import HistoryBottomSheet from './HistoryBottomSheet';

/**
 * 「＋ 加入」小視窗: the dogs not shown yet that have ever had a position, by
 * collar number (`candidates`: [{ id, name, avatar }]); one without records
 * on the day shown says 「沒有紀錄」 and is faded, and can still be added
 * (`checkDay(id)` → whether it has some). `onAdd(dog)` after the sheet has gone.
 */
export const AddDogSheet = forwardRef(function AddDogSheet({ candidates, checkDay, onAdd, onClosed, bottomInset },
  ref) {
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
    // idsKey stands for the candidates.
  }, [idsKey, checkDay]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = [...candidates].sort((a, b) => Number(a.id) - Number(b.id));
  return (
    <HistoryBottomSheet ref={sheet} title="加入狗" onClosed={onClosed} bottomInset={bottomInset}
      testID="history-add-sheet" closeLabel="關閉加入狗">
      {rows.length ? rows.map(dog => {
        const none = days[dog.id] === false;
        return (
          <Pressable key={dog.id} testID={`history-add-${dog.id}`} accessibilityRole="button"
            accessibilityLabel={`${dog.name}，訊號源 ${dog.id}${none ? '，沒有紀錄' : ''}`}
            onPress={() => sheet.current?.close(() => onAdd({ ...dog, hasData: !none }))}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
            <View style={[styles.rowInner, none && styles.faded]}>
              <DogAvatar avatar={dog.avatar} size={sizes.listRow.avatar} border={0} />
              <View style={styles.texts}>
                <Text style={styles.name} numberOfLines={1}>
                  {dog.name}<Text style={styles.number}>{`　訊號源 ${dog.id}`}</Text>
                </Text>
                {none && <Text style={styles.detail}>沒有紀錄</Text>}
              </View>
            </View>
          </Pressable>
        );
      }) : <Text style={styles.empty} testID="history-add-empty">沒有其他狗</Text>}
    </HistoryBottomSheet>
  );
});

/** 資料來源: 全部／這支手機收到的／雲端, one radio each; `onChoose(id)` after it closed. */
export const SourceSheet = forwardRef(function SourceSheet({ selected, onChoose, onClosed, bottomInset }, ref) {
  const sheet = useRef(null);
  useImperativeHandle(ref, () => ({ back: () => { sheet.current?.close(); return true; } }), []);
  return (
    <HistoryBottomSheet ref={sheet} title="資料來源" onClosed={onClosed} bottomInset={bottomInset}
      testID="history-source-sheet" closeLabel="關閉資料來源">
      <View accessibilityRole="radiogroup">
        {HISTORY_SOURCE_OPTIONS.map(option => {
          const on = option.id === selected;
          return (
            <Pressable key={option.id} testID={`history-source-${option.id}`} accessibilityRole="radio"
              accessibilityState={{ checked: on }} accessibilityLabel={option.label}
              onPress={() => sheet.current?.close(() => onChoose(option.id))}
              style={({ pressed }) => [styles.row, styles.rowInner, pressed && styles.pressed]}>
              <View style={[styles.radio, on && styles.radioOn]}>{on && <View style={styles.radioDot} />}</View>
              <Text style={styles.option}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </HistoryBottomSheet>
  );
});

const RADIO = 20;
const styles = StyleSheet.create({
  row: { minHeight: touch.row, borderRadius: 12 },
  rowInner: { flex: 1, minHeight: touch.row, flexDirection: 'row', alignItems: 'center', gap: space.m },
  pressed: { backgroundColor: colors.pressedOverlay },
  faded: { opacity: opacity.disabled },
  texts: { flex: 1, minWidth: 0 },
  name: { ...type.body, color: colors.text },
  number: { ...type.caption, color: colors.textMuted },
  detail: { ...type.caption, color: colors.textMuted },
  // 清單的空狀態: 16sp textMuted, centred, 32dp above and below.
  empty: { ...type.body, color: colors.textMuted, textAlign: 'center', paddingVertical: layout.emptyStatePadding },
  radio: { width: RADIO, height: RADIO, borderRadius: RADIO / 2, borderWidth: 2, borderColor: colors.textMuted,
    alignItems: 'center', justifyContent: 'center', marginLeft: 2 },
  radioOn: { borderColor: colors.accent },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent },
  option: { ...type.body, color: colors.text },
});
