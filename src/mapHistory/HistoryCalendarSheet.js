import { t } from '../i18n';
// 選日期 (H3b) and 選月份 (H3e): the sheet the date row's 「10/03（六）今天 ▾」
// opens (DESIGN.md「底部小視窗」「月曆」). It rises from the bottom over a 45%
// scrim; a day with records has a 5dp dot (this phone's and the cloud's
// alike), days without records and the future are grey and do nothing, today
// is outlined and always tappable, the day shown is filled. The rules are
// src/history/screen/HistoryCalendar.js; what is known about the cloud comes
// from useHistoryCloud (查詢中… while it is asked).
import { useTheme, useStyles, makeStyles } from '../theme/ThemeProvider';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Glyph from '../map/Glyph';
import { PressScale } from '../map/MapControls';
import { isReduceMotion, REDUCED_FADE_MS } from '../utils/reduceMotion';
import {
  CALENDAR_LIST_FONT_SCALE,
  CALENDAR_WEEKDAYS,
  calendarDayList,
  calendarMonth,
  monthPicker,
  shiftMonth,
} from '../history/screen/HistoryCalendar';
import {
  layout,
  motion,
  radius,
  size as sizes,
  space,
  touch,
  type,
  border,
} from '../theme/tokens';
import { useInitialFocus } from '../utils/a11yFocus';
import { fontScaleAtLeast, linesFor } from '../utils/textScale';

const ease = Easing.bezier(...motion.easeOut);
const CLOSE_MS = motion.rangeCollapse.duration;
const getHANDLE = makeStyles(theme => {
  const { literalColors: themeLiteral } = theme;
  return themeLiteral.sheetHandle;
});
// Grey (no records, the future): textMuted at 40% (DESIGN.md「月曆」).
const getFADED = makeStyles(theme => {
  const { literalColors: themeLiteral } = theme;
  return themeLiteral.disabledCalendarText;
});
// The previous / next month's days (the mockup's #7D7672).
const getOTHER_MONTH = makeStyles(theme => {
  const { literalColors: themeLiteral } = theme;
  return themeLiteral.otherMonthText;
});
const CELL = touch.calendarCell;
const MONTH_CELL = touch.row;
// The 40dp month pill, 48dp to the finger.
const PILL_SLOP = (touch.min - sizes.monthPill.height) / 2;

const monthOf = day => ({
  year: Number(day.slice(0, 4)),
  month: Number(day.slice(5, 7)),
});

function Arrow({ side, enabled, onPress, label, testID }) {
  const { colors } = useTheme();
  const styles = useStyles(getStyles);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={onPress}
      // The chevron sits at the sheet's edge, its 48dp target reaching inwards.
      style={({ pressed }) => [styles.arrow,
        side === 'previous' ? styles.arrowStart : styles.arrowEnd, pressed && styles.pressed]}
      hitSlop={space.xs}
    >
      <Glyph
        name={side === 'previous' ? 'back' : 'chevron'}
        color={enabled ? colors.text : colors.line}
        size={sizes.icon.row}
      />
    </Pressable>
  );
}

/** 查詢中… / 雲端的紀錄查不到　重試 (判定表「月曆查詢雲端失敗」), next to the title. */
function QueryStatus({ status, onRetry }) {
  const styles = useStyles(getStyles);
  if (status === 'querying') {
    return (
      <View style={styles.statusRow}>
        <Text
          style={styles.status}
          numberOfLines={linesFor(1)}
          testID="calendar-querying"
        >{t('c324')}</Text>
      </View>
    );
  }
  if (status !== 'failed') return <View style={styles.statusRow} />;
  return (
    <View style={styles.statusRow} testID="calendar-query-failed">
      <Text style={styles.status} numberOfLines={linesFor(1)}>{t("c809")}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("c810")}
        onPress={onRetry}
        style={({ pressed }) => [styles.statusRetry, pressed && styles.pressed]}
        hitSlop={space.s}
      >
        <Text style={styles.retryText}>{t('c049')}</Text>
      </Pressable>
    </View>
  );
}

// Colours are always given (never a style left out): Android kept a removed
// background or text colour on a cell after the cloud's answer changed it.
const dayColor = (cell, theme) => {
  const { colors } = theme;
  const FADED = getFADED(theme);
  const OTHER_MONTH = getOTHER_MONTH(theme);
  return cell.selected
    ? colors.tonalText
    : cell.muted
    ? FADED
    : !cell.inMonth
    ? OTHER_MONTH
    : colors.text;
};

function DayCell({ cell, onPress }) {
  const theme = useTheme();
  const styles = useStyles(getStyles);
  const text = [styles.dayText, { color: dayColor(cell, theme) }];
  const frame = cell.selected
    ? styles.frameSelected
    : cell.today
    ? styles.frameToday
    : styles.framePlain;
  return (
    <Pressable
      testID={`calendar-day-${cell.day}`}
      accessibilityRole="button"
      accessibilityLabel={cell.label}
      accessibilityState={{ disabled: !cell.tappable, selected: cell.selected }}
      // A day that cannot be chosen does nothing at all (判定表「沒紀錄的日子被點」).
      onPress={cell.tappable ? () => onPress(cell.day) : undefined}
      style={({ pressed }) => [styles.dayCell, pressed && styles.pressedRow]}
    >
      <View style={[styles.dayInner, frame]} collapsable={false}>
        <Text style={text}>{cell.date}</Text>
        <View style={[styles.dot, cell.dot ? styles.shown : styles.hidden]} />
      </View>
    </Pressable>
  );
}

function MonthCell({ entry, onPress }) {
  const { colors } = useTheme();
  const styles = useStyles(getStyles);
  const FADED = useStyles(getFADED);
  return (
    <Pressable
      testID={`calendar-month-${entry.month}`}
      accessibilityRole="button"
      accessibilityLabel={((entry.state === 'records') ? t("c777", { label: entry.label }) : (!(entry.state === 'records') && (entry.muted) ? t("c778", { label: entry.label }) : entry.label))}
      accessibilityState={{
        disabled: !entry.tappable,
        selected: entry.selected,
      }}
      onPress={entry.tappable ? () => onPress(entry.month) : undefined}
      collapsable={false}
      style={({ pressed }) => [styles.monthCell,
        entry.selected
          ? styles.frameSelected
          : entry.tappable
          ? styles.frameOn
          : styles.framePlain, pressed && styles.pressedRow]}
    >
      <Text
        style={[
          styles.monthText,
          {
            color: entry.selected
              ? colors.tonalText
              : entry.muted
              ? FADED
              : colors.text,
          },
        ]}
      >
        {entry.label}
      </Text>
      <View
        style={[styles.monthDot, entry.dot ? styles.shown : styles.hidden]}
      />
    </Pressable>
  );
}

/**
 * One day of the 200% list (設計稿「月曆在 200% 字體」): 56dp at least, the
 * date (and 今天) on the left, the 5dp records dot on the right; the day shown
 * is filled like its calendar cell. A tap chooses it and closes the sheet.
 */
function DayRow({ row, onPress }) {
  const { colors } = useTheme();
  const styles = useStyles(getStyles);
  return (
    <Pressable
      testID={`calendar-row-${row.day}`}
      accessibilityRole="button"
      accessibilityLabel={row.label}
      accessibilityState={{ selected: row.selected }}
      onPress={() => onPress(row.day)}
      style={({ pressed }) => [
        styles.dayRow,
        row.selected
          ? styles.frameSelected
          : pressed
          ? styles.rowPressed
          : styles.framePlain,
      ]}
    >
      <Text
        style={[
          styles.dayRowText,
          { color: row.selected ? colors.tonalText : colors.text },
        ]}
      >
        {row.title}
        {row.today ? t("c799") : ''}
      </Text>
      <View style={[styles.rowDot, row.dot ? styles.shown : styles.hidden]} />
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
const HistoryCalendarSheet = forwardRef(function HistoryCalendarSheet(
  { screen, bottomInset = 0, onOffline, onClosed, initialView = null },
  ref,
) {
  const theme = useTheme();
  const styles = getStyles(theme);
  // Day and month cells are drawn afresh on a theme switch: Android kept the
  // old (light) fill on some cells when only their colour changed.
  const scheme = theme.isDark ? 'dark' : 'light';
  const { height: windowHeight, fontScale } = useWindowDimensions();
  // 200% 字體: the month is a scrolling list of days instead of the grid.
  const asList = fontScaleAtLeast(fontScale, CALENDAR_LIST_FONT_SCALE);
  const { dayKey, todayKey, knowledge, askMonth, askYear, stopQuery } = screen;
  // 再打開月曆停在哪個月: the month of the day shown.
  const [shown, setShown] = useState(() => monthOf(dayKey));
  // The year 選月份 shows (null: the month view).
  const [picker, setPicker] = useState(() =>
    initialView === 'months' ? monthOf(dayKey).year : null,
  );
  const progress = useRef(new Animated.Value(0)).current;
  // The animated styles are made once: a native-driven style that changed
  // under a running animation left the sheet (or the scrim) undrawn.
  const opened = useRef(false);
  // 減少動態效果: no slide, the sheet fades with its scrim (DESIGN.md §8).
  const reduced = useRef(isReduceMotion()).current;
  const sheetOpacity = reduced ? progress : 1;
  const translateY = useRef(
    progress.interpolate({
      inputRange: [0, 1],
      outputRange: [reduced ? 0 : windowHeight, 0],
    }),
  ).current;
  const closing = useRef(false);
  // TalkBack starts on the title (選日期 / ‹ 選月份).
  const titleRef = useRef(null);
  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    stopQuery?.();
    Animated.timing(progress, {
      toValue: 0,
      duration: reduced ? REDUCED_FADE_MS : CLOSE_MS,
      easing: ease,
      useNativeDriver: true,
    }).start(() => onClosed?.());
  }, [onClosed, progress, stopQuery, reduced]);
  // Ask the cloud about what is on screen (a month, or a year's months).
  useEffect(() => {
    if (picker != null) askYear?.(picker);
    else askMonth?.(shown);
    // Asked again for another subject or account (signed in with the sheet open).
  }, [shown.year, shown.month, picker, screen.cloudScope]); // eslint-disable-line react-hooks/exhaustive-deps
  useImperativeHandle(
    ref,
    () => ({
      back: () => {
        if (picker != null) {
          setPicker(null);
          return true;
        }
        close();
        return true;
      },
    }),
    [picker, close],
  );
  const onLayout = event => {
    const value = Math.round(event.nativeEvent.layout.height);
    if (!value || opened.current) return;
    opened.current = true;
    Animated.timing(progress, {
      toValue: 1,
      duration: reduced ? REDUCED_FADE_MS : motion.cardRise.duration,
      easing: ease,
      useNativeDriver: true,
    }).start();
  };
  const choose = day => {
    if (closing.current) return;
    const result = screen.goTo(day);
    if (result.type === 'none') return;
    if (result.type === 'offline') {
      onOffline?.(result.message);
      return;
    }
    close();
  };
  const month = useMemo(
    () =>
      calendarMonth({ ...shown, today: todayKey, selected: dayKey, knowledge }),
    [shown, todayKey, dayKey, knowledge],
  );
  const dayList = useMemo(
    () => (asList ? calendarDayList(month) : []),
    [asList, month],
  );
  // Again on every switch between the month and 選月份 (each has its title).
  useInitialFocus(titleRef, picker != null ? 'months' : 'month');
  const months = useMemo(
    () =>
      picker == null
        ? null
        : monthPicker({
            year: picker,
            today: todayKey,
            shown: month.key,
            knowledge,
          }),
    [picker, todayKey, month.key, knowledge],
  );
  let body;
  if (months) {
    body = (
      <>
        <View style={styles.titleRow}>
          <Pressable
            ref={titleRef}
            testID="calendar-months-back"
            accessibilityRole="button"
            accessibilityLabel={t("c801")}
            onPress={() => setPicker(null)}
            style={({ pressed }) => [styles.backTitle, pressed && styles.pressed]}
            hitSlop={space.s}
          >
            <Text style={styles.title}>{t("c800")}</Text>
          </Pressable>
          <QueryStatus status={months.status} onRetry={screen.retryQuery} />
        </View>
        <View style={styles.yearRow}>
          <Arrow
            side="previous"
            enabled={months.previousEnabled}
            onPress={() => setPicker(picker - 1)}
            label={t("c804")}
            testID="calendar-year-previous"
          />
          <Text style={styles.yearText} accessibilityRole="header">
            {months.title}
          </Text>
          <Arrow
            side="next"
            enabled={months.nextEnabled}
            onPress={() => setPicker(picker + 1)}
            label={t("c805")}
            testID="calendar-year-next"
          />
        </View>
        <View style={styles.monthGrid}>
          {months.months.map(entry => (
            <MonthCell
              key={`${entry.key}-${scheme}`}
              entry={entry}
              onPress={value => {
                setShown({ year: picker, month: value });
                setPicker(null);
              }}
            />
          ))}
        </View>
      </>
    );
  } else {
    body = (
      <>
        <View style={styles.titleRow}>
          <Text ref={titleRef} style={styles.title} accessibilityRole="header">{t('c144')}</Text>
          {asList ? (
            <View style={styles.spacer} />
          ) : (
            <QueryStatus status={month.status} onRetry={screen.retryQuery} />
          )}
          <PressScale
            testID="calendar-today"
            accessibilityRole="button"
            accessibilityLabel={t('c145')}
            accessibilityState={{ disabled: !month.returnTodayEnabled }}
            disabled={!month.returnTodayEnabled}
            onPress={() => choose(todayKey)}
            hitSlop={space.s}
            style={[
              styles.todayButton,
              !month.returnTodayEnabled && styles.disabled,
            ]}
          >
            <Text style={styles.todayText}>{t('c145')}</Text>
          </PressScale>
        </View>
        {/* 200%: 「查詢中…」「雲端的紀錄查不到　重試」 get their own line. */}
        {asList && month.status && (
          <View style={styles.statusLine}>
            <QueryStatus status={month.status} onRetry={screen.retryQuery} />
          </View>
        )}
        <View style={styles.monthRow}>
          <Arrow
            side="previous"
            enabled={month.previousEnabled}
            onPress={() => setShown(shiftMonth(shown, -1))}
            label={t("c806")}
            testID="calendar-month-previous"
          />
          <Pressable
            testID="calendar-month-title"
            accessibilityRole="button"
            accessibilityLabel={t("c802", { title: month.title })}
            onPress={() => setPicker(shown.year)}
            style={({ pressed }) => [styles.monthPill, pressed && styles.pressed]}
            hitSlop={PILL_SLOP}
          >
            <Text style={styles.monthTitle}>{month.title}</Text>
            <Text style={styles.caret}> ▾</Text>
          </Pressable>
          <Arrow
            side="next"
            enabled={month.nextEnabled}
            onPress={() => setShown(shiftMonth(shown, 1))}
            label={t("c807")}
            testID="calendar-month-next"
          />
        </View>
        {asList ? (
          <ScrollView
            testID="calendar-list"
            style={styles.list}
            contentContainerStyle={styles.listContent}
          >
            {dayList.length ? (
              dayList.map(row => (
                <DayRow key={`${row.day}-${scheme}`} row={row} onPress={choose} />
              ))
            ) : (
              <Text style={styles.listEmpty}>{t("c808")}</Text>
            )}
          </ScrollView>
        ) : (
          <>
            <View style={styles.weekRow}>
              {CALENDAR_WEEKDAYS.map(name => (
                <Text key={name} style={styles.weekday}>
                  {name}
                </Text>
              ))}
            </View>
            {month.weeks.map(week => (
              <View key={week[0].day} style={styles.weekRow}>
                {week.map(cell => (
                  <DayCell
                    key={`${cell.day}-${scheme}`}
                    cell={cell}
                    onPress={choose}
                  />
                ))}
              </View>
            ))}
          </>
        )}
      </>
    );
  }
  return (
    <View
      style={[StyleSheet.absoluteFill, styles.layer]}
      testID="history-calendar"
      collapsable={false}
    >
      <Animated.View
        style={[StyleSheet.absoluteFill, styles.scrim, { opacity: progress }]}
        collapsable={false}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel={t("c803")}
          onPress={close}
        />
      </Animated.View>
      <Animated.View
        onLayout={onLayout}
        accessibilityViewIsModal
        style={[
          styles.sheet,
          {
            paddingBottom: space.l + bottomInset,
            maxHeight: Math.round(windowHeight * sizes.sheet.maxRatio),
            transform: [{ translateY }],
            opacity: sheetOpacity,
          },
        ]}
      >
        {!months && <View style={styles.handle} />}
        {body}
      </Animated.View>
    </View>
  );
});

export default HistoryCalendarSheet;

const getStyles = makeStyles(theme => {
  const { colors, opacity } = theme;
  const HANDLE = getHANDLE(theme);
  return StyleSheet.create({
    // 設計稿「元件狀態」: the pressed state.
    pressed: { backgroundColor: colors.pressedOverlay },
    // 設計稿「元件狀態」: the pressed state.
    pressedRow: { backgroundColor: colors.brandSoft },
    // Over the top capsules (30) and the panel (40).
    layer: { zIndex: 60, elevation: 30 },
    scrim: { backgroundColor: colors.scrim },
    sheet: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: colors.elevated,
      borderTopLeftRadius: radius.sheet,
      borderTopRightRadius: radius.sheet,
      paddingHorizontal: space.l,
      paddingTop: space.s,
      elevation: 24,
    },
    handle: {
      alignSelf: 'center',
      width: sizes.sheet.handleLength,
      height: sizes.sheet.handleThickness,
      borderRadius: sizes.sheet.handleThickness / 2,
      backgroundColor: HANDLE,
      marginBottom: space.s,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: touch.min,
      gap: space.s,
    },
    // 標題 16sp 粗體 (DESIGN.md「底部小視窗」).
    title: { ...type.status, color: colors.text },
    backTitle: { minHeight: touch.min, justifyContent: 'center' },
    statusRow: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.xs,
    },
    status: { ...type.caption, color: colors.textMuted, flexShrink: 1 },
    spacer: { flex: 1 },
    statusLine: { flexDirection: 'row' },
    statusRetry: {
      minHeight: touch.min,
      justifyContent: 'center',
      paddingHorizontal: space.xs,
    },
    retryText: { ...type.value, color: colors.tonalText },
    // 回到今天: 32dp high (48dp to the finger), outlined; faded on today.
    todayButton: {
      minHeight: sizes.calendar.todayPill,
      paddingHorizontal: space.m,
      borderRadius: radius.full,
      borderWidth: border.regular,
      borderColor: colors.line,
      alignItems: 'center',
      justifyContent: 'center',
    },
    todayText: { ...type.value, color: colors.text },
    disabled: { opacity: opacity.disabled },
    monthRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: space.xs,
    },
    arrow: { width: touch.min, height: touch.min, justifyContent: 'center' },
    arrowStart: { alignItems: 'flex-start' },
    arrowEnd: { alignItems: 'flex-end' },
    monthPill: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: sizes.monthPill.height,
      paddingHorizontal: space.l,
      borderRadius: radius.full,
      borderWidth: border.regular,
      borderColor: colors.line,
    },
    monthTitle: { ...type.status, fontSize: type.body.fontSize, color: colors.text },
    caret: { color: colors.text, fontSize: type.caption.fontSize },
    weekRow: { flexDirection: 'row' },
    weekday: {
      flex: 1,
      textAlign: 'center',
      ...type.captionBold,
      color: colors.textMuted,
      paddingVertical: space.s,
    },
    dayCell: { flex: 1, height: CELL + sizes.calendar.cellGutter, padding: space.xs },
    dayInner: {
      width: CELL,
      maxWidth: '100%',
      aspectRatio: 1,
      alignSelf: 'center',
      borderRadius: radius.full,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dayText: { ...type.status, color: colors.text },
    // Every variant sets all three, so a change never leaves one behind.
    // The sheet's white, not 'transparent': Android left the old fill on a
    // cell whose fill was taken away.
    framePlain: {
      backgroundColor: colors.elevated,
      borderWidth: 0,
      borderColor: colors.elevated,
    },
    frameOn: {
      backgroundColor: colors.bg,
      borderWidth: 0,
      borderColor: colors.bg,
    },
    frameToday: {
      backgroundColor: colors.elevated,
      borderWidth: border.regular,
      borderColor: colors.text,
    },
    frameSelected: {
      backgroundColor: colors.tonal,
      borderWidth: border.strong,
      borderColor: colors.accent,
    },
    shown: { opacity: 1 },
    hidden: { opacity: 0 },
    dot: {
      position: 'absolute',
      bottom: space.xs,
      width: sizes.calendarDot,
      height: sizes.calendarDot,
      borderRadius: sizes.calendarDot / 2,
      backgroundColor: colors.accent,
    },
    yearRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: space.m,
    },
    yearText: { ...type.status, fontSize: type.body.fontSize, color: colors.text },
    monthGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      rowGap: space.s,
    },
    monthCell: {
      width: '31.5%',
      minHeight: MONTH_CELL,
      paddingVertical: space.s,
      borderRadius: radius.full,
      alignItems: 'center',
      justifyContent: 'center',
    },
    monthText: { ...type.status, color: colors.text },
    // The 200% list (設計稿「月曆在 200% 字體」).
    list: { flexShrink: 1, marginTop: space.s },
    listContent: { gap: space.xs, paddingBottom: space.xs },
    listEmpty: {
      ...type.body,
      color: colors.textMuted,
      textAlign: 'center',
      paddingVertical: layout.emptyStatePadding,
    },
    dayRow: {
      minHeight: touch.row,
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.m,
      paddingHorizontal: space.l,
      paddingVertical: space.s,
      borderRadius: radius.input,
    },
    rowPressed: {
      backgroundColor: colors.brandSoft,
      borderWidth: 0,
      borderColor: colors.brandSoft,
    },
    dayRowText: { ...type.body, flex: 1 },
    rowDot: {
      width: sizes.calendarDot,
      height: sizes.calendarDot,
      borderRadius: sizes.calendarDot / 2,
      backgroundColor: colors.accent,
    },
    monthDot: {
      position: 'absolute',
      bottom: space.s,
      width: sizes.calendarDot,
      height: sizes.calendarDot,
      borderRadius: sizes.calendarDot / 2,
      backgroundColor: colors.accent,
    },
  });
});
