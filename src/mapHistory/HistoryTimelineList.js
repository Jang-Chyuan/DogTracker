import { useTheme, useStyles, makeStyles } from '../theme/ThemeProvider';
import { isReduceMotion } from '../utils/reduceMotion';
import { touch, size as sizes, space, type, border, radius, fontScale } from '../theme/tokens';
import React, { useEffect, useRef } from 'react';
import {
  LayoutAnimation,
  PixelRatio,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Glyph from '../map/Glyph';

import {
  interruptionText,
  nodePill,
  nodeTimes,
  placeLines,
  placeSpeech,
  sectionSpeech,
  sectionText,
} from '../history/HistoryText';
import { usePlaceNames } from '../placement/AddressLookup';

// 判定表「時間軸清單」: time column 54dp, track 36dp, then the place.
const TIME_WIDTH = sizes.timeline.timeColumn;
// 200% 字體 (DESIGN.md §3.4): the time column widens with the system font up to
// 72dp, and its times grow only as far as 「07:02」 fits there (no wrapping).
const TIME_MAX_SCALE = fontScale.timeColumnTextMax;
const timeWidth = () => ({
  width: Math.min(
    sizes.timeline.timeColumnMax,
    Math.round(TIME_WIDTH * (PixelRatio.getFontScale?.() || 1)),
  ),
});
const TRACK_WIDTH = sizes.timeline.track;
// Enough dots or dashes for the tallest row; the row clips the rest.
const MARKS = 40;

const isVehicle = mode => mode === 'driving' || mode === 'ride';

/** The track of one row: dotted (on foot), solid (car), long dash (no data). */

// A row is tapped only when the finger let go near where it touched: a swipe
// over the list that the list could not scroll (at its end) or that began on
// a row while the list was still gliding must never move the cursor (the
// cursor jumped to that row's start during scrolls on the device).
export const TAP_SLOP = 10;
export function useTap(onPress, value) {
  const down = useRef(null);
  return {
    onPressIn: event => {
      const { pageX, pageY } = event?.nativeEvent ?? {};
      down.current = Number.isFinite(pageY) ? { x: pageX, y: pageY } : null;
    },
    onPress: onPress
      ? event => {
          const { pageX, pageY } = event?.nativeEvent ?? {};
          const from = down.current;
          down.current = null;
          if (from && Number.isFinite(pageY)
            && Math.hypot(pageX - from.x, pageY - from.y) > TAP_SLOP) return;
          onPress(value);
        }
      : undefined,
  };
}

function Track({ kind, color, from = 0 }) {
  const styles = useStyles(getStyles);
  if (!kind) return null;
  const style = [styles.track, { top: from }];
  if (kind === 'solid')
    return (
      <View style={[...style, styles.solid, { backgroundColor: color }]} />
    );
  const dash = kind === 'gap';
  return (
    <View style={[...style, styles.marks]}>
      {Array.from({ length: MARKS }, (_, index) => (
        <View
          key={index}
          style={dash ? styles.dash : [styles.dot, { backgroundColor: color }]}
        />
      ))}
    </View>
  );
}
const lineOf = section =>
  !section
    ? null
    : section.type === 'gap'
    ? 'gap'
    : isVehicle(section.mode)
    ? 'solid'
    : 'dots';

function Node({ node, color }) {
  const { colors } = useTheme();
  const styles = useStyles(getStyles);
  switch (node.type) {
    case 'departure':
      return <View style={[styles.departure, { borderColor: color }]} />;
    case 'stop':
    case 'switch':
      return (
        <View style={[styles.numbered, { backgroundColor: color }]}>
          <Text style={styles.number}>{node.number}</Text>
        </View>
      );

    case 'indoor':
      return (
        <View style={styles.indoor}>
          <Glyph name="house" color={colors.onRoute} size={sizes.timeline.node.holdGlyph} />
        </View>
      );
    case 'resume':
      return <View style={[styles.resume, { borderColor: color }]} />;
    default:
      return (
        <View
          style={[
            styles.end,
            { backgroundColor: color, borderColor: `${color}55` },
          ]}
        />
      );
  }
}

function Pill({ pill, color }) {
  const { colors } = useTheme();
  const styles = useStyles(getStyles);
  if (!pill) return null;
  const tone = {
    stay: [{ backgroundColor: `${color}1F` }, { color }],
    plain: [{ backgroundColor: colors.pillPlain }, { color: colors.textMuted }],
    closed: [{ backgroundColor: colors.warnBg }, { color: colors.warn }],
    indoor: [{ backgroundColor: colors.pillIndoor }, { color: colors.receiver }],
  }[pill.tone];
  return (
    <View style={[styles.pill, tone[0]]}>
      <Text style={[styles.pillText, tone[1]]}>{pill.text}</Text>
    </View>
  );
}

function PlaceRow({ node, next, color, place, selected, onPress, onLayout }) {
  const styles = useStyles(getStyles);
  const tap = useTap(onPress, node);
  const [start, end] = nodeTimes(node);
  const lines = placeLines(node, place);
  const note = lines.coordinates ? interruptionText(node) : '';
  const pill = nodePill(node);
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.pressedRow]}
      hitSlop={ROW_SLOP}
      testID={`timeline-${node.type}`}
      {...tap}
      onLayout={onLayout}
      accessibilityRole="button"
      accessibilityLabel={placeSpeech(node, lines.title)}
      accessibilityState={{ selected: !!selected }}
    >
      <View style={[styles.timeColumn, timeWidth()]}>
        <Text style={styles.time} maxFontSizeMultiplier={TIME_MAX_SCALE}>
          {start}
        </Text>
        {end ? (
          <Text style={styles.timeEnd} maxFontSizeMultiplier={TIME_MAX_SCALE}>
            {end}
          </Text>
        ) : null}
      </View>
      <View style={styles.trackColumn}>
        {/* The line under a node is the next row's (判定表「時間軸清單」). */}
        <Track kind={lineOf(next)} color={color} from={12} />
        <Node node={node} color={color} />
      </View>
      <View style={styles.placeOuter}>
        {/* The row the cursor is on: a pale fill of the route colour (H2). */}
        <View
          style={[styles.place, selected && { backgroundColor: `${color}1A` }]}
          testID={selected ? 'timeline-selected' : undefined}
        >
          {/* Two lines kept while the address is asked for (判定表「清單節點的內容」). */}
          <Text
            style={[styles.address, lines.titleMuted && styles.asking]}
            testID="place-title"
          >
            {lines.title}
          </Text>
          {(pill || lines.coordinates || note) && <View style={styles.second}>
            <Pill pill={pill} color={color} />
            {lines.coordinates ? (
              <Text style={styles.note}>{lines.coordinates}</Text>
            ) : null}
            {note ? <Text style={styles.note}>{note}</Text> : null}
          </View>}
        </View>
      </View>
    </Pressable>
  );
}

function SectionRow({ section, color, onPress }) {
  const { colors } = useTheme();
  const styles = useStyles(getStyles);
  const text = sectionText(section);
  const muted = section.type === 'gap';
  const tap = useTap(onPress, section);
  return (
    <Pressable
      style={({ pressed }) => [styles.row, styles.sectionRow, pressed && styles.pressedRow]}
      hitSlop={ROW_SLOP}
      testID={`timeline-${section.type}-${section.mode}`}
      {...tap}
      accessibilityRole="button"
      accessibilityLabel={sectionSpeech(section)}
    >
      <View style={[styles.timeColumn, timeWidth()]} />
      <View style={styles.trackColumn}>
        <Track kind={lineOf(section)} color={color} />
      </View>
      <View style={styles.sectionText}>
        <Glyph
          name={text.icon}
          color={muted ? colors.iconMuted : color}
          size={sizes.timeline.icon}
        />
        <Text style={styles.movement}>
          {text.lead}
          {text.time ? ' ' : ''}
          <Text style={styles.bold}>{text.time}</Text>
          {text.rest}
        </Text>
      </View>
    </Pressable>
  );
}

/**
 * The time-line list of one dog or my route (H1/H2, 判定表「時間軸清單」):
 * places (出發, numbered stays and switch points, holds, 恢復記錄, the end)
 * with the movement and 沒有資料 rows between them. `selected` is the start
 * of the place row the cursor is on; a tap on a row calls `onPressNode` with
 * its node; `onRowLayout(start, y)` says where each place row sits.
 */
function HistoryTimelineList({
  model,
  color,
  selected = null,
  onPressNode,
  onRowLayout,
}) {
  const nodes = model.nodes;
  const places = usePlaceNames(
    nodes.map(node => (isSection(node) ? null : node)),
  );
  const states = places.map(place => place.state).join();
  const shown = useRef(states);
  useEffect(() => {
    // 減少動態效果: the addresses just appear (no rows sliding).
    if (shown.current !== states && !isReduceMotion())
      LayoutAnimation.configureNext(ADDRESS_MOTION);
    shown.current = states;
  }, [states]);
  return (
    <View testID="history-timeline">
      {nodes.map((node, index) =>
        isSection(node) ? (
          <SectionRow
            key={`s${node.start}-${index}`}
            section={node}
            color={color}
            onPress={onPressNode}
          />
        ) : (
          <PlaceRow
            key={`n${node.type}${node.start}-${index}`}
            node={node}
            color={color}
            place={places[index]}
            selected={selected != null && node.start === selected}
            onPress={onPressNode}
            onLayout={
              onRowLayout
                ? event => onRowLayout(node.start, event.nativeEvent.layout.y)
                : undefined
            }
            next={isSection(nodes[index + 1]) ? nodes[index + 1] : null}
          />
        ),
      )}
    </View>
  );
}

// Rows are 40dp at least with 12dp between: 4dp more above and below reach
// 48dp without overlapping the next row.
const ROW_SLOP = { top: (touch.min - sizes.timeline.sectionHeight) / 2, bottom: (touch.min - sizes.timeline.sectionHeight) / 2 };

const isSection = node => ['movement', 'gap'].includes(node?.type);

// Addresses fade in where they land and the rows below slide (180 ms).
const ADDRESS_MOTION = LayoutAnimation.create(
  180,
  LayoutAnimation.Types.easeInEaseOut,
  LayoutAnimation.Properties.opacity,
);

// The screen re-renders on every cursor move; the list only when its model
// or the selected row changes.
export default React.memo(HistoryTimelineList);

const getStyles = makeStyles(theme => {
  const { colors } = theme;
  return StyleSheet.create({
    // 設計稿「元件狀態」: the pressed state.
    pressedRow: { backgroundColor: colors.brandSoft },
    // The 12dp between rows is inside the place column, so the track column
    // runs the full row and the line has no breaks.
    row: { flexDirection: 'row' },
    sectionRow: { minHeight: sizes.timeline.sectionHeight },
    timeColumn: { width: TIME_WIDTH, alignItems: 'flex-end', paddingRight: space.xs },
    time: {
      color: colors.text,
      ...type.value,

      fontVariant: ['tabular-nums'],

    },
    timeEnd: {
      color: colors.textMuted,
      fontSize: type.small.fontSize,
      fontVariant: ['tabular-nums'],
    },
    trackColumn: { width: TRACK_WIDTH, alignItems: 'center' },
    track: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      alignItems: 'center',
      overflow: 'hidden',
    },
    solid: { left: TRACK_WIDTH / 2 - sizes.timeline.driveLine / 2, right: undefined, width: sizes.timeline.driveLine },
    marks: { flexDirection: 'column' },
    // 判定表「時間軸清單」: 3dp dots, 7dp apart.
    dot: { width: sizes.timeline.dot, height: sizes.timeline.dot, borderRadius: sizes.timeline.dot / 2, marginBottom: sizes.timeline.dotGap },
    dash: {
      width: sizes.timeline.noDataLine,
      height: sizes.timeline.noDataDash[0],
      marginBottom: sizes.timeline.noDataDash[1],
      backgroundColor: colors.noDataLine,
    },
    departure: {
      width: sizes.timeline.node.start,
      height: sizes.timeline.node.start,
      borderRadius: sizes.timeline.node.start / 2,
      borderWidth: border.heavy,
      backgroundColor: colors.elevated,
      marginTop: sizes.timeline.node.departureDrop,
    },
    numbered: {
      width: sizes.timeline.node.stop + border.heavy * 2,
      height: sizes.timeline.node.stop + border.heavy * 2,
      borderRadius: (sizes.timeline.node.stop + border.heavy * 2) / 2,
      borderWidth: border.heavy,
      borderColor: colors.elevated,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: -sizes.timeline.node.stayLift,
    },
    number: { color: colors.onRoute, fontSize: type.small.fontSize, fontWeight: type.stopNumber.fontWeight },
    indoor: {
      width: sizes.timeline.node.hold + border.heavy * 2,
      height: sizes.timeline.node.hold + border.heavy * 2,
      borderRadius: (sizes.timeline.node.hold + border.heavy * 2) / 2,
      borderWidth: border.heavy,
      borderColor: colors.elevated,
      backgroundColor: colors.receiver,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: -sizes.timeline.node.stayLift,
    },
    resume: {
      width: sizes.timeline.node.resume,
      height: sizes.timeline.node.resume,
      borderRadius: sizes.timeline.node.resume / 2,
      borderWidth: border.strong,
      backgroundColor: colors.elevated,
      marginTop: space.xs,
    },
    end: {
      width: sizes.timeline.node.end,
      height: sizes.timeline.node.end,
      borderRadius: sizes.timeline.node.end / 2,
      borderWidth: border.emphasis,
      marginTop: sizes.timeline.node.endDrop,
    },
    // 12dp between rows, outside the selected fill (radius.stayRow 12).
    placeOuter: { flex: 1, paddingBottom: space.xs },
    place: {
      marginTop: -space.xs,
      paddingTop: space.xs,
      paddingLeft: space.s,
      paddingRight: space.s,
      paddingBottom: space.xs,
      borderRadius: radius.input,
      overflow: 'hidden',
    },
    address: {
      color: colors.text,
      ...type.cardTitle,

      fontVariant: ['tabular-nums'],
    },
    asking: { color: colors.textMuted, fontWeight: type.body.fontWeight, minHeight: sizes.timeline.sectionHeight },
    second: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: space.s,
      marginTop: space.xs,
    },
    pill: {
      // 18dp, taller with a large system font (膠囊可以變高、不裁字).
      minHeight: sizes.timeline.pill.height,
      borderRadius: sizes.timeline.pill.height / 2,
      paddingHorizontal: space.s,
      justifyContent: 'center',
    },
    pillText: { fontSize: type.micro.fontSize, fontWeight: type.micro.fontWeight },
    note: { color: colors.textMuted, fontSize: type.small.fontSize },
    sectionText: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.xs,
      paddingLeft: space.s,
    },
    movement: { color: colors.textMuted, fontSize: type.caption.fontSize, flexShrink: 1 },
    bold: { color: colors.text, fontWeight: type.status.fontWeight },
  });
});
