// A small window rising from the bottom of the history screen (DESIGN.md
// 「底部小視窗」: top corners 16, 16dp inside, a 45% dark scrim behind; title
// 16sp bold): the dog chooser and export. A tap on the scrim, the back
// key (HistoryScreen asks `back()`) or a choice closes it.
import { useTheme, makeStyles } from '../theme/ThemeProvider';
import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import { isReduceMotion, REDUCED_FADE_MS } from '../utils/reduceMotion';
import {
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import {
  motion,
  radius,
  size as sizes,
  space,
  touch,
  type,
  border,
} from '../theme/tokens';
import { useInitialFocus } from '../utils/a11yFocus';

const ease = Easing.bezier(...motion.easeOut);

/**
 * `title`, `children` (the rows), `onClosed()` once it has slid away;
 * `locked`: a tap on the scrim does nothing (H9 產生中: only 取消 or the back
 * key stop it); `divided`: a line under the title. Ref:
 * { close(then?) } — slides it away, then calls `then` (a choice is applied
 * after the sheet has gone, so the screen does not change under it).
 */
const HistoryBottomSheet = forwardRef(function HistoryBottomSheet(
  {
    title,
    children,
    onClosed,
    bottomInset = 0,
    testID,
    closeLabel = '關閉',
    locked = false,
    divided = false,
  },
  ref,
) {
  const styles = getStyles(useTheme());
  const { height: windowHeight } = useWindowDimensions();
  const progress = useRef(new Animated.Value(0)).current;
  // Made once (a native-driven style changed under a running animation left
  // the sheet undrawn, as in the calendar).
  // 減少動態效果: no slide, the sheet fades with its scrim (DESIGN.md §8).
  const reduced = useRef(isReduceMotion()).current;
  const sheetOpacity = reduced ? progress : 1;
  const translateY = useRef(
    progress.interpolate({
      inputRange: [0, 1],
      outputRange: [reduced ? 0 : windowHeight, 0],
    }),
  ).current;
  const opened = useRef(false);
  // TalkBack starts on the sheet's title.
  const titleRef = useRef(null);
  useInitialFocus(titleRef);
  const closing = useRef(false);
  const close = useCallback(
    then => {
      if (closing.current) return;
      closing.current = true;
      Animated.timing(progress, {
        toValue: 0,
        duration: reduced ? REDUCED_FADE_MS : motion.rangeCollapse.duration,
        easing: ease,
        useNativeDriver: true,
      }).start(() => {
        then?.();
        onClosed?.();
      });
    },
    [onClosed, progress, reduced],
  );
  useImperativeHandle(ref, () => ({ close }), [close]);
  const onLayout = event => {
    if (opened.current || !event.nativeEvent.layout.height) return;
    opened.current = true;
    Animated.timing(progress, {
      toValue: 1,
      duration: reduced ? REDUCED_FADE_MS : motion.cardRise.duration,
      easing: ease,
      useNativeDriver: true,
    }).start();
  };
  return (
    <View
      style={[StyleSheet.absoluteFill, styles.layer]}
      testID={testID}
      collapsable={false}
    >
      <Animated.View
        style={[StyleSheet.absoluteFill, styles.scrim, { opacity: progress }]}
        collapsable={false}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
          onPress={() => {
            if (!locked) close();
          }}
        />
      </Animated.View>
      <Animated.View
        onLayout={onLayout}
        accessibilityViewIsModal
        style={[
          styles.sheet,
          {
            paddingBottom: space.l + bottomInset,
            maxHeight: Math.round(windowHeight * sizes.sheet.maxRatio),
            transform: [{ translateY }],
            opacity: sheetOpacity,
          },
        ]}
      >
        <View style={styles.handle} />
        <Text
          ref={titleRef}
          style={[styles.title, divided && styles.divided]}
          accessibilityRole="header"
        >
          {title}
        </Text>
        <ScrollView bounces={false}>{children}</ScrollView>
      </Animated.View>
    </View>
  );
});

export default HistoryBottomSheet;

const getStyles = makeStyles(theme => {
  const { colors } = theme;
  return StyleSheet.create({
    // Over the top capsules (30) and the panel (40), like the calendar.
    layer: { zIndex: 60, elevation: 30 },
    scrim: { backgroundColor: colors.scrim },
    sheet: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: colors.elevated,
      ...theme.floatingBorder,
      borderTopLeftRadius: radius.sheet,
      borderTopRightRadius: radius.sheet,
      paddingHorizontal: space.l,
      paddingTop: space.s,
      elevation: 24,
    },
    handle: {
      alignSelf: 'center',
      width: sizes.sheet.handleLength,
      height: sizes.sheet.handleThickness,
      borderRadius: sizes.sheet.handleThickness / 2,
      backgroundColor: colors.sheetHandle,
      marginBottom: space.s,
    },
    // H9: a line under the title (the export window).
    divided: {
      borderBottomWidth: border.hairline,
      borderBottomColor: colors.line,
      paddingBottom: space.m,
    },
    title: {
      ...type.status,
      color: colors.text,
      minHeight: touch.min,
      textAlignVertical: 'center',
      paddingTop: space.m,
    },
  });
});
