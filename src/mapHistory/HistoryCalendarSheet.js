// 選日期 (H3b) and 選月份 (H3e): the sheet the date row's 「10/03（六）今天 ▾」
// opens (DESIGN.md「底部小視窗」「月曆」). It rises from the bottom over a 45%
// scrim; a day with records has a 5dp dot (this phone's and the cloud's
// alike), days without records and the future are grey and do nothing, today
// is outlined and always tappable, the day shown is filled. The rules are
// src/history/screen/HistoryCalendar.js; what is known about the cloud comes
// from useHistoryCloud (查詢中… while it is asked).
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Glyph from '../map/Glyph';
import { PressScale } from '../map/MapControls';
import { CALENDAR_WEEKDAYS, calendarMonth, monthPicker, shiftMonth } from '../history/screen/HistoryCalendar';
import { colors, motion, opacity, radius, size as sizes, space, touch, type } from '../theme/tokens';

const ease = Easing.bezier(...motion.easeOut);
const CLOSE_MS = motion.rangeCollapse.duration;
const HANDLE = '#B9C3BD';
// Grey (no records, the future): textMuted at 40% (DESIGN.md「月曆」).
const FADED = 'rgba(94,94,94,0.4)';
const CELL = 44;
const MONTH_CELL = 56;

const monthOf = day => ({ year: Number(day.slice(0, 4)), month: Number(day.slice(5, 7)) });

function Arrow({ side, enabled, onPress, label, testID }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label}
      accessibilityState={{ disabled: !enabled }} disabled={!enabled} onPress={onPress} style={styles.arrow}
      hitSlop={4}>
      <Glyph name={side === 'previous' ? 'back' : 'chevron'} color={enabled ? colors.text : colors.line} size={20} />
    </Pressable>
  );
}

/** 查詢中… / 雲端的紀錄查不到　重試 (判定表「月曆查詢雲端失敗」), next to the title. */
function QueryStatus({ status, onRetry }) {
  if (status === 'querying') {
    return <Text style={styles.status} numberOfLines={1} testID="calendar-querying">查詢中…</Text>;
  }
  if (status !== 'failed') return null;
  return (
    <View style={styles.statusRow} testID="calendar-query-failed">
      <Text style={styles.status} numberOfLines={1}>雲端的紀錄查不到</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="重試查詢雲端的紀錄" onPress={onRetry}
        style={styles.statusRetry} hitSlop={8}>
        <Text style={styles.retryText}>重試</Text>
      </Pressable>
    </View>
  );
}

function DayCell({ cell, onPress }) {
  const text = [styles.dayText, !cell.inMonth && styles.otherMonth, cell.muted && styles.faded,
    cell.selected && styles.selectedText];
  return (
    <Pressable testID={`calendar-day-${cell.day}`} accessibilityRole="button" accessibilityLabel={cell.label}
      accessibilityState={{ disabled: !cell.tappable, selected: cell.selected }}
      // A day that cannot be chosen does nothing at all (判定表「沒紀錄的日子被點」).
      onPress={cell.tappable ? () => onPress(cell.day) : undefined} style={styles.dayCell}>
      <View style={[styles.dayInner, cell.today && styles.today, cell.selected && styles.selected]}>
        <Text style={text}>{cell.date}</Text>
        {cell.dot && <View style={styles.dot} />}
      </View>
    </Pressable>
  );
}

function MonthCell({ entry, onPress }) {
  return (
    <Pressable testID={`calendar-month-${entry.month}`} accessibilityRole="button"
      accessibilityLabel={`${entry.label}${entry.state === 'records' ? '，有紀錄' : entry.muted ? '，沒有紀錄' : ''}`}
      accessibilityState={{ disabled: !entry.tappable, selected: entry.selected }}
      onPress={entry.tappable ? () => onPress(entry.month) : undefined}
      style={[styles.monthCell, entry.tappable && styles.monthOn, entry.selected && styles.selected]}>
      <Text style={[styles.monthText, entry.muted && styles.faded, entry.selected && styles.selectedText]}>
        {entry.label}
      </Text>
      {entry.dot && <View style={styles.monthDot} />}
    </Pressable>
  );
}

/**
 * `screen` is useHistoryScreen's (dayKey, todayKey, knowledge, goTo, askMonth,
 * askYear, retryQuery, stopQuery). `onChosen(result)` after a day was chosen
 * (the sheet is closing); `onOffline(message)` when a cloud day needs the
 * network (the sheet stays); `onClosed()` once it has slid away.
 * Ref: { back() } — 返回鍵: 選月份 goes back to the month, else the sheet closes.
 */
const HistoryCalendarSheet = forwardRef(function HistoryCalendarSheet({ screen, bottomInset = 0, onOffline,
  onClosed, initialView = null }, ref) {
  const { height: windowHeight } = useWindowDimensions();
  const { dayKey, todayKey, knowledge, askMonth, askYear, stopQuery } = screen;
  // 再打開月曆停在哪個月: the month of the day shown.
  const [shown, setShown] = useState(() => monthOf(dayKey));
  // The year 選月份 shows (null: the month view).
  const [picker, setPicker] = useState(() => (initialView === 'months' ? monthOf(dayKey).year : null));
  const progress = useRef(new Animated.Value(0)).current;
  const [sheetHeight, setSheetHeight] = useState(0);
  const closing = useRef(false);
  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    stopQuery?.();
    Animated.timing(progress, { toValue: 0, duration: CLOSE_MS, easing: ease, useNativeDriver: true })
      .start(() => onClosed?.());
  }, [onClosed, progress, stopQuery]);
  // Ask the cloud about what is on screen (a month, or a year's months).
  useEffect(() => {
    if (picker != null) askYear?.(picker);
    else askMonth?.(shown);
  }, [shown.year, shown.month, picker]); // eslint-disable-line react-hooks/exhaustive-deps
  useImperativeHandle(ref, () => ({
    back: () => {
      if (picker != null) { setPicker(null); return true; }
      close();
      return true;
    },
  }), [picker, close]);
  const onLayout = event => {
    const value = Math.round(event.nativeEvent.layout.height);
    if (!value || sheetHeight) return;
    setSheetHeight(value);
    Animated.timing(progress, { toValue: 1, duration: motion.cardRise.duration, easing: ease,
      useNativeDriver: true }).start();
  };
  const choose = day => {
    if (closing.current) return;
    const result = screen.goTo(day);
    if (result.type === 'none') return;
    if (result.type === 'offline') { onOffline?.(result.message); return; }
    close();
  };
  const month = useMemo(() => calendarMonth({ ...shown, today: todayKey, selected: dayKey, knowledge }),
    [shown, todayKey, dayKey, knowledge]);
  const months = useMemo(() => (picker == null ? null
    : monthPicker({ year: picker, today: todayKey, shown: month.key, knowledge })), [picker, todayKey, month.key, knowledge]);
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [sheetHeight || windowHeight, 0] });
  let body;
  if (months) {
    body = (
      <>
        <View style={styles.titleRow}>
          <Pressable testID="calendar-months-back" accessibilityRole="button" accessibilityLabel="選月份，回到月曆"
            onPress={() => setPicker(null)} style={styles.backTitle} hitSlop={8}>
            <Text style={styles.title}>‹ 選月份</Text>
          </Pressable>
          <QueryStatus status={months.status} onRetry={screen.retryQuery} />
        </View>
        <View style={styles.yearRow}>
          <Arrow side="previous" enabled={months.previousEnabled} onPress={() => setPicker(picker - 1)}
            label="前一年" testID="calendar-year-previous" />
          <Text style={styles.yearText} accessibilityRole="header">{months.title}</Text>
          <Arrow side="next" enabled={months.nextEnabled} onPress={() => setPicker(picker + 1)}
            label="後一年" testID="calendar-year-next" />
        </View>
        <View style={styles.monthGrid}>
          {months.months.map(entry => (
            <MonthCell key={entry.key} entry={entry} onPress={value => {
              setShown({ year: picker, month: value });
              setPicker(null);
            }} />
          ))}
        </View>
        <View style={styles.legend}>
          <View style={styles.legendItem}><View style={styles.legendDot} /><Text style={styles.legendText}>這個月有紀錄</Text></View>
          <Text style={[styles.legendText, styles.legendFaded]}>灰字＝沒有紀錄或還沒到，不能點</Text>
        </View>
      </>
    );
  } else {
    body = (
      <>
        <View style={styles.titleRow}>
          <Text style={styles.title} accessibilityRole="header">選日期</Text>
          <QueryStatus status={month.status} onRetry={screen.retryQuery} />
          <PressScale testID="calendar-today" accessibilityRole="button" accessibilityLabel="回到今天"
            accessibilityState={{ disabled: !month.returnTodayEnabled }} disabled={!month.returnTodayEnabled}
            onPress={() => choose(todayKey)} hitSlop={8}
            style={[styles.todayButton, !month.returnTodayEnabled && styles.disabled]}>
            <Text style={styles.todayText}>回到今天</Text>
          </PressScale>
        </View>
        <View style={styles.monthRow}>
          <Arrow side="previous" enabled={month.previousEnabled} onPress={() => setShown(shiftMonth(shown, -1))}
            label="上個月" testID="calendar-month-previous" />
          <Pressable testID="calendar-month-title" accessibilityRole="button" accessibilityLabel={`${month.title}，選月份`}
            onPress={() => setPicker(shown.year)} style={styles.monthPill}>
            <Text style={styles.monthTitle}>{month.title}</Text>
            <Text style={styles.caret}> ▾</Text>
          </Pressable>
          <Arrow side="next" enabled={month.nextEnabled} onPress={() => setShown(shiftMonth(shown, 1))}
            label="下個月" testID="calendar-month-next" />
        </View>
        <View style={styles.weekRow}>
          {CALENDAR_WEEKDAYS.map(name => <Text key={name} style={styles.weekday}>{name}</Text>)}
        </View>
        {month.weeks.map(week => (
          <View key={week[0].day} style={styles.weekRow}>
            {week.map(cell => <DayCell key={cell.day} cell={cell} onPress={choose} />)}
          </View>
        ))}
        <View style={styles.legend}>
          <View style={styles.legendItem}><View style={styles.legendDot} /><Text style={styles.legendText}>有紀錄</Text></View>
          <Text style={[styles.legendText, styles.legendFaded]}>灰字＝沒有紀錄，不能點</Text>
        </View>
      </>
    );
  }
  return (
    <View style={StyleSheet.absoluteFill} testID="history-calendar">
      <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, { opacity: progress }]}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="關閉選日期"
          onPress={close} />
      </Animated.View>
      <Animated.View onLayout={onLayout} accessibilityViewIsModal
        style={[styles.sheet, { paddingBottom: space.l + bottomInset,
          maxHeight: Math.round(windowHeight * sizes.sheet.maxRatio), transform: [{ translateY }] },
        !sheetHeight && styles.unmeasured]}>
        {!months && <View style={styles.handle} />}
        {body}
      </Animated.View>
    </View>
  );
});

export default HistoryCalendarSheet;

const styles = StyleSheet.create({
  scrim: { backgroundColor: colors.scrim },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.surface,
    borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, paddingHorizontal: space.l,
    paddingTop: space.s, elevation: 24,
  },
  unmeasured: { opacity: 0 },
  handle: { alignSelf: 'center', width: 32, height: 4, borderRadius: 2, backgroundColor: HANDLE, marginBottom: space.s },
  titleRow: { flexDirection: 'row', alignItems: 'center', minHeight: touch.min, gap: space.s },
  // 標題 16sp 粗體 (DESIGN.md「底部小視窗」).
  title: { ...type.status, color: colors.text },
  backTitle: { minHeight: touch.min, justifyContent: 'center' },
  statusRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.xs },
  status: { ...type.caption, color: colors.textMuted, flexShrink: 1, flex: 0 },
  statusRetry: { minHeight: touch.min, justifyContent: 'center', paddingHorizontal: space.xs },
  retryText: { ...type.value, color: colors.tonalText },
  // 回到今天: 32dp high (48dp to the finger), outlined; faded on today.
  todayButton: { marginLeft: 'auto', height: 32, paddingHorizontal: space.m, borderRadius: radius.input,
    borderWidth: 1.5, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  todayText: { ...type.value, color: colors.text },
  disabled: { opacity: opacity.disabled },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.xs },
  arrow: { width: touch.min, height: touch.min, alignItems: 'center', justifyContent: 'center' },
  monthPill: { flexDirection: 'row', alignItems: 'center', height: 40, paddingHorizontal: 18, borderRadius: 20,
    borderWidth: 1.5, borderColor: colors.line },
  monthTitle: { ...type.status, fontSize: 17, color: colors.text },
  caret: { color: colors.text, fontSize: 13 },
  weekRow: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', ...type.captionBold, color: colors.textMuted, paddingVertical: space.s },
  dayCell: { flex: 1, height: CELL + 4, padding: 2 },
  dayInner: { flex: 1, borderRadius: radius.input, alignItems: 'center', justifyContent: 'center' },
  dayText: { ...type.status, color: colors.text },
  otherMonth: { color: colors.textMuted },
  faded: { color: FADED },
  today: { borderWidth: 1.5, borderColor: colors.text },
  selected: { backgroundColor: colors.tonal, borderWidth: 2, borderColor: colors.accent },
  selectedText: { color: colors.tonalText },
  dot: { position: 'absolute', bottom: 4, width: sizes.calendarDot, height: sizes.calendarDot,
    borderRadius: sizes.calendarDot / 2, backgroundColor: colors.accent },
  legend: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space.l, rowGap: space.xs,
    marginTop: space.m },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
  legendText: { ...type.caption, color: colors.textMuted },
  legendFaded: { color: FADED },
  yearRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.m },
  yearText: { ...type.status, fontSize: 18, color: colors.text },
  monthGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: space.s },
  monthCell: { width: '31.5%', height: MONTH_CELL, borderRadius: radius.input, alignItems: 'center',
    justifyContent: 'center' },
  monthOn: { backgroundColor: colors.bg },
  monthText: { ...type.status, color: colors.text },
  monthDot: { position: 'absolute', bottom: 8, width: sizes.calendarDot, height: sizes.calendarDot,
    borderRadius: sizes.calendarDot / 2, backgroundColor: colors.accent },
});
