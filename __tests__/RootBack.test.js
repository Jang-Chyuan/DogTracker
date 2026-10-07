import { Alert, BackHandler, NativeModules } from 'react-native';
import { backgroundWork, CLOSE_IMPACT, handleRootBack } from '../src/app/handleRootBack';

const moveToBackground = jest.fn();
function native({ ble = { enabled: false, running: false }, location = { running: false } } = {}) {
  NativeModules.BleBackground = {
    getState: typeof ble === 'function' ? ble : async () => ble,
    moveToBackground,
  };
  NativeModules.LocationTracker = {
    live: typeof location === 'function' ? location : async () => JSON.stringify(location),
  };
}

afterEach(() => {
  delete NativeModules.BleBackground;
  delete NativeModules.LocationTracker;
  moveToBackground.mockClear();
  jest.restoreAllMocks();
});

test('receiving from the receiver: back only moves the app to the background', async () => {
  native({ ble: { enabled: true, running: true, connected: false } });
  const alert = jest.spyOn(Alert, 'alert');
  await handleRootBack();
  expect(moveToBackground).toHaveBeenCalledTimes(1);
  expect(alert).not.toHaveBeenCalled();
});

test('recording the phone\'s position also keeps the app running', async () => {
  native({ location: { running: true } });
  const alert = jest.spyOn(Alert, 'alert');
  await handleRootBack();
  expect(moveToBackground).toHaveBeenCalledTimes(1);
  expect(alert).not.toHaveBeenCalled();
});

test('this phone uploading for a receiver also keeps the app running', async () => {
  native();
  const alert = jest.spyOn(Alert, 'alert');
  await handleRootBack({ uploading: true });
  expect(moveToBackground).toHaveBeenCalledTimes(1);
  expect(alert).not.toHaveBeenCalled();
});

test('with no background work it asks 「要關閉 DogTracker 嗎？」 and closes only on 關閉', async () => {
  native();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const exit = jest.spyOn(BackHandler, 'exitApp').mockImplementation(() => {});
  await handleRootBack();
  expect(moveToBackground).not.toHaveBeenCalled();
  expect(alert.mock.calls[0][0]).toBe('要關閉 DogTracker 嗎？');
  expect(alert.mock.calls[0][1]).toBe(CLOSE_IMPACT);
  const buttons = alert.mock.calls[0][2];
  expect(buttons.map(button => button.text)).toEqual(['取消', '關閉']);
  expect(exit).not.toHaveBeenCalled();
  buttons.find(button => button.text === '關閉').onPress();
  expect(exit).toHaveBeenCalledTimes(1);
});

test('a state that cannot be read counts as running: never closes what may be receiving', async () => {
  native({ ble: async () => { throw Error('unavailable'); } });
  const alert = jest.spyOn(Alert, 'alert');
  const exit = jest.spyOn(BackHandler, 'exitApp');
  await handleRootBack();
  expect(moveToBackground).toHaveBeenCalledTimes(1);
  expect(alert).not.toHaveBeenCalled();
  expect(exit).not.toHaveBeenCalled();
  expect(await backgroundWork()).toEqual({ receiving: null, recording: false, uploading: false });
});

test('without the native modules (nothing can run) it asks before closing', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await handleRootBack();
  expect(alert.mock.calls[0][0]).toBe('要關閉 DogTracker 嗎？');
});
