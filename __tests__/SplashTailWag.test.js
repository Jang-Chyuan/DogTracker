import { Animated } from 'react-native';
import { startTailWag, WAG_CYCLE_MS, WAG_MAX_ANGLE, WAG_TIMING } from '../src/app/splashTailWag';

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

function setup() {
  const loop = { start: jest.fn(), stop: jest.fn() };
  jest.spyOn(Animated, 'loop').mockReturnValue(loop);
  const timing = jest.spyOn(Animated, 'timing');
  const value = new Animated.Value(0);
  const stop = startTailWag(value);
  return { loop, timing, value, stop };
}

test('neutral at hand-off, starts after drawing, a burst of four quick swings then a short pause', () => {
  const { loop, timing, value, stop } = setup();
  expect(value.__getValue()).toBe(0);
  jest.advanceTimersByTime(799);
  expect(loop.start).not.toHaveBeenCalled();
  jest.advanceTimersByTime(1);
  expect(loop.start).toHaveBeenCalledTimes(1);
  expect(
    timing.mock.calls.map(([, config]) => [config.toValue, config.duration]),
  ).toEqual([
    [20, 55],
    [-20, 110],
    [20, 110],
    [-20, 110],
    [0, 55],
    [0, 380],
  ]);
  // Fast swings (about 9 a second), then a still tail for most of a burst's length.
  expect(WAG_CYCLE_MS).toBe(820);
  timing.mock.calls.forEach(([, config]) => {
    expect(config.useNativeDriver).toBe(true);
    expect(config.isInteraction).toBe(false);
    expect(config.easing(0.5)).toBeCloseTo(0.5);
  });
  value.setValue(7);
  stop();
  expect(loop.stop).toHaveBeenCalledTimes(1);
  expect(value.__getValue()).toBe(0);
});

test('handover before drawing completes cancels the pending wag', () => {
  const { loop, stop } = setup();
  stop();
  jest.advanceTimersByTime(5000);
  expect(loop.start).not.toHaveBeenCalled();
});

test('the exported maximum angle defines both wag endpoints', () => {
  expect(WAG_MAX_ANGLE).toBe(20);
  expect(WAG_TIMING.angle).toBe(WAG_MAX_ANGLE);
});
