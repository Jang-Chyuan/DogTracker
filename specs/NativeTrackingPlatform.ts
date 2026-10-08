import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  isMapConfigured(): boolean;
  locationServicesEnabled(): Promise<boolean>;
  claimLocationPermissionPrompt(): Promise<boolean>;
  // Settings → 手機 (S4): whether Android already exempts this app from
  // battery optimization (a recommendation, never a problem).
  batteryOptimizationIgnored(): Promise<boolean>;
  // The installed version name (S1's last line, 「DogTracker 3.0.0」).
  appVersion(): string;
  // A touch haptic (src/utils/haptics.js): 'EFFECT_TICK', 'EFFECT_CLICK',
  // 'EFFECT_DOUBLE_CLICK' or 'EFFECT_HEAVY_CLICK', played through the window's
  // haptic feedback (follows the system's touch-feedback setting).
  performHaptic(effect: string): void;
}

// Android adapter. Other platforms show an explicit unavailable state rather
// than substituting a different map provider.
export default TurboModuleRegistry.get<Spec>('TrackingPlatform');
