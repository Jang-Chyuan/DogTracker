// The views of the history map's markers (DESIGN.md「停留編號」「時間標記」
// 「歷史游標點」). Plain views: GoogleTrackingMap puts them in its markers
// (only it touches the map SDK). Each is laid out so the point it marks is
// the middle of the view (anchor 0.5, 0.5).
import { useTheme, useStyles, makeStyles } from '../theme/ThemeProvider';

import { StyleSheet, Text, View } from 'react-native';
import Glyph from '../map/Glyph';
import DogAvatar from '../dogs/DogAvatar';
import { withAlpha } from '../history/screen/HistoryMapModel';
import { size as sizes, border as borders, type, space, radius } from '../theme/tokens';

const LABEL_LINE = type.mapLabel.lineHeight;

/**
 * A numbered stay or switch point: white, a 2dp ring and number in the route
 * colour. Stays at one place share one marker (`label` 「1・3」): a capsule.
 */
export function StopMarkerView({ number, label = null, color }) {
  const styles = useStyles(getStyles);
  return (
    <View style={[styles.stop, label != null && styles.stopGroup, { borderColor: color }]}>
      <Text allowFontScaling={false} style={[styles.stopNumber, { color }]}>
        {label ?? number}
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
      <Glyph name="house" color={colors.onRoute} size={sizes.timeline.node.holdGlyph} />
    </View>
  );
}

/**
 * A time marker: a hollow ring (7dp, 1.6dp; the range's ends 9dp, 2.4dp) and
 * its time under it, 13sp bold with a white halo. The end (`last`) is solid
 * like the list's end node: a 9dp route-colour dot in a 2.4dp ring of the
 * route colour at opacity.endRing. An empty block of the label's height
 * above keeps the ring in the middle.
 */
export function TimeMarkerView({ label, end, last = false, color }) {
  const { colors, opacity } = useTheme();
  const styles = useStyles(getStyles);
  const ring = end ? sizes.timeMarker.endSize : sizes.timeMarker.size;
  const border = end ? sizes.timeMarker.endBorder : sizes.timeMarker.border;
  const outer = ring + border * 2;
  return (
    <View style={styles.time}>
      <View style={styles.timeSpacer} />
      {last ? (
        // Two views: a translucent border would show the fill under it.
        <View
          testID="time-marker-end"
          style={[{
            width: outer,
            height: outer,
            borderRadius: outer / 2,
            backgroundColor: withAlpha(color, opacity.endRing),
          }, styles.centred]}
        >
          <View style={{ width: ring, height: ring, borderRadius: ring / 2, backgroundColor: color }} />
        </View>
      ) : (
        <View
          style={{
            width: outer,
            height: outer,
            borderRadius: ring,
            borderWidth: border,
            borderColor: color,
            backgroundColor: colors.surface,
          }}
        />
      )}
      <Text allowFontScaling={false} style={styles.timeLabel}>
        {label}
      </Text>
    </View>
  );
}

/** Its height, for the marker's anchor: the label above the dot (see CursorMarkerView). */
export const CURSOR_BELOW = sizes.cursor.halo / 2;

/** The same label pixels in the native marker and a collision-only screen overlay. */
export function CursorLabelView({ lines, hidden = false, onLabelHeight, onLabelLayout, layoutKey }) {
  const styles = useStyles(getStyles);
  return <View key={layoutKey} style={[styles.cursorLabel, hidden && styles.hiddenLabel]}
    accessibilityElementsHidden={hidden} importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
    onLayout={event => {
      onLabelHeight?.(event.nativeEvent.layout.height);
      onLabelLayout?.(event.nativeEvent.layout);
    }}>
    <Text allowFontScaling={false} style={styles.cursorTime}>{lines?.[0]}</Text>
    <Text allowFontScaling={false} style={styles.cursorDetail}>{lines?.[1]}</Text>
  </View>;
}

/**
 * The cursor: a 16dp dot in the route colour with a 3dp white ring and a
 * 32dp halo (18%); its two-line label 12dp above (radius 16, surface, 1dp
 * line, shadow). In a stretch without data: grey, with a dashed staleRing.
 * `onLabelHeight` reports the label's height (the marker's anchor needs it).
 */
export function CursorMarkerView({
  lines,
  color,
  stale = false,
  onLabelHeight,
  onLabelLayout,
  labelLayoutKey,
  labelHidden = false,
}) {
  const { opacity, colors } = useTheme();
  const styles = useStyles(getStyles);
  const dot = sizes.cursor.dot + sizes.cursor.border * 2;
  return (
    <View style={styles.cursor}>
      <CursorLabelView lines={lines} hidden={labelHidden} onLabelHeight={onLabelHeight} onLabelLayout={onLabelLayout} layoutKey={labelLayoutKey} />
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
            borderWidth: borders.heavy,
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
export const FACE = sizes.marker.normal;
const FACE_HALO = FACE + sizes.cursor.labelHaloExpansion;
const FACE_GAP = sizes.cursor.labelGap - (FACE_HALO - FACE) / 2;
const FACE_TAG_GAP = sizes.marker.labelGap - (FACE_HALO - FACE) / 2;
const FACE_TAG = sizes.historyFace.labelHeight;

export function cursorLabelFootprint(label, face = false, marker = null) {
  return { width: label.width, height: label.height,
    above: label.height + (face ? FACE_GAP + FACE_HALO / 2 : CURSOR_GAP + CURSOR_BELOW),
    pinAbove: face ? FACE_HALO / 2 : CURSOR_BELOW,
    pinHalf: face ? (marker ? Math.max(FACE_HALO / 2, marker.width / 2 - space.xs) : FACE_HALO / 2) : sizes.cursor.halo / 2,
    below: face ? Math.max(FACE_HALO / 2 + FACE_TAG_GAP + FACE_TAG,
      marker ? marker.height - label.height - FACE_GAP - FACE_HALO / 2 : 0) : CURSOR_BELOW };
}


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
  onLabelLayout,
  labelLayoutKey,
  labelHidden = false,
}) {
  const { opacity, colors } = useTheme();
  const styles = useStyles(getStyles);
  return (
    <View style={styles.cursor}>
      <CursorLabelView lines={lines} hidden={labelHidden} onLabelHeight={onLabelHeight} onLabelLayout={onLabelLayout} layoutKey={labelLayoutKey} />
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
          border={borders.extraStrong}
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
      width: sizes.stopMarker.size + borders.strong * 2,
      height: sizes.stopMarker.size + borders.strong * 2,
      borderRadius: (sizes.stopMarker.size + borders.strong * 2) / 2,
      borderWidth: borders.strong,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stopGroup: { width: 'auto', minWidth: sizes.stopMarker.size + borders.strong * 2, paddingHorizontal: space.xs },
    stopNumber: { ...type.stopNumber,   },
    indoor: { backgroundColor: colors.receiver, borderColor: colors.surface },
    time: { alignItems: 'center' },
    centred: { alignItems: 'center', justifyContent: 'center' },
    timeSpacer: { height: LABEL_LINE + sizes.marker.labelGap },
    timeLabel: {
      marginTop: sizes.marker.labelGap,
      height: LABEL_LINE,
      lineHeight: LABEL_LINE,
      fontSize: type.caption.fontSize,
      fontWeight: type.captionBold.fontWeight,
      color: colors.text,
      textShadowColor: colors.mapLabelHalo,
      textShadowRadius: 3,
      paddingHorizontal: sizes.timeMarker.labelInset,
      textShadowOffset: { width: 0, height: 0 },
    },
    cursor: { alignItems: 'center', paddingHorizontal: space.xs, paddingBottom: 0 },
    hiddenLabel: { opacity: 0 },
    cursorLabel: {
      backgroundColor: colors.surface,
      borderRadius: radius.cursorLabel,
      borderWidth: borders.hairline,
      // Floats on the map: floatingOutline (= line in light).
      borderColor: colors.floatingOutline,
      paddingVertical: sizes.cursor.labelPaddingV,
      paddingHorizontal: sizes.cursor.labelPaddingH,
      alignItems: 'center',
      elevation: 3,
    },
    cursorTime: {
      color: colors.text,
      fontSize: type.body.fontSize,
      lineHeight: sizes.cursor.timeGlyphLine,
      fontWeight: type.status.fontWeight,
      fontVariant: ['tabular-nums'],
    },
    cursorDetail: { color: colors.textMuted, fontSize: type.caption.fontSize, lineHeight: sizes.cursor.detailGlyphLine },
    halo: {
      width: sizes.cursor.halo,
      height: sizes.cursor.halo,
      borderRadius: sizes.cursor.halo / 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    staleHalo: {
      borderWidth: borders.strong,
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
      width: FACE + sizes.historyFace.staleOutset * 2,
      height: FACE + sizes.historyFace.staleOutset * 2,
      margin: (FACE_HALO - FACE - sizes.historyFace.staleOutset * 2) / 2,
      borderWidth: borders.strong,
      borderStyle: 'dashed',
      borderColor: colors.staleRing,
    },
    faceTag: {
      height: FACE_TAG,
      paddingHorizontal: sizes.mapLabel.paddingH,
      borderRadius: sizes.mapLabel.radius,
      borderWidth: borders.hairline,
      borderColor: colors.floatingOutline,
      backgroundColor: colors.surface,
      justifyContent: 'center',
      maxWidth: sizes.cursor.labelTextMax,
    },
    faceName: {
      ...type.mapLabel,

      color: colors.text,
    },
  });
});
