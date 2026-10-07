import { NativeModules } from 'react-native';

/** Lets the launch screen go once the app has its first real screen. */
export function hideSplash() {
  NativeModules.AppSplash?.hide?.();
}
