import { Linking } from 'react-native';
import { logger } from '../logger';

/**
 * Opens a system settings page: `action` (an Android intent action such as
 * android.settings.LOCATION_SOURCE_SETTINGS) when given, else — or when that
 * fails — the app's own settings page. Never rejects: when even that cannot
 * open, the press simply does nothing (and it is logged), instead of leaving
 * an unhandled rejection behind.
 */
export async function openSystemSettings(action = null, linking = Linking) {
  try {
    if (action) {
      try {
        await linking.sendIntent(action);
        return true;
      } catch { /* the app's settings page instead */ }
    }
    await linking.openSettings();
    return true;
  } catch (error) {
    logger.warn('[Settings] could not open system settings', error?.message || error);
    return false;
  }
}
