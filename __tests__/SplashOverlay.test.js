// D0 → 地圖銜接（C）: the launch screen's JavaScript copy and its handover.
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { NativeModules } from 'react-native';
import SplashOverlay, {
  flightGeometry,
  HEAD,
  SPLASH_ICON,
  TIMING,
} from '../src/app/SplashOverlay';
import {
  getSplashState,
  launchInto,
  reportMapFramed,
  resetSplashGate,
} from '../src/app/hideSplash';

afterEach(() => {
  delete NativeModules.AppSplash;
  resetSplashGate();
});

test('the head lands on the dog: its centre on the dog, the disc at the face size', () => {
  const box = { x: 100, y: 300 };
  const target = { x: 120, y: 200, marker: { size: 48 } };
  const g = flightGeometry(SPLASH_ICON, target, box);
  const unit = SPLASH_ICON / 108;
  const head = {
    x: (20.258 + 0.4962 * HEAD.x) * unit,
    y: (13.064 + 0.4962 * HEAD.y) * unit,
  };
  const centre = SPLASH_ICON / 2;
  // Where the head's centre ends up after RN's scale about the box centre.
  expect(box.x + centre + g.scale * (head.x - centre) + g.x).toBeCloseTo(120);
  expect(box.y + centre + g.scale * (head.y - centre) + g.y).toBeCloseTo(200);
  expect(2 * HEAD.r * 0.4962 * unit * g.scale).toBeCloseTo(48);
});

test('everything settles within 600 ms; the other dogs start popping when the background has gone', () => {
  expect(TIMING.flight).toBeLessThanOrEqual(TIMING.settled);
  expect(TIMING.popStart[0]).toBe(TIMING.background);
  expect(TIMING.popStart[1] + TIMING.pop).toBeLessThanOrEqual(TIMING.settled);
  expect(TIMING.chromeStart + TIMING.chrome).toBeLessThanOrEqual(TIMING.settled);
});

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('covers the screen while waiting; with animations off it goes straight to the map', async () => {
  NativeModules.AppSplash = {
    hide: jest.fn(),
    done: jest.fn(),
    launchInfo: () => ({ animatorScale: 0 }),
  };
  let renderer;
  await act(async () => {
    renderer = Renderer.create(<SplashOverlay />);
  });
  expect(renderer.root.findAllByProps({ testID: 'splash-overlay' }).length).toBeGreaterThan(0);
  await act(async () => {
    launchInto('map');
    reportMapFramed([{ slaveId: 4, x: 100, y: 300, marker: { size: 40 } }]);
  });
  expect(getSplashState().phase).toBe('done');
  expect(NativeModules.AppSplash.done).toHaveBeenCalled();
  expect(renderer.toJSON()).toBeNull();
  await act(async () => renderer.unmount());
});
