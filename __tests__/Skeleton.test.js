import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { AccessibilityInfo, Animated, Text } from 'react-native';
import Skeleton, { LoadingContent, SKELETON_TIMING } from '../src/components/Skeleton';
import { lightTheme, darkTheme } from '../src/theme/ThemeProvider';

beforeEach(() => jest.useFakeTimers());
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks(); });

test('fast loads never show skeleton; slow loads announce once and fade into content', async () => {
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  const timing = jest.spyOn(Animated, 'timing');
  let renderer;
  const view = loading => <LoadingContent loading={loading} label="讀取中" skeletonTestID="bones"><Text>content</Text></LoadingContent>;
  await act(async () => { renderer = Renderer.create(view(true)); });
  await act(async () => jest.advanceTimersByTime(299));
  expect(renderer.root.findAllByProps({ testID: 'bones' })).toHaveLength(0);
  await act(async () => renderer.update(view(false)));
  expect(timing.mock.calls.some(([, config]) => config.duration === 150)).toBe(false);
  await act(async () => renderer.update(view(true)));
  await act(async () => jest.advanceTimersByTime(300));
  expect(renderer.root.findAllByProps({ testID: 'bones' }).length).toBeGreaterThan(0);
  await act(async () => renderer.update(view(true)));
  expect(announce).toHaveBeenCalledTimes(2);
  await act(async () => renderer.update(view(false)));
  expect(JSON.stringify(renderer.toJSON())).toContain('content');
  expect(timing.mock.calls.some(([, config]) => config.duration === 150 && config.toValue === 1)).toBe(true);
  await act(async () => renderer.unmount());
});

test.each([false, true])('motion mode %s uses sweep or opacity pulse and hides decorative blocks', async reduced => {
  const timing = jest.spyOn(Animated, 'timing');
  let renderer;
  await act(async () => { renderer = Renderer.create(<Skeleton shape="timeline" reduced={reduced} />); });
  const root = renderer.root.findAllByProps({ importantForAccessibility: 'no-hide-descendants' })[0];
  expect(root.props.accessibilityElementsHidden).toBe(true);
  expect(timing.mock.calls.some(([, config]) => config.duration === (reduced ? 800 : 1200))).toBe(true);
  await act(async () => renderer.unmount());
});

test('exact loading tokens and shared timing contract', () => {
  expect(SKELETON_TIMING).toEqual({ delay: 300, sweep: 1200, pulse: 1600, fade: 150 });
  expect(lightTheme.colors).toMatchObject({ skeleton: '#EDE6E4', skeletonHighlight: '#F7F2F0' });
  expect(darkTheme.colors).toMatchObject({ skeleton: '#3D3432', skeletonHighlight: '#4A3F3D' });
});


test('D8: a short reload after an interrupted fade restores full content opacity', async () => {
  let renderer, fadeValue;
  const original = Animated.timing;
  jest.spyOn(Animated, 'timing').mockImplementation((value, config) => {
    if (config.duration !== SKELETON_TIMING.fade) return original(value, config);
    fadeValue = value;
    return { start: () => value.setValue(0.4), stop: jest.fn() };
  });
  const view = loading => <LoadingContent loading={loading}><Text>content</Text></LoadingContent>;
  await act(async () => { renderer = Renderer.create(view(true)); });
  await act(async () => jest.advanceTimersByTime(300));
  await act(async () => renderer.update(view(false)));
  expect(fadeValue.__getValue()).toBe(0.4);
  await act(async () => renderer.update(view(true)));
  await act(async () => jest.advanceTimersByTime(100));
  await act(async () => renderer.update(view(false)));
  expect(fadeValue.__getValue()).toBe(1);
  await act(async () => renderer.unmount());
});
