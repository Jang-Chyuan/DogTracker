import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import { requestLocationPermission } from '../gps/LocationService';

export const locationTrackerNative = NativeModules.LocationTracker;

export async function startLocationTracker() {
  if (Platform.OS !== 'android' || !locationTrackerNative)
    throw new Error('此版本僅支援 Android 手機位置記錄');
  const permission = await requestLocationPermission();
  if (!['precise', 'approximate'].includes(permission))
    throw new Error('請允許定位權限後再開始記錄');
  if (Platform.Version >= 33)
    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  await locationTrackerNative.start();
}

export async function stopLocationTracker() {
  await locationTrackerNative?.stop();
}
