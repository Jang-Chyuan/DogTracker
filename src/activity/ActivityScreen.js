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
import Svg, { Defs, Path, Pattern, Rect } from 'react-native-svg';
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
import BackRow from '../components/BackRow';

export const ACTIVITY_MODES = Object.freeze([
  { mode: 'day', label: t("c444") },
  { mode: 'week', label: t('c081') },
  { mode: 'month', label: t('c082') },
  { mode: 'year', label: t('c083') },
]);
const CHART = size.activity.chart;
const STATE_COLOR = {
  missing: 'activityMissing',
  rest: 'activityLow',
  normal: 'activityNormal',
  vigorous: 'activityHigh',
  charging: 'activityCharging',
};

// Runs of consecutive no-data quarter hours in a day: [first, last] indexes.
export function missingRuns(bars) {
  const runs = [];
  bars.forEach(bar => {
    const missing = !bar.pending && bar.state === 'missing' && !(bar.count > 0);
    if (!missing) return;
    const last = runs[runs.length - 1];
    if (last && last[1] === bar.index - 1) last[1] = bar.index;
    else runs.push([bar.index, bar.index]);
  });
  return runs;
}

// 沒有資料: a pale band with 45 degree hatching (one SVG pattern, so a gap of
// any width costs one rect). It is a background, not a bar: full height,
// drawn behind the bars.
export function HatchBand({ bandWidth: width, bandHeight: height, testID, style }) {
  const { colors } = useTheme();
  const { spacing, stroke, opacity } = size.activity.hatch;
  if (!(width > 0) || !(height > 0)) return null;
  return (
    <View testID={testID} pointerEvents="none" style={[{ width, height }, style]}>
      <Svg width={width} height={height}>
        <Defs>
          <Pattern id="activityHatch" patternUnits="userSpaceOnUse" width={spacing} height={spacing}>
            <Path d={`M-1 ${spacing + 1} L${spacing + 1} -1 M${spacing - 1} ${spacing + 1} L${spacing + 1} ${spacing - 1} M-1 1 L1 -1`}
              stroke={colors.activityMissingLine} strokeWidth={stroke} strokeOpacity={opacity} />
          </Pattern>
        </Defs>
        <Rect width={width} height={height} fill={colors.activityMissingBand} />
        <Rect width={width} height={height} fill="url(#activityHatch)" />
      </Svg>
    </View>
  );
}

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
  owner = null,
  getPublication = null,
  revision = 0,
  publishedReads = false,
  initialView = null,
  onBack,
}) {
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
    owner, getPublication, revision, publishedReads,
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
        {/* 066: the back icon and the title are one 48dp target. */}
        <BackRow
          rowId="activity-back"
          label={t("c479", { value: t("c439", { name: name }) })}
          title={t("c439", { name: name })}
          onPress={onBack}
          titleLines={linesFor(1)}
        />
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
          {view && <ActivityBody view={view} />}
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
      <Legend view={view} />
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
          {width > 0 && missingRuns(view.bars).map(([first, last]) => {
            const slot = (width - (view.bars.length - 1) * size.activity.dayBarGap) / view.bars.length;
            return (
              <HatchBand key={first} testID={`activity-day-nodata-${first}`} bandHeight={CHART}
                bandWidth={(last - first + 1) * slot + (last - first) * size.activity.dayBarGap}
                style={[styles.dayNoData, { left: first * (slot + size.activity.dayBarGap) }]} />
            );
          })}
          {view.bars.map(bar => (
            <View key={bar.index} style={styles.daySlot}>
              {!bar.pending && (bar.count > 0 ? (
                <View testID={`activity-day-bar-${bar.index}`} style={[styles.dayBar, { height: bar.height,
                  backgroundColor: colors[STATE_COLOR[bar.state]] }]} />
              ) : <View testID={`activity-day-${bar.state === 'charging' ? 'charging' : 'gap'}-${bar.index}`}
                style={[styles.dayGap, bar.state === 'charging' && { backgroundColor: colors.activityCharging }]} />)}
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

// A whole bar of no data: the hatched band over the bar's full height.
function BarNoData({ testID }) {
  const styles = useStyles(getStyles);
  const [width, setWidth] = useState(0);
  return (
    <View style={styles.barNoData} testID={`${testID}-slot`}
      onLayout={event => setWidth(event.nativeEvent.layout.width)}>
      <HatchBand bandWidth={width} bandHeight={CHART} testID={testID} />
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
            {bar.totals.missing > 0 && bar.segments.every(segment => segment.minutes === 0) && (
              <BarNoData testID={`activity-nodata-${bar.start}`} />
            )}
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

function Legend({ view }) {
  const { colors } = useTheme();
  const styles = useStyles(getStyles);
  // 充電中 only in a period that has some.
  const items = ACTIVITY_VIEW_COPY.legend.filter(item => item.state !== 'charging' || view?.totals?.charging > 0);
  return (
    <View style={styles.legend}>
      {items.map(item => (
        <View key={item.state} style={styles.legendItem}>
          {item.state === 'missing' ? (
            <View style={[styles.swatch, styles.swatchMissing]}>
              <HatchBand bandWidth={size.activity.legendSwatch - 2 * border.hairline}
                bandHeight={size.activity.legendSwatch - 2 * border.hairline} testID="activity-legend-missing" />
            </View>
          ) : (
            <View
              testID={`activity-legend-${item.state}`}
              style={[
                styles.swatch,
                { backgroundColor: colors[STATE_COLOR[item.state]] },
              ]}
            />
          )}
          <Text style={styles.legendText}>{item.label}</Text>
        </View>
      ))}
    </View>
  );
}

function Summary({ view }) {
  const styles = useStyles(getStyles);
  const rows = view.rows.filter(
    row => (row.state !== 'missing' && row.state !== 'charging') || row.durationMinutes > 0,
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
    dayNoData: { position: 'absolute', top: 0 },
    barNoData: { position: 'absolute', left: 0, right: 0, bottom: 0, height: CHART },
    swatchMissing: { borderWidth: border.hairline, borderColor: colors.activityMissingLine, overflow: 'hidden' },
    dayGap: { height: size.activity.dayGapHeight },
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
    swatch: { width: size.activity.legendSwatch, minWidth: size.activity.legendSwatch, height: size.activity.legendSwatch },
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
