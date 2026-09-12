import { Platform } from 'react-native';
import NativeTrackingPlatform from '../../specs/NativeTrackingPlatform';
import GoogleTrackingMap from './GoogleTrackingMap';
import { createMapProviderDefinition } from './TrackingMap';

// The composition root imports this definition explicitly. No shared screen or
// presentation module imports react-native-maps or the native platform bridge.
export const GOOGLE_MAP_PROVIDER = createMapProviderDefinition({
  id: 'google',
  Renderer: GoogleTrackingMap,
  isSupported: () => Platform.OS === 'android' && !!NativeTrackingPlatform,
  isConfigured: () => NativeTrackingPlatform.isMapConfigured(),
});
