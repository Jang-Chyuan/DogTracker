import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Linking, PermissionsAndroid, Platform } from 'react-native';
import {
  readLocationPermission,
  requestLocationPermission,
} from '../src/gps/LocationService';
import { usePhoneLocation } from '../src/gps/usePhoneLocation';

const { ACCESS_FINE_LOCATION: fine, ACCESS_COARSE_LOCATION: coarse } =
  PermissionsAndroid.PERMISSIONS;
let renderer, state, platform;
const originalOS = Platform.OS;
function Harness({ foreground = true, promptOnFirstUse = false }) {
  state = usePhoneLocation(foreground, platform, promptOnFirstUse);
  return null;
}
beforeEach(() => {
  Platform.OS = 'android';
  platform = {
    locationServicesEnabled: jest.fn(async () => true),
    claimLocationPermissionPrompt: jest.fn(async () => false),
  };
  jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(false);
  jest
    .spyOn(PermissionsAndroid, 'requestMultiple')
    .mockResolvedValue({ [fine]: 'denied', [coarse]: 'denied' });
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  renderer = null;
  jest.restoreAllMocks();
  Platform.OS = originalOS;
});
async function mount() {
  await act(async () => {
    renderer = Renderer.create(<Harness />);
  });
}
test('checks existing precise or approximate grants without requesting anything', async () => {
  PermissionsAndroid.check.mockImplementation(async key => key === coarse);
  expect(await readLocationPermission()).toBe('approximate');
  PermissionsAndroid.check.mockResolvedValue(true);
  expect(await readLocationPermission()).toBe('precise');
  expect(PermissionsAndroid.requestMultiple).not.toHaveBeenCalled();
});
test.each([
  [{ [fine]: 'granted', [coarse]: 'granted' }, 'precise'],
  [{ [fine]: 'denied', [coarse]: 'granted' }, 'approximate'],
  [{ [fine]: 'denied', [coarse]: 'denied' }, 'denied'],
  [{ [fine]: 'never_ask_again', [coarse]: 'never_ask_again' }, 'blocked'],
])(
  'requests fine and coarse together and respects result %s',
  async (result, expected) => {
    PermissionsAndroid.requestMultiple.mockResolvedValue(result);
    expect(await requestLocationPermission()).toBe(expected);
    expect(PermissionsAndroid.requestMultiple).toHaveBeenCalledWith([
      fine,
      coarse,
    ]);
  },
);
test('does not auto-request; denied remains usable and an explicit coarse grant enables layer', async () => {
  await mount();
  expect(state.permission).toBe('denied');
  expect(state.enabled).toBe(false);
  expect(PermissionsAndroid.requestMultiple).not.toHaveBeenCalled();
  PermissionsAndroid.requestMultiple.mockResolvedValue({
    [fine]: 'denied',
    [coarse]: 'granted',
  });
  await act(async () => state.requestPermission());
  expect(state.permission).toBe('approximate');
  expect(state.enabled).toBe(true);
});

test('first map use prompts once and enables the layer after an approximate grant', async () => {
  platform.claimLocationPermissionPrompt.mockResolvedValueOnce(true);
  PermissionsAndroid.requestMultiple.mockResolvedValue({
    [fine]: 'denied',
    [coarse]: 'granted',
  });
  await act(async () => {
    renderer = Renderer.create(<Harness promptOnFirstUse />);
  });
  expect(PermissionsAndroid.requestMultiple).toHaveBeenCalledTimes(1);
  expect(state.permission).toBe('approximate');
  expect(state.enabled).toBe(true);
});

test('denial is not reprompted by tab changes, foreground or a cold remount', async () => {
  platform.claimLocationPermissionPrompt.mockResolvedValueOnce(true);
  await act(async () => {
    renderer = Renderer.create(<Harness promptOnFirstUse />);
  });
  expect(state.permission).toBe('denied');
  expect(state.enabled).toBe(false);
  await act(async () => renderer.update(<Harness />));
  await act(async () => renderer.update(<Harness promptOnFirstUse />));
  await act(async () =>
    renderer.update(<Harness foreground={false} promptOnFirstUse />),
  );
  await act(async () => renderer.update(<Harness promptOnFirstUse />));
  await act(async () => renderer.unmount());
  await act(async () => {
    renderer = Renderer.create(<Harness promptOnFirstUse />);
  });
  expect(PermissionsAndroid.requestMultiple).toHaveBeenCalledTimes(1);
  PermissionsAndroid.requestMultiple.mockResolvedValue({
    [fine]: 'granted',
    [coarse]: 'granted',
  });
  await act(async () => state.requestPermission());
  expect(PermissionsAndroid.requestMultiple).toHaveBeenCalledTimes(2);
  expect(state.enabled).toBe(true);
});

test('a grant before first use does not trigger another permission dialog', async () => {
  PermissionsAndroid.check.mockResolvedValue(true);
  await act(async () => {
    renderer = Renderer.create(<Harness promptOnFirstUse />);
  });
  expect(state.enabled).toBe(true);
  expect(platform.claimLocationPermissionPrompt).not.toHaveBeenCalled();
  expect(PermissionsAndroid.requestMultiple).not.toHaveBeenCalled();
});

test('a foreground refresh waits for the open system dialog result', async () => {
  let finish;
  platform.claimLocationPermissionPrompt.mockResolvedValueOnce(true);
  PermissionsAndroid.requestMultiple.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  await act(async () => {
    renderer = Renderer.create(<Harness promptOnFirstUse />);
  });
  await act(async () =>
    renderer.update(<Harness foreground={false} promptOnFirstUse />),
  );
  await act(async () => renderer.update(<Harness promptOnFirstUse />));
  expect(state.busy).toBe(true);
  expect(PermissionsAndroid.requestMultiple).toHaveBeenCalledTimes(1);
  await act(async () => finish({ [fine]: 'granted', [coarse]: 'granted' }));
  expect(state.permission).toBe('precise');
  expect(state.enabled).toBe(true);
});

test('failed prompt persistence is visible and retryable without silently granting access', async () => {
  platform.claimLocationPermissionPrompt
    .mockRejectedValueOnce(new Error('preference storage failed'))
    .mockResolvedValueOnce(true);
  await act(async () => {
    renderer = Renderer.create(<Harness promptOnFirstUse />);
  });
  expect(state.error).toBe('preference storage failed');
  expect(state.enabled).toBe(false);
  expect(PermissionsAndroid.requestMultiple).not.toHaveBeenCalled();
  await act(async () => state.retry());
  expect(state.error).toBeNull();
  expect(PermissionsAndroid.requestMultiple).toHaveBeenCalledTimes(1);
});
test('system location disabled, service read failure and retry are visible', async () => {
  PermissionsAndroid.check.mockResolvedValue(true);
  platform.locationServicesEnabled.mockResolvedValue(false);
  await mount();
  expect(state.services).toBe(false);
  expect(state.enabled).toBe(false);
  platform.locationServicesEnabled.mockRejectedValueOnce(
    new Error('unavailable'),
  );
  await act(async () => state.retry());
  expect(state.error).toBe('unavailable');
  expect(state.enabled).toBe(false);
  platform.locationServicesEnabled.mockResolvedValue(true);
  await act(async () => state.retry());
  expect(state.error).toBeNull();
  expect(state.enabled).toBe(true);
});
test('foreground rechecks revoked permission; background disables layer immediately', async () => {
  PermissionsAndroid.check.mockResolvedValue(true);
  await mount();
  expect(state.enabled).toBe(true);
  await act(async () => renderer.update(<Harness foreground={false} />));
  expect(state.enabled).toBe(false);
  PermissionsAndroid.check.mockResolvedValue(false);
  await act(async () => renderer.update(<Harness />));
  expect(state.permission).toBe('denied');
  expect(state.enabled).toBe(false);
});
test('old async result cannot overwrite a newer foreground lifetime', async () => {
  let finish;
  platform.locationServicesEnabled.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  await mount();
  await act(async () => renderer.update(<Harness foreground={false} />));
  PermissionsAndroid.check.mockResolvedValue(true);
  await act(async () => renderer.update(<Harness />));
  await act(async () => finish(false));
  expect(state.permission).toBe('precise');
  expect(state.services).toBe(true);
});
test('settings failures are surfaced instead of unhandled rejections', async () => {
  jest
    .spyOn(Linking, 'openSettings')
    .mockRejectedValue(new Error('settings unavailable'));
  await mount();
  await act(async () => state.openSettings());
  expect(state.error).toBe('settings unavailable');
});
test('unsupported platform never requests Android permissions', async () => {
  Platform.OS = 'ios';
  await mount();
  expect(state.permission).toBe('unsupported');
  expect(state.enabled).toBe(false);
  expect(PermissionsAndroid.check).not.toHaveBeenCalled();
});
