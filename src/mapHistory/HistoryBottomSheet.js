// A small window rising from the bottom of the history screen (DESIGN.md
// 「底部小視窗」: top corners 16, 16dp inside, a 45% dark scrim behind; title
// 16sp bold): 「＋ 加入」's dogs and 資料來源. A tap on the scrim, the back
// key (HistoryScreen asks `back()`) or a choice closes it.
import React, { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { colors, motion, radius, size as sizes, space, touch, type } from '../theme/tokens';

const ease = Easing.bezier(...motion.easeOut);

/**
 * `title`, `children` (the rows), `onClosed()` once it has slid away. Ref:
 * { close(then?) } — slides it away, then calls `then` (a choice is applied
 * after the sheet has gone, so the screen does not change under it).
 */
const HistoryBottomSheet = forwardRef(function HistoryBottomSheet({ title, children, onClosed, bottomInset = 0,
  testID, closeLabel = '關閉' }, ref) {
  const { height: windowHeight } = useWindowDimensions();
  const progress = useRef(new Animated.Value(0)).current;
  // Made once (a native-driven style changed under a running animation left
  // the sheet undrawn, as in the calendar).
  const translateY = useRef(progress.interpolate({ inputRange: [0, 1], outputRange: [windowHeight, 0] })).current;
  const opened = useRef(false);
  const closing = useRef(false);
  const close = useCallback(then => {
    if (closing.current) return;
    closing.current = true;
    Animated.timing(progress, { toValue: 0, duration: motion.rangeCollapse.duration, easing: ease,
      useNativeDriver: true }).start(() => {
      then?.();
      onClosed?.();
    });
  }, [onClosed, progress]);
  useImperativeHandle(ref, () => ({ close }), [close]);
  const onLayout = event => {
    if (opened.current || !event.nativeEvent.layout.height) return;
    opened.current = true;
    Animated.timing(progress, { toValue: 1, duration: motion.cardRise.duration, easing: ease,
      useNativeDriver: true }).start();
  };
  return (
    <View style={[StyleSheet.absoluteFill, styles.layer]} testID={testID} collapsable={false}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, { opacity: progress }]} collapsable={false}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel={closeLabel}
          onPress={() => close()} />
      </Animated.View>
      <Animated.View onLayout={onLayout} accessibilityViewIsModal
        style={[styles.sheet, { paddingBottom: space.l + bottomInset,
          maxHeight: Math.round(windowHeight * sizes.sheet.maxRatio), transform: [{ translateY }] }]}>
        <View style={styles.handle} />
        <Text style={styles.title} accessibilityRole="header">{title}</Text>
        <ScrollView bounces={false}>{children}</ScrollView>
      </Animated.View>
    </View>
  );
});

export default HistoryBottomSheet;

const styles = StyleSheet.create({
  // Over the top capsules (30) and the panel (40), like the calendar.
  layer: { zIndex: 60, elevation: 30 },
  scrim: { backgroundColor: colors.scrim },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.surface,
    borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, paddingHorizontal: space.l,
    paddingTop: space.s, elevation: 24,
  },
  handle: { alignSelf: 'center', width: 32, height: 4, borderRadius: 2, backgroundColor: colors.sheetHandle, marginBottom: space.s },
  title: { ...type.status, color: colors.text, minHeight: touch.min, textAlignVertical: 'center', paddingTop: 12 },
});
