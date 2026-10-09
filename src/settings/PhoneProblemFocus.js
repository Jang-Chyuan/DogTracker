import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { useReducedMotion } from '../components/Skeleton';

export function firstPhoneProblem(page) {
  if (!page.recording.on) return 'recording';
  if (page.location.problem) return 'location';
  return null;
}

/** Rows measure their position in the card; the target is resolved when S4 opens. */
export function FocusedPhoneRow({ children, id, target }) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const opacity = useRef(new Animated.Value(0)).current;
  const [laidOut, setLaidOut] = useState(false);
  useEffect(() => {
    if (target !== id || !laidOut) return undefined;
    opacity.setValue(1);
    let animation;
    const timer = setTimeout(() => {
      if (reduced) opacity.setValue(0);
      else {
        animation = Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true });
        animation.start();
      }
    }, 1000);
    return () => { clearTimeout(timer); animation?.stop(); };
  }, [id, target, laidOut, opacity, reduced]);
  return <View testID={`phone-focus-${id}`} onLayout={() => {
    setLaidOut(true);
  }}>
    <Animated.View pointerEvents="none" testID={`phone-highlight-${id}`} accessible={false}
      style={[StyleSheet.absoluteFill, { backgroundColor: colors.brandSoft, opacity }]} />
    {children}
  </View>;
}
