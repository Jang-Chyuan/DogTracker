// The range summary and the range bar (H1/H2b; DESIGN.md「範圍摘要」「範圍條」
// 「調整範圍時的框」): 「08:03 – 現在 ▾」 with the distance and time under it
// and 「調整範圍」 on the right; a tap opens the bar in the same framed box,
// whose two round handles move the start and the end.
import { useTheme, useStyles, makeStyles } from '../theme/ThemeProvider';
import { useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import Glyph from '../map/Glyph';
import {
  clock,
  km,
  spoken,
  summaryDuration,
  summaryText,
  vehicleExclusion,
} from '../history/HistoryText';
import {
  dragRangeHandle,
  rangeHandles,
  stepRangeHandle,
  xOfTime,
} from '../history/screen/HistoryRangeBar';
import {
  size as sizes,
  tabularNumbers,
  touch,
  space,
  radius,
  type,
  border,
  fontScale,
} from '../theme/tokens';
import { haptic } from '../utils/haptics';
import { isLargeFont, linesFor } from '../utils/textScale';
import { useInitialFocus } from '../utils/a11yFocus';

const HANDLE = sizes.rangeBar.handle;
const STEPS = [{ name: 'increment' }, { name: 'decrement' }];
const TOUCH = touch.min;

/** The summary's two lines while the bar is closed, or open (the range itself). */
export function rangeSummaryLines(model, { subject, open, range, who = null }) {
  if (!model?.points.length) return null;
  // Several dogs: the second line names the protagonist (c158: 「豆豆・移動 7.4 km」).
  const moved = who
    ? `${who}・移動 ${km(model.distanceM)}${vehicleExclusion(model, subject)}`
    : `${subject === 'phone' ? '走了' : '移動'} ${km(
        model.distanceM,
      )}${vehicleExclusion(model, subject)}・${summaryDuration(model.durationMs)}`;
  const until = range?.following ? '現在' : clock(range?.end);
  if (!open && !who) return summaryText(model, { subject });
  // Several dogs share one range: the title is that range, whoever leads.
  return { title: `${clock(range.start)} – ${until}`, detail: moved };
}

function RangeBar({ range, track, dayPoints, today, onDrag, onCommit }) {
  const styles = useStyles(getStyles);
  const [width, setWidth] = useState(0);
  const handles = rangeHandles(range, track);
  const startX = xOfTime(handles.start, width, track);
  const endX = xOfTime(handles.end, width, track);
  const state = useRef({});
  state.current = {
    range,
    track,
    dayPoints,
    today,
    width,
    startX,
    endX,
    onDrag,
    onCommit,
  };
  const drag = useRef({
    handle: null,
    from: 0,
    last: null,
    rejected: false,
    edge: false,
  });
  const responder = useMemo(() => {
    // One step of a drag `dx` from where it began (a move, or the release
    // itself: a quick flick can end before its last moves reach JS, and the
    // handle must still land where the finger let go).
    const follow = dx => {
      const d = drag.current;
      if (!d.last) return;
      const {
        track: t,
        dayPoints: points,
        today: isToday,
        width: w,
      } = state.current;
      // Both handles on one spot: the first direction picks (left = start).
      if (!d.handle) {
        if (Math.abs(dx) < 2) return;
        d.handle = dx < 0 ? 'start' : 'end';
        d.from =
          d.handle === 'start' ? state.current.startX : state.current.endX;
      }
      const x = Math.max(0, Math.min(w, d.from + dx));
      const result = dragRangeHandle(state.current.range, d.handle, x, w, {
        track: t,
        dayPoints: points,
        today: isToday,
      });
      if (result.atEdge && !d.edge) haptic('heavy');
      d.edge = result.atEdge;
      d.rejected = !result.valid;
      if (!result.valid) return;
      const changed =
        result.range.start !== d.last.start ||
        result.range.end !== d.last.end ||
        result.range.following !== d.last.following;
      d.last = result.range;
      if (changed) state.current.onDrag(result.range);
    };
    // Where the finger is now, from the event itself when it says (the
    // release's own position: the gesture's dx stops at the last move).
    const dxOf = (event, gesture) => {
      const pageX = event?.nativeEvent?.pageX;
      const from = drag.current.pageX;
      return typeof pageX === 'number' && typeof from === 'number'
        ? pageX - from
        : gesture?.dx ?? 0;
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: event => {
        const { startX: s, endX: e } = state.current;
        const x = event.nativeEvent.locationX - TOUCH / 2;
        // 判定表「範圍條把手太近」: the side of the middle between them (left
        // = start); right on the middle, the first direction moved decides.
        const middle = (s + e) / 2;
        const handle = x < middle ? 'start' : x > middle ? 'end' : null;
        drag.current = {
          handle,
          from: x === middle ? s : handle === 'start' ? s : e,
          last: state.current.range,
          rejected: false,
          edge: false,
          pageX: event.nativeEvent.pageX,
        };
      },
      onPanResponderMove: (event, gesture) => follow(dxOf(event, gesture)),
      onPanResponderRelease: (event, gesture) => {
        follow(dxOf(event, gesture));
        const d = drag.current;
        // Refused (start not before the end): the handle springs back.
        haptic(d.rejected ? 'double' : 'tick');
        state.current.onCommit(d.last);
        drag.current = { handle: null };
      },
      onPanResponderTerminate: (event, gesture) => {
        follow(dxOf(event, gesture));
        state.current.onCommit(drag.current.last);
        drag.current = { handle: null };
      },
    });
  }, []);
  const step = (handle, event) => {
    const result = stepRangeHandle(
      range,
      handle,
      event.nativeEvent.actionName === 'increment' ? 1 : -1,
      { dayPoints, today },
    );
    if (!result.valid) {
      haptic('double');
      return;
    }
    onCommit(result.range);
  };
  // 判定表「範圍條把手太近」: closer than 48dp, the start's time sits left of
  // its handle and the end's right of it (and 12dp lower if still too close).
  const close = endX - startX < TOUCH;
  // Opened, TalkBack moves to the start handle (設計稿「範圍條在 TalkBack 開著時」).
  const startRef = useRef(null);
  useInitialFocus(startRef);
  const startLabel = clock(handles.start);
  const endLabel = clock(handles.end);
  return (
    <View
      style={styles.bar}
      {...responder.panHandlers}
      testID="history-range-bar"
    >
      <View
        style={styles.trackArea}
        pointerEvents="none"
        onLayout={event => setWidth(event.nativeEvent.layout.width - TOUCH)}
      >
        <View style={styles.track} />
        <View
          style={[
            styles.selection,
            { left: TOUCH / 2 + startX, width: Math.max(0, endX - startX) },
          ]}
        />
        {/* TalkBack: each end is its own adjustable control (one fix, at
               least a minute, per step). */}
        <View
          ref={startRef}
          testID="range-handle-start"
          style={[styles.handle, { left: startX + (TOUCH - HANDLE) / 2 }]}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={`開始 ${startLabel}`}
          accessibilityActions={STEPS}
          onAccessibilityAction={event => step('start', event)}
        />
        <View
          testID="range-handle-end"
          style={[styles.handle, { left: endX + (TOUCH - HANDLE) / 2 }]}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={`結束 ${endLabel}${
            range.following ? '，跟著現在' : ''
          }`}
          accessibilityActions={STEPS}
          onAccessibilityAction={event => step('end', event)}
        />
      </View>
      <View style={styles.labels} pointerEvents="none">
        <Text
          style={[
            styles.label,
            close
              ? [styles.labelRight, { right: width - startX + TOUCH / 2 + sizes.rangeBar.labelEdgeGap }]
              : [styles.labelCentre, { left: startX }],
          ]}
          numberOfLines={1}
          maxFontSizeMultiplier={HANDLE_LABEL_MAX_SCALE}
        >
          {startLabel}
        </Text>
        <Text
          style={[
            styles.label,
            close
              ? { left: endX + TOUCH / 2 + sizes.rangeBar.labelEdgeGap }
              : [styles.labelCentre, { left: endX }],
          ]}
          numberOfLines={1}
          maxFontSizeMultiplier={HANDLE_LABEL_MAX_SCALE}
        >
          {endLabel}
        </Text>
      </View>
    </View>
  );
}

/**
 * `model` (historyTimeline's), `range` ({ start, end, following }), `track`
 * (rangeTrack), `open` and `onToggle` (the bar), `onDrag` (a range while a
 * handle moves) and `onCommit` (the range when it is let go). `closedAt`:
 * my route's recording was switched off then (「記錄已在 10:20 關閉」).
 */
// The times under the 24dp handles stay within their 48dp target: they grow
// with the system font only a little (a 200% font would wrap 「07:50」).
const HANDLE_LABEL_MAX_SCALE = fontScale.graphicTextMax;

export default function HistoryRangeSummary({
  model,
  subject,
  range,
  track,
  today,
  open,
  onToggle,
  onDrag,
  onCommit,
  closedAt = null,
  dayPoints: shared = null,
  who = null,
}) {
  const { colors } = useTheme();
  const styles = useStyles(getStyles);
  const lines = rangeSummaryLines(model, { subject, open, range, who });
  if (!lines) return null;
  // The handles snap to every shown dog's fixes (判定表「多隻狗的共同範圍」).
  const dayPoints = shared?.length ? shared : model.dayPoints;
  const enabled =
    dayPoints?.length > 1 &&
    dayPoints[dayPoints.length - 1].time - dayPoints[0].time >= 60000;
  // 「08:03 到現在，走了 5.2 公里，點兩下調整範圍」 (設計稿「無障礙」範圍條).
  const speech = `${lines.title.replace(' – ', ' 到')}，${spoken(lines.detail.replace(/（([^）]+)）/g, '，$1'))}${
    enabled ? '，點兩下調整範圍' : ''
  }`;
  // 大字體: 「調整範圍」 goes under the times, which keep the full width.
  const stacked = isLargeFont();
  return (
    <View style={[styles.box, open && styles.boxOpen]} testID="history-summary">
      <Pressable
        onPress={enabled ? onToggle : undefined}
        style={({ pressed }) => [
          styles.summary,
          stacked && styles.summaryStacked,
          pressed && styles.pressedRow,
        ]}
        accessibilityRole="button"
        accessibilityLabel={speech}
        accessibilityState={{ expanded: open }}
      >
        <View style={[styles.texts, stacked && styles.textsStacked]}>
          <Text
            style={[styles.title, open && styles.titleOpen]}
            numberOfLines={linesFor(1)}
          >
            {lines.title}
            {enabled ? (
              <Text style={[styles.caret, open && styles.titleOpen]}>
                {open ? ' ▴' : ' ▾'}
              </Text>
            ) : null}
          </Text>
          <Text style={styles.detail} numberOfLines={linesFor(2)}>
            {lines.detail}
          </Text>
        </View>
        {enabled && (
          <Pressable
            onPress={onToggle}
            testID="history-adjust"
            accessibilityRole="button"
            accessibilityLabel={open ? '完成' : '調整範圍'}
            hitSlop={space.s}
            style={({ pressed }) => [styles.adjust, open && styles.adjustOpen, pressed && styles.pressed]}
          >
            <Glyph
              name="sliders"
              color={open ? colors.tonalText : colors.text}
              size={sizes.icon.adjust}
            />
            <Text style={[styles.adjustText, open && styles.adjustTextOpen]}>
              {open ? '完成' : '調整範圍'}
            </Text>
          </Pressable>
        )}
      </Pressable>
      {!open && closedAt != null && (
        <Text style={styles.closed}>{`記錄已在 ${clock(closedAt)} 關閉`}</Text>
      )}
      {open && (
        <>
          <RangeBar
            range={range}
            track={track}
            dayPoints={dayPoints}
            today={today}
            onDrag={onDrag}
            onCommit={onCommit}
          />
        </>
      )}
    </View>
  );
}

const getStyles = makeStyles(theme => {
  const { colors } = theme;
  return StyleSheet.create({
    // 設計稿「元件狀態」: the pressed state.
    pressed: { backgroundColor: colors.pressedOverlay },
    // 設計稿「元件狀態」: the pressed state.
    pressedRow: { backgroundColor: colors.brandSoft },
    // Closed: no fill and no frame. Open: white, 1.5dp accent frame, radius 14.
    box: {
      marginHorizontal: space.l,
      paddingHorizontal: space.s,
      paddingVertical: space.s,
      borderRadius: radius.rangeFrame,
      borderWidth: border.regular,
      borderColor: 'transparent',
    },
    boxOpen: { borderColor: colors.accent, backgroundColor: colors.elevated },
    summary: { flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: touch.min },
    texts: { flex: 1 },
    summaryStacked: { flexDirection: 'column', alignItems: 'flex-start' },
    textsStacked: { flex: 0, alignSelf: 'stretch' },
    title: {
      color: colors.text,
      ...type.title,

      ...tabularNumbers,
    },
    titleOpen: { color: colors.tonalText },
    caret: { color: colors.textMuted, fontSize: type.value.fontSize },
    detail: {
      color: colors.textMuted,
      fontSize: type.caption.fontSize,
      lineHeight: type.caption.lineHeight,
      ...tabularNumbers,
    },
    adjust: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.xs,
      minHeight: sizes.chip.height,
      paddingHorizontal: space.m,
      borderRadius: radius.full,
      borderWidth: border.hairline,
      borderColor: colors.line,
      backgroundColor: colors.elevated,
    },
    adjustOpen: { backgroundColor: colors.tonal, borderColor: colors.tonal },
    adjustText: { color: colors.text, fontSize: type.small.fontSize, fontWeight: type.stopNumber.fontWeight },
    adjustTextOpen: { color: colors.tonalText },
    closed: { color: colors.textMuted, fontSize: type.caption.fontSize, marginTop: space.xs },
    // No hint above the bar (D6): the track sits right under the summary.
    bar: { paddingBottom: space.xs, marginTop: space.xs },
    trackArea: { height: TOUCH, justifyContent: 'center' },
    track: {
      marginHorizontal: TOUCH / 2,
      height: sizes.rangeBar.track,
      borderRadius: sizes.rangeBar.track / 2,
      backgroundColor: colors.line,
    },
    selection: {
      position: 'absolute',
      height: sizes.rangeBar.track,
      backgroundColor: colors.accent,
    },
    handle: {
      position: 'absolute',
      width: HANDLE,
      height: HANDLE,
      borderRadius: HANDLE / 2,
      borderWidth: border.heavy,
      borderColor: colors.accent,
      backgroundColor: colors.avatarFrameMap,
    },
    labels: { minHeight: sizes.rangeBar.labelHeight, marginTop: -sizes.rangeBar.labelBaselineLift, marginHorizontal: 0 },
    label: {
      position: 'absolute',
      color: colors.textMuted,
      fontSize: type.caption.fontSize,
      ...tabularNumbers,
    },
    labelRight: { textAlign: 'right' },
    labelCentre: { width: TOUCH, textAlign: 'center' },
  });
});
