import React, { useEffect, useRef } from 'react';
import { LayoutAnimation, Pressable, StyleSheet, Text, View } from 'react-native';
import Glyph from '../map/Glyph';
import { colors } from '../theme/tokens';
import {
  interruptionText, nodePill, nodeTimes, placeLines, sectionText,
} from '../history/HistoryText';
import { usePlaceNames } from '../placement/AddressLookup';

// 判定表「時間軸清單」: time column 54dp, track 36dp, then the place.
const TIME_WIDTH = 54;
const TRACK_WIDTH = 36;
// Enough dots or dashes for the tallest row; the row clips the rest.
const MARKS = 40;

const isVehicle = mode => mode === 'driving' || mode === 'ride';

/** The track of one row: dotted (on foot), solid (car), long dash (no data). */
function Track({ kind, color, from = 0 }) {
  if (!kind) return null;
  const style = [styles.track, { top: from }];
  if (kind === 'solid') return <View style={[...style, styles.solid, { backgroundColor: color }]} />;
  const dash = kind === 'gap';
  return (
    <View style={[...style, styles.marks]}>
      {Array.from({ length: MARKS }, (_, index) => (
        <View key={index} style={dash ? styles.dash : [styles.dot, { backgroundColor: color }]} />
      ))}
    </View>
  );
}
const lineOf = section => (!section ? null : section.type === 'gap' ? 'gap' : isVehicle(section.mode) ? 'solid' : 'dots');

function Node({ node, color }) {
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
      return <View style={styles.indoor}><Glyph name="house" color={colors.onRoute} size={14} /></View>;
    case 'resume':
      return <View style={[styles.resume, { borderColor: color }]} />;
    default:
      return <View style={[styles.end, { backgroundColor: color, borderColor: `${color}55` }]} />;
  }
}

function Pill({ pill, color }) {
  if (!pill) return null;
  const tone = {
    stay: [{ backgroundColor: `${color}1F` }, { color }],
    plain: [{ backgroundColor: colors.pillPlain }, { color: colors.textMuted }],
    manual: [{ backgroundColor: colors.tonal }, { color: colors.tonalText }],
    closed: [{ backgroundColor: colors.warnBg }, { color: colors.warn }],
    indoor: [{ backgroundColor: colors.pillIndoor }, { color: colors.receiver }],
  }[pill.tone];
  return <View style={[styles.pill, tone[0]]}><Text style={[styles.pillText, tone[1]]}>{pill.text}</Text></View>;
}

function PlaceRow({ node, next, color, place, selected, onPress, onLayout }) {
  const [start, end] = nodeTimes(node);
  const note = interruptionText(node);
  const lines = placeLines(node, place);
  return (
    <Pressable style={styles.row} testID={`timeline-${node.type}`} onPress={onPress ? () => onPress(node) : undefined}
      onLayout={onLayout} accessibilityRole="button" accessibilityState={{ selected: !!selected }}>
      <View style={styles.timeColumn}>
        <Text style={styles.time}>{start}</Text>
        {end ? <Text style={styles.timeEnd}>{end}</Text> : null}
      </View>
      <View style={styles.trackColumn}>
        {/* The line under a node is the next row's (判定表「時間軸清單」). */}
        <Track kind={lineOf(next)} color={color} from={12} />
        <Node node={node} color={color} />
      </View>
      <View style={styles.placeOuter}>
        {/* The row the cursor is on: a pale fill of the route colour (H2). */}
        <View style={[styles.place, selected && { backgroundColor: `${color}1A` }]}
          testID={selected ? 'timeline-selected' : undefined}>
          {/* Two lines kept while the address is asked for (判定表「清單節點的內容」). */}
          <Text style={[styles.address, lines.titleMuted && styles.asking]} testID="place-title">
            {lines.title}
          </Text>
          <View style={styles.second}>
            <Pill pill={nodePill(node)} color={color} />
            {lines.coordinates ? <Text style={styles.note}>{lines.coordinates}</Text> : null}
            {lines.missing ? <Text style={styles.note}>{lines.missing}</Text> : null}
            {note ? <Text style={styles.note}>{note}</Text> : null}
          </View>
        </View>
      </View>
    </Pressable>
  );
}

function SectionRow({ section, color, onPress }) {
  const text = sectionText(section);
  const muted = section.type === 'gap';
  return (
    <Pressable style={[styles.row, styles.sectionRow]} testID={`timeline-${section.type}-${section.mode}`}
      onPress={onPress ? () => onPress(section) : undefined} accessibilityRole="button">
      <View style={styles.timeColumn} />
      <View style={styles.trackColumn}><Track kind={lineOf(section)} color={color} /></View>
      <View style={styles.sectionText}>
        <Glyph name={text.icon} color={muted ? colors.iconMuted : color} size={20} />
        <Text style={styles.movement}>
          {text.lead}{text.time ? ' ' : ''}<Text style={styles.bold}>{text.time}</Text>{text.rest}
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
function HistoryTimelineList({ model, color, selected = null, onPressNode, onRowLayout }) {
  const nodes = model.nodes;
  const places = usePlaceNames(nodes.map(node => (isSection(node) ? null : node)));
  const states = places.map(place => place.state).join();
  const shown = useRef(states);
  useEffect(() => {
    if (shown.current !== states) LayoutAnimation.configureNext(ADDRESS_MOTION);
    shown.current = states;
  }, [states]);
  return (
    <View testID="history-timeline">
      {nodes.map((node, index) => (isSection(node)
        ? <SectionRow key={`s${node.start}-${index}`} section={node} color={color} onPress={onPressNode} />
        : <PlaceRow key={`n${node.type}${node.start}-${index}`} node={node} color={color} place={places[index]}
          selected={selected != null && node.start === selected} onPress={onPressNode}
          onLayout={onRowLayout ? event => onRowLayout(node.start, event.nativeEvent.layout.y) : undefined}
          next={isSection(nodes[index + 1]) ? nodes[index + 1] : null} />))}
    </View>
  );
}

const isSection = node => ['movement', 'gap'].includes(node?.type);

// Addresses fade in where they land and the rows below slide (180 ms).
const ADDRESS_MOTION = LayoutAnimation.create(180, LayoutAnimation.Types.easeInEaseOut,
  LayoutAnimation.Properties.opacity);

// The screen re-renders on every cursor move; the list only when its model
// or the selected row changes.
export default React.memo(HistoryTimelineList);

const styles = StyleSheet.create({
  // The 12dp between rows is inside the place column, so the track column
  // runs the full row and the line has no breaks.
  row: { flexDirection: 'row' },
  sectionRow: { minHeight: 40 },
  timeColumn: { width: TIME_WIDTH, alignItems: 'flex-end', paddingRight: 4 },
  time: { color: colors.text, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'], lineHeight: 20 },
  timeEnd: { color: colors.textMuted, fontSize: 12, fontVariant: ['tabular-nums'] },
  trackColumn: { width: TRACK_WIDTH, alignItems: 'center' },
  track: { position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center', overflow: 'hidden' },
  solid: { left: TRACK_WIDTH / 2 - 1.5, right: undefined, width: 3 },
  marks: { flexDirection: 'column' },
  // 判定表「時間軸清單」: 3dp dots, 7dp apart.
  dot: { width: 3, height: 3, borderRadius: 1.5, marginBottom: 7 },
  dash: { width: 2, height: 6, marginBottom: 4, backgroundColor: colors.noDataLine },
  departure: { width: 16, height: 16, borderRadius: 8, borderWidth: 3, backgroundColor: colors.surface, marginTop: 2 },
  numbered: { width: 30, height: 30, borderRadius: 15, borderWidth: 3, borderColor: colors.surface,
    alignItems: 'center', justifyContent: 'center', marginTop: -3 },
  number: { color: colors.onRoute, fontSize: 12, fontWeight: '700' },
  indoor: { width: 30, height: 30, borderRadius: 15, borderWidth: 3, borderColor: colors.surface,
    backgroundColor: colors.receiver, alignItems: 'center', justifyContent: 'center', marginTop: -3 },
  resume: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, backgroundColor: colors.surface, marginTop: 4 },
  end: { width: 18, height: 18, borderRadius: 9, borderWidth: 4, marginTop: 1 },
  // 12dp between rows, outside the selected fill (radius.stayRow 12).
  placeOuter: { flex: 1, paddingBottom: 6 },
  place: { marginTop: -4, paddingTop: 4, paddingLeft: 8, paddingRight: 8, paddingBottom: 6, borderRadius: 12,
    overflow: 'hidden' },
  address: { color: colors.text, fontSize: 15, fontWeight: '700', lineHeight: 20, fontVariant: ['tabular-nums'] },
  asking: { color: colors.textMuted, fontWeight: '400', minHeight: 40 },
  second: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 4 },
  pill: { height: 18, borderRadius: 9, paddingHorizontal: 7, justifyContent: 'center' },
  pillText: { fontSize: 11, fontWeight: '700' },
  note: { color: colors.textMuted, fontSize: 12 },
  sectionText: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 8 },
  movement: { color: colors.textMuted, fontSize: 13, flexShrink: 1 },
  bold: { color: colors.text, fontWeight: '700' },
});
