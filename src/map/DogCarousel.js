import { t } from '../i18n';
// The top of the dog card (DESIGN.md「摘要卡片」換狗, 2026-10-14 option c): a
// horizontally scrolling row of every dog on the map, each once, in the
// stable order (DogSwitch). The open dog sits in the middle, largest, with
// the pencil badge (the edit entry) and its name under it; the others get
// smaller and fainter with distance. Swipe or fling the row (it snaps one dog
// per slot, and at either end it stretches into a short empty stretch and
// springs back to the end dog: no wrap-around) or tap a side face to pick
// that dog; the card below swaps its
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
// When the row checks again that it sits on the open dog; after a slide to
// another dog, from PLACE_SETTLE_MS on.
const PLACE_RETRY_MS = [0, 60, 200, 500, 1200];
const PLACE_SETTLE_MS = 500;

// The edge bounce (2026-10-14): Android's own overscroll (a glow, or a
// stretch from Android 12) is hardly seen on a row this short, so the row
// has this much empty room past each end dog. A drag runs on into it and,
// let go, the row springs back to the end dog (only the dogs are snap
// points). Clearly an end, never a wrap-around.
export const BOUNCE = Math.round(carousel.slot * 0.75);

/** The row's scroll offset with dog `index` in the middle. */
export const offsetOf = index => BOUNCE + index * carousel.slot;

/** Which slot `x` (the row's scroll offset) has in the middle; past an end, the end dog. */
export const slotAt = (x, count) => Math.max(0, Math.min(count - 1, Math.round((x - BOUNCE) / carousel.slot)));

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
  const scrollX = useRef(new Animated.Value(offsetOf(at.current))).current;
  const list = useRef(null);
  // Only the user's own drag picks a dog where the row lands: the row's own
  // moves (placing it on the open dog, following a pick) never do.
  const dragging = useRef(false);
  // Let go (or come to rest) in the empty room past an end: spring back to
  // the end dog. Only the dogs are snap points, and Android does not snap
  // outside the first and last of them.
  const springBack = x => {
    const target = Math.max(offsetOf(0), Math.min(offsetOf(count - 1), x));
    if (Math.abs(target - x) > 1) list.current?.scrollTo({ x: target, animated: true });
  };
  const settle = x => {
    springBack(x);
    if (!dragging.current) return;
    dragging.current = false;
    const index = slotAt(x, count);
    at.current = index;
    const dog = dogs[index];
    if (dog && dog.slaveId !== currentId) onSelect?.(dog.slaveId);
  };
  // The row sits on the open dog. Android ignores contentOffset, and a busy
  // phone can drop an early scrollTo, so after every layout and every change
  // of dog or of the dogs (not while the user drags) it is put there again,
  // a few times, until the row reports it has arrived.
  const lastX = useRef(0);
  const timers = useRef([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  // Until then a slide the row was asked for is still on its way.
  const slidingUntil = useRef(0);
  const place = (animated = false) => {
    timers.current.forEach(clearTimeout);
    if (dragging.current) return;
    if (animated) {
      list.current?.scrollTo({ x: offsetOf(at.current), animated: true });
      slidingUntil.current = Date.now() + PLACE_SETTLE_MS;
    }
    const sliding = Date.now() < slidingUntil.current;
    timers.current = PLACE_RETRY_MS.filter(ms => !sliding || ms >= PLACE_SETTLE_MS).map(ms => setTimeout(() => {
      const target = offsetOf(at.current);
      if (!dragging.current && Math.abs(lastX.current - target) > 1) {
        list.current?.scrollTo({ x: target, animated: false });
      }
    }, ms));
  };
  // The dog opened another way (a tap on the map, TalkBack), or the dogs
  // changed: the row follows, sliding when it moves to another dog.
  const idsKey = dogs.map(dog => dog.slaveId).join(',');
  useEffect(() => {
    const index = indexOf(currentId);
    const moved = index !== at.current;
    at.current = index;
    place(moved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, idsKey]);
  // The middle name's line, measured (it grows with the system font).
  const [nameHeight, setNameHeight] = useState(0);
  // No room under the name: the rows start right below it (the card stays
  // no taller than before the row of dogs, 2026-10-14).
  const rowHeight = carousel.face[0] + space.xs + Math.ceil(nameHeight);
  const side = Math.max(0, (width - slot) / 2);
  const snaps = useMemo(() => dogs.map((_, index) => offsetOf(index)), [dogs]);
  const faces = useMemo(() => dogs.map((dog, index) => {
    const centre = offsetOf(index);
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
        snapToOffsets={snaps}
        snapToStart={false}
        snapToEnd={false}
        decelerationRate="fast"
        contentOffset={{ x: offsetOf(at.current), y: 0 }}
        onContentSizeChange={() => place()}
        onLayout={() => place()}
        contentContainerStyle={{ paddingHorizontal: side + BOUNCE }}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
          useNativeDriver: true,
          listener: event => { lastX.current = event.nativeEvent.contentOffset.x; },
        })}
        onScrollBeginDrag={() => {
          timers.current.forEach(clearTimeout);
          dragging.current = true;
        }}
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
              accessibilityLabel={open ? t('c378', { dogName: dog.name }) : t('c1350', { name: dog.name })}
              accessibilityActions={open ? actions : undefined}
              onAccessibilityAction={open ? onAction : undefined}
              onPress={() => {
                if (open) {
                  onEdit?.();
                  return;
                }
                // A tap picks at once; the row slides to it.
                at.current = index;
                list.current?.scrollTo({ x: offsetOf(index), animated: true });
                slidingUntil.current = Date.now() + PLACE_SETTLE_MS;
                onSelect?.(dog.slaveId);
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
    // Its line is no taller than the 20sp words need (24dp).
    name: {
      ...type.title,
      lineHeight: type.title.fontSize + space.xs,
      color: colors.text,
      width: carousel.nameWidth,
      textAlign: 'center',
    },
    // A side face pressed dims (no square overlay on a round face; the row
    // then slides to it).
    pressed: { opacity: 0.6 },
  });
});
