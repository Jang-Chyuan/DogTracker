import { t } from '../i18n';
// The top of the dog card (DESIGN.md「摘要卡片」換狗, 2026-10-14 option c): a
// horizontally moving row of every dog on the map, each once, in the stable
// order (DogSwitch). The open dog sits in the middle, largest, with the
// pencil badge (the edit entry) and its name under it; the others get smaller
// and fainter with distance. Drag or fling the row, or tap a side face to pick
// that dog; the card below swaps its content and the map centres on the new
// dog (MapScreen). Size and fade follow the row's position on the native
// driver.
//
// The row moves itself (a responder and one Animated value), not a
// ScrollView (2026-10-14, tried on a phone): Android's own fling and snap
// could not be told how far to go — a normal swipe went two dogs, and holding
// it to one dog made a fast flick go one too. Here (releaseTarget):
// - while the finger is down the row follows it 1:1; past an end it goes on
//   at half the finger's speed (the edge bounce);
// - a drag (the finger down longer than FLICK_MAX_MS, or let go nearly
//   still): the dog nearest where it was let go, however far that is; no
//   momentum;
// - a flick (short and still moving when let go): from the dog it began on,
//   as many dogs as the release speed carries, at least one and at most
//   five — a casual swipe is one however far the finger carried the row,
//   only a clearly fast flick more;
// - then a decelerating slide to that dog on the native driver; past an end,
//   back to the end dog. No wrap-around.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import DogAvatar from '../dogs/DogAvatar';
import BangGlyph from '../components/BangGlyph';
import Glyph from './Glyph';
import { useTheme, useStyles, makeStyles } from '../theme/ThemeProvider';
import { border, radius, size as sizes, space, touch, type } from '../theme/tokens';
import { linesFor } from '../utils/textScale';

const carousel = sizes.card.carousel;

// The edge bounce: the row can be pulled this far past an end dog (at half
// the finger's speed), then springs back. Android's own glow or stretch is
// hardly seen on a row this short.
export const BOUNCE = Math.round(carousel.slot * 0.75);
// How much of the finger's move past an end the row follows.
export const RUBBER = 0.5;
// A horizontal move this long (dp) makes it a drag of the row, not a tap.
export const SLOP = 8;
// A flick: the finger down no longer than this (ms) and still moving at
// least this fast (dp/ms) when it lifts. Measured on emulator-5562: casual
// swipes of 200–400 ms let go at 0.25–0.4 dp/ms and had carried the row 1.3–
// 1.8 cells — by position alone that is often two dogs, the phone's
// complaint; as flicks they go one. Drags across several cells last longer.
export const FLICK_MAX_MS = 400;
export const FLING_VELOCITY = 0.25;
// The flick's reach: speed × this (ms) of travel, in dogs, rounded; at least
// one, at most FLING_MAX. With a 64dp slot: under 2 dp/ms (2 000 dp/s — a
// casual swipe stays well under) one dog; 2–3.3 two; 3.3–4.7 three; 4.7–6
// four; above, five.
export const FLING_REACH_MS = 48;
export const FLING_MAX = 5;
// The velocity is the finger's over its last this many ms (like Android's
// VelocityTracker), not over the whole gesture.
const VELOCITY_WINDOW_MS = 100;
// The slide to the chosen dog: it starts at the release speed and slows to
// rest (ease-out cubic), between these durations.
const SNAP_MIN_MS = 180;
const SNAP_MAX_MS = 450;
const SNAP_DRAG_MS = 220;

/** The row's offset with dog `index` in the middle. */
export const offsetOf = index => BOUNCE + index * carousel.slot;

/** Which slot `x` (the row's offset) has in the middle; past an end, the end dog. */
export const slotAt = (x, count) => Math.max(0, Math.min(count - 1, Math.round((x - BOUNCE) / carousel.slot)));

/** A flick, not a drag: short, and still moving when let go. */
export const isFlick = (velocity, duration) => duration <= FLICK_MAX_MS && Math.abs(velocity) >= FLING_VELOCITY;

/**
 * Where a drag or flick let go lands (pure).
 * @param from the dog (index) in the middle when the finger went down
 * @param x the row's offset when let go
 * @param velocity dp/ms, positive toward later dogs (the finger moving left)
 * @param duration ms from the finger down to up
 * @param count how many dogs
 * @returns the index to slide to
 */
export function releaseTarget({ from, x, velocity, duration, count }) {
  if (!isFlick(velocity, duration)) return slotAt(x, count);
  const reach = Math.round((Math.abs(velocity) * FLING_REACH_MS) / carousel.slot);
  const dogsAway = Math.max(1, Math.min(FLING_MAX, reach));
  return Math.max(0, Math.min(count - 1, from + Math.sign(velocity) * dogsAway));
}

/** The slide's duration: it begins at the release speed (ease-out cubic starts at 3× its mean speed). */
export function snapDuration(distance, velocity) {
  if (!velocity) return SNAP_DRAG_MS;
  return Math.max(SNAP_MIN_MS, Math.min(SNAP_MAX_MS, (3 * Math.abs(distance)) / Math.abs(velocity)));
}

/** The finger's move past an end, followed at RUBBER and never past BOUNCE. */
export function rubberBand(x, count) {
  const low = offsetOf(0);
  const high = offsetOf(count - 1);
  if (x < low) return low - Math.min(BOUNCE, (low - x) * RUBBER);
  if (x > high) return high + Math.min(BOUNCE, (x - high) * RUBBER);
  return x;
}

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
  // The row's offset: dog i is in the middle at offsetOf(i).
  const position = useRef(new Animated.Value(offsetOf(at.current))).current;
  // Where it is (kept here too: a native-driven value cannot be read back
  // synchronously).
  const here = useRef(offsetOf(at.current));
  const sliding = useRef(null);
  const slideTo = (index, velocity = 0) => {
    sliding.current?.stop();
    const target = offsetOf(index);
    const from = here.current;
    here.current = target;
    if (Math.abs(target - from) < 0.5) {
      position.setValue(target);
      return;
    }
    const run = Animated.timing(position, {
      toValue: target,
      duration: snapDuration(target - from, velocity),
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    sliding.current = run;
    run.start(({ finished }) => {
      if (finished && sliding.current === run) sliding.current = null;
    });
  };
  // The drag: where the finger went down, where the row was, the finger's
  // recent positions for its speed.
  const drag = useRef(null);
  const touchStart = useRef(null);
  const responder = {
    onTouchStart: event => {
      const { pageX, pageY, timestamp } = event.nativeEvent;
      touchStart.current = { x: pageX, y: pageY, t: timestamp };
    },
    // Taken from a face (its press is cancelled) once the finger clearly
    // moves sideways; an up-down move stays the card's (it closes the card).
    onMoveShouldSetResponderCapture: event => {
      const start = touchStart.current;
      if (!start || count < 2) return false;
      const dx = event.nativeEvent.pageX - start.x;
      const dy = event.nativeEvent.pageY - start.y;
      return Math.abs(dx) > SLOP && Math.abs(dx) > Math.abs(dy);
    },
    onResponderGrant: event => {
      sliding.current?.stop();
      sliding.current = null;
      const { pageX, timestamp } = event.nativeEvent;
      drag.current = { from: at.current, base: here.current, x0: touchStart.current?.x ?? pageX,
        t0: touchStart.current?.t ?? timestamp, samples: [{ x: pageX, t: timestamp }] };
    },
    onResponderTerminationRequest: () => false,
    onResponderMove: event => {
      const current = drag.current;
      if (!current) return;
      const { pageX, timestamp } = event.nativeEvent;
      const x = rubberBand(current.base - (pageX - current.x0), count);
      here.current = x;
      position.setValue(x);
      current.samples.push({ x: pageX, t: timestamp });
      while (current.samples.length > 2 && timestamp - current.samples[0].t > VELOCITY_WINDOW_MS) {
        current.samples.shift();
      }
    },
    onResponderRelease: event => release(event),
    onResponderTerminate: event => release(event),
  };
  const release = event => {
    const current = drag.current;
    drag.current = null;
    if (!current) return;
    const { pageX, timestamp } = event.nativeEvent;
    const samples = [...current.samples, { x: pageX, t: timestamp }];
    const first = samples[0];
    const last = samples[samples.length - 1];
    const elapsed = last.t - first.t;
    // The finger moving left brings later dogs: the row's offset grows.
    const velocity = elapsed > 0 ? -(last.x - first.x) / elapsed : 0;
    const duration = timestamp - (current.t0 ?? first.t);
    const flick = isFlick(velocity, duration);
    const index = releaseTarget({ from: current.from, x: here.current, velocity, duration, count });
    at.current = index;
    slideTo(index, flick ? velocity : 0);
    const dog = dogs[index];
    if (dog && dog.slaveId !== currentId) onSelect?.(dog.slaveId);
  };
  useEffect(() => () => sliding.current?.stop(), []);
  // The dog opened another way (a tap on the map, TalkBack), or the dogs
  // changed: the row follows, sliding when it moves to another dog.
  const idsKey = dogs.map(dog => dog.slaveId).join(',');
  useEffect(() => {
    if (drag.current) return;
    const index = indexOf(currentId);
    const moved = index !== at.current;
    at.current = index;
    if (moved || !sliding.current) slideTo(index);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, idsKey]);
  // The middle name's line, measured (it grows with the system font).
  const [nameHeight, setNameHeight] = useState(0);
  // No room under the name: the rows start right below it (the card stays
  // no taller than before the row of dogs, 2026-10-14).
  const rowHeight = carousel.face[0] + space.xs + Math.ceil(nameHeight);
  const side = Math.max(0, (width - slot) / 2);
  const shift = useMemo(() => Animated.multiply(position, -1), [position]);
  const faces = useMemo(() => dogs.map((dog, index) => {
    const centre = offsetOf(index);
    const range = [centre - 2 * slot, centre - slot, centre, centre + slot, centre + 2 * slot];
    const big = carousel.face[0];
    const ratio = value => value / big;
    return {
      dog,
      index,
      scale: position.interpolate({ inputRange: range, extrapolate: 'clamp',
        outputRange: [ratio(carousel.face[2]), ratio(carousel.face[1]), 1, ratio(carousel.face[1]), ratio(carousel.face[2])] }),
      opacity: position.interpolate({ inputRange: range, extrapolate: 'clamp',
        outputRange: [carousel.opacity[2], carousel.opacity[1], 1, carousel.opacity[1], carousel.opacity[2]] }),
      middle: position.interpolate({ inputRange: [centre - slot / 2, centre, centre + slot / 2],
        outputRange: [0, 1, 0], extrapolate: 'clamp' }),
    };
  }), [dogs, slot, position]);
  return (
    <View style={[styles.row, { height: rowHeight }]}>
      {/* A hidden sample of the middle name: the row's height at any font. */}
      <Text style={[styles.name, styles.sample]} accessible={false}
        onLayout={event => setNameHeight(event.nativeEvent.layout.height)}>
        {dogs[at.current]?.name ?? ''}
      </Text>
      <View testID="dog-card-carousel" style={[styles.window, { height: rowHeight }]} {...responder}>
        <Animated.View style={[styles.strip, { paddingLeft: side + BOUNCE, transform: [{ translateX: shift }] }]}>
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
                  slideTo(index);
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
        </Animated.View>
      </View>
    </View>
  );
}

const getStyles = makeStyles(theme => {
  const { colors } = theme;
  return StyleSheet.create({
    // Edge to edge across the card (its 16dp side padding).
    row: { marginHorizontal: -space.l },
    // The row's window: the faces outside it are cut off at the card's edge.
    window: { overflow: 'hidden' },
    strip: { flexDirection: 'row', alignItems: 'flex-start' },
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
