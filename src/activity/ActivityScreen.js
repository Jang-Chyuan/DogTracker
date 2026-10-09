import { t } from '../i18n';
import { LoadingContent } from '../components/Skeleton';
// A4 活動量: one dog's activity by 日 (15-minute mean bars) and 週／月／年
// (one segmented bar per day, or per month for 年: 休息、一般、劇烈 from the
// bottom, the minutes without data left blank on top). Opened from the 活動量
// row of the dog's card; ‹ and the back key return to the card.
// Design v3 A4, 判定表「A4 活動量」「A4 怎麼算」「A4 日的柱子」「A4 柱子的比例」.
import { useCallback, useEffect, useState } from 'react';
import {
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { makeStyles, useStyles, useTheme } from '../theme/ThemeProvider';
import {
  layout,
  radius,
  size,
  space,
  tabularNumbers,
  touch,
  type,
  border,
  fontScale,
} from '../theme/tokens';
import Glyph from '../map/Glyph';
import { TextButton } from '../settings/DataTable';
import { ACTIVITY_VIEW_COPY, activityPeriod, activityChartSummary } from './views';
import { useActivityView } from './useActivityView';
import { linesFor } from '../utils/textScale';

export const ACTIVITY_MODES = Object.freeze([
  { mode: 'day', label: t("c444") },
  { mode: 'week', label: t('c081') },
  { mode: 'month', label: t('c082') },
  { mode: 'year', label: t('c083') },
]);
const CHART = size.activity.chart;
const STATE_COLOR = {
  missing: 'noDataLine',
  rest: 'activityLow',
  normal: 'activityNormal',
  vigorous: 'activityHigh',
};
const BAR_GAP = { week: 8, month: 2, year: 6 };
const HOURS = ['00:00', '06:00', '12:00', '18:00', '24:00'];
const AXIS_LABEL = size.activity.axisLabel;

function useBack(onBack) {
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        onBack();
        return true;
      },
    );
    return () => subscription.remove();
  }, [onBack]);
}

/**
 * @param read (slaveId, { start, end, detail }) => Promise — CloudDatabase.activityPeriod
 * @param readEarliest (slaveId) => Promise<number|null>
 * @param initialView { mode, date } (screen fixtures)
 */
export default function ActivityScreen({
  name,
  slaveId,
  read,
  readEarliest,
  now,
  active = true,
  initialView = null,
  onBack,
}) {
  const { colors } = useTheme();
  const styles = useStyles(getStyles);
  const insets = useSafeAreaInsets();
  useBack(onBack);
  const [mode, setMode] = useState(initialView?.mode ?? 'day');
  const [date, setDate] = useState(initialView?.date ?? now);
  const { status, view, retry, earliest } = useActivityView({
    read,
    readEarliest,
    slaveId,
    mode,
    date,
    now,
    active,
  });
  // Until the answer the arrows keep the last navigation they had.
  const [navigation, setNavigation] = useState(null);
  useEffect(() => {
    if (view) setNavigation(view.navigation);
  }, [view]);
  const choose = useCallback(
    next => {
      if (next === mode) return;
      setNavigation(null);
      setMode(next);
    },
    [mode],
  );
  const go = useCallback(target => {
    if (target == null) return;
    setNavigation(null);
    setDate(target);
  }, []);
  return (
    <View
      style={[StyleSheet.absoluteFill, styles.page, { paddingTop: insets.top }]}
      testID="activity-page"
    >
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("c438")}
          onPress={onBack}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
        >
          <Glyph name="back" color={colors.text} size={size.icon.navigation} />
        </Pressable>
        <Text
          style={styles.title}
          accessibilityRole="header"
          numberOfLines={linesFor(1)}
        >{t("c439", { name: name })}</Text>
      </View>
      <ScrollView
        contentContainerStyle={[
          styles.body,
          { paddingBottom: insets.bottom + space.xl },
        ]}
      >
        <Tabs mode={mode} onChoose={choose} />
        <PeriodRow
          label={view?.label ?? periodLabel(mode, date, now, earliest)}
          navigation={navigation}
          onPrevious={() => go(navigation?.previous)}
          onNext={() => go(navigation?.next)}
        />
        <LoadingContent loading={status === 'loading'} shape={mode === 'day' ? 'chart' : 'bars'} skeletonTestID="activity-loading">
          {status === 'error' && <Failure onRetry={retry} />}
          {status === 'ready' && view && <ActivityBody view={view} />}
        </LoadingContent>
      </ScrollView>
    </View>
  );
}

// The period's words before its answer (載入中, 讀取失敗).
// A date before the first reading or after now reads as the nearest period
// (as useActivityView shows it).
export function periodLabel(mode, date, now, earliest = null) {
  const low = earliest != null && earliest < now ? earliest : -Infinity;
  const period = activityPeriod(mode, Math.min(Math.max(date, low), now));
  const today = mode === 'day' && activityPeriod('day', now).start === period.start;
  return ((today) ? t('c084', { date: period.label }) : period.label);
}

const TAB_SLOP = (touch.min - size.activity.segmented) / 2;

// Words inside the chart (axis times, bar labels, the zone labels) sit at
// fixed places in its 200dp: they grow with the system font only a little,
// so 200% neither wraps 「00:00」 nor runs the months into each other.
const CHART_TEXT_MAX_SCALE = fontScale.graphicTextMax;

function Tabs({ mode, onChoose }) {
  const styles = useStyles(getStyles);
  return (
    <View style={styles.tabs} accessibilityRole="tablist">
      {ACTIVITY_MODES.map(item => {
        const on = item.mode === mode;
        return (
          <Pressable
            key={item.mode}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            testID={`activity-tab-${item.mode}`}
            onPress={() => onChoose(item.mode)}
            // 36dp segments, 48dp to the finger.
            hitSlop={{ top: TAB_SLOP, bottom: TAB_SLOP }}
            style={({ pressed }) => [
              styles.tab,
              on && styles.tabOn,
              pressed && !on && styles.pressed,
            ]}
          >
            <Text style={[styles.tabText, on && styles.tabTextOn]}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function PeriodRow({ label, navigation, onPrevious, onNext }) {
  const { colors } = useTheme();
  const styles = useStyles(getStyles);
  const arrow = (glyph, enabled, onPress, words, testID) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={words}
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.arrow,
        !enabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Glyph name={glyph} color={colors.text} size={size.icon.smallAction} />
    </Pressable>
  );
  return (
    <View style={styles.period}>
      {arrow(
        'back',
        !!navigation?.canPrevious,
        onPrevious,
        t("c441"),
        'activity-previous',
      )}
      <Text
        style={styles.periodLabel}
        numberOfLines={linesFor(1)}
        testID="activity-period"
      >
        {label}
      </Text>
      {arrow(
        'chevron',
        !!navigation?.canNext,
        onNext,
        t("c442"),
        'activity-next',
      )}
    </View>
  );
}

function Failure({ onRetry }) {
  const styles = useStyles(getStyles);
  return (
    <View style={styles.stateBox} testID="activity-error">
      <Text accessibilityRole="alert" style={styles.error}>{t("c440")}</Text>
      <TextButton title={t('c049')} onPress={onRetry} tone="crit" />
    </View>
  );
}

function ActivityBody({ view }) {
  const styles = useStyles(getStyles);
  const empty = !!view.emptyText;
  return (
    <View>
      {view.mode === 'day' ? <DayChart view={view} /> : <Bars view={view} />}
      <Legend />
      {empty && (
        <Text style={styles.empty} testID="activity-empty">
          {view.emptyText}
        </Text>
      )}
      <Summary view={view} />
    </View>
  );
}

function DayChart({ view }) {
  const { colors } = useTheme();
  const styles = useStyles(getStyles);
  const [width, setWidth] = useState(0);
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={activityChartSummary(view.totals)}
      testID="activity-day-summary">
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={[styles.chart, styles.dayBars]}
          onLayout={event => setWidth(event.nativeEvent.layout.width)} testID="activity-day-chart">
          {view.bars.map(bar => (
            <View key={bar.index} style={styles.daySlot}>
              {!bar.pending && (bar.count > 0 ? (
                <View testID={`activity-day-bar-${bar.index}`} style={[styles.dayBar, { height: bar.height,
                  backgroundColor: colors[STATE_COLOR[bar.state]] }]} />
              ) : <View testID={`activity-day-gap-${bar.index}`}
                style={styles.dayGap} />)}
            </View>
          ))}
        </View>
        <View style={styles.axis}>
          {width > 0 && HOURS.map((hour, index) => (
            <Text key={hour} style={[styles.axisText, index === 0 ? styles.axisLeft : index === 4 ? styles.axisRight : styles.axisCenter, {
              left: Math.min(Math.max(index / 4 * width - AXIS_LABEL / 2, 0), width - AXIS_LABEL),
            }]} maxFontSizeMultiplier={CHART_TEXT_MAX_SCALE} numberOfLines={1}>{hour}</Text>
          ))}
        </View>
      </View>
    </View>
  );
}

function Bars({ view }) {
  const { colors } = useTheme();
  const styles = useStyles(getStyles);
  const gap = BAR_GAP[view.mode];
  return (
    <View>
      <View style={[styles.bars, { gap }]} testID="activity-bars">
        {view.bars.map(bar => (
          <View key={bar.start} style={styles.bar}>
            {bar.segments.map(segment => {
              const height = segment.share * CHART;
              if (height <= 0) return null;
              return (
                <View
                  key={segment.state}
                  style={[
                    styles.segment,
                    {
                      height,
                      backgroundColor: colors[STATE_COLOR[segment.state]],
                    },
                  ]}
                />
              );
            })}
          </View>
        ))}
      </View>
      <View style={[styles.barLabels, { gap }]}>
        {view.bars.map(bar => (
          // A month's 31 bars are narrower than 「30」: the label may run
          // over its neighbours, which are blank (every fifth day only).
          <View key={bar.start} style={styles.barLabelCell}>
            <Text
              style={styles.barLabel}
              numberOfLines={1}
              // 年's twelve months fill the width already at 100%: any larger
              // and 「10月11月12月」 run together.
              maxFontSizeMultiplier={view.mode === 'year' ? 1 : CHART_TEXT_MAX_SCALE}
            >
              {bar.axisLabel}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function Legend() {
  const { colors } = useTheme();
  const styles = useStyles(getStyles);
  return (
    <View style={styles.legend}>
      {ACTIVITY_VIEW_COPY.legend.map(item => (
        <View key={item.state} style={styles.legendItem}>
          <View
            style={[
              styles.swatch,
              { backgroundColor: colors[STATE_COLOR[item.state]] },
            ]}
          />
          <Text style={styles.legendText}>{item.label}</Text>
        </View>
      ))}
    </View>
  );
}

function Summary({ view }) {
  const styles = useStyles(getStyles);
  const rows = view.rows.filter(
    row => row.state !== 'missing' || row.durationMinutes > 0,
  );
  return (
    <View testID="activity-summary">
      <Text style={styles.section}>{view.summaryLabel}</Text>
      {rows.map(row => {
        const lines =
          row.state === 'missing'
            ? [
                ...row.rangeLabels,
                ...(row.additionalText ? [row.additionalText] : []),
              ]
            : [row.durationText];
        // The total under the gaps (判定表「A4 日的柱子」: 合計 h 小時 m 分).
        const total =
          row.state === 'missing' ? t("c443", { durationText: row.durationText }) : null;
        return (
          <View
            key={row.state}
            // Several lines: the label stays level with the first one.
            style={[styles.row, (lines.length > 1 || total) && styles.rowTall]}
            testID={`activity-row-${row.state}`}
          >
            <Text style={styles.rowLabel}>{row.label}</Text>
            <View style={styles.rowValues}>
              {lines.map(line => (
                <Text key={line} style={styles.rowValue}>
                  {line}
                </Text>
              ))}
              {total && <Text style={styles.rowTotal}>{total}</Text>}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const getStyles = makeStyles(theme => {
  const { colors, isDark } = theme;
  return StyleSheet.create({
    page: {
      zIndex: 40,
      elevation: 12,
      backgroundColor: isDark ? colors.bg : colors.surface,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: touch.subpageHeader,
      paddingHorizontal: space.xs,
    },
    back: {
      width: touch.min,
      height: touch.min,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.full,
    },
    title: { ...type.title, color: colors.text, flexShrink: 1 },
    body: { paddingHorizontal: layout.screenEdge },
    tabs: {
      flexDirection: 'row',
      // Taller with a large system font (the words never clip).
      minHeight: size.activity.segmented + space.xs,
      padding: space.xs,
      borderRadius: radius.chip,
      backgroundColor: isDark ? colors.surface : colors.bg,
      marginTop: space.xs,
    },
    tab: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.chip,
    },
    tabOn: isDark
      ? { backgroundColor: colors.tonal }
      : { backgroundColor: colors.surface, ...theme.shadow.floating },
    tabText: { ...type.captionBold, fontSize: type.value.fontSize, color: colors.textMuted },
    tabTextOn: { color: isDark ? colors.tonalText : colors.text },
    period: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: touch.min,
      marginTop: space.xs,
    },
    arrow: {
      width: touch.min,
      height: touch.min,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.full,
      marginHorizontal: -space.m,
    },
    disabled: { opacity: theme.opacity.disabled },
    periodLabel: {
      ...type.cardTitle,
      ...tabularNumbers,
      color: colors.text,
      flex: 1,
      textAlign: 'center',
    },
    pressed: { backgroundColor: colors.pressedOverlay },
    stateBox: {
      minHeight: CHART,
      alignItems: 'center',
      justifyContent: 'center',
      gap: space.s,
    },
    loadingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: touch.min,
      gap: space.s,
    },
    loadingText: { ...type.body, color: colors.textMuted },
    error: { ...type.body, color: colors.critAction },
    chart: { height: CHART, marginTop: space.s },
    dayBars: { flexDirection: 'row', alignItems: 'flex-end', gap: size.activity.dayBarGap },
    daySlot: { flex: 1, justifyContent: 'flex-end' },
    dayBar: { borderTopLeftRadius: size.activity.dayBarRadius, borderTopRightRadius: size.activity.dayBarRadius },
    dayGap: { height: size.activity.dayGapHeight, backgroundColor: colors.noDataLine },
    axisLeft: { textAlign: 'left' },
    axisRight: { textAlign: 'right' },
    axisCenter: { textAlign: 'center' },
    // The axis times may grow to 1.15× (CHART_TEXT_MAX_SCALE): room for that.
    axis: { height: Math.ceil(type.small.lineHeight * fontScale.graphicTextMax), marginTop: space.xs },
    axisText: {
      ...type.small,
      ...tabularNumbers,
      color: colors.textMuted,
      position: 'absolute',
      width: AXIS_LABEL,
    },
    bars: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      height: CHART,
      marginTop: space.s,
      borderBottomWidth: border.hairline,
      borderBottomColor: colors.line,
    },
    bar: { flex: 1, flexDirection: 'column-reverse' },
    // Adjacent segments are 1dp apart.
    segment: {
      borderTopWidth: border.hairline,
      borderTopColor: isDark ? colors.bg : colors.surface,
    },
    barLabels: { flexDirection: 'row', marginTop: space.xs },
    barLabelCell: { flex: 1, alignItems: 'center', overflow: 'visible' },
    barLabel: {
      ...type.small,
      color: colors.textMuted,
      width: size.activity.barLabel,
      textAlign: 'center',
    },
    legend: {
      flexDirection: 'row',
      gap: space.s,
      flexWrap: 'wrap',
      marginTop: space.s,
    },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
    swatch: { width: size.activity.legendSwatch, height: size.activity.legendSwatch },
    legendText: { ...type.caption, color: colors.textMuted },
    section: {
      ...type.captionBold,
      color: colors.textMuted,
      marginTop: space.xl,
      marginBottom: space.xs,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: size.activity.totalRow,
      paddingVertical: space.s,
      borderTopWidth: border.hairline,
      borderTopColor: colors.line,
    },
    rowTall: { alignItems: 'flex-start', paddingTop: space.m },
    rowLabel: { ...type.value, fontSize: type.body.fontSize, lineHeight: type.body.lineHeight, color: colors.text },
    rowValues: { alignItems: 'flex-end', flexShrink: 1 },
    rowValue: { ...type.body, ...tabularNumbers, fontSize: type.value.fontSize, color: colors.textMuted },
    rowTotal: { ...type.small, ...tabularNumbers, color: colors.textMuted },
    empty: {
      ...type.body,
      color: colors.textMuted,
      textAlign: 'center',
      marginTop: space.xl,
    },
    explanation: {
      ...type.caption,
      color: colors.textMuted,
      marginTop: space.l,
    },
  });
});
