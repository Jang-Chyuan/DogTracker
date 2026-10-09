// D0 → 地圖銜接（C）: the launch screen's JavaScript copy and its handover.
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { AccessibilityInfo, Animated, NativeModules } from 'react-native';
import SplashOverlay, {
  flightGeometry,
  handoverDuration,
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
  expect(TIMING.chromeStart + TIMING.chrome).toBeLessThanOrEqual(
    TIMING.settled,
  );
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
  expect(
    renderer.root.findAllByProps({ testID: 'splash-overlay' }).length,
  ).toBeGreaterThan(0);
  await act(async () => {
    launchInto('map');
    reportMapFramed([{ slaveId: 4, x: 100, y: 300, marker: { size: 40 } }]);
  });
  expect(getSplashState().phase).toBe('done');
  expect(NativeModules.AppSplash.done).toHaveBeenCalled();
  expect(renderer.toJSON()).toBeNull();
  await act(async () => renderer.unmount());
});

test('a report made before the copy mounts is not missed (the state is read from the first render)', async () => {
  NativeModules.AppSplash = {
    hide: jest.fn(),
    done: jest.fn(),
    launchInfo: () => ({ animatorScale: 0 }),
  };
  launchInto('page');
  let renderer;
  await act(async () => {
    renderer = Renderer.create(<SplashOverlay />);
  });
  expect(NativeModules.AppSplash.done).toHaveBeenCalledTimes(1);
  expect(renderer.toJSON()).toBeNull();
  await act(async () => renderer.unmount());
});

// O2 (lane C, 061c/061d): under load the map showed under a coral navigation
// bar — done() waits for JavaScript's animation callback. The handover tells
// the native side how long it runs, so the bar changes on the UI thread.
test('the handover tells the native side how long it runs (the bar does not wait for JavaScript)', async () => {
  NativeModules.AppSplash = {
    hide: jest.fn(),
    done: jest.fn(),
    handover: jest.fn(),
    launchInfo: () => ({ animatorScale: 1 }),
  };
  let renderer;
  await act(async () => {
    renderer = Renderer.create(<SplashOverlay />);
  });
  await act(async () => {
    launchInto('page');
  });
  expect(NativeModules.AppSplash.handover).toHaveBeenCalledTimes(1);
  expect(NativeModules.AppSplash.handover).toHaveBeenCalledWith(handoverDuration('fade'));
  expect(handoverDuration('fly')).toBeGreaterThanOrEqual(TIMING.flight);
  expect(handoverDuration('fly', true)).toBe(TIMING.reduced);
  await act(async () => renderer.unmount());
});

describe('waiting tail lifecycle', () => {
  afterEach(() => jest.restoreAllMocks());

  async function mountWaiting({ reduced = false, scale = 1 } = {}) {
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(reduced);
    NativeModules.AppSplash = { launchInfo: () => ({ animatorScale: scale }) };
    const loop = { start: jest.fn(), stop: jest.fn() };
    jest.spyOn(Animated, 'loop').mockReturnValue(loop);
    let renderer;
    await act(async () => {
      renderer = Renderer.create(<SplashOverlay />);
    });
    await act(async () => {
      renderer.root.findByProps({ testID: 'splash-overlay' }).props.onLayout({
        nativeEvent: { layout: { width: 400, height: 800 } },
      });
    });
    return { renderer, loop };
  }

  test.each(['fly', 'fade'])(
    'stops the wag when %s handover begins',
    async mode => {
      const { renderer, loop } = await mountWaiting();
      await act(async () => jest.advanceTimersByTime(800));
      expect(loop.start).toHaveBeenCalledTimes(1);
      await act(async () => {
        if (mode === 'fly') {
          launchInto('map');
          reportMapFramed([
            { slaveId: 4, x: 100, y: 300, marker: { size: 40 } },
          ]);
        } else launchInto('page');
      });
      expect(loop.stop).toHaveBeenCalledTimes(1);
      await act(async () => renderer.unmount());
    },
  );

  test.each([{ reduced: true }, { scale: 0 }])(
    'does not wag with motion disabled: %j',
    async options => {
      const { renderer, loop } = await mountWaiting(options);
      await act(async () => jest.advanceTimersByTime(3000));
      expect(Animated.loop).not.toHaveBeenCalled();
      expect(loop.start).not.toHaveBeenCalled();
      await act(async () => renderer.unmount());
    },
  );
});
