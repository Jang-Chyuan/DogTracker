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
    performHaptic: jest.fn(),
  },
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
