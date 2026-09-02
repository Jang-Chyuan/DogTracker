export const DEFAULT_PROFILE_NAME = 'default';

export const DEVICE_PROFILES = Object.freeze({
  default: Object.freeze({
    name: 'default',
    backgroundBle: true,
    databaseSaveIntervalMs: 1000,
    historyLimit: 100,
    tableRefreshIntervalMs: 1000,
    tableColumns: Object.freeze([
      'received_at',
      'master_id',
      'slave_id',
      'distance_meters',
      'battery_percentage',
    ]),
  }),
});

export function getDeviceProfile(name = DEFAULT_PROFILE_NAME) {
  const normalizedName = typeof name === 'string' ? name.trim() : '';
  return DEVICE_PROFILES[normalizedName] || DEVICE_PROFILES[DEFAULT_PROFILE_NAME];
}
