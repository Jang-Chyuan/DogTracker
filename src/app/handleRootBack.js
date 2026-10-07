import { Alert, BackHandler, NativeModules } from 'react-native';

// 返回鍵 on the live map with no card open (design v3 返回鍵表「地圖（沒有卡片）」):
// while any background work runs — receiving from the receiver, recording the
// phone's position, this phone uploading for a receiver — the app only moves
// to the background, so nothing stops. With none running it asks
// 「要關閉 DogTracker 嗎？」.

async function receiving() {
  const state = await NativeModules.BleBackground?.getState?.();
  return !!(state?.enabled && state?.running);
}

async function recording() {
  const live = await NativeModules.LocationTracker?.live?.();
  if (!live) return false;
  return !!JSON.parse(live)?.running;
}

/** Which background work is running now (a failed read counts as running). */
export async function backgroundWork({ uploading = false } = {}) {
  const read = async check => {
    try { return await check(); } catch { return null; }
  };
  const [ble, location] = await Promise.all([read(receiving), read(recording)]);
  return { receiving: ble, recording: location, uploading: !!uploading };
}

export async function handleRootBack({ uploading = false } = {}) {
  const work = await backgroundWork({ uploading });
  // A state that could not be read is treated as running: going to the
  // background never stops anything, closing might.
  const running = work.receiving !== false || work.recording !== false || work.uploading;
  const moveToBackground = NativeModules.BleBackground?.moveToBackground;
  if (running && moveToBackground) {
    moveToBackground();
    return;
  }
  Alert.alert('要關閉 DogTracker 嗎？', undefined, [
    { text: '取消', style: 'cancel' },
    { text: '關閉', style: 'destructive', onPress: () => BackHandler.exitApp() },
  ]);
}
