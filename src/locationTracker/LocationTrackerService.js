import { t } from '../i18n';
import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import { requestLocationPermission } from '../gps/LocationService';

export const locationTrackerNative = NativeModules.LocationTracker;

export async function startLocationTracker() {
  if (Platform.OS !== 'android' || !locationTrackerNative)
    throw new Error(t("c716"));
  const permission = await requestLocationPermission();
  if (!['precise', 'approximate'].includes(permission))
    throw new Error(t("c717"));
  if (Platform.Version >= 33)
    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  await locationTrackerNative.start();
}

export async function stopLocationTracker() {
  await locationTrackerNative?.stop();
}
