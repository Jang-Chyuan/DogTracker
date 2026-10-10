import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

// The alerts' Android side (src/alerts/AlertNotifications.js): one alert
// state shared with the background check of the receiver's service, the
// merged notification on the 「提醒」 channel, the alert vibration and sound.
export interface Spec extends TurboModule {
  // { revision, state }: the saved alert state (AlertEngine format) or null.
  loadState(): Promise<string>;
  // Saves the app's state; false when it moved on since `basedOn` (reload).
  saveState(state: string, basedOn: number): Promise<boolean>;
  // This phone's dogs as the app sees them, and the 提醒 settings.
  handOver(snapshot: string): Promise<void>;
  // One step's effects: { command, content, vibration, critical, sound }.
  deliver(effects: string): Promise<boolean>;
  // { required, granted, alertsEnabled }.
  permissionState(): Promise<string>;
}

export default TurboModuleRegistry.get<Spec>('AlertNotifications');
