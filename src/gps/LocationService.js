import { PermissionsAndroid, Platform } from 'react-native';

export async function requestLocationPermission() {
  if (Platform.OS !== 'android') return true;
  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  );
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

export async function getCurrentLocation() {
  throw new Error('手機 GPS 尚未接入；請由 GPS Task 實作定位提供者。');
}
