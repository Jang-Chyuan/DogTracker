import { useTheme, useStyles, makeStyles } from '../theme/ThemeProvider';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { radius, size, space, touch, type, border } from '../theme/tokens';

// The light pieces the 診斷 data pages share (design S8: 「可選欄位、恢復預設欄
// 位；欄位不截字；載入中、空、讀取失敗都有樣子」).

/**
 * A table that scrolls sideways. `columns`: [{ key, label, width, format }];
 * a cell wraps instead of being cut (its width is the narrowest it gets).
 * `onRowPress(row)` makes a row pressable (its detail), `openId` marks it.
 */
// 36dp chips, 48dp to the finger.
const CHIP_SLOP = (touch.min - size.chip.height) / 2;

export function DataTable({
  columns,
  rows,
  rowKey = row => row.id,
  onRowPress,
  openId = null,
  rowLabel,
  testID,
}) {
  const styles = useStyles(getStyles);
  return (
    <ScrollView
      horizontal
      testID={testID}
      showsHorizontalScrollIndicator
      style={styles.table}
    >
      <View>
        <View style={[styles.row, styles.headerRow]}>
          {columns.map(column => (
            <Text
              key={column.key}
              style={[styles.cell, styles.headerCell, { width: column.width }]}
            >
              {column.label}
            </Text>
          ))}
        </View>
        {rows.map((row, index) => {
          const cells = columns.map(column => (
            <Text
              key={column.key}
              style={[styles.cell, { width: column.width }]}
            >
              {cellText(row, column)}
            </Text>
          ));
          const key = rowKey(row);
          const style = [
            styles.row,
            index % 2 === 1 && styles.altRow,
            openId === key && styles.openRow,
          ];
          return onRowPress ? (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityLabel={rowLabel?.(row)}
              accessibilityState={{ expanded: openId === key }}
              onPress={() => onRowPress(row)}
              style={({ pressed }) => [...style, pressed && styles.pressed]}
            >
              {cells}
            </Pressable>
          ) : (
            <View key={key} style={style}>
              {cells}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

export function cellText(row, column) {
  const value = row[column.key];
  if (value === null || value === undefined || value === '') return '—';
  return String(column.format ? column.format(value, row) : value);
}

/** The column picker: one pill per column, 「恢復預設欄位」 at the end. */
export function ColumnPicker({ columns, selected, onToggle, onReset }) {
  const styles = useStyles(getStyles);
  return (
    <View style={styles.picker} testID="column-picker">
      {columns.map(column => {
        const on = selected.includes(column.key);
        return (
          <Pressable
            key={column.key}
            accessibilityRole="checkbox"
            accessibilityLabel={column.label}
            accessibilityState={{ checked: on }}
            onPress={() => onToggle(column.key)}
            hitSlop={CHIP_SLOP}
            style={({ pressed }) => [
              styles.pill,
              on && styles.pillOn,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.pillText, on && styles.pillTextOn]}>
              {on ? `✓ ${column.label}` : column.label}
            </Text>
          </Pressable>
        );
      })}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="恢復預設欄位"
        onPress={onReset}
        style={({ pressed }) => [styles.reset, pressed && styles.pressed]}
        hitSlop={CHIP_SLOP}
      >
        <Text style={styles.link}>恢復預設欄位</Text>
      </Pressable>
    </View>
  );
}

/** 載入中 / 空 / 讀取失敗＋重試 for a page's rows. */
export function LoadState({
  loading,
  error,
  empty,
  emptyText,
  onRetry,
  testID,
}) {
  const { colors } = useTheme();
  const styles = useStyles(getStyles);
  if (error) {
    return (
      <View style={styles.state} testID={testID && `${testID}-error`}>
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
        {onRetry ? (
          <TextButton title="重試" onPress={onRetry} tone="crit" />
        ) : null}
      </View>
    );
  }
  if (loading) {
    return (
      <View style={styles.state} testID={testID && `${testID}-loading`}>
        <ActivityIndicator
          color={colors.tonalText}
          accessibilityLabel="讀取中"
        />
      </View>
    );
  }
  if (empty)
    return (
      <Text
        style={[styles.state, styles.empty]}
        testID={testID && `${testID}-empty`}
      >
        {emptyText}
      </Text>
    );
  return null;
}

/** A 48dp text button (tonal; crit-red when it fixes a problem). */
export function TextButton({
  title,
  onPress,
  disabled = false,
  tone = 'tonal',
  testID,
}) {
  const styles = useStyles(getStyles);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={space.xs}
      style={({ pressed }) => [
        styles.textButton,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.link, tone === 'crit' && styles.crit]}>{title}</Text>
    </Pressable>
  );
}

/** A pill button (tonal, 48dp), e.g. 「選擇欄位」 「上一頁」. */
export function PillButton({ title, onPress, disabled = false, testID }) {
  const styles = useStyles(getStyles);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pillButton,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Text style={styles.pillButtonText}>{title}</Text>
    </Pressable>
  );
}

export const getDataStyles = makeStyles(theme => {
  const { colors } = theme;
  return StyleSheet.create({
    // A short muted line about the page (what it lists, how often it updates).
    hint: { ...type.caption, color: colors.textMuted, marginTop: space.m },
    // Buttons side by side (上一頁 / 下一頁).
    buttons: {
      flexDirection: 'row',
      gap: space.s,
      marginTop: space.m,
      flexWrap: 'wrap',
    },
    heading: {
      ...type.captionBold,
      color: colors.textMuted,
      marginTop: space.xl,
      marginBottom: space.s,
      marginLeft: space.xs,
    },
  });
});

const getStyles = makeStyles(theme => {
  const { colors, opacity } = theme;
  return StyleSheet.create({
    table: {
      marginTop: space.m,
      borderRadius: radius.input,
      borderWidth: border.hairline,
      borderColor: colors.line,
    },
    row: {
      flexDirection: 'row',
      minHeight: touch.min,
      borderBottomWidth: border.hairline,
      borderBottomColor: colors.line,
    },
    headerRow: { backgroundColor: colors.bg },
    altRow: { backgroundColor: colors.bg },
    openRow: { backgroundColor: colors.brandSoft },
    cell: {
      ...type.small,
      color: colors.text,
      paddingHorizontal: space.s,
      paddingVertical: space.s,
    },
    headerCell: { fontWeight: type.status.fontWeight, color: colors.textMuted },
    pressed: { backgroundColor: colors.pressedOverlay },
    picker: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: space.s,
      marginTop: space.m,
    },
    pill: {
      minHeight: size.chip.height,
      borderRadius: radius.chip,
      borderWidth: border.hairline,
      borderColor: colors.line,
      paddingHorizontal: size.chip.paddingH,
      justifyContent: 'center',
    },
    pillOn: { backgroundColor: colors.tonal, borderColor: colors.tonal },
    pillText: { ...type.caption, color: colors.textMuted },
    pillTextOn: { color: colors.tonalText, fontWeight: type.status.fontWeight },
    reset: {
      minHeight: size.chip.height,
      justifyContent: 'center',
      paddingHorizontal: space.s,
    },
    link: { ...type.captionBold, color: colors.tonalText },
    crit: { color: colors.critAction },
    state: { paddingVertical: space.l, alignItems: 'flex-start' },
    empty: { ...type.body, color: colors.textMuted },
    error: { ...type.body, color: colors.crit },
    textButton: {
      minHeight: touch.min,
      justifyContent: 'center',
      paddingHorizontal: space.xs,
    },
    pillButton: {
      minHeight: touch.min,
      borderRadius: radius.button,
      backgroundColor: colors.tonal,
      paddingHorizontal: space.l,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pillButtonText: { ...type.captionBold, color: colors.tonalText },
    disabled: { opacity: opacity.disabled },
  });
});
