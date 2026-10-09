import { NativeModules } from 'react-native';
import {
  finishSplash,
  getSplashState,
  hideSplash,
  awaitInitialLink,
  initialLinkRead,
  LINK_WAIT_MS,
  launchFromNotification,
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

test('a plain fade when no dog is on screen', () => {
  launchInto('map');
  reportMapFramed([]);
  expect(getSplashState()).toMatchObject({
    mode: 'fade',
    markersHidden: false,
  });
});

// User 2026-10-09 (判定表「從通知冷啟動」): 「狗飛到被提醒那隻（在畫面上時，不在
// 就飛到最靠近中心的那隻）」; a notification that opens a page fades.
test('from a notification: flies to the alerted dog when on screen, else to the nearest the middle', () => {
  const framed = [dog(4, 200, 400), dog(6, 100, 300), dog(9, 300, 600)];
  launchFromNotification({ screen: 'map', dogId: 9 });
  launchInto('map');
  reportMapFramed(framed);
  expect(getSplashState()).toMatchObject({ mode: 'fly', markersHidden: true });
  expect(getSplashState().targets.map(t => t.slaveId)).toEqual([9, 4, 6]);

  resetSplashGate();
  launchFromNotification({ screen: 'map', dogId: 12 });
  launchInto('map');
  reportMapFramed(framed);
  expect(getSplashState().targets.map(t => t.slaveId)).toEqual([4, 6, 9]);

  resetSplashGate();
  launchFromNotification({ screen: 'open-map', dogId: null });
  launchInto('map');
  reportMapFramed(framed);
  expect(getSplashState()).toMatchObject({ mode: 'fly' });

  resetSplashGate();
  launchFromNotification({ screen: 'receiver-settings', dogId: null });
  launchInto('map');
  reportMapFramed(framed);
  expect(getSplashState()).toMatchObject({ mode: 'fade', targets: [] });

  // After the handover a notification changes nothing here (warm start).
  resetSplashGate();
  launchInto('map');
  reportMapFramed(framed);
  finishSplash();
  launchFromNotification({ screen: 'receiver-settings', dogId: null });
  expect(getSplashState().phase).toBe('done');
});

// Codex review: the map's framing can come before the launch link is read.
test('the map handover waits for the launch link, at most LINK_WAIT_MS', () => {
  jest.useFakeTimers();
  try {
    const framed = [dog(4, 200, 400), dog(9, 300, 600)];
    awaitInitialLink();
    launchInto('map');
    reportMapFramed(framed);
    expect(getSplashState().phase).toBe('waiting');
    launchFromNotification({ screen: 'receiver-settings', dogId: null });
    initialLinkRead();
    expect(getSplashState()).toMatchObject({ phase: 'handover', mode: 'fade' });

    resetSplashGate();
    awaitInitialLink();
    launchInto('map');
    reportMapFramed(framed);
    jest.advanceTimersByTime(LINK_WAIT_MS - 1);
    expect(getSplashState().phase).toBe('waiting');
    jest.advanceTimersByTime(1);
    expect(getSplashState()).toMatchObject({ phase: 'handover', mode: 'fly' });
  } finally {
    jest.useRealTimers();
  }
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
