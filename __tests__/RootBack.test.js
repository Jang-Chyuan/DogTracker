import { Alert, BackHandler, NativeModules } from 'react-native';
import { handleRootBack } from '../src/app/handleRootBack';

afterEach(() => {
  delete NativeModules.BleBackground;
  jest.restoreAllMocks();
});

test('an enabled running service keeps receiving after leaving the map', async () => {
  const moveToBackground = jest.fn();
  NativeModules.BleBackground = {
    getState: async () => ({ enabled: true, running: true, connected: false }),
    moveToBackground,
  };
  const alert = jest.spyOn(Alert, 'alert');
  await handleRootBack();
  expect(moveToBackground).toHaveBeenCalledTimes(1);
  expect(alert).not.toHaveBeenCalled();
});

test('without a background session exit requires explicit confirmation', async () => {
  const alert = jest.spyOn(Alert, 'alert');
  const exit = jest.spyOn(BackHandler, 'exitApp');
  await handleRootBack();
  expect(exit).not.toHaveBeenCalled();
  alert.mock.calls[0][2].find(button => button.text === '退出').onPress();
  expect(exit).toHaveBeenCalledTimes(1);
});

test('a native state error does not exit or silently stop reception', async () => {
  NativeModules.BleBackground = { getState: async () => { throw Error('unavailable'); } };
  const alert = jest.spyOn(Alert, 'alert');
  const exit = jest.spyOn(BackHandler, 'exitApp');
  await handleRootBack();
  expect(alert.mock.calls[0][0]).toBe('無法確認背景連線');
  expect(exit).not.toHaveBeenCalled();
});
