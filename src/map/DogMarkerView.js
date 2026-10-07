import React from 'react';
import { PixelRatio, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { colors, size as sizes, type } from '../theme/tokens';
import DogAvatar from '../dogs/DogAvatar';

// The view inside one dog's map marker (design v3「狗的標記：所有情況」,
// DESIGN.md §15): the face (40dp, 48dp with a problem, +8dp when its card is
// open), a red "!" top right for any problem, a small house bottom left when
// held indoors, and the name tag right under the face — or, where tags would
// overlap, one 「3 隻」 group tag under the lowest face and none under the
// others (DogMarkers.nameTags). Provider-neutral: the map renderer wraps it in
// its own marker, anchored at `anchor` (the centre of the face is the dog's
// position, there is no pointer).

export const MARKER_WIDTH = 168;
// Room above the face for the "!" badge reaching out of it.
const TOP = 8;
const { badge, marker: markerSize, mapLabel, groupTag } = sizes;

const fontScale = () => PixelRatio.getFontScale?.() || 1;

// The tag area: two lines of the name tag at most (DESIGN.md: 200% font
// wraps to two lines), or the 32dp group tag.
function tagArea() {
  const lines = 2 * type.mapLabel.lineHeight * fontScale() + 2 * (mapLabel.paddingV + mapLabel.border);
  return Math.max(lines, groupTag.height * Math.max(1, fontScale())) + 4;
}

/** The marker view's height and the anchor of the face centre, for a face size. */
export function markerFrame(faceSize) {
  const height = Math.ceil(TOP + faceSize + markerSize.labelGap + tagArea());
  return { width: MARKER_WIDTH, height, anchor: { x: 0.5, y: (TOP + faceSize / 2) / height } };
}

function ProblemBadge({ offset }) {
  return (
    <View testID="dog-badge-problem" style={[styles.badge, styles.problem, { top: -offset, right: -offset }]}>
      <Svg width={badge.glyph} height={badge.glyph} viewBox="0 0 24 24">
        <Path d="M12 4v10" stroke="#FFFFFF" strokeWidth={4.4} strokeLinecap="round" />
        <Circle cx={12} cy={20} r={2.6} fill="#FFFFFF" />
      </Svg>
    </View>
  );
}

// Left, reaching `offset` out of the face like the "!"; its centre a quarter
// of the face below the face's centre, on the rim (as in the A7 mockup).
function HouseBadge({ offset, size }) {
  return (
    <View testID="dog-badge-indoor" style={[styles.badge, styles.house,
      { top: size * 0.75 - badge.size / 2, left: -offset }]}>
      <Svg width={badge.glyph} height={badge.glyph} viewBox="0 0 24 24">
        <Path d="M4 11 12 4l8 7v9H4z" fill="none" stroke="#FFFFFF" strokeWidth={2.8} strokeLinejoin="round" />
      </Svg>
    </View>
  );
}

// The shadow circle under a face: 1dp wider and 1dp lower (0 1 3 in the
// mockups), 3dp lower and 3dp wider when its card is open.
function shadowFrame(size, selected, width) {
  const spread = selected ? 3 : 1;
  const side = size + 2 * spread;
  return { width: side, height: side, borderRadius: side / 2, left: (width - side) / 2,
    top: TOP - spread + (selected ? 3 : 1) };
}

/**
 * @param marker DogMarkers.dogMarker output
 * @param tag DogMarkers.nameTags entry: { text, group, problem } or null
 * @param avatar the dog's chosen face (useDogAvatars), or undefined for the default
 */
export default function DogMarkerView({ marker, tag, avatar, onAvatarLoad }) {
  const { size, problem, indoor, stale, selected } = marker;
  const frame = markerFrame(size);
  // Badges reach 4dp out of a 40dp face, 6dp out of 48dp, 8dp out of 56dp
  // (判定表「角標位移（選中時）」).
  const offset = badge.offset + (size - markerSize.normal) / 4;
  return (
    <View collapsable={false} style={[styles.root, { width: frame.width, height: frame.height }]}>
      {/* A drawn shadow: a marker is captured as a bitmap, where elevation
          shadows barely show. */}
      <View style={[styles.shadow, selected && styles.selectedShadow, shadowFrame(size, selected, frame.width)]} />
      <View style={[styles.face, { top: TOP, left: (frame.width - size) / 2, width: size, height: size,
        borderRadius: size / 2 }, selected && styles.selected]}>
        <DogAvatar avatar={avatar} size={size} stale={stale} border={markerSize.border} onLoad={onAvatarLoad}
          snapshot />
        {indoor && <HouseBadge offset={offset} size={size} />}
        {problem && <ProblemBadge offset={offset} />}
      </View>
      {tag && (
        <View style={[styles.tagRow, { top: TOP + size + markerSize.labelGap }]}>
          {tag.group > 1 ? (
            <View testID="dog-group-tag" style={styles.groupTag}>
              {tag.problem && <View testID="dog-group-problem" style={styles.groupDot} />}
              <Text style={styles.groupText} numberOfLines={1}>{tag.text}</Text>
            </View>
          ) : (
            <View testID="dog-name-tag" style={styles.nameTag}>
              <Text style={styles.nameText} numberOfLines={mapLabel.maxLines}>{tag.text}</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { overflow: 'visible' },
  face: { position: 'absolute', backgroundColor: '#FFFFFF' },
  selected: {},
  shadow: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.16)' },
  selectedShadow: { backgroundColor: 'rgba(0,0,0,0.22)' },
  badge: { position: 'absolute', width: badge.size, height: badge.size, borderRadius: badge.size / 2,
    borderWidth: badge.border, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  problem: { backgroundColor: colors.problemBadge },
  house: { backgroundColor: colors.receiver },
  tagRow: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  nameTag: { maxWidth: MARKER_WIDTH - 8, paddingHorizontal: mapLabel.paddingH,
    paddingVertical: mapLabel.paddingV, borderRadius: 6, borderWidth: mapLabel.border,
    borderColor: colors.line, backgroundColor: colors.surface },
  nameText: { ...type.mapLabel, color: colors.text, textAlign: 'center' },
  groupTag: { minHeight: groupTag.height, paddingHorizontal: groupTag.paddingH, borderRadius: 999,
    borderWidth: mapLabel.border, borderColor: colors.line, backgroundColor: colors.surface,
    flexDirection: 'row', alignItems: 'center' },
  groupDot: { width: groupTag.problemDot, height: groupTag.problemDot, borderRadius: groupTag.problemDot / 2,
    backgroundColor: colors.problemBadge, marginRight: 6 },
  groupText: { ...type.value, color: colors.text },
});
