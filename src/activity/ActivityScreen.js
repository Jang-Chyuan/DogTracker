// A4 活動量: one dog's activity by 日 (a curve of every minute) and 週／月／年
// (one segmented bar per day, or per month for 年: 休息、一般、劇烈 from the
// bottom, the minutes without data left blank on top). Opened from the 活動量
// row of the dog's card; ‹ and the back key return to the card.
// Design v3 A4, 判定表「A4 活動量」「A4 怎麼算」「A4 日的曲線」「A4 柱子的比例」.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Line, Polyline, Rect } from 'react-native-svg';
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
import { ACTIVITY_VIEW_COPY, activityPeriod } from './views';
import { useActivityView } from './useActivityView';
import { linesFor } from '../utils/textScale';

export const ACTIVITY_MODES = Object.freeze([
  { mode: 'day', label: '日' },
  { mode: 'week', label: '週' },
  { mode: 'month', label: '月' },
  { mode: 'year', label: '年' },
]);
const CHART = size.activity.chart;
const STATE_COLOR = {
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
          accessibilityLabel="返回"
          onPress={onBack}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
        >
          <Glyph name="back" color={colors.text} size={size.icon.navigation} />
        </Pressable>
        <Text
          style={styles.title}
          accessibilityRole="header"
          numberOfLines={linesFor(1)}
        >{`${name}・活動量`}</Text>
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
        {status === 'loading' && <Loading />}
        {status === 'error' && <Failure onRetry={retry} />}
        {status === 'ready' && view && <ActivityBody view={view} />}
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
  return period.label + (today ? '今天' : '');
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
        '上一段',
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
        '下一段',
        'activity-next',
      )}
    </View>
  );
}

// 判定表「載入中、產生中」: a 48dp row, a 20dp spinner and the words.
function Loading() {
  const { colors } = useTheme();
  const styles = useStyles(getStyles);
  return (
    <View style={styles.stateBox} testID="activity-loading">
      <View style={styles.loadingRow}>
        <ActivityIndicator
          size={size.spinner}
          color={colors.tonalText}
          accessibilityLabel="載入中"
        />
        <Text style={styles.loadingText}>載入中…</Text>
      </View>
    </View>
  );
}

function Failure({ onRetry }) {
  const styles = useStyles(getStyles);
  return (
    <View style={styles.stateBox} testID="activity-error">
      <Text accessibilityRole="alert" style={styles.error}>
        讀取失敗
      </Text>
      <TextButton title="重試" onPress={onRetry} tone="crit" />
    </View>
  );
}

function ActivityBody({ view }) {
  const styles = useStyles(getStyles);
  const empty = !!view.emptyText;
  return (
    <View>
      {view.mode === 'day' ? <DayChart view={view} /> : <Bars view={view} />}
      {view.mode !== 'day' && <Legend />}
      {empty ? (
        <Text style={styles.empty} testID="activity-empty">
          {view.emptyText}
        </Text>
      ) : (
        <Summary view={view} />
      )}
      <Text style={styles.explanation}>{ACTIVITY_VIEW_COPY.explanation}</Text>
    </View>
  );
}

// Polylines of the curve, broken wherever a minute has no data.
export function curveRuns(points, width, height) {
  const runs = [];
  let run = [];
  const count = Math.max(1, points.length);
  points.forEach((point, index) => {
    if (point.value == null) {
      if (run.length) runs.push(run);
      run = [];
      return;
    }
    // Each minute sits in the middle of its own slice of the width.
    const x = ((index + 0.5) / count) * width;
    const y = (1 - point.value) * height;
    run.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  });
  if (run.length) runs.push(run);
  // A lone minute between two gaps still shows as a short dash.
  return runs.map(items =>
    items.length === 1
      ? [
          items[0].replace(/^([\d.]+)/, x => String(Number(x) - 1)),
          items[0].replace(/^([\d.]+)/, x => String(Number(x) + 1)),
        ].join(' ')
      : items.join(' '),
  );
}

function DayChart({ view }) {
  const { colors } = useTheme();
  const styles = useStyles(getStyles);
  const [width, setWidth] = useState(0);
  // The whole day is the width, also while today is still running.
  const total = (view.end - view.start) / 60000;
  const points = view.points;
  const x = time => ((time - view.start) / (view.end - view.start)) * width;
  const highTop = 0;
  const highBottom = CHART * (1 - view.thresholds.vigorousMin);
  const lowTop = CHART * (1 - view.thresholds.restMax);
  const runs = useMemo(
    () =>
      width
        ? curveRuns(
            points.concat(
              Array.from({ length: total - points.length }, () => ({
                value: null,
              })),
            ),
            width,
            CHART,
          )
        : [],
    [points, total, width],
  );
  return (
    <View>
      <View
        style={styles.chart}
        onLayout={event => setWidth(event.nativeEvent.layout.width)}
        testID="activity-day-chart"
      >
        {width > 0 && (
          <Svg width={width} height={CHART}>
            {/* 休息／劇烈 runs: the band colour over the run's whole time. */}
            {view.bands.rest.map(band => (
              <Rect
                key={`r${band.start}`}
                x={x(band.start)}
                y={0}
                width={Math.max(size.activity.bandMin, x(band.end) - x(band.start))}
                height={CHART}
                fill={colors.activityLowBand}
              />
            ))}
            {view.bands.vigorous.map(band => (
              <Rect
                key={`v${band.start}`}
                x={x(band.start)}
                y={0}
                width={Math.max(size.activity.bandMin, x(band.end) - x(band.start))}
                height={CHART}
                fill={colors.activityHighBand}
              />
            ))}
            {/* Threshold zones: 高活動 0.8 以上 on top, 低活動 0.05 以下 below. */}
            <Rect
              x={0}
              y={highTop}
              width={width}
              height={highBottom - highTop}
              fill={colors.activityHighBand}
            />
            <Rect
              x={0}
              y={lowTop}
              width={width}
              height={CHART - lowTop}
              fill={colors.activityLowBand}
            />
            <Line
              x1={0}
              x2={width}
              y1={CHART - 0.5}
              y2={CHART - 0.5}
              stroke={colors.line}
              strokeWidth={1}
            />
            {runs.map((pointsText, index) => (
              <Polyline
                key={index}
                points={pointsText}
                fill="none"
                stroke={colors.route1}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
          </Svg>
        )}
        <Text
          style={[styles.zoneLabel, styles.highLabel]}
          maxFontSizeMultiplier={CHART_TEXT_MAX_SCALE}
        >
          {ACTIVITY_VIEW_COPY.high}
        </Text>
        <Text
          style={[
            styles.zoneLabel,
            styles.lowLabel,
            { top: lowTop - type.small.lineHeight - size.activity.zoneLabelInset },
          ]}
          maxFontSizeMultiplier={CHART_TEXT_MAX_SCALE}
        >
          {ACTIVITY_VIEW_COPY.low}
        </Text>
      </View>
      {/* Hours at their local time (a 23 or 25-hour day moves them). */}
      <View style={styles.axis}>
        {width > 0 &&
          HOURS.map((hour, index) => {
            const day = new Date(view.start);
            const time = new Date(
              day.getFullYear(),
              day.getMonth(),
              day.getDate(),
              index * 6,
            ).getTime();
            const left = Math.min(
              Math.max(x(time) - AXIS_LABEL / 2, 0),
              width - AXIS_LABEL,
            );
            const align =
              index === 0 ? 'left' : index === HOURS.length - 1 ? 'right' : 'center';
            return (
              <Text
                key={hour}
                style={[styles.axisText, { left, textAlign: align }]}
                maxFontSizeMultiplier={CHART_TEXT_MAX_SCALE}
                numberOfLines={1}
              >
                {hour}
              </Text>
            );
          })}
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
        // The total under the gaps (判定表「A4 日的曲線」: 合計 h 小時 m 分).
        const total =
          row.state === 'missing' ? `合計 ${row.durationText}` : null;
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
    zoneLabel: {
      ...type.small,
      position: 'absolute',
      left: space.xs,
    },
    highLabel: { top: size.activity.zoneLabelInset, color: colors.warn },
    lowLabel: { color: colors.textMuted },
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
      gap: space.l,
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
