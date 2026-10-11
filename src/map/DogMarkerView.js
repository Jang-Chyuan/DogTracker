import { useTheme, useStyles, makeStyles } from '../theme/ThemeProvider';
import { PixelRatio, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { size as sizes, type, border, space } from '../theme/tokens';
import MapNameTag from './MapNameTag';
import DogAvatar from '../dogs/DogAvatar';
import { problemBadgePosition, houseBadgePosition } from './BadgeGeometry';

// The view inside one dog's map marker (design v3「狗的標記：所有情況」,
// DESIGN.md §15): the face (40dp, 48dp with a problem, +8dp when its card is
// open), a red "!" top right for any problem, a small house bottom left when
// held indoors, and the name tag right under the face — or, where tags would
// overlap, one 「3 隻」 group tag under the lowest face and none under the
// others (DogMarkers.nameTags). Provider-neutral: the map renderer wraps it in
// its own marker, anchored at `anchor` (the centre of the face is the dog's
// position, there is no pointer).

// D14: the widest name text plus the capsule's padding and border.
export const MARKER_WIDTH = sizes.marker.textWidth + 2 * (sizes.mapLabel.paddingH + sizes.mapLabel.border);
// Room above the face for the "!" badge reaching out of it.
const TOP = sizes.marker.headroom;
const { badge, marker: markerSize, mapLabel, groupTag } = sizes;

const fontScale = () => PixelRatio.getFontScale?.() || 1;

// The tag area: two lines of the name tag at most (DESIGN.md: 200% font
// wraps to two lines), or the 32dp group tag.
function tagArea() {
  const lines =
    2 * type.mapLabel.lineHeight * fontScale() +
    2 * (mapLabel.paddingV + mapLabel.border);
  return Math.max(lines, groupTag.height * Math.max(1, fontScale())) + 4;
}

/** The marker view's height and the anchor of the face centre, for a face size. */
export function markerFrame(faceSize, compact = false) {
  if (compact) {
    // External labels have their own markers. Keeping their empty canvas on
    // the face lets the SDK's rectangular hit target cover a neighbouring dog.
    const side = faceSize + 2 * TOP;
    return { width: side, height: side, anchor: { x: 0.5, y: 0.5 } };
  }
  const height = Math.ceil(TOP + faceSize + markerSize.labelGap + tagArea());
  return {
    // Long indoor group text plus its optional problem dot must fit at 200%.
    width: Math.max(MARKER_WIDTH, Math.ceil(8 * type.value.fontSize * fontScale() +
      2 * (mapLabel.paddingH + mapLabel.border) + groupTag.problemDot + groupTag.dotGap + groupTag.safety)),
    height,
    anchor: { x: 0.5, y: (TOP + faceSize / 2) / height },
  };
}

function ProblemBadge({ size }) {
  const { literalColors: themeLiteral } = useTheme();
  const styles = useStyles(getStyles);
  return (
    <View
      testID="dog-badge-problem"
      style={[styles.badge, styles.problem, problemBadgePosition(size)]}
    >
      <Svg width={badge.glyph} height={badge.glyph} viewBox="0 0 24 24">
        <Path
          d="M12 4v10"
          stroke={themeLiteral.avatarFrameMap}
          strokeWidth={4.4}
          strokeLinecap="round"
        />
        <Circle cx={12} cy={20} r={2.6} fill={themeLiteral.avatarFrameMap} />
      </Svg>
    </View>
  );
}

// Centre on the left rim, a quarter face below its centre.
function HouseBadge({ size }) {
  const { literalColors: themeLiteral } = useTheme();
  const styles = useStyles(getStyles);
  return (
    <View
      testID="dog-badge-indoor"
      style={[
        styles.badge,
        styles.house,
        houseBadgePosition(size),
      ]}
    >
      <Svg width={badge.glyph} height={badge.glyph} viewBox="0 0 24 24">
        <Path
          d="M4 11 12 4l8 7v9H4z"
          fill="none"
          stroke={themeLiteral.onRoute}
          strokeWidth={2.8}
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}

// The shadow circle under a face: 1dp wider and 1dp lower (0 1 3 in the
// mockups), 3dp lower and 3dp wider when its card is open.
function shadowFrame(size, selected, width) {
  const spread = selected ? sizes.marker.selectedShadowDrop : sizes.marker.shadowDrop;
  const side = size + 2 * spread;
  return {
    width: side,
    height: side,
    borderRadius: side / 2,
    left: (width - side) / 2,
    top: TOP - spread + (selected ? sizes.marker.selectedShadowDrop : sizes.marker.shadowDrop),
  };
}

/**
 * @param marker DogMarkers.dogMarker output
 * @param tag DogMarkers.nameTags entry: { text, group, problem } or null
 * @param avatar the dog's chosen face (useDogAvatars), or undefined for the default
 */
export default function DogMarkerView({ marker, tag, avatar, onAvatarLoad, compact = false }) {
  const { colors } = useTheme();
  const styles = useStyles(getStyles);
  const { size, problem, indoor, stale, selected, staleRing, tint } = marker;
  const frame = markerFrame(size, compact);
  return (
    <View
      collapsable={false}
      style={[styles.root, { width: frame.width, height: frame.height }]}
    >
      {/* A drawn shadow: a marker is captured as a bitmap, where elevation
             shadows barely show. */}
      <View
        style={[
          styles.shadow,
          selected && styles.selectedShadow,
          shadowFrame(size, selected, frame.width),
        ]}
      />
      <View
        collapsable={false}
        style={[
          styles.face,
          {
            top: TOP,
            left: (frame.width - size) / 2,
            width: size,
            height: size,
            borderRadius: size / 2,
          },
          selected && styles.selected,
        ]}
      >
        {/* History (H7): another dog's face on its route colour; a grey dashed
               ring while it has no data at the cursor's time. */}
        <DogAvatar
          avatar={avatar}
          size={size}
          stale={stale}
          border={markerSize.border}
          onLoad={onAvatarLoad}
          snapshot
          tint={tint ? { bg: tint, line: colors.onRoute } : null}
        />
        {staleRing && (
          <View
            testID="dog-stale-ring"
            style={[styles.staleRing, { borderRadius: (size + sizes.marker.staleRingOutset * 2) / 2 }]}
          />
        )}
        {indoor && <HouseBadge size={size} />}
        {problem && <ProblemBadge size={size} />}
      </View>
      {tag && (
        <View
          style={[styles.tagRow, { top: TOP + size + markerSize.labelGap }]}
        >
          {tag.group > 1 ? (
            <View testID="dog-group-tag" style={styles.groupTag}>
              {tag.problem && (
                <View testID="dog-group-problem" style={styles.groupDot} />
              )}
              <Text style={styles.groupText} numberOfLines={1}>
                {tag.text}
              </Text>
            </View>
          ) : (
            <MapNameTag text={tag.text} maxWidth={MARKER_WIDTH - markerSize.labelSafety} />
          )}
        </View>
      )}
    </View>
  );
}

const getStyles = makeStyles(theme => {
  const { literalColors: themeLiteral, colors } = theme;
  return StyleSheet.create({
    root: { overflow: 'visible' },
    face: {
      position: 'absolute',
      overflow: 'visible',
      backgroundColor: themeLiteral.avatarFrameMap,
    },
    selected: {},
    staleRing: {
      position: 'absolute',
      top: -sizes.marker.staleRingOutset,
      left: -sizes.marker.staleRingOutset,
      right: -sizes.marker.staleRingOutset,
      bottom: -sizes.marker.staleRingOutset,
      borderWidth: border.strong,
      borderStyle: 'dashed',
      borderColor: colors.staleRing,
    },
    shadow: { position: 'absolute', backgroundColor: themeLiteral.markerShadow },
    selectedShadow: { backgroundColor: themeLiteral.selectedMarkerShadow },
    badge: {
      position: 'absolute',
      width: badge.size,
      height: badge.size,
      borderRadius: badge.size / 2,
      borderWidth: border.regular,
      borderColor: themeLiteral.avatarFrameMap,
      alignItems: 'center',
      justifyContent: 'center',
    },
    problem: { backgroundColor: colors.problemBadge },
    house: { backgroundColor: colors.receiver },
    tagRow: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
    groupTag: {
      minHeight: groupTag.height,
      paddingHorizontal: mapLabel.paddingH,
      borderRadius: mapLabel.radius,
      borderWidth: mapLabel.border,
      borderColor: colors.floatingOutline,
      backgroundColor: colors.surface,
      flexDirection: 'row',
      alignItems: 'center',
    },
    groupDot: {
      width: groupTag.problemDot,
      height: groupTag.problemDot,
      borderRadius: groupTag.problemDot / 2,
      backgroundColor: colors.problemBadge,
      marginRight: space.xs,
    },
    groupText: { ...type.value, color: colors.text },
  });
});
