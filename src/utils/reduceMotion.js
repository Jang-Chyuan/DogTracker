// 「減少動態效果」(DESIGN.md §8, 設計稿「無障礙」「動效」): with the system's
// reduce motion on — on Android that is 「移除動畫」, the animator duration
// scale at 0 — only fades remain: sheets, cards and the alert card fade in
// place instead of sliding, buttons do not shrink, and the map and the history
// cursor jump instead of moving. One store for the whole app, read at start
// and kept up to date (AccessibilityInfo 'reduceMotionChanged').
import { useSyncExternalStore } from 'react';
import {
  AccessibilityInfo,
  Animated,
  AppState,
  NativeModules,
} from 'react-native';
import { motion } from '../theme/tokens';

// The animator duration scale at 0 (developer options' 「動畫時間尺度：關閉」,
// part of 移除動畫) counts too: React Native's own animations do not follow it.
const animatorOff = () => {
  try {
    return NativeModules.AppSplash?.launchInfo?.()?.animatorScale === 0;
  } catch {
    return false;
  }
};
let systemReduced = false;
let reduced = animatorOff();
const listeners = new Set();
const notify = () => listeners.forEach(listener => listener());

/** Sets the preference (also for tests and the launch's own reading). */
export function setReduceMotion(value) {
  systemReduced = !!value;
  const next = systemReduced || animatorOff();
  if (next === reduced) return;
  reduced = next;
  notify();
}

try {
  AccessibilityInfo.isReduceMotionEnabled?.()
    .then(setReduceMotion)
    .catch(() => {});
  AccessibilityInfo.addEventListener?.('reduceMotionChanged', setReduceMotion);
  // The animator scale has no event: read again on every return to the app.
  AppState.addEventListener?.('change', next => {
    if (next === 'active') setReduceMotion(systemReduced);
  });
} catch {
  // No accessibility module (tests): motion stays on.
}

export const isReduceMotion = () => reduced;

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True while the system asks for less motion; re-renders when it changes. */
export function useReduceMotion() {
  return useSyncExternalStore(subscribe, isReduceMotion);
}

/** A movement's duration: none at all under reduce motion (the map jumps). */
export const moveDuration = ms => (reduced ? 0 : ms);

/** The fade that replaces a slide under reduce motion (DESIGN.md §8). */
export const REDUCED_FADE_MS = motion.reducedFade.duration;

/**
 * A sheet, card or alert card sliding in (`show`) or out: `value` (its
 * translate or progress) goes to `toValue`. Under 減少動態效果 it is put there
 * at once and `fade` (the view's opacity, 1 otherwise) fades instead: in after
 * the jump, out before it. Returns { start(callback), stop() } like Animated.
 */
export function slideOrFade(value, toValue, { fade, show, duration, easing }) {
  if (!reduced || !fade) {
    fade?.setValue(1);
    return Animated.timing(value, {
      toValue,
      duration,
      easing,
      useNativeDriver: true,
    });
  }
  const run = Animated.timing(fade, {
    toValue: show ? 1 : 0,
    duration: REDUCED_FADE_MS,
    useNativeDriver: true,
  });
  return {
    start(callback) {
      if (show) {
        fade.setValue(0);
        value.setValue(toValue);
      }
      run.start(result => {
        if (!show) value.setValue(toValue);
        callback?.(result);
      });
    },
    stop: () => run.stop(),
  };
}
