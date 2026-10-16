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
// could not be told how far to go. Here (releaseTarget):
// - while the finger is down the row follows it 1:1; past an end it goes on
//   at half the finger's speed (the edge bounce);
// - let go, the row glides on from where it is by the momentum it has — the
//   release speed (the finger's over its last 50 ms) under Android's own
//   fling curve (OverScroller: distance grows with speed^1.74), with more
//   friction — and stops on the dog nearest that point. Let go nearly still:
//   no glide, the nearest dog. The glide is counted from where the row is,
//   never from where the drag began, so the row never runs on and then comes
//   back past where it was let go (2026-10-14, the fourth phone try). A flick
//   past the slop moves at least one dog; a hard one reaches the end;
// - the slide starts at the release speed and slows to that dog on the
//   native driver, runs a few dp past and settles back on a spring (let go
//   still: the spring alone); past an end, back to the end dog. No
//   wrap-around. ‹ › at the two ends move one dog at a time.
import { memo, useEffect, useMemo, useRef, useState } from 'react';
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
// Let go slower than this (dp/ms) the row does not glide on.
export const FLING_VELOCITY = 0.25;
// The glide (2026-10-14): Android's OverScroller spline, distance = k ×
// speed^e with e = r / (r − 1), r = ln 0.78 / ln 0.9 (its
// DECELERATION_RATE) — the curve every Android list flings by — with k for
// a row of 64dp dogs: 1 dp/ms glides 20dp (a third of a dog), 2 dp/ms 67, 3
// 135, 4 222, 5 328, 6 452, 8 738 (Android's fastest fling, 11 dogs). A
// casual swipe adds little to where the finger left the row; a hard flick
// runs to the end. Checked on the phone (2026-10-15): real flicks let go at
// 0.9–1.5 dp/ms, most of the travel is the drag itself.
const DECELERATION_RATE = Math.log(0.78) / Math.log(0.9);
export const FLING_EXPONENT = DECELERATION_RATE / (DECELERATION_RATE - 1);
export const FLING_K = 20;
// The release speed is the finger's over its last this many ms (the last
// two moves at least): a flick speeds up to the end, a longer average reads
// it slow.
export const VELOCITY_WINDOW_MS = 50;
const LIFT_FRAME_MS = 20;
// The slide to the chosen dog: it starts at the release speed and slows to
// rest (ease-out cubic), between these durations; it runs LANDING_OVERSHOOT
// dp past the dog and settles back on LANDING_SPRING (damping ratio 0.68).
const SNAP_MIN_MS = 180;
const SNAP_MAX_MS = 700;
export const LANDING_OVERSHOOT = 6;
const LANDING_SPRING = { stiffness: 320, damping: 24, mass: 1 };
// A drag let go (or a tap, or the row following another pick): the spring
// alone, from where it is (damping ratio 0.7: about 5% past, then back).
const SETTLE_SPRING = { stiffness: 260, damping: 22.5, mass: 1 };

/** The row's offset with dog `index` in the middle. */
export const offsetOf = index => BOUNCE + index * carousel.slot;

/** Which slot `x` (the row's offset) has in the middle; past an end, the end dog. */
export const slotAt = (x, count) => Math.max(0, Math.min(count - 1, Math.round((x - BOUNCE) / carousel.slot)));

/** How far (dp) the row glides on after a release at `velocity` dp/ms. */
export const flingDistance = velocity => (Math.abs(velocity) < FLING_VELOCITY ? 0
  : FLING_K * Math.abs(velocity) ** FLING_EXPONENT);

/**
 * Where a release lands (pure): the dog nearest where the row glides to
 * from where it is. A flick that would stay on the dog it began on moves
 * one on.
 * @param from the dog (index) in the middle when the finger went down
 * @param x the row's offset when let go
 * @param velocity dp/ms, positive toward later dogs (the finger moving left)
 * @param count how many dogs
 * @returns the index to slide to
 */
export function releaseTarget({ from, x, velocity, count }) {
  const glide = Math.sign(velocity) * flingDistance(velocity);
  const index = slotAt(x + glide, count);
  if (glide && index === from) return Math.max(0, Math.min(count - 1, from + Math.sign(velocity)));
  return index;
}

/**
 * The finger's speed when it lifted (dp/ms, positive toward later dogs: the
 * finger moving left), over its last VELOCITY_WINDOW_MS (at least the last
 * two moves).
 * @param samples [{ x: pageX dp, t: ms }] in order
 */
export function releaseVelocity(samples) {
  const points = [...samples];
  // The lift comes a frame after the last move, at its place: that is not a
  // stop. A finger held still longer before it lifts is.
  if (points.length > 2 && points.at(-1).x === points.at(-2).x
    && points.at(-1).t - points.at(-2).t <= LIFT_FRAME_MS) points.pop();
  if (points.length < 2) return 0;
  const last = points[points.length - 1];
  let first = points[points.length - 2];
  for (let index = points.length - 2; index >= 0 && last.t - points[index].t <= VELOCITY_WINDOW_MS; index -= 1) {
    first = points[index];
  }
  const elapsed = last.t - first.t;
  return elapsed > 0 ? -(last.x - first.x) / elapsed || 0 : 0;
}

/** The slide's duration: it begins at the release speed (ease-out cubic starts at 3× its mean speed). */
export function snapDuration(distance, velocity) {
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
    if (Math.abs(target - from) < 0.5 && !velocity) {
      position.setValue(target);
      return;
    }
    const settle = config => Animated.spring(position, { toValue: target, ...config, useNativeDriver: true });
    // A fling: the slide keeps the release speed, runs a little past the dog,
    // and the spring brings it back. Anything else: the spring from here.
    const direction = Math.sign(target - from) || Math.sign(velocity);
    const run = velocity && direction === Math.sign(velocity)
      ? Animated.sequence([
        Animated.timing(position, {
          toValue: target + direction * LANDING_OVERSHOOT,
          duration: snapDuration(target - from + direction * LANDING_OVERSHOOT, velocity),
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        settle(LANDING_SPRING),
      ])
      : settle(SETTLE_SPRING);
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
      while (current.samples.length > 8 && timestamp - current.samples[1].t > VELOCITY_WINDOW_MS) {
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
    const velocity = releaseVelocity(samples);
    const index = releaseTarget({ from: current.from, x: here.current, velocity, count });
    at.current = index;
    slideTo(index, Math.abs(velocity) >= FLING_VELOCITY ? velocity : 0);
    const dog = dogs[index];
    if (dog && dog.slaveId !== currentId) onSelect?.(dog.slaveId);
  };
  useEffect(() => () => sliding.current?.stop(), []);
  // A face tapped: the open one opens the edit sheet; another is picked at
  // once and the row slides to it. One function for every face (kept by
  // ref), so a face only draws again when its own dog or state changes.
  const latest = useRef({});
  latest.current = { currentId, onEdit, onSelect, slideTo };
  const pick = useRef(({ dog, index }) => {
    const { currentId: openId, onEdit: edit, onSelect: select, slideTo: slide } = latest.current;
    if (dog.slaveId === openId) {
      edit?.();
      return;
    }
    at.current = index;
    slide(index);
    select?.(dog.slaveId);
  }).current;
  // ‹ ›: the dog before or after the open one, with the same landing.
  const openIndex = indexOf(currentId);
  const step = direction => {
    const index = Math.max(0, Math.min(count - 1, at.current + direction));
    if (index === at.current) return;
    at.current = index;
    slideTo(index);
    onSelect?.(dogs[index].slaveId);
  };
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
  // The names' lines, measured (they grow with the system font): the row is
  // as tall as the tallest, so it never changes height from dog to dog.
  const [nameHeights, setNameHeights] = useState({});
  const nameHeight = Math.max(0, ...Object.values(nameHeights));
  // No room under the name: the rows start right below it (the card stays
  // no taller than before the row of dogs, 2026-10-14).
  const rowHeight = carousel.face[0] + space.xs + Math.ceil(nameHeight);
  // The track between the two ‹ › zones (48dp each, never over a face).
  const track = Math.max(slot, width - 2 * carousel.stepZone);
  const side = Math.max(0, (track - slot) / 2);
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
      // The name grows and fades in with its face as it comes to the middle,
      // and shrinks and fades out as it leaves (never larger than as drawn).
      nameOpacity: position.interpolate({ inputRange: [centre - slot, centre, centre + slot],
        outputRange: [0, 1, 0], extrapolate: 'clamp' }),
    };
  }), [dogs, slot, position]);
  return (
    <View style={[styles.row, { height: rowHeight }]}>
      {/* Hidden samples of every name: the row's height at any font. */}
      {dogs.map(dog => (
        <Text key={dog.slaveId} style={[styles.name, styles.sample]} accessible={false}
          numberOfLines={linesFor(1)}
          onLayout={event => {
            const height = event.nativeEvent.layout.height;
            setNameHeights(current => (current[dog.slaveId] === height ? current
              : { ...current, [dog.slaveId]: height }));
          }}>
          {dog.name}
        </Text>
      ))}
      <View testID="dog-card-carousel" style={[styles.window, { height: rowHeight }]} {...responder}>
        <Animated.View style={[styles.strip, { paddingLeft: side + BOUNCE, transform: [{ translateX: shift }] }]}>
          {faces.map(face => {
            const open = face.dog.slaveId === currentId;
            return (
              <Face
                key={face.dog.slaveId}
                face={face}
                open={open}
                actions={open ? actions : undefined}
                onAction={open ? onAction : undefined}
                onPick={pick}
                styles={styles}
                colors={colors}
              />
            );
          })}
        </Animated.View>
      </View>
      {/* ‹ › in their own zones at the two ends: one dog at a time, none past an end. */}
      {openIndex > 0 && (
        <Step side="previous" onPress={() => step(-1)} styles={styles} colors={colors} />
      )}
      {openIndex < count - 1 && (
        <Step side="next" onPress={() => step(1)} styles={styles} colors={colors} />
      )}
    </View>
  );
}

/**
 * One dog in the row: its face (with the 「!」 and, in the middle, the pencil
 * badge) and its name, sized and faded by the row's position on the native
 * driver. Drawn again only when its dog, its animations or whether it is the
 * open one change (2026-10-16: every face was drawn again on every swipe).
 */
const Face = memo(function Face({ face, open, actions, onAction, onPick, styles, colors }) {
  const { dog, scale, opacity, middle, nameOpacity } = face;
  return (
    <Pressable
      testID={open ? 'dog-card-edit' : `dog-card-pick-${dog.slaveId}`}
      accessibilityRole="button"
      accessibilityLabel={open ? t('c378', { dogName: dog.name }) : t('c1350', { name: dog.name })}
      accessibilityActions={actions}
      onAccessibilityAction={onAction}
      onPress={() => onPick(face)}
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
      <Animated.Text style={[styles.name, { opacity: nameOpacity, transform: [{ scale }] }]}
        numberOfLines={linesFor(1)} accessible={false}>
        {dog.name}
      </Animated.Text>
    </Pressable>
  );
});

/**
 * A small ‹ or › in its own zone at one end of the row (2026-10-14, option
 * (b) of three: a 32dp round `surface` face with a 1dp `line` ring and a
 * `textMuted` chevron — light, like the pencil badge), a 48dp target.
 */
function Step({ side, onPress, styles, colors }) {
  const next = side === 'next';
  return (
    <Pressable
      testID={`dog-card-step-${side}`}
      accessibilityRole="button"
      accessibilityLabel={next ? t('c1291') : t('c1292')}
      onPress={onPress}
      style={({ pressed }) => [styles.step, next ? styles.stepNext : styles.stepPrevious, pressed && styles.pressed]}
    >
      <View style={styles.stepFace}>
        <View style={next ? null : styles.flip}>
          <Glyph name="chevron" color={colors.textMuted} size={sizes.card.carousel.stepIcon} />
        </View>
      </View>
    </Pressable>
  );
}

const getStyles = makeStyles(theme => {
  const { colors } = theme;
  return StyleSheet.create({
    // Edge to edge across the card (its 16dp side padding).
    row: { marginHorizontal: -space.l },
    // The row's window between the ‹ › zones: the faces outside it are cut off.
    window: { overflow: 'hidden', marginHorizontal: carousel.stepZone },
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
    // ‹ ›: 48dp targets at the row's two ends, level with the faces.
    // ‹ ›: a 48dp target filling its zone, level with the faces; a 32dp
    // round face inside it.
    step: {
      position: 'absolute',
      top: space.xs + (carousel.face[0] - touch.min) / 2,
      width: carousel.stepZone,
      height: touch.min,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.full,
    },
    stepFace: {
      width: carousel.stepFace,
      height: carousel.stepFace,
      borderRadius: radius.full,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
      borderWidth: border.hairline,
      borderColor: colors.line,
    },
    stepPrevious: { left: 0 },
    stepNext: { right: 0 },
    flip: { transform: [{ rotate: '180deg' }] },
  });
});
