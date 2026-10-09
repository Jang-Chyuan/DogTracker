import { NativeModules } from 'react-native';
import { hideSplash, launchInto, reportMapFramed, resetSplashGate } from '../src/app/hideSplash';

afterEach(() => { delete NativeModules.AppSplash; resetSplashGate(); });

test('the launch screen is released through the native module when it exists', () => {
  NativeModules.AppSplash = { hide: jest.fn() };
  hideSplash();
  expect(NativeModules.AppSplash.hide).toHaveBeenCalledTimes(1);
  delete NativeModules.AppSplash;
  expect(() => hideSplash()).not.toThrow();
});

test('D0 holds until the start is decided: the map after its framing, a page of its own at once', () => {
  NativeModules.AppSplash = { hide: jest.fn() };
  // The map frames before the start is decided (first launch → D1): held.
  reportMapFramed();
  expect(NativeModules.AppSplash.hide).not.toHaveBeenCalled();
  launchInto('map');
  expect(NativeModules.AppSplash.hide).toHaveBeenCalledTimes(1);

  resetSplashGate();
  NativeModules.AppSplash.hide.mockClear();
  // Decided on the map first: waits for its framing.
  launchInto('map');
  expect(NativeModules.AppSplash.hide).not.toHaveBeenCalled();
  reportMapFramed();
  expect(NativeModules.AppSplash.hide).toHaveBeenCalledTimes(1);

  resetSplashGate();
  NativeModules.AppSplash.hide.mockClear();
  // D1 or the failure screen: released once it is laid out, map or not.
  launchInto('page');
  expect(NativeModules.AppSplash.hide).toHaveBeenCalledTimes(1);
});
