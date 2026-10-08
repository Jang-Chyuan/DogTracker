import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Glyph from '../map/Glyph';
import { colors } from '../theme/tokens';
import {
  emptyText, interruptionText, nodePill, nodeTimes, placeCoordinates, placeTitle, sectionText, summaryText,
} from '../history/HistoryText';

// 判定表「時間軸清單」: time column 54dp, track 36dp, then the place.
const TIME_WIDTH = 54;
const TRACK_WIDTH = 36;
// Enough dots or dashes for the tallest row; the row clips the rest.
const MARKS = 40;
const PLAIN_PILL = '#F1EEEC';
const INDOOR_PILL = '#E6EEF3';

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
      return <View style={styles.indoor}><Glyph name="house" color="#FFFFFF" size={14} /></View>;
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
    plain: [{ backgroundColor: PLAIN_PILL }, { color: colors.textMuted }],
    manual: [{ backgroundColor: colors.tonal }, { color: colors.tonalText }],
    closed: [{ backgroundColor: colors.warnBg }, { color: colors.warn }],
    indoor: [{ backgroundColor: INDOOR_PILL }, { color: colors.receiver }],
  }[pill.tone];
  return <View style={[styles.pill, tone[0]]}><Text style={[styles.pillText, tone[1]]}>{pill.text}</Text></View>;
}

function PlaceRow({ node, next, color }) {
  const [start, end] = nodeTimes(node);
  const note = interruptionText(node);
  return (
    <View style={styles.row} testID={`timeline-${node.type}`}>
      <View style={styles.timeColumn}>
        <Text style={styles.time}>{start}</Text>
        {end ? <Text style={styles.timeEnd}>{end}</Text> : null}
      </View>
      <View style={styles.trackColumn}>
        {/* The line under a node is the next row's (判定表「時間軸清單」). */}
        <Track kind={lineOf(next)} color={color} from={12} />
        <Node node={node} color={color} />
      </View>
      <View style={styles.place}>
        <Text style={styles.address}>{placeTitle(node)}</Text>
        <View style={styles.second}>
          <Pill pill={nodePill(node)} color={color} />
          {placeCoordinates(node) ? <Text style={styles.note}>{placeCoordinates(node)}</Text> : null}
          {note ? <Text style={styles.note}>{note}</Text> : null}
        </View>
      </View>
    </View>
  );
}

function SectionRow({ section, color }) {
  const text = sectionText(section);
  const muted = section.type === 'gap';
  return (
    <View style={[styles.row, styles.sectionRow]} testID={`timeline-${section.type}-${section.mode}`}>
      <View style={styles.timeColumn} />
      <View style={styles.trackColumn}><Track kind={lineOf(section)} color={color} /></View>
      <View style={styles.sectionText}>
        <Glyph name={text.icon} color={muted ? colors.iconMuted : color} size={20} />
        <Text style={styles.movement}>
          {text.lead}{text.time ? ' ' : ''}<Text style={styles.bold}>{text.time}</Text>{text.rest}
        </Text>
      </View>
    </View>
  );
}

/**
 * The time-line list of one dog or my route (H1/H2, 判定表「時間軸清單」):
 * the summary, then places (出發, numbered stays and switch points, holds,
 * 恢復記錄, the end) with the movement and 沒有資料 rows between them.
 * Shown on the old history page until 055 builds the new one.
 */
function HistoryTimelineList({ model, subject, today, name, color, loading, error }) {
  if (error) return <Text style={styles.empty}>{error}</Text>;
  if (!model) return loading ? <Text style={styles.empty}>讀取中…</Text> : null;
  if (!model.dayRecords) return <Text style={styles.empty}>{emptyText({ subject, today, name })}</Text>;
  if (!model.points.length) return <Text style={styles.empty}>這段時間沒有紀錄</Text>;
  const summary = summaryText(model, { subject });
  const nodes = model.nodes;
  return (
    <View testID="history-timeline">
      <View style={styles.summary} accessible accessibilityLabel={`${summary.title}，${summary.detail}`}>
        <Text style={styles.title}>{summary.title}</Text>
        <Text style={styles.detail}>{summary.detail}</Text>
      </View>
      {nodes.map((node, index) => (['movement', 'gap'].includes(node.type)
        ? <SectionRow key={`s${node.start}-${index}`} section={node} color={color} />
        : <PlaceRow key={`n${node.type}${node.start}-${index}`} node={node} color={color}
          next={['movement', 'gap'].includes(nodes[index + 1]?.type) ? nodes[index + 1] : null} />))}
    </View>
  );
}

// The page re-renders every second (useMapHistory's clock); the list only
// when its model changes.
export default React.memo(HistoryTimelineList);

const styles = StyleSheet.create({
  summary: { paddingVertical: 10 },
  title: { color: colors.text, fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'] },
  detail: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
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
  dot: { width: 3, height: 3, borderRadius: 1.5, marginBottom: 4 },
  dash: { width: 2, height: 6, marginBottom: 4, backgroundColor: colors.noDataLine },
  departure: { width: 16, height: 16, borderRadius: 8, borderWidth: 3, backgroundColor: colors.surface, marginTop: 2 },
  numbered: { width: 30, height: 30, borderRadius: 15, borderWidth: 3, borderColor: colors.surface,
    alignItems: 'center', justifyContent: 'center', marginTop: -3 },
  number: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  indoor: { width: 30, height: 30, borderRadius: 15, borderWidth: 3, borderColor: colors.surface,
    backgroundColor: colors.receiver, alignItems: 'center', justifyContent: 'center', marginTop: -3 },
  resume: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, backgroundColor: colors.surface, marginTop: 4 },
  end: { width: 18, height: 18, borderRadius: 9, borderWidth: 4, marginTop: 1 },
  place: { flex: 1, paddingLeft: 4, paddingBottom: 12 },
  address: { color: colors.text, fontSize: 15, fontWeight: '700', lineHeight: 20, fontVariant: ['tabular-nums'] },
  second: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 4 },
  pill: { height: 18, borderRadius: 9, paddingHorizontal: 7, justifyContent: 'center' },
  pillText: { fontSize: 11, fontWeight: '700' },
  note: { color: colors.textMuted, fontSize: 12 },
  sectionText: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 4 },
  movement: { color: colors.textMuted, fontSize: 13, flexShrink: 1 },
  bold: { color: colors.text, fontWeight: '700' },
  empty: { color: colors.textMuted, fontSize: 16, textAlign: 'center', paddingVertical: 32 },
});
