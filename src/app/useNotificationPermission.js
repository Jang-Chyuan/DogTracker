import { useEffect, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';

/**
 * Whether Android 13+ withholds the notification permission (the gear's red
 * dot, design 「每一種提醒」「通知權限沒給」). Read again each time the app
 * comes to the front, since it is changed in the system settings. false
 * until known, and on older Android, where there is no such permission.
 */
export function useNotificationPermission(foreground) {
  const [denied, setDenied] = useState(false);
  useEffect(() => {
    const permission = PermissionsAndroid.PERMISSIONS?.POST_NOTIFICATIONS;
    if (!foreground || Platform.OS !== 'android' || Platform.Version < 33 || !permission) return undefined;
    let alive = true;
    // Without the native module (tests) nothing is known: no dot.
    Promise.resolve().then(() => PermissionsAndroid.check(permission))
      .then(granted => { if (alive) setDenied(!granted); })
      .catch(() => {});
    return () => { alive = false; };
  }, [foreground]);
  return denied;
}
