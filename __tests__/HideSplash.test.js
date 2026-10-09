import { NativeModules } from 'react-native';
import {
  finishSplash,
  getSplashState,
  hideSplash,
  launchInto,
  reportMapFramed,
  resetSplashGate,
} from '../src/app/hideSplash';

afterEach(() => {
  delete NativeModules.AppSplash;
  resetSplashGate();
});

const dog = (slaveId, x, y) => ({ slaveId, x, y, marker: { size: 40 } });

test('the system launch screen is released through the native module when it exists', () => {
  NativeModules.AppSplash = { hide: jest.fn() };
  hideSplash();
  expect(NativeModules.AppSplash.hide).toHaveBeenCalledTimes(1);
  delete NativeModules.AppSplash;
  expect(() => hideSplash()).not.toThrow();
});

test('D0 holds until the start is decided: the map after its framing, a page of its own at once', () => {
  // The map frames before the start is decided (first launch → D1): held.
  reportMapFramed([dog(4, 100, 300)]);
  expect(getSplashState().phase).toBe('waiting');
  launchInto('map');
  expect(getSplashState()).toMatchObject({ phase: 'handover', mode: 'fly' });

  resetSplashGate();
  // Decided on the map first: waits for its framing.
  launchInto('map');
  expect(getSplashState().phase).toBe('waiting');
  reportMapFramed([dog(4, 100, 300)]);
  expect(getSplashState()).toMatchObject({
    phase: 'handover',
    mode: 'fly',
    markersHidden: true,
  });
  finishSplash();
  expect(getSplashState()).toMatchObject({
    phase: 'done',
    markersHidden: false,
  });

  resetSplashGate();
  // D1 or the failure screen: a plain fade once it is laid out, map or not.
  launchInto('page');
  expect(getSplashState()).toMatchObject({ phase: 'handover', mode: 'fade' });
});

test('a plain fade when no dog is on screen, or when opened from a notification', () => {
  launchInto('map');
  reportMapFramed([]);
  expect(getSplashState()).toMatchObject({
    mode: 'fade',
    markersHidden: false,
  });

  resetSplashGate();
  NativeModules.AppSplash = { launchInfo: () => ({ fromNotification: true }) };
  launchInto('map');
  reportMapFramed([dog(4, 100, 300)]);
  expect(getSplashState()).toMatchObject({ mode: 'fade', targets: [] });
});

test('the handover starts once: a later report changes nothing', () => {
  launchInto('map');
  reportMapFramed([dog(4, 100, 300)]);
  launchInto('page');
  reportMapFramed([]);
  expect(getSplashState()).toMatchObject({ mode: 'fly' });
  expect(getSplashState().targets.map(t => t.slaveId)).toEqual([4]);
});

test('reduce motion: a plain crossfade, real markers and controls stay visible', () => {
  const { setReducedMotion } = require('../src/app/hideSplash');
  setReducedMotion(true);
  launchInto('map');
  reportMapFramed([dog(4, 100, 300)]);
  expect(getSplashState()).toMatchObject({
    mode: 'fade',
    markersHidden: false,
  });
});
