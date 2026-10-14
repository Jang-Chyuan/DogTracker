import { Linking } from 'react-native';

// The link that opened the app (Linking.getInitialURL): a notification's
// destination, or a debug screen-state link. It belongs to this start only:
// each reader (`consumer`) gets it once per JavaScript start, and null after
// that, so a remount of the app (刪除全部狗資料 starts TrackerApp over) does
// not open that notification's page, or a debug first-launch state, again.
// Android itself no longer hands it back when it makes the app again after
// closing it in the background (LaunchLink.kt).
let initial = null;
const taken = new Set();

/** Resolves the launch link for `consumer` the first time, null afterwards. */
export function takeLaunchLink(consumer) {
  if (taken.has(consumer)) return Promise.resolve(null);
  taken.add(consumer);
  initial ??= Promise.resolve().then(() => Linking.getInitialURL());
  return initial;
}

/** Tests only: a new JavaScript start. */
export function resetLaunchLink() {
  initial = null;
  taken.clear();
}
