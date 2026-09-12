import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  isMapConfigured(): boolean;
  locationServicesEnabled(): Promise<boolean>;
  claimLocationPermissionPrompt(): Promise<boolean>;
}

// Android adapter. Other platforms show an explicit unavailable state rather
// than substituting a different map provider.
export default TurboModuleRegistry.get<Spec>('TrackingPlatform');
