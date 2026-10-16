import { t } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { useReduceMotion } from '../utils/reduceMotion';
import { motion, radius, size as sizes, space, type } from '../theme/tokens';

/**
 * A small 「更新中」 capsule with the catch-up pill's shimmer sweeping across it
 * (MapControls.CatchUpPill, 070): what is shown is kept while its newest data
 * is fetched. Under 減少動態效果 it stands still.
 */
export default function ShimmerLabel({ text = t('c1420'), testID = 'shimmer-label' }) {
  const { colors } = useTheme();
  const reduced = useReduceMotion();
  const sweep = useRef(new Animated.Value(0)).current;
  const [width, setWidth] = useState(0);
  const shimmering = !reduced && width > 0;
  useEffect(() => {
    if (!shimmering) return undefined;
    sweep.setValue(0);
    const run = Animated.loop(
      Animated.timing(sweep, {
        toValue: 1,
        duration: motion.catchUpSweep.duration,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    );
    run.start();
    return () => run.stop();
  }, [shimmering, sweep]);
  const band = sizes.catchUpPill.shimmer;
  return (
    <View
      testID={testID}
      accessibilityLiveRegion="polite"
      onLayout={event => setWidth(event.nativeEvent.layout.width)}
      style={[styles.pill, { backgroundColor: colors.skeleton }]}
    >
      {shimmering && (
        <Animated.View
          testID={`${testID}-shimmer`}
          pointerEvents="none"
          style={[styles.shimmer, {
            width: band,
            backgroundColor: colors.skeletonHighlight,
            transform: [{ translateX: sweep.interpolate({ inputRange: [0, 1], outputRange: [-band, width] }) }],
          }]}
        />
      )}
      <Text style={[styles.text, { color: colors.textMuted }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { borderRadius: radius.full, paddingHorizontal: space.s, overflow: 'hidden', justifyContent: 'center' },
  shimmer: { position: 'absolute', top: 0, bottom: 0, left: 0 },
  text: { fontSize: type.caption.fontSize },
});
