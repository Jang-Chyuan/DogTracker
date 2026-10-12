import { t } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';
import { radius, size } from '../theme/tokens';
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

function Block({ width, height = 12, square = false, progress, reduced, colors }) {
  const [measured, setMeasured] = useState(0);
  return <View onLayout={event => setMeasured(event.nativeEvent.layout.width)}
    style={[styles.block, square && styles.square, { width, height, backgroundColor: colors.skeleton }]}>
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
  const block = (width, height, square = false) => <Block {...{ width, height, square, progress, reduced, colors }} />;
  return <Animated.View testID={testID} accessible={false} accessibilityElementsHidden
    importantForAccessibility="no-hide-descendants" style={[styles.shape, shape === 'address' && styles.address,
      reduced && { opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.6] }) }]}>
    {shape === 'address' ? block('80%', 12) : shape === 'chart' || shape === 'bars' ? <>
      <View style={styles.chart}>{shape === 'chart' ? block('100%', 180, true)
        : [100, 150, 120, 170, 110, 140, 130].map((height, index) => <View key={index}>{block(24, height, true)}</View>)}</View>
      <View style={styles.row}>{block('35%')}{block('25%')}{block('25%')}</View>
    </> : [0, 1, 2, 3].map(index => <View key={index} style={[styles.row, shape === 'timeline' && styles.timeline]}>
      {shape === 'timeline' ? <>{block(40)}{block(16, 16)}{block(index % 2 ? '60%' : '70%')}</>
        : <><View style={styles.labels}>{block('70%')}{index % 2 === 0 && block('45%')}</View>{block('25%')}</>}
    </View>)}
  </Animated.View>;
}

/**
 * Keep this mounted around content to fade in when a slow load finishes.
 * `immediate`: show the skeleton on the first frame instead of after
 * SKELETON_TIMING.delay — for a wait the user just started (a released
 * range, another day), whose work may then keep the JavaScript timer from
 * ever firing. A new `label` while still loading (讀取中 → 下載…) is only
 * announced: the skeleton stays, it does not wait for the delay again.
 */
export function LoadingContent({ loading, children, shape, label = t('c425'), skeletonTestID, reduced, immediate = false }) {
  const [visible, setVisible] = useState(immediate && loading);
  const wasVisible = useRef(false);
  // A new value for each content that follows a load: the content view
  // unmounted for the skeleton detaches only in a microtask, and a fade
  // started on its old value before then (an immediate skeleton can be
  // that short) would try to drive the unmounted view.
  const opacityNow = useRef(null);
  const wasLoading = useRef(loading);
  if (!opacityNow.current || (wasLoading.current && !loading)) opacityNow.current = new Animated.Value(1);
  wasLoading.current = loading;
  const opacity = opacityNow.current;
  const immediateNow = useRef(immediate);
  immediateNow.current = immediate;
  useEffect(() => {
    if (loading) AccessibilityInfo.announceForAccessibility?.(label);
  }, [loading, label]);
  useEffect(() => {
    if (!loading) return undefined;
    opacity.setValue(1);
    if (immediateNow.current) {
      wasVisible.current = true;
      setVisible(true);
      return undefined;
    }
    setVisible(false);
    wasVisible.current = false;
    const timer = setTimeout(() => { wasVisible.current = true; setVisible(true); }, SKELETON_TIMING.delay);
    return () => clearTimeout(timer);
  }, [loading, opacity]);
  // Asked for at once while already waiting for the delay.
  useEffect(() => {
    if (!loading || !immediate || wasVisible.current) return;
    wasVisible.current = true;
    setVisible(true);
  }, [loading, immediate]);
  useEffect(() => {
    if (loading) return undefined;
    if (!wasVisible.current) {
      opacity.setValue(1);
      return undefined;
    }
    wasVisible.current = false;
    setVisible(false);
    opacity.setValue(0);
    const animation = Animated.timing(opacity, { toValue: 1, duration: SKELETON_TIMING.fade, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [loading, opacity]);
  if (loading) return visible || immediate ? <Skeleton shape={shape} testID={skeletonTestID} reduced={reduced} /> : null;
  return <Animated.View style={{ opacity }}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  shape: { padding: size.skeleton.padding },
  address: { padding: 0, width: '100%' },
  block: { overflow: 'hidden', borderRadius: radius.full },
  square: { borderRadius: 0 },
  light: { position: 'absolute', top: 0, bottom: 0 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: size.skeleton.rowGap, marginBottom: size.skeleton.rowSpacing },
  timeline: { minHeight: size.skeleton.timelineRow, justifyContent: 'flex-start' },
  labels: { width: '60%', gap: size.skeleton.labelGap },
  chart: { height: size.skeleton.chart, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: size.skeleton.rowSpacing },
});
