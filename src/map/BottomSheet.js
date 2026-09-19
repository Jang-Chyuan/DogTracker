import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { floatingShadow, mapColors as colors } from './MapTheme';
import {
  clampHeight,
  sheetStops,
  settleSheet,
  shouldDragSheet,
} from './SheetMotion';

/**
 * The draggable card the map screens share: the live card and the history card
 * behave the same, so the motion, the handle and the scroll container live
 * here and each screen only supplies its own content.
 *
 * `name` prefixes the testIDs, so a screen's card stays identifiable.
 */
export default function BottomSheet({
  name = 'tracking',
  title,
  summary,
  bottomInset,
  topInset = 100,
  onHeight,
  children,
}) {
  const { height: windowHeight, fontScale } = useWindowDimensions();
  const stops = useMemo(
    () => sheetStops(windowHeight, bottomInset, topInset, fontScale),
    [windowHeight, bottomInset, topInset, fontScale],
  );
  const [level, setLevel] = useState('collapsed');
  const animation = useRef(new Animated.Value(stops.collapsed)).current;
  const current = useRef(stops.collapsed);
  const start = useRef(stops.collapsed);
  const scroll = useRef(null);
  const scrollOffset = useRef(0);
  const motion = useRef(null);
  motion.current = { stops, level, onHeight };
  useEffect(() => {
    const listener = animation.addListener(({ value }) => {
      current.current = value;
    });
    return () => {
      animation.removeListener(listener);
      animation.stopAnimation();
    };
  }, [animation]);
  useEffect(() => {
    onHeight(stops[level]);
    const transition = Animated.spring(animation, {
      toValue: stops[level],
      speed: 22,
      bounciness: 0,
      useNativeDriver: false,
    });
    transition.start();
    return () => transition.stop();
  }, [animation, stops, level, onHeight]);

  const settle = useRef(null);
  settle.current = next => {
    setLevel(next);
    if (next !== 'expanded') {
      scroll.current?.scrollTo({ y: 0, animated: false });
      scrollOffset.current = 0;
    }
    // Also settle when the target is the existing level (a short/cancelled drag).
    if (next === motion.current.level) {
      motion.current.onHeight(motion.current.stops[next]);
      Animated.spring(animation, {
        toValue: motion.current.stops[next],
        speed: 22,
        bounciness: 0,
        useNativeDriver: false,
      }).start();
    }
  };
  const pan = useMemo(() => {
    const handlers = {
      onPanResponderGrant: () => {
        animation.stopAnimation();
        start.current = current.current;
      },
      onPanResponderMove: (_, gesture) => {
        animation.setValue(
          clampHeight(
            start.current - gesture.dy,
            motion.current.stops.collapsed,
            motion.current.stops.expanded,
          ),
        );
      },
      onPanResponderRelease: (_, gesture) =>
        settle.current(
          settleSheet(current.current, gesture.vy, motion.current.stops),
        ),
      onPanResponderTerminate: () => settle.current(motion.current.level),
    };
    return {
      content: PanResponder.create({
        ...handlers,
        onMoveShouldSetPanResponderCapture: (_, gesture) =>
          shouldDragSheet(
            gesture,
            current.current,
            motion.current.stops.expanded,
            scrollOffset.current,
          ),
      }),
      handle: PanResponder.create({
        ...handlers,
        // The handle always drags the sheet, even if its content is scrolled.
        onMoveShouldSetPanResponderCapture: (_, gesture) =>
          shouldDragSheet(
            gesture,
            current.current,
            motion.current.stops.expanded,
            0,
          ),
      }),
    };
  }, [animation]);
  return (
    <Animated.View
      style={[styles.sheet, { bottom: bottomInset, height: animation }]}
      testID={`${name}-sheet`}
      {...pan.content.panHandlers}
    >
      <View
        style={[styles.handleArea, { height: stops.collapsed }]}
        testID={`${name}-sheet-handle`}
        {...pan.handle.panHandlers}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={`${title}。${summary}。上滑展開、下滑收合`}
        accessibilityValue={{
          min: 0,
          max: 2,
          now: ['collapsed', 'compact', 'expanded'].indexOf(level),
        }}
        accessibilityActions={[
          { name: 'increment', label: '展開' },
          { name: 'decrement', label: '收合' },
        ]}
        onAccessibilityAction={event => {
          const levels = ['collapsed', 'compact', 'expanded'];
          const index =
            levels.indexOf(level) +
            (event.nativeEvent.actionName === 'increment' ? 1 : -1);
          settle.current(levels[Math.max(0, Math.min(2, index))]);
        }}
      >
        <View style={styles.handle} />
        <Text
          style={styles.summary}
          numberOfLines={1}
          testID={`${name}-sheet-summary`}
        >
          {title}
        </Text>
        {/* Two lines: the history summary carries a range and a count per dog,
            and one line cut it off mid-sentence. */}
        <Text style={styles.summaryTime} numberOfLines={2}>
          {summary}
        </Text>
      </View>
      <ScrollView
        ref={scroll}
        contentContainerStyle={styles.content}
        nestedScrollEnabled
        bounces={false}
        // The history card holds text inputs: without this the first tap after
        // typing only dismisses the keyboard and never reaches 套用 or a chip.
        keyboardShouldPersistTaps="handled"
        testID={`${name}-sheet-content`}
        scrollEnabled={level === 'expanded'}
        scrollEventThrottle={16}
        onScroll={event => {
          scrollOffset.current = Math.max(0, event.nativeEvent.contentOffset.y);
        }}
        accessibilityElementsHidden={level === 'collapsed'}
        importantForAccessibility={
          level === 'collapsed' ? 'no-hide-descendants' : 'auto'
        }
      >
        {children}
      </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    zIndex: 10,
    left: 12,
    right: 12,
    borderRadius: 24,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    ...floatingShadow,
  },
  handleArea: {
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    gap: 4,
  },
  handle: { width: 40, height: 5, backgroundColor: '#C6CCC9', borderRadius: 3 },
  summary: {
    alignSelf: 'stretch',
    textAlign: 'center',
    color: colors.ink,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  summaryTime: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  content: { padding: 18, paddingTop: 0, paddingBottom: 24 },
});
