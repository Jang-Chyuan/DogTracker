import { Alert, BackHandler, NativeModules } from 'react-native';

// Leaving the map must not stop an enabled upstream BLE background session.
export async function handleRootBack() {
  try {
    const state = await NativeModules.BleBackground?.getState?.();
    if (state?.enabled && state?.running) {
      NativeModules.BleBackground.moveToBackground();
      return;
    }
    Alert.alert('退出 DogTracker', '目前沒有 BLE 背景連線，確定要退出 App 嗎？', [
      { text: '取消', style: 'cancel' },
      { text: '退出', style: 'destructive', onPress: () => BackHandler.exitApp() },
    ]);
  } catch (error) {
    Alert.alert('無法確認背景連線', '請先到硬體設定確認連線狀態，或使用手機的 Home 鍵。');
  }
}
