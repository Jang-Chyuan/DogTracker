import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  cancelAnimation,
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import DogAvatar from '../dogs/DogAvatar';
import { colors, motion, shadow, space, type } from '../theme/tokens';
import {
  CHIP_GAP, CHIP_WIDTH, HANDLE_HEIGHT, SIDE, STRIP_RING,
  flightPoint, flightProgress, headerBottom, liveSheetStops, rowSlot, settleStop, stripSlot,
} from './SheetGeometry';

const LEVELS = ['collapsed', 'half', 'expanded'];
// The header and strip are laid out for fonts up to this scale (SheetGeometry).
const FONT_CAP = 1.6;

// One avatar of the strip/list pair. It is the only avatar drawn for a shown
// dog: in the strip, in flight, and on its list row. Never touchable; the
// chip or row underneath takes the tap.
function FlyingAvatar({ index, id, ring, avatar, progress, stripX, listY, rows, fontScale, reduced }) {
  const style = useAnimatedStyle(() => {
    const top = headerBottom(fontScale);
    const from = stripSlot(index, stripX.value, fontScale);
    const row = rows.value[id];
    const to = row ? rowSlot(row.y, row.height, listY.value, fontScale) : from;
    const point = flightPoint(progress.value, index, from, to, reduced);
    const scale = point.size / STRIP_RING;
    return {
      transform: [
        { translateX: point.x - STRIP_RING / 2 },
        { translateY: point.y - top - STRIP_RING / 2 },
        { scale },
      ],
    };
  });
  return (
    <Animated.View style={[styles.flyer, { borderColor: ring }, style]}>
      <DogAvatar avatar={avatar} size={STRIP_RING - 8} />
    </Animated.View>
  );
}

/**
 * The home map's card. Collapsed it shows a row of dog avatars, each with its
 * name and state; dragged up, each avatar flies to its own row of the list
 * underneath, following the finger. The drag and the flight run on the UI
 * thread (Reanimated, Gesture Handler), so BLE and cloud updates on the JS
 * thread cannot make them stutter; the content stays frozen while the finger
 * is down and catches up when the card settles.
 *
 * strip: [{ id, name, status, spoken, ring, avatar, onPress(pageY) }] in list order;
 * status is empty for a dog with nothing wrong.
 * children({ onRowLayout }): the list; DogList reports each row's layout so
 * the avatars land on the rows wherever large fonts or wrapped text put them.
 */
export default function LiveSheet({
  title, summary, badge, control, strip, bottomInset, topInset = 100, onHeight, onDragging, children,
  covered = false,
}) {
  const { height: windowHeight, fontScale } = useWindowDimensions();
  const stops = useMemo(
    () => liveSheetStops(windowHeight, bottomInset, topInset, fontScale),
    [windowHeight, bottomInset, topInset, fontScale],
  );
  const reduced = useReducedMotion();
  const [level, setLevel] = useState('collapsed');
  const sheet = useSharedValue(stops.collapsed);
  const start = useSharedValue(stops.collapsed);
  const stripX = useSharedValue(0);
  const listY = useSharedValue(0);
  const rows = useSharedValue({});
  const rowLayouts = useRef({});
  const progress = useDerivedValue(() => flightProgress(sheet.value, stops));

  // A released drag already springs on the UI thread; only taps, the
  // accessibility actions and stop changes (rotation, font size) spring here.
  const springing = useRef(false);
  const appliedStops = useRef(stops);
  useEffect(() => {
    // A drag's own spring targets the stops it was released against. If the
    // stops moved in the same render (a status pill appearing pushes the top
    // down), that spring aims at the old place, so spring again here.
    const moved = appliedStops.current !== stops;
    appliedStops.current = stops;
    if (springing.current && !moved) springing.current = false;
    else {
      springing.current = false;
      sheet.value = withSpring(stops[level], motion.sheetSpring);
    }
    onHeight?.(stops[level]);
  }, [level, stops, sheet, onHeight]);

  const settled = useCallback(next => {
    springing.current = true;
    setLevel(current => {
      // Same level: no re-render, so the effect will not clear the flag.
      if (current === next) springing.current = false;
      return next;
    });
  }, []);
  const dragging = useCallback(value => onDragging?.(value), [onDragging]);

  const panConfig = enabled => ({
    enabled,
    // Horizontal movement fails the pan before vertical movement activates
    // it, so sliding along the avatar strip scrolls the strip.
    activeOffsetY: [-12, 12],
    failOffsetX: [-10, 10],
    onBegin: () => {
      'worklet';
      // Catch a card that is still springing where it is, not where it was.
      cancelAnimation(sheet);
      start.value = sheet.value;
    },
    onActivate: () => {
      'worklet';
      scheduleOnRN(dragging, true);
    },
    onUpdate: event => {
      'worklet';
      sheet.value = Math.max(stops.collapsed, Math.min(stops.expanded, start.value - event.translationY));
    },
    onDeactivate: event => {
      'worklet';
      // The spring starts here, on the UI thread, with the finger's speed; a
      // busy JS thread must not hold the card mid-way. A cancelled gesture
      // goes to the nearest stop, not where its speed pointed.
      const velocity = event.canceled ? 0 : -event.velocityY;
      const next = settleStop(sheet.value, velocity, stops);
      sheet.value = withSpring(stops[next], { ...motion.sheetSpring, velocity }, finished => {
        'worklet';
        // The content stays frozen until the card has landed.
        if (finished) scheduleOnRN(dragging, false);
      });
      scheduleOnRN(settled, next);
    },
  });
  // The header always drags the card; the body only until it is fully up,
  // where the list scrolls instead.
  const headerPan = usePanGesture(panConfig(true));
  const bodyPan = usePanGesture(panConfig(level !== 'expanded'));

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: stops.expanded - sheet.value }],
  }));
  const stripStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.4], [1, 0], Extrapolation.CLAMP),
  }));
  const listStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.35, 1], [0, 1], Extrapolation.CLAMP),
  }));
  const onStripScroll = useAnimatedScrollHandler(event => { stripX.value = event.contentOffset.x; });
  const onListScroll = useAnimatedScrollHandler(event => { listY.value = event.contentOffset.y; });
  const onRowLayout = useCallback((id, layout) => {
    rowLayouts.current = { ...rowLayouts.current, [id]: { y: layout.y, height: layout.height } };
    rows.value = rowLayouts.current;
  }, [rows]);

  const toggle = () => setLevel(level === 'collapsed' ? 'half' : 'collapsed');
  const top = headerBottom(fontScale);
  const collapsed = level === 'collapsed';

  return (
    <Animated.View
      // A dog's panel takes this card's place; the card keeps its state and
      // position underneath, out of sight and out of reach.
      style={[styles.sheet, { bottom: bottomInset, height: stops.expanded }, sheetStyle,
        covered && styles.covered]}
      pointerEvents={covered ? 'none' : 'auto'}
      importantForAccessibility={covered ? 'no-hide-descendants' : 'auto'}
      testID="tracking-sheet"
    >
      <GestureDetector gesture={headerPan}>
        <View>
          <View style={styles.handleArea}><View style={styles.handle} /></View>
          <Pressable
            testID="tracking-sheet-handle"
            onPress={toggle}
            accessibilityRole="adjustable"
            accessibilityLabel={[title, badge, summary].filter(Boolean).join('。')}
            accessibilityHint="點一下展開或收合狗清單"
            accessibilityValue={{ min: 0, max: 2, now: LEVELS.indexOf(level) }}
            accessibilityActions={[{ name: 'increment', label: '展開' }, { name: 'decrement', label: '收合' }]}
            onAccessibilityAction={event => {
              const index = LEVELS.indexOf(level) + (event.nativeEvent.actionName === 'increment' ? 1 : -1);
              setLevel(LEVELS[Math.max(0, Math.min(2, index))]);
            }}
            style={[styles.header, { minHeight: top - HANDLE_HEIGHT }]}
          >
            <View style={styles.headerText}>
              <View style={styles.titleLine}>
                <Text style={styles.title} numberOfLines={1} maxFontSizeMultiplier={FONT_CAP}>{title}</Text>
                {!!badge && (
                  <View style={styles.badge}>
                    <View style={styles.badgeDot} />
                    <Text style={styles.badgeText} numberOfLines={1} maxFontSizeMultiplier={FONT_CAP}>{badge}</Text>
                  </View>
                )}
              </View>
              {!!summary && <Text style={styles.summary} numberOfLines={1} maxFontSizeMultiplier={FONT_CAP}>{summary}</Text>}
            </View>
            {!collapsed && control}
          </Pressable>
        </View>
      </GestureDetector>

      <GestureDetector gesture={bodyPan}>
        {/* Explicit height: the detector wraps its child, so bottom: 0 would
            resolve against a zero-height wrapper and clip the avatars. */}
        <View style={[styles.body, { top, height: stops.expanded - top }]}>
          <Animated.View
            style={[StyleSheet.absoluteFill, listStyle]}
            pointerEvents={collapsed ? 'none' : 'auto'}
            accessibilityElementsHidden={collapsed}
            importantForAccessibility={collapsed ? 'no-hide-descendants' : 'auto'}
          >
            <Animated.ScrollView
              testID="tracking-sheet-content"
              accessibilityElementsHidden={collapsed}
              importantForAccessibility={collapsed ? 'no-hide-descendants' : 'auto'}
              onScroll={onListScroll}
              scrollEventThrottle={16}
              scrollEnabled={level === 'expanded'}
              contentContainerStyle={styles.listContent}
            >
              {children({ onRowLayout })}
            </Animated.ScrollView>
          </Animated.View>

          <Animated.View
            style={[styles.strip, stripStyle]}
            pointerEvents={collapsed ? 'auto' : 'none'}
            accessibilityElementsHidden={!collapsed}
            importantForAccessibility={collapsed ? 'auto' : 'no-hide-descendants'}
          >
            <Animated.ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              onScroll={onStripScroll}
              scrollEventThrottle={16}
              contentContainerStyle={styles.stripContent}
            >
              {strip.map(item => (
                <Pressable
                  key={item.id}
                  testID={`strip-dog-${item.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.name}，${item.spoken ?? item.status}`}
                  accessibilityHint="把地圖移到這隻狗，並打開選項"
                  onPress={event => item.onPress(event.nativeEvent.pageY, event.nativeEvent.pageX)}
                  style={styles.chip}
                >
                  <View style={styles.chipRing} />
                  <Text style={styles.chipName} numberOfLines={1} maxFontSizeMultiplier={FONT_CAP}>{item.name}</Text>
                  <Text style={[styles.chipStatus, { color: item.statusColor }]} numberOfLines={1} maxFontSizeMultiplier={FONT_CAP}>{item.status}</Text>
                </Pressable>
              ))}
            </Animated.ScrollView>
          </Animated.View>

          <View style={styles.flyers} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {strip.map((item, index) => (
              <FlyingAvatar key={item.id} index={index} id={item.id} ring={item.ring} avatar={item.avatar} progress={progress}
                stripX={stripX} listY={listY} rows={rows} fontScale={fontScale} reduced={reduced} />
            ))}
          </View>
        </View>
      </GestureDetector>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute', zIndex: 10, left: 12, right: 12,
    borderRadius: 24, backgroundColor: colors.surface, overflow: 'hidden', ...shadow.floating,
  },
  covered: { opacity: 0 },
  handleArea: { height: 22, alignItems: 'center', justifyContent: 'center' },
  handle: { width: 40, height: 5, borderRadius: 3, backgroundColor: '#D8CFCC' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SIDE, gap: space.s },
  headerText: { flex: 1 },
  title: { ...type.status, color: colors.text, flexShrink: 1 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  badge: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  badgeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.ok },
  badgeText: { ...type.caption, color: colors.ok, fontWeight: '700' },
  summary: { ...type.caption, color: colors.textMuted },
  body: { position: 'absolute', left: 0, right: 0 },
  listContent: { paddingHorizontal: 18, paddingBottom: space.xl },
  strip: { position: 'absolute', left: 0, right: 0, top: 0 },
  stripContent: { paddingHorizontal: SIDE, gap: CHIP_GAP },
  chip: { width: CHIP_WIDTH, alignItems: 'center', paddingBottom: space.s },
  chipRing: { width: STRIP_RING, height: STRIP_RING, marginBottom: 4 },
  chipName: { ...type.caption, fontWeight: '700', color: colors.text, maxWidth: CHIP_WIDTH },
  chipStatus: { ...type.caption, fontWeight: '700' },
  flyers: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, overflow: 'hidden' },
  flyer: {
    position: 'absolute', left: 0, top: 0, width: STRIP_RING, height: STRIP_RING,
    borderRadius: STRIP_RING / 2, borderWidth: 3, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
});
