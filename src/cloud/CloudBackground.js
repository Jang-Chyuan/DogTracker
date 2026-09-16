import { DeviceEventEmitter, NativeModules, PermissionsAndroid, Platform } from 'react-native';

export const cloudBackground = Platform.OS === 'android' ? NativeModules.CloudBackground : null;

export async function requestCloudNotificationPermission() {
  if (Platform.OS === 'android' && Platform.Version >= 33) {
    const permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
    if (!(await PermissionsAndroid.check(permission))) await PermissionsAndroid.request(permission);
  }
}

// A Headless JS task keeps RN timers running while the Activity is paused.
// The App-level sync engine remains the only download owner, with the same
// session, database, progress, and manual-download exclusion lock.
export function cloudKeepAlive({ runId }, native = cloudBackground, events = DeviceEventEmitter) {
  return new Promise(resolve => {
    const finish = () => { subscription.remove(); resolve(); };
    const subscription = events.addListener('CloudBackgroundStopped', event => {
      if (event.runId === runId) finish();
    });
    // A stop can arrive before JS has registered the listener.
    Promise.resolve(native?.getRunId()).then(current => {
      if (current !== runId) finish();
    }).catch(finish);
  });
}
