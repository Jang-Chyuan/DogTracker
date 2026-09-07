/* eslint-env jest */
jest.mock('./specs/NativeTrackingPlatform', () => ({
  __esModule: true,
  default: {
    isMapConfigured: jest.fn(() => true),
    locationServicesEnabled: jest.fn(async () => true),
    claimLocationPermissionPrompt: jest.fn(async () => false),
  },
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
