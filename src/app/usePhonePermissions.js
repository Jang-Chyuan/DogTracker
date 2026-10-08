import { useEffect, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import NativeTrackingPlatform from '../../specs/NativeTrackingPlatform';

const NOTHING_KNOWN = Object.freeze({ notificationsDenied: false, nearbyDenied: false, batteryIgnored: null });

/**
 * This phone's permissions besides location (usePhoneLocation reads that):
 * - notificationsDenied: Android 13+ withholds notifications (gear red dot,
 *   S1 手機 and 提醒 rows, S4 權限);
 * - nearbyDenied: Android 12+ withholds 附近的裝置 (Bluetooth scan/connect),
 *   which the receiver needs (gear red dot, S1 手機, S4 權限);
 * - batteryIgnored: exempt from battery optimization (S4, a recommendation,
 *   never a problem); null until known.
 * Read again each time the app comes to the front, since all of them change
 * in the system settings. Nothing is reported as missing until it is known,
 * and older Android has no such permissions.
 */
export function usePhonePermissions(foreground, platform = NativeTrackingPlatform) {
  const [state, setState] = useState(NOTHING_KNOWN);
  useEffect(() => {
    if (!foreground || Platform.OS !== 'android') return undefined;
    let alive = true;
    const { POST_NOTIFICATIONS, BLUETOOTH_SCAN, BLUETOOTH_CONNECT } = PermissionsAndroid.PERMISSIONS || {};
    const granted = (permission, minimum) => (Platform.Version < minimum || !permission ? Promise.resolve(true)
      : Promise.resolve().then(() => PermissionsAndroid.check(permission)));
    // Without the native modules (tests) nothing is known: nothing missing.
    Promise.all([
      granted(POST_NOTIFICATIONS, 33).catch(() => true),
      granted(BLUETOOTH_SCAN, 31).catch(() => true),
      granted(BLUETOOTH_CONNECT, 31).catch(() => true),
      Promise.resolve().then(() => platform?.batteryOptimizationIgnored?.() ?? null).catch(() => null),
    ]).then(([notifications, scan, connect, battery]) => {
      if (!alive) return;
      const next = { notificationsDenied: !notifications, nearbyDenied: !scan || !connect,
        batteryIgnored: typeof battery === 'boolean' ? battery : null };
      setState(current => (current.notificationsDenied === next.notificationsDenied
        && current.nearbyDenied === next.nearbyDenied && current.batteryIgnored === next.batteryIgnored
        ? current : next));
    });
    return () => { alive = false; };
  }, [foreground, platform]);
  return state;
}
