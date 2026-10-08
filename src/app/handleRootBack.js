import { NativeModules } from 'react-native';

// The live map's back key always backgrounds the activity, including when idle.
export async function handleRootBack() {
  NativeModules.BleBackground?.moveToBackground?.();
}
