// Touch haptics (DESIGN.md「操作與震動」): Android's own predefined effects,
// played through the window's haptic feedback, so they follow the system's
// touch-feedback setting. Off while TalkBack is on (tokens.haptics).
import { AccessibilityInfo } from 'react-native';
import NativeTrackingPlatform from '../../specs/NativeTrackingPlatform';
import { haptics as effects } from '../theme/tokens';

// tick: EFFECT_TICK (每 10 分、放手); click: EFFECT_CLICK (整點);
// double: EFFECT_DOUBLE_CLICK (停留、彈回); heavy: EFFECT_HEAVY_CLICK (拖到頭).
export const HAPTIC_EFFECTS = Object.freeze({
  tick: effects.cursorTenMinutes,
  click: effects.cursorHour,
  double: effects.stop,
  heavy: effects.edge,
});

let screenReader = false;
// An alert's vibration pattern is playing until then: no touch haptic over it
// (design 「提醒出現時，操作震動先停」).
let quietUntil = 0;

/** Keeps touch haptics quiet for `ms` (an alert is vibrating). */
export function holdTouchHaptics(ms, now = Date.now()) {
  quietUntil = Math.max(quietUntil, now + Math.max(0, ms));
}
try {
  AccessibilityInfo.isScreenReaderEnabled?.().then(value => { screenReader = !!value; }).catch(() => {});
  AccessibilityInfo.addEventListener?.('screenReaderChanged', value => { screenReader = !!value; });
} catch {
  // No accessibility service (tests): haptics stay on.
}

/** Plays one of HAPTIC_EFFECTS' kinds; anything else (or none) does nothing. */
export function haptic(kind) {
  const effect = HAPTIC_EFFECTS[kind];
  if (!effect || screenReader || Date.now() < quietUntil) return false;
  try {
    NativeTrackingPlatform?.performHaptic?.(effect);
    return true;
  } catch {
    return false;
  }
}
