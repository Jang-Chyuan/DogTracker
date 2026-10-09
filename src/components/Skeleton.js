import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export const SKELETON_TIMING = Object.freeze({ delay: 300, sweep: 1200, pulse: 1600, fade: 150 });

export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    Promise.resolve(AccessibilityInfo.isReduceMotionEnabled?.()).then(value => {
      if (alive) setReduced(!!value);
    });
    const subscription = AccessibilityInfo.addEventListener?.('reduceMotionChanged', setReduced);
    return () => { alive = false; subscription?.remove(); };
  }, []);
  return reduced;
}

function Block({ width, height = 12, round = false, progress, reduced, colors }) {
  const [measured, setMeasured] = useState(0);
  return <View onLayout={event => setMeasured(event.nativeEvent.layout.width)}
    style={[styles.block, round && styles.round, { width, height, backgroundColor: colors.skeleton }]}>
    {!reduced && measured > 0 && <Animated.View style={[styles.light, {
      width: measured * 0.5, backgroundColor: colors.skeletonHighlight,
      transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [-measured * 0.5, measured] }) }],
    }]} />}
  </View>;
}

/** Known content shapes, hidden from TalkBack; the loading transition is announced once. */
export default function Skeleton({ shape = 'rows', reduced: override, testID = 'skeleton' }) {
  const { colors } = useTheme();
  const systemReduced = useReducedMotion();
  const reduced = override ?? systemReduced;
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    progress.setValue(0);
    const animation = Animated.loop(reduced ? Animated.sequence([
      Animated.timing(progress, { toValue: 1, duration: SKELETON_TIMING.pulse / 2, useNativeDriver: true }),
      Animated.timing(progress, { toValue: 0, duration: SKELETON_TIMING.pulse / 2, useNativeDriver: true }),
    ]) : Animated.timing(progress, { toValue: 1, duration: SKELETON_TIMING.sweep,
      easing: Easing.inOut(Easing.ease), useNativeDriver: true }));
    animation.start();
    return () => animation.stop();
  }, [progress, reduced]);
  const block = (width, height, round = false) => <Block {...{ width, height, round, progress, reduced, colors }} />;
  return <Animated.View testID={testID} accessible={false} accessibilityElementsHidden
    importantForAccessibility="no-hide-descendants" style={[styles.shape,
      reduced && { opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.6] }) }]}>
    {shape === 'chart' || shape === 'bars' ? <>
      <View style={styles.chart}>{shape === 'chart' ? block('100%', 180)
        : [100, 150, 120, 170, 110, 140, 130].map((height, index) => <View key={index}>{block(24, height)}</View>)}</View>
      <View style={styles.row}>{block('35%')}{block('25%')}{block('25%')}</View>
    </> : [0, 1, 2, 3].map(index => <View key={index} style={[styles.row, shape === 'timeline' && styles.timeline]}>
      {shape === 'timeline' ? <>{block(40)}{block(16, 16, true)}{block(index % 2 ? '60%' : '70%')}</>
        : <><View style={styles.labels}>{block('70%')}{index % 2 === 0 && block('45%')}</View>{block('25%')}</>}
    </View>)}
  </Animated.View>;
}

/** Keep this mounted around content to fade in when a slow load finishes. */
export function LoadingContent({ loading, children, shape, label = '載入中', skeletonTestID, reduced }) {
  const [visible, setVisible] = useState(false);
  const wasVisible = useRef(false);
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!loading) return undefined;
    AccessibilityInfo.announceForAccessibility?.(label);
    setVisible(false);
    const timer = setTimeout(() => { wasVisible.current = true; setVisible(true); }, SKELETON_TIMING.delay);
    return () => clearTimeout(timer);
  }, [loading, label]);
  useEffect(() => {
    if (loading || !wasVisible.current) return undefined;
    wasVisible.current = false;
    setVisible(false);
    opacity.setValue(0);
    const animation = Animated.timing(opacity, { toValue: 1, duration: SKELETON_TIMING.fade, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [loading, opacity]);
  if (loading) return visible ? <Skeleton shape={shape} testID={skeletonTestID} reduced={reduced} /> : null;
  return <Animated.View style={{ opacity }}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  shape: { padding: 16 },
  block: { overflow: 'hidden', borderRadius: 6 },
  round: { borderRadius: 8 },
  light: { position: 'absolute', top: 0, bottom: 0 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 24 },
  timeline: { minHeight: 64, justifyContent: 'flex-start' },
  labels: { width: '60%', gap: 10 },
  chart: { height: 180, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 24 },
});
