// The views of the history map's markers (DESIGN.md「停留編號」「時間標記」
// 「歷史游標點」). Plain views: GoogleTrackingMap puts them in its markers
// (only it touches the map SDK). Each is laid out so the point it marks is
// the middle of the view (anchor 0.5, 0.5).
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Glyph from '../map/Glyph';
import { withAlpha } from '../history/screen/HistoryMapModel';
import { colors, opacity, size as sizes } from '../theme/tokens';

const LABEL_LINE = 16;

/** A numbered stay or switch point: white, a 2dp ring and number in the route colour. */
export function StopMarkerView({ number, color }) {
  return (
    <View style={[styles.stop, { borderColor: color }]}>
      <Text allowFontScaling={false} style={[styles.stopNumber, { color }]}>{number}</Text>
    </View>
  );
}

/** A hold (停在原處): the house on receiver blue. */
export function IndoorMarkerView() {
  return (
    <View style={[styles.stop, styles.indoor]}>
      <Glyph name="house" color={colors.surface} size={14} />
    </View>
  );
}

/**
 * A time marker: a hollow ring (7dp, 1.6dp; the range's ends 9dp, 2.4dp) and
 * its time under it, 13sp bold with a white halo. An empty block of the
 * label's height above keeps the ring in the middle.
 */
export function TimeMarkerView({ label, end, color }) {
  const ring = end ? sizes.timeMarker.endSize : sizes.timeMarker.size;
  const border = end ? sizes.timeMarker.endBorder : sizes.timeMarker.border;
  return (
    <View style={styles.time}>
      <View style={styles.timeSpacer} />
      <View style={{ width: ring + border * 2, height: ring + border * 2, borderRadius: ring, borderWidth: border,
        borderColor: color, backgroundColor: colors.surface }} />
      <Text allowFontScaling={false} style={styles.timeLabel}>{label}</Text>
    </View>
  );
}

/** Its height, for the marker's anchor: the label above the dot (see CursorMarkerView). */
export const CURSOR_BELOW = sizes.cursor.halo / 2;

/**
 * The cursor: a 16dp dot in the route colour with a 3dp white ring and a
 * 32dp halo (18%); its two-line label 12dp above (radius 10, surface, 1dp
 * line, shadow). In a stretch without data: grey, with a dashed staleRing.
 * `onLabelHeight` reports the label's height (the marker's anchor needs it).
 */
export function CursorMarkerView({ lines, color, stale = false, onLabelHeight }) {
  const dot = sizes.cursor.dot + sizes.cursor.border * 2;
  return (
    <View style={styles.cursor}>
      <View style={styles.cursorLabel} onLayout={event => onLabelHeight?.(event.nativeEvent.layout.height)}>
        <Text allowFontScaling={false} style={styles.cursorTime}>{lines?.[0]}</Text>
        <Text allowFontScaling={false} style={styles.cursorDetail}>{lines?.[1]}</Text>
      </View>
      <View style={{ height: CURSOR_GAP }} />
      <View style={[styles.halo, stale ? styles.staleHalo : { backgroundColor: withAlpha(color, opacity.cursorHalo) }]}>
        <View style={{ width: dot, height: dot, borderRadius: dot / 2, borderWidth: sizes.cursor.border,
          borderColor: colors.surface, backgroundColor: stale ? colors.staleRing : color }} />
      </View>
    </View>
  );
}
// The label's bottom is 12dp above the dot's ring; the halo reaches 5dp
// higher than the ring, so 7dp of space between label and halo.
export const CURSOR_GAP = sizes.cursor.labelGap - (sizes.cursor.halo - (sizes.cursor.dot + sizes.cursor.border * 2)) / 2;

/** The cursor marker's anchor for a label `labelHeight` high: the dot's centre. */
export function cursorAnchor(labelHeight) {
  const total = labelHeight + CURSOR_GAP + sizes.cursor.halo;
  return { x: 0.5, y: (labelHeight + CURSOR_GAP + CURSOR_BELOW) / total };
}

const styles = StyleSheet.create({
  stop: { width: sizes.stopMarker.size + 4, height: sizes.stopMarker.size + 4, borderRadius: 13,
    borderWidth: sizes.stopMarker.border, backgroundColor: colors.surface, alignItems: 'center',
    justifyContent: 'center' },
  stopNumber: { fontSize: 12, lineHeight: 14, fontWeight: '700' },
  indoor: { backgroundColor: colors.receiver, borderColor: colors.surface },
  time: { alignItems: 'center' },
  timeSpacer: { height: LABEL_LINE + 2 },
  timeLabel: { marginTop: 2, height: LABEL_LINE, lineHeight: LABEL_LINE, fontSize: 13, fontWeight: '700',
    color: colors.text, textShadowColor: colors.mapLabelHalo, textShadowRadius: 3, paddingHorizontal: 3,
    textShadowOffset: { width: 0, height: 0 } },
  cursor: { alignItems: 'center', paddingHorizontal: 4, paddingBottom: 0 },
  cursorLabel: { backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.line,
    paddingVertical: sizes.cursor.labelPaddingV, paddingHorizontal: sizes.cursor.labelPaddingH,
    alignItems: 'center', elevation: 3 },
  cursorTime: { color: colors.text, fontSize: 16, lineHeight: 20, fontWeight: '700', fontVariant: ['tabular-nums'] },
  cursorDetail: { color: colors.textMuted, fontSize: 13, lineHeight: 17 },
  halo: { width: sizes.cursor.halo, height: sizes.cursor.halo, borderRadius: sizes.cursor.halo / 2,
    alignItems: 'center', justifyContent: 'center' },
  staleHalo: { borderWidth: 2, borderStyle: 'dashed', borderColor: colors.staleRing },
});
