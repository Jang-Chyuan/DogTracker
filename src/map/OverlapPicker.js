// The overlap menu (design v3 判定表「頭像疊在一起」「名稱牌疊在一起」, DESIGN.md
// §9.5 and §15「重疊選狗小選單」): tapping a merged 「3 隻」 tag pops up a small
// menu above the tap — one row per dog with its face, name and problem — and
// picking one opens that dog. Not a list page. 240dp wide, rows 56dp with a
// 32dp face, at most 5 rows before it scrolls. A tap outside or the back key
// closes it (a small window closes before anything else).
import { useStyles, makeStyles } from '../theme/ThemeProvider';
import { useEffect, useRef } from 'react';
import {
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import DogAvatar from '../dogs/DogAvatar';
import { problemBadgePosition } from './BadgeGeometry';
import { radius, size as sizes, type, space, border } from '../theme/tokens';
import { useInitialFocus } from '../utils/a11yFocus';

const menu = sizes.overlapMenu;
const PADDING_V = space.s;
// Gap between the menu and the tag it came from, and from the screen edges.
const GAP = space.s;

const getNOTE_COLOR = makeStyles(theme => {
  const { colors } = theme;
  return { crit: colors.crit, warn: colors.warn, muted: colors.textMuted };
});

/** The menu's height for `count` rows (5 at most, then it scrolls). */
export function overlapMenuHeight(count) {
  return Math.min(count, menu.maxRows) * menu.row + 2 * PADDING_V;
}

/**
 * Where the menu goes: centred over `anchor` (the tapped tag's face, in dp)
 * and above it, inside the screen; below it when there is no room above.
 * @param anchor { x, y, size }: the face centre and its size
 * @param screen { width, height, top, bottom }: the screen and the covered
 *   strips at its top and bottom
 */
export function overlapMenuPlace(
  anchor,
  count,
  { width, height, top = 0, bottom = 0 },
) {
  const menuHeight = overlapMenuHeight(count);
  const left = Math.min(
    Math.max(GAP, anchor.x - menu.width / 2),
    Math.max(GAP, width - GAP - menu.width),
  );
  const faceTop = anchor.y - (anchor.size || sizes.marker.normal) / 2;
  const above = faceTop - GAP - menuHeight;
  if (above >= top + GAP) return { left, top: above, height: menuHeight };
  const below =
    anchor.y +
    (anchor.size || sizes.marker.normal) / 2 +
    sizes.groupTag.height +
    GAP;
  const lowest = height - bottom - GAP - menuHeight;
  return {
    left,
    top: Math.max(top + GAP, Math.min(below, lowest)),
    height: menuHeight,
  };
}

export default function OverlapPicker({
  markers,
  place,
  avatars = {},
  onPick,
  onClose,
}) {
  const styles = useStyles(getStyles);
  const NOTE_COLOR = useStyles(getNOTE_COLOR);
  // TalkBack starts on the first dog of the menu (設計稿「無障礙」焦點順序).
  const firstRow = useRef(null);
  useInitialFocus(firstRow);
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        onClose();
        return true;
      },
    );
    return () => subscription.remove();
  }, [onClose]);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Pressable
        testID="overlap-picker-outside"
        accessibilityRole="button"
        accessibilityLabel="關閉"
        style={StyleSheet.absoluteFill}
        onPress={onClose}
      />
      <View
        testID="overlap-picker"
        accessibilityViewIsModal
        style={[
          styles.menu,
          { left: place.left, top: place.top, height: place.height },
        ]}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          scrollEnabled={markers.length > menu.maxRows}
        >
          {markers.map((marker, index) => (
            <Pressable
              ref={index === 0 ? firstRow : undefined}
              key={marker.slaveId}
              testID={`overlap-row-${marker.slaveId}`}
              accessibilityRole="button"
              accessibilityLabel={
                marker.note
                  ? `${marker.name}，${marker.note.text}`
                  : marker.name
              }
              onPress={() => onPick(marker.slaveId)}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              {/* The face as on the map: grey when it has no new position, the
               red "!" top right for any problem. */}
              <View collapsable={false} style={styles.face}>
                <DogAvatar
                  avatar={avatars[marker.slaveId]}
                  size={menu.avatar}
                  stale={marker.stale}
                  border={border.regular}
                />
                {marker.problem && (
                  <View testID="overlap-row-problem" style={styles.badge}>
                    <Text style={styles.badgeText} allowFontScaling={false}>
                      !
                    </Text>
                  </View>
                )}
              </View>
              <View style={styles.words}>
                <Text style={styles.name} numberOfLines={1}>
                  {marker.name}
                </Text>
                {marker.note && (
                  <Text
                    style={[
                      styles.note,
                      { color: NOTE_COLOR[marker.note.level] },
                    ]}
                    numberOfLines={1}
                  >
                    {marker.note.text}
                  </Text>
                )}
              </View>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

const getStyles = makeStyles(theme => {
  const { colors, shadow, literalColors: themeLiteral } = theme;
  return StyleSheet.create({
    menu: {
      position: 'absolute',
      width: menu.width,
      borderRadius: radius.menu,
      backgroundColor: colors.surface,
      ...theme.floatingBorder,
      overflow: 'hidden',
      ...shadow.floating,
      ...theme.floatingBorder,
    },
    content: { paddingVertical: PADDING_V },
    row: {
      height: menu.row,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: space.m,
      gap: space.m,
    },
    pressed: { backgroundColor: colors.pressedOverlay },
    words: { flex: 1 },
    name: { ...type.status, color: colors.text },
    note: { ...type.caption },
    face: { width: menu.avatar, height: menu.avatar, overflow: 'visible' },
    badge: {
      position: 'absolute',
      ...problemBadgePosition(menu.avatar, sizes.badge.size - border.strong),
      width: sizes.badge.size - border.strong,
      height: sizes.badge.size - border.strong,
      borderRadius: sizes.badge.size,
      borderWidth: border.regular,
      borderColor: themeLiteral.avatarFrameMap,
      backgroundColor: colors.problemBadge,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badgeText: {
      color: themeLiteral.avatarFrameMap,
      fontSize: sizes.badge.glyph,
      lineHeight: sizes.badge.problemLine,
      fontWeight: sizes.badge.problemWeight,
    },
  });
});
