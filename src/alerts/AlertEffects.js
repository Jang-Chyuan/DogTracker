// Carries out AlertScheduler's attention effects on this phone while the app
// is running: the alert vibration (strong long-short-long for 不在接收範圍 and
// 接收器斷線, one short buzz otherwise), the sound, touch haptics held back
// meanwhile, and the notification command. On Android all of it goes through
// the native side (AlertNotifications), which also respects the 「提醒」
// channel's vibration and the phone's silent mode; without it, React
// Native's Vibration stands in.
import { Vibration } from 'react-native';
import { holdTouchHaptics } from '../utils/haptics';
import { nativeAlerts, sendAlertEffects } from './AlertNotifications';

const length = pattern => pattern.reduce((sum, value) => sum + value, 0);

export function carryOutAlertEffects(effects, now = Date.now(), { vibrate = Vibration, native } = {}) {
  if (!effects) return;
  if (effects.vibration && effects.stopTouchHaptics) holdTouchHaptics(length(effects.vibration), now);
  if (effects.vibration && !nativeAlerts(native)) {
    try {
      vibrate.cancel?.();
      vibrate.vibrate(effects.vibration);
    } catch {
      // No vibrator (or not allowed): the alert still shows.
    }
  }
  sendAlertEffects(effects, now, native);
}
