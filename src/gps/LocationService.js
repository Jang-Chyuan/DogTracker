import { PermissionsAndroid, Platform } from 'react-native';

export async function readLocationPermission() {
  if (Platform.OS !== 'android') return 'unsupported';
  const { ACCESS_FINE_LOCATION, ACCESS_COARSE_LOCATION } =
    PermissionsAndroid.PERMISSIONS;
  if (await PermissionsAndroid.check(ACCESS_FINE_LOCATION)) return 'precise';
  if (await PermissionsAndroid.check(ACCESS_COARSE_LOCATION))
    return 'approximate';
  return 'denied';
}

export async function requestLocationPermission() {
  if (Platform.OS !== 'android') return 'unsupported';
  // Android 12+ supports coarse-only access. Request both in one dialog and
  // accept the user's approximate choice; no background permission is requested.
  const { ACCESS_FINE_LOCATION, ACCESS_COARSE_LOCATION } =
    PermissionsAndroid.PERMISSIONS;
  const result = await PermissionsAndroid.requestMultiple([
    ACCESS_FINE_LOCATION,
    ACCESS_COARSE_LOCATION,
  ]);
  if (result[ACCESS_FINE_LOCATION] === PermissionsAndroid.RESULTS.GRANTED)
    return 'precise';
  if (result[ACCESS_COARSE_LOCATION] === PermissionsAndroid.RESULTS.GRANTED)
    return 'approximate';
  return Object.values(result).includes(
    PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN,
  )
    ? 'blocked'
    : 'denied';
}
