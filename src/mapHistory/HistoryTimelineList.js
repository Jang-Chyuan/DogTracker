import { useTheme, useStyles, makeStyles } from '../theme/ThemeProvider';
import { isReduceMotion } from '../utils/reduceMotion';
import { touch, size as sizes, space, type, border, radius, fontScale } from '../theme/tokens';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  LayoutAnimation,
  PixelRatio,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Glyph from '../map/Glyph';
import { LEAVE_SHAPE } from '../map/LeaveGeometry';
import Skeleton from '../components/Skeleton';
import { rangeEndRows, timelinePresentation } from '../history/HistoryTimelinePresentation';

import {
  interruptionText,
  nodePill,
  nodeTimes,
  placeLines,
  placeSpeech,
  sectionSpeech,
  sectionText,
  leavesFrom,
  clock,
} from '../history/HistoryText';
import { usePlaceNames } from '../placement/AddressLookup';
import { rowKey } from '../history/screen/HistoryScreenCursor';
import { withAlpha } from '../history/screen/HistoryMapModel';

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
// The departure time's box, centred on the chevron: tall enough for the
// caption at the largest font the time column allows (a shorter box clips it).
const LEAVE_TIME_BOX = Math.ceil(type.caption.lineHeight * TIME_MAX_SCALE * 2);

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

/**
 * Where a row's track draws, top to bottom ({ top, height } in dp, from the
 * row's top): only whole dots or dashes (判定表「時間軸清單」), none cut by
 * the row's edges or by a cleared stretch (`clears`: [{ top, bottom }], a
 * node, the leave chevron, the movement icon, each with its gap), as the
 * PNG's trackOps. A solid line runs right up to each cleared stretch.
 */
export function trackMarks(kind, height, clears = []) {
  if (!kind || !(height > 0)) return [];
  const segments = [];
  let top = 0, openTop = true;
  for (const clear of [...clears].sort((a, b) => a.top - b.top)) {
    if (clear.top > top) segments.push({ top, bottom: Math.min(clear.top, height), openTop, openBottom: false });
    if (clear.bottom > top) { top = clear.bottom; openTop = false; }
  }
  segments.push({ top, bottom: height, openTop, openBottom: true });
  const marks = [];
  for (const segment of segments) {
    if (segment.bottom <= segment.top) continue;
    if (kind === 'solid') {
      // To the row's bottom edge (`toEnd`): no hairline where the next row's line goes on.
      marks.push({ top: segment.top, height: segment.bottom - segment.top, ...(segment.openBottom && { toEnd: true }) });
      continue;
    }
    const [mark, gap] = kind === 'gap' ? sizes.timeline.noDataDash : [sizes.timeline.dot, sizes.timeline.dotGap];
    // At the row's edges half a gap, so the next row's marks keep the spacing.
    const from = segment.top + (segment.openTop ? gap / 2 : 0);
    const room = segment.bottom - (segment.openBottom ? gap / 2 : 0) - from;
    const count = Math.floor((room + gap) / (mark + gap));
    if (count <= 0) continue;
    const start = from + (room + gap - count * (mark + gap)) / 2;
    for (let i = 0, at = start; i < count; i += 1, at += mark + gap) marks.push({ top: at, height: mark });
  }
  return marks;
}

const NO_CLEARS = [];
// The movement icon in the middle of a movement row and its gap above and below.
const iconClear = height => [{ top: height / 2 - sizes.timeline.icon / 2 - space.xs, bottom: height / 2 + sizes.timeline.icon / 2 + space.xs }];

function Track({ kind, color, clears = NO_CLEARS, icon = false }) {
  const styles = useStyles(getStyles);
  const [height, setHeight] = useState(0);
  if (!kind) return null;
  const marks = trackMarks(kind, height, icon ? iconClear(height) : clears);
  const look = kind === 'solid' ? [styles.solid, { backgroundColor: color }]
    : kind === 'gap' ? styles.dash : [styles.dot, { backgroundColor: color }];
  return (
    <View style={styles.track} onLayout={event => setHeight(event.nativeEvent.layout.height)} testID="track-line">
      {marks.map(mark => (
        <View key={mark.top} style={[look, styles.mark, mark.toEnd ? [styles.toEnd, { top: mark.top }] : { top: mark.top, height: mark.height }]} />
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

function Node({ node, color, centered = false, rangeStart = false, rangeEnd = false, selected = false }) {
  const { colors, opacity } = useTheme();
  const styles = useStyles(getStyles);
  const centeredStyle = centered ? { marginTop: 0 } : null;
  // 2026-10-14 (user, #163 round 3): the range's first / last row is its
  // start / end — the hollow 出發 circle, the solid end circle — whatever
  // the row is (a stay keeps its minutes and address, but no number).
  if (rangeStart && rangeEnd) {
    return (
      <View style={[styles.bothEnds, centeredStyle, { borderColor: color }]} testID="range-both-node">
        <View style={[styles.endCore, styles.bothEndsCore, { backgroundColor: color }]} />
      </View>
    );
  }
  if (rangeStart) return <Node node={{ type: 'departure' }} color={color} centered={centered} />;
  if (rangeEnd) return <Node node={{ type: 'end' }} color={color} centered={centered} />;
  switch (node.type) {
    case 'departure':
      return <View style={[styles.departure, centeredStyle, { borderColor: color }]} />;
    case 'stop':
    case 'switch':
      // 2026-10-14 (user): as the map's stop marker — white, a 2dp ring and
      // the number in the route colour; solid (white number) only while its
      // row is the selected one, with its map marker. A stay without a number
      // never gets an empty numbered circle: a small plain dot.
      if (node.number == null) {
        return (
          <View style={[styles.plainStopBox, centeredStyle]} testID="node-plain-stop">
            <View style={[styles.plainStop, { backgroundColor: color }]} />
          </View>
        );
      }
      return (
        <View style={[styles.numbered, centeredStyle]} testID={`node-number-${node.number}`}>
          <View style={[styles.numberedRing, { borderColor: color }, selected && { backgroundColor: color }]}>
            {/* A number in a fixed 24dp circle: it does not grow with the font. */}
            <Text style={[styles.number, { color: selected ? colors.onRoute : color }]} allowFontScaling={false}>{node.number}</Text>
          </View>
        </View>
      );

    case 'indoor':
      return (
        <View style={[styles.indoor, centeredStyle]}>
          <Glyph name="house" color={colors.onRoute} size={sizes.timeline.node.holdGlyph} />
        </View>
      );
    case 'resume':
      return <View style={[styles.resume, centeredStyle, { borderColor: color }]} />;
    default:
      // 18dp solid with a ring of the route colour (opacity.endRing) around
      // it, as the PNG's: two views, since a translucent border would only
      // show the fill under it (2026-10-14: the ring never showed).
      return (
        <View style={[styles.end, centeredStyle]}>
          <View style={[styles.endRing, { backgroundColor: withAlpha(color, opacity.endRing) }]}>
            <View style={[styles.endCore, { backgroundColor: color }]} />
          </View>
        </View>
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

function PlaceRowView({ node, next, color, place, selected, onPress, onRowLayout, onRowBox, rangeStart = false, rangeEnd = false }) {
  const styles = useStyles(getStyles);
  const { fontScale: scale = 1 } = useWindowDimensions();
  const firstLine = { height: Math.ceil(type.cardTitle.lineHeight * scale) };
  const tap = useTap(onPress, node);
  const onLayout = onRowLayout || onRowBox
    ? event => {
      const { y, height } = event.nativeEvent.layout;
      onRowLayout?.(node.start, y);
      onRowBox?.(rowKey(node), y, height);
    }
    : undefined;
  const [start] = nodeTimes(node);
  const lines = placeLines(node, place);
  const note = interruptionText(node);
  const pill = nodePill(node);
  const pending = place?.state === 'pending';
  const leaving = leavesFrom(node, next);
  const track = useMemo(() => placeTrack(firstLine.height, leaving), [firstLine.height, leaving]);
  // No address (not found, offline, timed out): the place's coordinates.
  const title = lines.title;
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.pressedRow]}
      hitSlop={ROW_SLOP}
      testID={`timeline-${node.type}`}
      {...tap}
      onLayout={onLayout}
      accessibilityRole="button"
      accessibilityLabel={placeSpeech(node, title)}
      accessibilityState={{ selected: !!selected }}
    >
      <View style={[styles.timeColumn, timeWidth()]}>
        <Text style={styles.time} maxFontSizeMultiplier={TIME_MAX_SCALE}>
          {start}
        </Text>
        {/* When it left (2026-10-14): smaller, level with the chevron. */}
        {leaving && (
          <View style={[styles.leaveTimeBox, { top: track.chevron.top + track.chevron.height / 2 - LEAVE_TIME_BOX / 2 }]}
            testID="leave-time-box">
            <Text style={styles.leaveTime} maxFontSizeMultiplier={TIME_MAX_SCALE} testID="leave-time">
              {clock(node.end)}
            </Text>
          </View>
        )}
      </View>
      <View style={[styles.trackColumn, { minHeight: track.minHeight }]}>
        {/* The line under a node is the next row's (判定表「時間軸清單」). */}
        <Track kind={lineOf(next)} color={color} clears={track.clears} />
        <View style={[styles.firstLineCenter, firstLine]} testID="place-node-first-line">
          <Node node={node} color={color} centered rangeStart={rangeStart} rangeEnd={rangeEnd} selected={!!selected} />
        </View>
        {/* Leaving this stay (2026-10-14, moved onto the line 2026-10-14): a
            down chevron on the next row's line, line above and below it. */}
        {leaving && (
          <View style={[styles.leave, { top: track.glyphTop }]} testID="leave-chevron">
            <Glyph name="leave" color={color} size={sizes.timeline.leave} />
          </View>
        )}
      </View>
      <View style={styles.placeOuter}>
        {/* The selected row (2026-10-14, any row): a pale fill of the route
            colour and a 4dp route-colour edge on its left. */}
        <View
          style={[styles.place, selected && { backgroundColor: `${color}1A` }]}
          testID={selected ? 'timeline-selected' : undefined}
        >
          {selected && <View style={[styles.selectedEdge, { backgroundColor: color }]} testID="selected-row-edge" />}
          <View style={styles.placeHeading}>
            {pill && <View style={[styles.firstLineCenter, firstLine]} testID="place-pill-first-line"><Pill pill={pill} color={color} /></View>}
            {pending ? <View style={[styles.address, styles.firstLineCenter, firstLine]}>
              <Skeleton shape="address" testID="place-address-pending" />
            </View> : <Text style={[styles.address, place?.state !== 'found' && styles.addressMissing]} testID="place-title">
              {title}
            </Text>}
          </View>
          {note ? <Text style={styles.note}>{note}</Text> : null}
        </View>
      </View>
    </Pressable>
  );
}

// A cursor move changes one row's `selected`; the rest of a long day's rows
// (hundreds of views) are left alone (068). The address is compared by what
// it says: usePlaceNames answers with new objects on every render.
const samePlace = (a, b) => a === b || (a?.state === b?.state && a?.text === b?.text);
const PlaceRow = React.memo(PlaceRowView, (before, after) =>
  before.node === after.node && before.next === after.next && before.color === after.color
  && before.selected === after.selected && before.onPress === after.onPress
  && before.onRowLayout === after.onRowLayout && before.onRowBox === after.onRowBox
  && samePlace(before.place, after.place)
  && before.rangeStart === after.rangeStart && before.rangeEnd === after.rangeEnd);

function SectionRowView({ section, from = null, color, onPress, selected = false, onRowBox }) {
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
      onLayout={onRowBox ? event => onRowBox(rowKey(section), event.nativeEvent.layout.y,
        event.nativeEvent.layout.height) : undefined}
      accessibilityRole="button"
      accessibilityLabel={sectionSpeech(section, from)}
      accessibilityState={{ selected: !!selected }}
    >
      <View style={[styles.timeColumn, timeWidth()]} />
      <View style={[styles.trackColumn, styles.transportTrack]}>
        <Track kind={lineOf(section)} color={color} icon />
        <View style={styles.transportIcon}>
          <Glyph
            name={text.icon}
            color={muted ? colors.iconMuted : color}
            size={sizes.timeline.icon}
          />
        </View>
      </View>
      <View style={[styles.sectionText, selected && [styles.sectionSelected, { backgroundColor: `${color}1A` }]]}
        testID={selected ? 'timeline-selected' : undefined}>
        {selected && <View style={[styles.selectedEdge, { backgroundColor: color }]} testID="selected-row-edge" />}
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
const SectionRow = React.memo(SectionRowView);

/**
 * The time-line list of one dog or my route (H1/H2, 判定表「時間軸清單」):
 * places (出發, numbered stays and switch points, holds, 恢復記錄, the end)
 * with the movement and 沒有資料 rows between them. `selectedKey` is the
 * selected row's `${type}:${start}` (any row, HistoryScreenCursor.rowKey);
 * a tap on a row calls `onPressNode` with its node; `onRowLayout(start, y)`
 * says where each place row sits, `onRowBox(key, y, height)` every row.
 */
function HistoryTimelineList({
  model,
  color,
  selectedKey = null,
  onPressNode,
  onRowLayout,
  onRowBox,
}) {
  const nodes = useMemo(() => timelinePresentation(model.nodes), [model.nodes]);
  const ends = useMemo(() => rangeEndRows(nodes), [nodes]);
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
            from={isSection(nodes[index - 1]) ? null : nodes[index - 1] ?? null}
            color={color}
            onPress={onPressNode}
            selected={selectedKey != null && rowKey(node) === selectedKey}
            onRowBox={onRowBox}
          />
        ) : (
          <PlaceRow
            key={`n${node.type}${node.start}-${index}`}
            node={node}
            color={color}
            place={places[index]}
            selected={selectedKey != null && rowKey(node) === selectedKey}
            onPress={onPressNode}
            onRowLayout={onRowLayout}
            onRowBox={onRowBox}
            next={isSection(nodes[index + 1]) ? nodes[index + 1] : null}
            rangeStart={ends.start === index}
            rangeEnd={ends.end === index}
          />
        ),
      )}
    </View>
  );
}

// Transport rows are tall enough to expose line above and below the glyph.
// Only shorter footprints need extra slop to reach the minimum hit target.
const ROW_SLOP = { top: space.xs, bottom: space.xs };

const isSection = node => ['movement', 'gap'].includes(node?.type);

/**
 * A place row's track (dp from the row's top): the line under the node is
 * the next row's and starts a gap below the node. Leaving a stay (2026-10-14,
 * the user: the chevron read as part of the node): a short stretch of that
 * line, then the chevron with a gap above and below, then the line goes on
 * to the movement icon. The row is at least tall enough for that.
 */
export function placeTrack(firstLineHeight, leaving) {
  const { leaveGap: gap, leaveLine, leaveBelow, leave } = sizes.timeline;
  const lineTop = firstLineHeight / 2 + sizes.timeline.node.stop / 2 + gap;
  if (!leaving) return { clears: [{ top: 0, bottom: lineTop }], minHeight: 0, chevron: null, glyphTop: 0 };
  const top = lineTop + leaveLine + gap;
  const height = (leave * (LEAVE_SHAPE.to - LEAVE_SHAPE.from)) / 24;
  return {
    clears: [{ top: 0, bottom: lineTop }, { top: top - gap, bottom: top + height + gap }],
    minHeight: Math.ceil(top + height + gap + leaveBelow),
    // The chevron's drawn shape (not its 24-unit box): the time is level with it.
    chevron: { top, height },
    glyphTop: top - (leave * LEAVE_SHAPE.from) / 24,
  };
}

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
    // A range wholly in one stay: the solid end inside the start's ring.
    bothEnds: {
      width: sizes.timeline.node.stop,
      height: sizes.timeline.node.stop,
      borderRadius: sizes.timeline.node.stop / 2,
      borderWidth: border.heavy,
      backgroundColor: colors.elevated,
      alignItems: 'center',
      justifyContent: 'center',
    },
    leaveTimeBox: { position: 'absolute', right: space.xs, height: LEAVE_TIME_BOX, justifyContent: 'center' },
    leaveTime: {
      color: colors.textMuted,
      ...type.caption,
      fontVariant: ['tabular-nums'],
    },
    sectionRow: { minHeight: sizes.timeline.sectionHeight },
    timeColumn: { width: TIME_WIDTH, alignItems: 'flex-end', paddingRight: space.xs },
    time: {
      color: colors.text,
      ...type.value,

      fontVariant: ['tabular-nums'],

    },
    trackColumn: { width: TRACK_WIDTH, alignItems: 'center' },
    transportTrack: { justifyContent: 'center' },
    // The line stops short of it (trackMarks): no dot or dash runs through it.
    transportIcon: { paddingVertical: space.xs },
    leave: { position: 'absolute' },
    track: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 },
    mark: { position: 'absolute' },
    toEnd: { bottom: 0 },
    solid: { left: TRACK_WIDTH / 2 - sizes.timeline.driveLine / 2, width: sizes.timeline.driveLine },
    // 判定表「時間軸清單」: 3dp dots, 7dp apart.
    dot: { left: TRACK_WIDTH / 2 - sizes.timeline.dot / 2, width: sizes.timeline.dot, borderRadius: sizes.timeline.dot / 2 },
    dash: {
      left: TRACK_WIDTH / 2 - sizes.timeline.noDataLine / 2,
      width: sizes.timeline.noDataLine,
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
    // A 3dp ring of the page colour around the 24dp marker cuts the track.
    numbered: {
      width: sizes.timeline.node.stop + border.heavy * 2,
      height: sizes.timeline.node.stop + border.heavy * 2,
      borderRadius: (sizes.timeline.node.stop + border.heavy * 2) / 2,
      backgroundColor: colors.elevated,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: -sizes.timeline.node.stayLift,
    },
    numberedRing: {
      width: sizes.timeline.node.stop,
      height: sizes.timeline.node.stop,
      borderRadius: sizes.timeline.node.stop / 2,
      borderWidth: border.strong,
      backgroundColor: colors.elevated,
      alignItems: 'center',
      justifyContent: 'center',
    },
    plainStopBox: {
      width: sizes.timeline.node.plainStop + border.heavy * 2,
      height: sizes.timeline.node.plainStop + border.heavy * 2,
      borderRadius: (sizes.timeline.node.plainStop + border.heavy * 2) / 2,
      backgroundColor: colors.elevated,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: space.xs,
    },
    plainStop: {
      width: sizes.timeline.node.plainStop,
      height: sizes.timeline.node.plainStop,
      borderRadius: sizes.timeline.node.plainStop / 2,
    },
    number: { color: colors.onRoute, fontSize: type.small.fontSize, fontWeight: type.stopNumber.fontWeight,
      lineHeight: type.stopNumber.lineHeight, includeFontPadding: false, textAlign: 'center', textAlignVertical: 'center' },
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
      marginTop: sizes.timeline.node.endDrop,
    },
    // The ring reaches border.strong past the 18dp node: the layout keeps 18dp.
    endRing: {
      width: sizes.timeline.node.end + border.strong * 2,
      height: sizes.timeline.node.end + border.strong * 2,
      margin: -border.strong,
      borderRadius: sizes.timeline.node.end / 2 + border.strong,
      alignItems: 'center',
      justifyContent: 'center',
    },
    endCore: {
      width: sizes.timeline.node.end,
      height: sizes.timeline.node.end,
      borderRadius: sizes.timeline.node.end / 2,
    },
    bothEndsCore: {
      width: sizes.timeline.node.stop - border.heavy * 4,
      height: sizes.timeline.node.stop - border.heavy * 4,
      borderRadius: sizes.timeline.node.stop / 2,
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
    firstLineCenter: { justifyContent: 'center', alignItems: 'center' },
    placeHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: space.xs },
    address: {
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: 0,
      minWidth: touch.min,
      color: colors.text,
      ...type.cardTitle,

      fontVariant: ['tabular-nums'],
    },
    addressMissing: { color: colors.textMuted, fontWeight: type.body.fontWeight },
    pill: {
      maxWidth: '100%',
      // 18dp, taller with a large system font (膠囊可以變高、不裁字).
      minHeight: sizes.timeline.pill.height,
      borderRadius: radius.full,
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
    // The selected row's left edge, clipped by the row's 12 corners; a
    // movement row gets the same fill and corners as a place row.
    selectedEdge: { position: 'absolute', left: 0, top: 0, bottom: 0, width: border.emphasis },
    sectionSelected: { borderRadius: radius.input, overflow: 'hidden', paddingRight: space.s },
    bold: { color: colors.text, fontWeight: type.status.fontWeight },
  });
});
