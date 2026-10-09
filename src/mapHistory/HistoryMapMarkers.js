// The views of the history map's markers (DESIGN.md「停留編號」「時間標記」
// 「歷史游標點」). Plain views: GoogleTrackingMap puts them in its markers
// (only it touches the map SDK). Each is laid out so the point it marks is
// the middle of the view (anchor 0.5, 0.5).
import { useTheme, useStyles, makeStyles } from '../theme/ThemeProvider';

import { StyleSheet, Text, View } from 'react-native';
import Glyph from '../map/Glyph';
import DogAvatar from '../dogs/DogAvatar';
import { withAlpha } from '../history/screen/HistoryMapModel';
import { size as sizes } from '../theme/tokens';

const LABEL_LINE = 16;

/** A numbered stay or switch point: white, a 2dp ring and number in the route colour. */
export function StopMarkerView({ number, color }) {
  const styles = useStyles(getStyles);
  return (
    <View style={[styles.stop, { borderColor: color }]}>
      <Text allowFontScaling={false} style={[styles.stopNumber, { color }]}>
        {number}
      </Text>
    </View>
  );
}

/** A hold (停在原處): the house on receiver blue. */
export function IndoorMarkerView() {
  const { colors } = useTheme();
  const styles = useStyles(getStyles);
  return (
    <View style={[styles.stop, styles.indoor]}>
      <Glyph name="house" color={colors.onRoute} size={14} />
    </View>
  );
}

/**
 * A time marker: a hollow ring (7dp, 1.6dp; the range's ends 9dp, 2.4dp) and
 * its time under it, 13sp bold with a white halo. An empty block of the
 * label's height above keeps the ring in the middle.
 */
export function TimeMarkerView({ label, end, color }) {
  const { colors } = useTheme();
  const styles = useStyles(getStyles);
  const ring = end ? sizes.timeMarker.endSize : sizes.timeMarker.size;
  const border = end ? sizes.timeMarker.endBorder : sizes.timeMarker.border;
  return (
    <View style={styles.time}>
      <View style={styles.timeSpacer} />
      <View
        style={{
          width: ring + border * 2,
          height: ring + border * 2,
          borderRadius: ring,
          borderWidth: border,
          borderColor: color,
          backgroundColor: colors.surface,
        }}
      />
      <Text allowFontScaling={false} style={styles.timeLabel}>
        {label}
      </Text>
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
export function CursorMarkerView({
  lines,
  color,
  stale = false,
  onLabelHeight,
}) {
  const { opacity, colors } = useTheme();
  const styles = useStyles(getStyles);
  const dot = sizes.cursor.dot + sizes.cursor.border * 2;
  return (
    <View style={styles.cursor}>
      <View
        style={styles.cursorLabel}
        onLayout={event => onLabelHeight?.(event.nativeEvent.layout.height)}
      >
        <Text allowFontScaling={false} style={styles.cursorTime}>
          {lines?.[0]}
        </Text>
        <Text allowFontScaling={false} style={styles.cursorDetail}>
          {lines?.[1]}
        </Text>
      </View>
      <View style={{ height: CURSOR_GAP }} />
      <View
        style={[
          styles.halo,
          stale
            ? styles.staleHalo
            : { backgroundColor: withAlpha(color, opacity.cursorHalo) },
        ]}
      >
        <View
          style={{
            width: dot,
            height: dot,
            borderRadius: dot / 2,
            borderWidth: sizes.cursor.border,
            borderColor: colors.surface,
            backgroundColor: stale ? colors.staleRing : color,
          }}
        />
      </View>
    </View>
  );
}
// The label's bottom is 12dp above the dot's ring; the halo reaches 5dp
// higher than the ring, so 7dp of space between label and halo.
export const CURSOR_GAP =
  sizes.cursor.labelGap -
  (sizes.cursor.halo - (sizes.cursor.dot + sizes.cursor.border * 2)) / 2;

/** The cursor marker's anchor for a label `labelHeight` high: the dot's centre. */
export function cursorAnchor(labelHeight, face = false) {
  if (face) {
    const total = labelHeight + FACE_GAP + FACE_HALO + FACE_TAG_GAP + FACE_TAG;
    return { x: 0.5, y: (labelHeight + FACE_GAP + FACE_HALO / 2) / total };
  }
  const total = labelHeight + CURSOR_GAP + sizes.cursor.halo;
  return { x: 0.5, y: (labelHeight + CURSOR_GAP + CURSOR_BELOW) / total };
}

// 多隻狗時的游標點 (the protagonist): a 40dp face in a glow of its route
// colour, its name right under it, the label 12dp above the face.
export const FACE = 40;
const FACE_HALO = FACE + 16;
const FACE_GAP = sizes.cursor.labelGap - (FACE_HALO - FACE) / 2;
const FACE_TAG_GAP = 2 - (FACE_HALO - FACE) / 2;
const FACE_TAG = 22;

/**
 * The protagonist's cursor among several dogs: the two-line label, the face
 * (its own avatar) with a route-colour glow, and the name tag. Without data
 * at the cursor's time: no glow, a grey dashed ring (判定表「主角在游標時間沒資料」).
 */
export function CursorFaceView({
  lines,
  color,
  stale = false,
  face,
  onLabelHeight,
}) {
  const { opacity, colors } = useTheme();
  const styles = useStyles(getStyles);
  return (
    <View style={styles.cursor}>
      <View
        style={styles.cursorLabel}
        onLayout={event => onLabelHeight?.(event.nativeEvent.layout.height)}
      >
        <Text allowFontScaling={false} style={styles.cursorTime}>
          {lines?.[0]}
        </Text>
        <Text allowFontScaling={false} style={styles.cursorDetail}>
          {lines?.[1]}
        </Text>
      </View>
      <View style={{ height: FACE_GAP }} />
      <View
        style={[
          styles.faceHalo,
          stale
            ? styles.faceStale
            : { backgroundColor: withAlpha(color, opacity.faceGlow) },
        ]}
      >
        <DogAvatar
          avatar={face?.avatar}
          size={FACE}
          border={2.5}
          snapshot
          tint={face?.avatar ? null : { bg: color, line: colors.onRoute }}
        />
      </View>
      <View style={{ height: FACE_TAG_GAP }} />
      <View style={styles.faceTag}>
        <Text
          allowFontScaling={false}
          style={styles.faceName}
          numberOfLines={1}
        >
          {face?.name}
        </Text>
      </View>
    </View>
  );
}

const getStyles = makeStyles(theme => {
  const { colors } = theme;
  return StyleSheet.create({
    stop: {
      width: sizes.stopMarker.size + 4,
      height: sizes.stopMarker.size + 4,
      borderRadius: 13,
      borderWidth: sizes.stopMarker.border,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stopNumber: { fontSize: 12, lineHeight: 14, fontWeight: '700' },
    indoor: { backgroundColor: colors.receiver, borderColor: colors.surface },
    time: { alignItems: 'center' },
    timeSpacer: { height: LABEL_LINE + 2 },
    timeLabel: {
      marginTop: 2,
      height: LABEL_LINE,
      lineHeight: LABEL_LINE,
      fontSize: 13,
      fontWeight: '700',
      color: colors.text,
      textShadowColor: colors.mapLabelHalo,
      textShadowRadius: 3,
      paddingHorizontal: 3,
      textShadowOffset: { width: 0, height: 0 },
    },
    cursor: { alignItems: 'center', paddingHorizontal: 4, paddingBottom: 0 },
    cursorLabel: {
      backgroundColor: colors.surface,
      borderRadius: 10,
      borderWidth: 1,
      // Floats on the map: floatingOutline (= line in light).
      borderColor: colors.floatingOutline,
      paddingVertical: sizes.cursor.labelPaddingV,
      paddingHorizontal: sizes.cursor.labelPaddingH,
      alignItems: 'center',
      elevation: 3,
    },
    cursorTime: {
      color: colors.text,
      fontSize: 16,
      lineHeight: 20,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    cursorDetail: { color: colors.textMuted, fontSize: 13, lineHeight: 17 },
    halo: {
      width: sizes.cursor.halo,
      height: sizes.cursor.halo,
      borderRadius: sizes.cursor.halo / 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    staleHalo: {
      borderWidth: 2,
      borderStyle: 'dashed',
      borderColor: colors.staleRing,
    },
    faceHalo: {
      width: FACE_HALO,
      height: FACE_HALO,
      borderRadius: FACE_HALO / 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    faceStale: {
      width: FACE + 8,
      height: FACE + 8,
      margin: (FACE_HALO - FACE - 8) / 2,
      borderWidth: 2,
      borderStyle: 'dashed',
      borderColor: colors.staleRing,
    },
    faceTag: {
      height: FACE_TAG,
      paddingHorizontal: 6,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: colors.floatingOutline,
      backgroundColor: colors.surface,
      justifyContent: 'center',
      maxWidth: 160,
    },
    faceName: {
      fontSize: 13,
      lineHeight: 16,
      fontWeight: '700',
      color: colors.text,
    },
  });
});
