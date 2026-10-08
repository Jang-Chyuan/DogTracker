// The history screen's bottom panel (DESIGN.md「面板高度」「面板和清單的手勢」):
// three heights — only the date row and summary (about 140dp), half (the
// default) and 75% of the screen. Only the handle, the date row and the
// summary drag it (a spring, translateY, never height); the list scrolls
// inside and never moves the panel. A day without records keeps one height
// (about 40%).
import { useTheme, makeStyles } from '../theme/ThemeProvider';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { motion, radius, size as sizes } from '../theme/tokens';

const getHANDLE = makeStyles(theme => {
  const { literalColors: themeLiteral } = theme;
  return themeLiteral.sheetHandle;
});
// The default height: date row, summary and the first rows of the list (H1).
export const PANEL_HALF_SHARE = 0.55;

/**
 * Where a drag let go at `height` with velocity `vy` (dp/ms, negative = up)
 * settles: a flick goes one level on in its direction, else the nearest.
 */
export function settleLevel(height, vy, levels) {
  const order = ['summary', 'half', 'full'].filter(
    name => levels[name] != null,
  );
  if (Math.abs(vy) > 0.35) {
    const up = vy < 0;
    const next = up
      ? order.find(name => levels[name] > height + 1)
      : [...order].reverse().find(name => levels[name] < height - 1);
    if (next) return next;
  }
  return order.reduce(
    (best, name) =>
      Math.abs(levels[name] - height) < Math.abs(levels[best] - height)
        ? name
        : best,
    order[0],
  );
}

/** The panel's heights for a window `height` high (and the bottom inset). */
export function panelLevels(height, bottomInset = 0, { empty = false } = {}) {
  const full = Math.round(height * sizes.sheet.maxRatio);
  if (empty) {
    const fixed = Math.round(height * sizes.sheet.emptyRatio);
    return { summary: fixed, half: fixed, full: fixed };
  }
  return {
    summary: Math.min(full, sizes.sheet.collapsed + bottomInset),
    half: Math.min(full, Math.round(height * PANEL_HALF_SHARE)),
    full,
  };
}

/**
 * `header`: handle, date row and summary (they drag the panel). `children`:
 * the list, scrolled inside. `onLevel(level, height)` after each settle;
 * `onDragStart` when the user starts dragging it (the range bar closes).
 * Ref: { level, setLevel(level), back() } — back() takes the panel from 75%
 * to half and says whether it did (返回鍵 table).
 */
const HistoryPanel = forwardRef(function HistoryPanel(
  {
    levels: given,
    header,
    children,
    onLevel,
    onDragStart,
    bottomInset = 0,
    scrollRef,
    locked = false,
    initialLevel = 'half',
    above = null,
    footer = null,
  },
  ref,
) {
  const styles = getStyles(useTheme());
  // 只留日期列和摘要: exactly the header (it can be taller than 140dp with
  // large text), above the navigation bar.
  const [headerHeight, setHeaderHeight] = useState(0);
  const summary = Math.min(
    given.full,
    Math.max(
      given.summary,
      headerHeight ? Math.ceil(headerHeight + bottomInset) : 0,
    ),
  );
  const levels = useMemo(
    () => ({
      ...given,
      summary: given.summary === given.full ? given.summary : summary,
    }),
    [given, summary],
  );
  const [level, setLevelState] = useState(initialLevel);
  const levelRef = useRef(level);
  levelRef.current = level;
  // The list's bottom padding shrinks as the panel rises (so its end stays
  // above the screen's edge at every height). A list scrolled to its end at
  // half height would then show blank space under the last row at 75%:
  // bring it back to the new end.
  const ownScroll = useRef(null);
  const scroller = scrollRef ?? ownScroll;
  const scrolled = useRef({ y: 0, content: 0, frame: 0 });
  useEffect(() => {
    const { y, content, frame } = scrolled.current;
    const end = Math.max(0, content - frame);
    if (frame > 0 && y > end + 1) scroller.current?.scrollTo({ y: end, animated: true });
  }, [level, scroller]);
  const height = useRef(new Animated.Value(levels[initialLevel])).current;
  const current = useRef(levels[initialLevel]);
  useEffect(() => {
    const id = height.addListener(({ value }) => {
      current.current = value;
    });
    return () => height.removeListener(id);
  }, [height]);
  const settle = useCallback(
    next => {
      setLevelState(next);
      Animated.spring(height, {
        toValue: levels[next],
        ...motion.sheetSpring,
        useNativeDriver: true,
      }).start();
      onLevel?.(next, levels[next]);
    },
    [height, levels, onLevel],
  );
  // New heights (a rotation, a day with or without records): stay on the level.
  const levelsKey = `${levels.summary}:${levels.half}:${levels.full}`;
  useEffect(() => {
    settle(levelRef.current);
    // levelsKey stands for levels.
  }, [levelsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useImperativeHandle(
    ref,
    () => ({
      get level() {
        return levelRef.current;
      },
      setLevel: next => {
        if (levels[next] != null) settle(next);
      },
      back: () => {
        if (levelRef.current !== 'full' || locked) return false;
        settle('half');
        return true;
      },
    }),
    [levels, settle, locked],
  );
  const start = useRef(0);
  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          !locked &&
          Math.abs(gesture.dy) > 8 &&
          Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderGrant: () => {
          start.current = current.current;
          height.stopAnimation();
          onDragStart?.();
        },
        onPanResponderMove: (_, gesture) => {
          height.setValue(
            Math.max(
              levels.summary,
              Math.min(levels.full, start.current - gesture.dy),
            ),
          );
        },
        onPanResponderRelease: (_, gesture) =>
          settle(settleLevel(current.current, gesture.vy, levels)),
        onPanResponderTerminate: () => settle(levelRef.current),
      }),
    [height, levels, settle, onDragStart, locked],
  );
  // translateY moves the panel down by what is not shown.
  const translateY = height.interpolate({
    inputRange: [0, levels.full],
    outputRange: [levels.full, 0],
    extrapolate: 'clamp',
  });
  const pressHandle = () => {
    if (locked) return;
    settle(levelRef.current === 'full' ? 'half' : 'full');
  };
  // The foot row (資料來源) stays at the bottom of what is shown, above the
  // navigation bar: it rides the panel's height, not its top.
  const footerHeight = footer ? sizes.sheet.dataSourceRow : 0;
  const footerY = useMemo(
    () =>
      Animated.add(height, new Animated.Value(-(footerHeight + bottomInset))),
    [height, footerHeight, bottomInset],
  );
  // One fixed height (a day without records): nothing fades.
  const fadeFrom =
    levels.summary < levels.full ? levels.summary : levels.summary - 40;
  const listOpacity = height.interpolate({
    inputRange: [fadeFrom, fadeFrom + 40],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  // What rides on the panel's top edge (框住全部), faded out above half.
  const aboveOpacity = height.interpolate({
    inputRange: [levels.half, Math.max(levels.half + 1, levels.half + 60)],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });
  return (
    <Animated.View
      testID="history-panel"
      pointerEvents="box-none"
      style={[
        styles.panel,
        { height: levels.full, transform: [{ translateY }] },
      ]}
    >
      {above && (
        <Animated.View
          pointerEvents="box-none"
          style={[styles.above, { opacity: aboveOpacity }]}
        >
          {above}
        </Animated.View>
      )}
      <View style={styles.sheet}>
        <View
          {...responder.panHandlers}
          testID="history-panel-header"
          onLayout={event => setHeaderHeight(event.nativeEvent.layout.height)}
        >
          <Pressable
            onPress={pressHandle}
            style={styles.handleArea}
            accessibilityRole="adjustable"
            accessibilityLabel="面板高度"
            hitSlop={8}
          >
            <View style={styles.handle} />
          </Pressable>
          {header}
        </View>
        {/* Only the date row and the summary at the lowest height: the list
                 fades out over its last 40dp (it would peek over the system bar). */}
        <Animated.View style={[styles.list, { opacity: listOpacity }]}>
          <ScrollView
            ref={scroller}
            style={styles.list}
            nestedScrollEnabled
            scrollEventThrottle={100}
            onScroll={event => {
              scrolled.current.y = event.nativeEvent.contentOffset.y;
            }}
            onContentSizeChange={(_, contentHeight) => {
              scrolled.current.content = contentHeight;
            }}
            onLayout={event => {
              scrolled.current.frame = event.nativeEvent.layout.height;
            }}
            contentContainerStyle={{
              paddingBottom:
                levels.full - levels[level] + bottomInset + footerHeight + 16,
            }}
          >
            {children}
          </ScrollView>
        </Animated.View>
        {footer && (
          <Animated.View
            style={[
              styles.footer,
              {
                height: footerHeight + bottomInset,
                paddingBottom: bottomInset,
                opacity: listOpacity,
                transform: [{ translateY: footerY }],
              },
            ]}
          >
            {footer}
          </Animated.View>
        )}
      </View>
    </Animated.View>
  );
});

export default HistoryPanel;

const getStyles = makeStyles(theme => {
  const { colors, shadow } = theme;
  const HANDLE = getHANDLE(theme);
  return StyleSheet.create({
    panel: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 40,
      elevation: 12,
    },
    sheet: {
      flex: 1,
      backgroundColor: colors.elevated,
      borderTopLeftRadius: radius.sheet + 8,
      borderTopRightRadius: radius.sheet + 8,
      ...shadow.floating,
      ...theme.floatingBorder,
      elevation: 12,
      overflow: 'hidden',
    },
    above: {
      position: 'absolute',
      right: 16,
      top: -(sizes.floatingButton + 12),
    },
    handleArea: { height: 20, alignItems: 'center', justifyContent: 'center' },
    handle: { width: 32, height: 4, borderRadius: 2, backgroundColor: HANDLE },
    list: { flex: 1 },
    footer: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: 0,
      backgroundColor: colors.elevated,
    },
  });
});
