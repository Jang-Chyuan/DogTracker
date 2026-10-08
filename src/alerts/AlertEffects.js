// Carries out AlertScheduler's attention effects on this phone while the app
// is running: the alert vibration (strong long-short-long for 不在接收範圍 and
// 接收器斷線, one short buzz otherwise), touch haptics held back meanwhile, and
// the notification command. The sound needs the notification channel (058b).
import { Vibration } from 'react-native';
import { holdTouchHaptics } from '../utils/haptics';
import { sendAlertNotification } from './AlertNotifications';

const length = pattern => pattern.reduce((sum, value) => sum + value, 0);

export function carryOutAlertEffects(effects, now = Date.now(), { vibrate = Vibration } = {}) {
  if (!effects) return;
  if (effects.vibration) {
    if (effects.stopTouchHaptics) holdTouchHaptics(length(effects.vibration), now);
    try {
      vibrate.cancel?.();
      vibrate.vibrate(effects.vibration);
    } catch {
      // No vibrator (or not allowed): the alert still shows.
    }
  }
  sendAlertNotification(effects.notification, effects.content, now);
}
