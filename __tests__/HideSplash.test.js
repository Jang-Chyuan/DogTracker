import { NativeModules } from 'react-native';
import { hideSplash } from '../src/app/hideSplash';

test('the launch screen is released through the native module when it exists', () => {
  NativeModules.AppSplash = { hide: jest.fn() };
  hideSplash();
  expect(NativeModules.AppSplash.hide).toHaveBeenCalledTimes(1);
  delete NativeModules.AppSplash;
  expect(() => hideSplash()).not.toThrow();
});
