import { Animated } from 'react-native';
import { startTailWag, WAG_MAX_ANGLE, WAG_TIMING } from '../src/app/splashTailWag';

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

test('neutral at hand-off, starts after drawing, two 900 ms wags then a 400 ms pause', () => {
  const { loop, timing, value, stop } = setup();
  expect(value.__getValue()).toBe(0);
  jest.advanceTimersByTime(799);
  expect(loop.start).not.toHaveBeenCalled();
  jest.advanceTimersByTime(1);
  expect(loop.start).toHaveBeenCalledTimes(1);
  expect(
    timing.mock.calls.map(([, config]) => [config.toValue, config.duration]),
  ).toEqual([
    [-12, 225],
    [12, 450],
    [0, 225],
    [-12, 225],
    [12, 450],
    [0, 225],
    [0, 400],
  ]);
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
  expect(WAG_MAX_ANGLE).toBe(12);
  expect(WAG_TIMING.angle).toBe(WAG_MAX_ANGLE);
});
