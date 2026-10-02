/* eslint-env jest */
jest.mock('react-native-keychain');
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

// The home sheet uses Reanimated and Gesture Handler; jest runs their mocks
// (Reanimated and Worklets: __mocks__/, mapped in jest.config.js).
require('react-native-gesture-handler/jestSetup');
// Screens are rendered without the app's GestureHandlerRootView in tests;
// the detector only wraps its child there, gestures are driven by props.
jest.mock('react-native-gesture-handler', () => ({
  ...jest.requireActual('react-native-gesture-handler'),
  GestureDetector: ({ children }) => children,
}));
