import { Alert, BackHandler, NativeModules } from 'react-native';
import { handleRootBack } from '../src/app/handleRootBack';

afterEach(() => {
  delete NativeModules.BleBackground;
  delete NativeModules.LocationTracker;
  jest.restoreAllMocks();
});

test.each(['idle', 'receiving', 'recording', 'uploading', 'unreadable'])('%s: back backgrounds immediately, never asks or exits', async state => {
  const moveToBackground = jest.fn();
  const getState = jest.fn(() => { throw Error('unreadable'); });
  const live = jest.fn(() => { throw Error('unreadable'); });
  NativeModules.BleBackground = { moveToBackground, getState };
  NativeModules.LocationTracker = { live };
  const alert = jest.spyOn(Alert, 'alert');
  const exit = jest.spyOn(BackHandler, 'exitApp');
  await handleRootBack({ uploading: state === 'uploading' });
  expect(moveToBackground).toHaveBeenCalledTimes(1);
  expect(getState).not.toHaveBeenCalled();
  expect(live).not.toHaveBeenCalled();
  expect(alert).not.toHaveBeenCalled();
  expect(exit).not.toHaveBeenCalled();
});

test('missing native bridge never opens a close dialog or exits', async () => {
  const alert = jest.spyOn(Alert, 'alert');
  const exit = jest.spyOn(BackHandler, 'exitApp');
  await handleRootBack();
  expect(alert).not.toHaveBeenCalled();
  expect(exit).not.toHaveBeenCalled();
});
