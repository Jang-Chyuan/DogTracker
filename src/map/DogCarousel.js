import { t } from '../i18n';
// The top of the dog card (DESIGN.md「摘要卡片」換狗, 2026-10-14 option c): a
// horizontally scrolling row of every dog on the map, each once, in the
// stable order (DogSwitch). The open dog sits in the middle, largest, with
// the pencil badge (the edit entry) and its name under it; the others get
// smaller and fainter with distance. Swipe or fling the row (it snaps one dog
// per slot, and stops with the platform's overscroll at either end: no
// wrap-around) or tap a side face to pick that dog; the card below swaps its
// content and the map centres on the new dog (MapScreen). Size and fade
// follow the scroll position on the native driver.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import DogAvatar from '../dogs/DogAvatar';
import BangGlyph from '../components/BangGlyph';
import Glyph from './Glyph';
import { useTheme, useStyles, makeStyles } from '../theme/ThemeProvider';
import { border, radius, size as sizes, space, touch, type } from '../theme/tokens';
import { linesFor } from '../utils/textScale';

const carousel = sizes.card.carousel;

/** Which slot `x` (the row's scroll offset) has in the middle. */
export const slotAt = (x, count) => Math.max(0, Math.min(count - 1, Math.round(x / carousel.slot)));

/**
 * @param dogs the order (DogSwitch): [{ slaveId, name, avatar, problem, stale }]
 * @param currentId the open dog
 * @param width the row's width (the card's, edge to edge)
 * @param onSelect(slaveId) a dog picked
 * @param onEdit the middle face (the dog's edit sheet)
 * @param actions TalkBack's 下一隻／上一隻 for the middle face, and onAction
 */
export default function DogCarousel({ dogs, currentId, width, onSelect, onEdit, actions, onAction }) {
  const styles = useStyles(getStyles);
  const { colors } = useTheme();
  const { slot } = carousel;
  const count = dogs.length;
  const indexOf = id => Math.max(0, dogs.findIndex(dog => dog.slaveId === id));
  const at = useRef(indexOf(currentId));
  const scrollX = useRef(new Animated.Value(at.current * slot)).current;
  const list = useRef(null);
  // The dog opened another way (a tap on the map, TalkBack): the row follows.
  useEffect(() => {
    const index = indexOf(currentId);
    if (index === at.current) return;
    at.current = index;
    list.current?.scrollTo({ x: index * slot, animated: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, count]);
  const settle = x => {
    const index = slotAt(x, count);
    at.current = index;
    const dog = dogs[index];
    if (dog && dog.slaveId !== currentId) onSelect?.(dog.slaveId);
  };
  // The middle name's line, measured (it grows with the system font).
  const [nameHeight, setNameHeight] = useState(0);
  const rowHeight = carousel.face[0] + space.xs * 2 + Math.ceil(nameHeight);
  const side = Math.max(0, (width - slot) / 2);
  const faces = useMemo(() => dogs.map((dog, index) => {
    const centre = index * slot;
    const range = [centre - 2 * slot, centre - slot, centre, centre + slot, centre + 2 * slot];
    const big = carousel.face[0];
    const ratio = value => value / big;
    return {
      dog,
      index,
      scale: scrollX.interpolate({ inputRange: range, extrapolate: 'clamp',
        outputRange: [ratio(carousel.face[2]), ratio(carousel.face[1]), 1, ratio(carousel.face[1]), ratio(carousel.face[2])] }),
      opacity: scrollX.interpolate({ inputRange: range, extrapolate: 'clamp',
        outputRange: [carousel.opacity[2], carousel.opacity[1], 1, carousel.opacity[1], carousel.opacity[2]] }),
      middle: scrollX.interpolate({ inputRange: [centre - slot / 2, centre, centre + slot / 2],
        outputRange: [0, 1, 0], extrapolate: 'clamp' }),
    };
  }), [dogs, slot, scrollX]);
  return (
    <View style={[styles.row, { height: rowHeight }]}>
      {/* A hidden sample of the middle name: the row's height at any font. */}
      <Text style={[styles.name, styles.sample]} accessible={false}
        onLayout={event => setNameHeight(event.nativeEvent.layout.height)}>
        {dogs[at.current]?.name ?? ''}
      </Text>
      <Animated.ScrollView
        ref={list}
        testID="dog-card-carousel"
        horizontal
        style={{ height: rowHeight }}
        showsHorizontalScrollIndicator={false}
        snapToInterval={slot}
        decelerationRate="fast"
        contentOffset={{ x: at.current * slot, y: 0 }}
        contentContainerStyle={{ paddingHorizontal: side }}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], { useNativeDriver: true })}
        onMomentumScrollEnd={event => settle(event.nativeEvent.contentOffset.x)}
        onScrollEndDrag={event => {
          // Let go without a fling: it still lands on a slot.
          if (!event.nativeEvent.velocity?.x) settle(event.nativeEvent.contentOffset.x);
        }}
      >
        {faces.map(({ dog, index, scale, opacity, middle }) => {
          const open = dog.slaveId === currentId;
          return (
            <Pressable
              key={dog.slaveId}
              testID={open ? 'dog-card-edit' : `dog-card-pick-${dog.slaveId}`}
              accessibilityRole="button"
              accessibilityLabel={open ? t('c378', { dogName: dog.name }) : t('c1340', { name: dog.name })}
              accessibilityActions={open ? actions : undefined}
              onAccessibilityAction={open ? onAction : undefined}
              onPress={() => {
                if (open) onEdit?.();
                else list.current?.scrollTo({ x: index * slot, animated: true });
              }}
              style={({ pressed }) => [styles.slot, pressed && !open && styles.pressed]}
            >
              <Animated.View style={[styles.face, { transform: [{ scale }] }]}>
                <Animated.View style={{ opacity }}>
                  <DogAvatar avatar={dog.avatar} size={carousel.face[0]} stale={dog.stale} border={0} />
                </Animated.View>
                {/* A problem's red 「!」 keeps its full strength on a faded face. */}
                {dog.problem && (
                  <View style={styles.bang}>
                    <BangGlyph size={sizes.badge.size} background={colors.problemBadge}
                      color={colors.avatarFrameMap} />
                  </View>
                )}
                <Animated.View style={[styles.editBadge, { opacity: middle }]} testID={open ? 'dog-card-edit-badge' : undefined}>
                  <Glyph name="pencil" color={colors.textMuted} size={sizes.card.editBadgeIcon} />
                </Animated.View>
              </Animated.View>
              <Animated.Text style={[styles.name, { opacity: middle }]} numberOfLines={linesFor(1)}
                accessible={false}>
                {dog.name}
              </Animated.Text>
            </Pressable>
          );
        })}
      </Animated.ScrollView>
    </View>
  );
}

const getStyles = makeStyles(theme => {
  const { colors } = theme;
  return StyleSheet.create({
    // Edge to edge across the card (its 16dp side padding).
    row: { marginHorizontal: -space.l },
    sample: { position: 'absolute', opacity: 0 },
    slot: {
      width: carousel.slot,
      minHeight: touch.min,
      alignItems: 'center',
      paddingTop: space.xs,
      borderRadius: radius.card,
    },
    face: {
      width: carousel.face[0],
      height: carousel.face[0],
      alignItems: 'center',
      justifyContent: 'center',
    },
    bang: { position: 'absolute', top: 0, right: 0 },
    editBadge: {
      position: 'absolute',
      right: -space.xs / 2,
      bottom: -space.xs / 2,
      width: sizes.card.editBadge,
      height: sizes.card.editBadge,
      borderRadius: radius.full,
      backgroundColor: colors.surface,
      borderWidth: border.hairline,
      borderColor: colors.line,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // The middle dog's name: wider than its slot, centred under the face.
    name: {
      ...type.title,
      color: colors.text,
      width: carousel.nameWidth,
      textAlign: 'center',
    },
    pressed: { backgroundColor: colors.pressedOverlay },
  });
});
