/* eslint-env jest */
jest.mock('react-native-keychain');
jest.mock('./specs/NativeTrackingPlatform', () => ({
  __esModule: true,
  default: {
    isMapConfigured: jest.fn(() => true),
    locationServicesEnabled: jest.fn(async () => true),
    claimLocationPermissionPrompt: jest.fn(async () => false),
    batteryOptimizationIgnored: jest.fn(async () => true),
    appVersion: jest.fn(() => '3.0.0'),
    packageName: jest.fn(() => 'com.antgo.dogtracker'),
    performHaptic: jest.fn(),
  },
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

// The alerts' native side (058b) as an in-memory store: the saved state and
// its revision, the hand-over and the delivered effects.
jest.mock('./specs/NativeAlertNotifications', () => {
  const store = { revision: 0, state: null };
  return {
    __esModule: true,
    default: {
      store,
      loadState: jest.fn(async () => JSON.stringify(store)),
      saveState: jest.fn(async (state, basedOn) => {
        if (basedOn !== store.revision) return false;
        store.state = JSON.parse(state);
        return true;
      }),
      handOver: jest.fn(async () => {}),
      deliver: jest.fn(async () => true),
      permissionState: jest.fn(async () => JSON.stringify({ required: true, granted: true, alertsEnabled: true })),
    },
  };
});
