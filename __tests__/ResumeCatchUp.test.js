import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Animated, StyleSheet, Text } from 'react-native';
import { createResumeCatchUp, CATCH_UP_TIMEOUT_MS } from '../src/tracking/ResumeCatchUp';
import { CatchUpPill } from '../src/map/MapControls';
import { setReduceMotion } from '../src/utils/reduceMotion';
import { dogMarkers } from '../src/map/DogMarkers';
import { lightTheme, darkTheme, ThemeProvider } from '../src/theme/ThemeProvider';
import { touch } from '../src/theme/tokens';

let renderer;
beforeEach(() => jest.useFakeTimers());
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  renderer = null;
  act(() => setReduceMotion(false));
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test('only a resume catches up; finish hides the pill and background cancels the cap', () => {
  const sync = createResumeCatchUp();
  sync.back();
  expect(sync.state().phase).toBe('idle');
  sync.caughtUp();
  sync.back(); // repeated active is not a resume
  expect(sync.state().phase).toBe('idle');
  sync.away();
  sync.back();
  expect(sync.state().phase).toBe('catching-up');
  sync.caughtUp();
  expect(sync.state().phase).toBe('idle');
  sync.away(); sync.back(); sync.away();
  jest.advanceTimersByTime(CATCH_UP_TIMEOUT_MS);
  expect(sync.state().phase).toBe('idle');
  sync.close();
});

test('a completed return releases its old freeze clock before a later explicit cloud retry', () => {
  let now = 1000;
  const sync = createResumeCatchUp({ now: () => now });
  sync.caughtUp(); sync.away();
  now = 61000; sync.back();
  expect(sync.state()).toEqual({ phase: 'catching-up', since: 1000 });
  sync.caughtUp();
  now = 3 * 3600000; sync.started(true);
  expect(sync.state()).toEqual({ phase: 'catching-up', since: now });
  sync.close();
});

test('the exact 20 second timeout and a read error fail; retry restarts; a later read clears it', () => {
  const onRetry = jest.fn();
  const sync = createResumeCatchUp({ onRetry });
  sync.caughtUp(); sync.away(); sync.back();
  expect(CATCH_UP_TIMEOUT_MS).toBe(20000);
  jest.advanceTimersByTime(19999);
  expect(sync.state().phase).toBe('catching-up');
  jest.advanceTimersByTime(1);
  expect(sync.state().phase).toBe('failed');
  sync.retry();
  expect(onRetry).toHaveBeenCalledTimes(1);
  expect(sync.state().phase).toBe('catching-up');
  sync.failed();
  expect(sync.state().phase).toBe('failed');
  // The feed keeps polling: once a read gets through, the failure is over
  // without 重試 (a one-off read error is not worth a stuck 更新失敗).
  sync.caughtUp();
  expect(sync.state().phase).toBe('idle');
  expect(onRetry).toHaveBeenCalledTimes(1);
  sync.close();
});

test('catch-up dims last colours; finish applies the normal ten minute stale rule', () => {
  const minute = 60000;
  const away = 20 * minute;
  const dog = { slaveId: 1, coordinate: { latitude: 25, longitude: 121 }, fixAt: 18 * minute,
    fixSource: 'ble', packetAt: 18 * minute, packetSource: 'ble' };
  const old = { ...dog, slaveId: 2, fixAt: 0 };
  const pending = dogMarkers([dog, old], { now: 40 * minute, catchUpSince: away });
  expect(pending[0]).toMatchObject({ stale: false, dimmed: true });
  expect(pending[1]).toMatchObject({ stale: true, dimmed: true });
  expect(dogMarkers([dog], { now: 40 * minute })[0]).toMatchObject({ stale: true, dimmed: false });
  // A cloud refresh changing its reference clock during catch-up must not
  // replace the colour the user left behind.
  expect(dogMarkers([{ ...dog, fixSource: 'cloud' }], { now: 40 * minute,
    catchUpSince: away, cloud: { lastDownloadAt: 40 * minute }, previousStale: { 1: false } })[0])
    .toMatchObject({ stale: false, dimmed: true });
  expect(lightTheme.opacity.catchingUp).toBe(0.5);
  expect(darkTheme.opacity.catchingUp).toBe(0.6);
});

test('pill announces updating/failure, retry is a minimum-size button, and reduced motion is static', async () => {
  const start = jest.fn(), stop = jest.fn();
  const loop = jest.spyOn(Animated, 'loop').mockReturnValue({ start, stop });
  const timing = jest.spyOn(Animated, 'timing');
  const retry = jest.fn();
  const render = phase => <ThemeProvider><CatchUpPill phase={phase} top={8} onRetry={retry} /></ThemeProvider>;
  await act(async () => { renderer = Renderer.create(render('catching-up')); });
  const pill = () => renderer.root.findByProps({ testID: 'map-catch-up' });
  await act(async () => pill().props.onLayout({ nativeEvent: { layout: { width: 220 } } }));
  expect(renderer.root.findAllByType(Text).some(node => node.props.children === '正在更新狗的位置')).toBe(true);
  expect(pill().props.accessibilityLiveRegion).toBe('polite');
  expect(loop).toHaveBeenCalled();
  expect(timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ useNativeDriver: true }));
  act(() => setReduceMotion(true));
  expect(stop).toHaveBeenCalled();
  expect(renderer.root.findAllByProps({ testID: 'map-catch-up-shimmer' })).toHaveLength(0);
  await act(async () => renderer.update(render('failed')));
  expect(renderer.root.findAllByType(Text).some(node => node.props.children === '更新失敗')).toBe(true);
  expect(renderer.root.findAllByType(Text).some(node => node.props.children === '重試')).toBe(true);
  const button = renderer.root.findAllByProps({ testID: 'map-catch-up-retry' }).find(node => node.props.onPress);
  expect(button.props.accessibilityRole).toBe('button');
  const style = StyleSheet.flatten(button.props.style);
  expect(style.minWidth).toBeGreaterThanOrEqual(touch.min);
  expect(style.minHeight).toBeGreaterThanOrEqual(touch.min);
  act(() => button.props.onPress());
  expect(retry).toHaveBeenCalledTimes(1);
  await act(async () => renderer.update(render('idle')));
  expect(renderer.root.findAllByProps({ testID: 'map-catch-up' })).toHaveLength(0);
});

describe('combined local and cloud return state', () => {
  const { combinedResumeCatchUp } = require('../src/tracking/ResumeCatchUp');
  test('local completion cannot hide an ongoing cloud download and preserves the earlier freeze clock', () => {
    expect(combinedResumeCatchUp({ phase: 'catching-up', since: 10 }, { phase: 'catching-up', since: 20 }))
      .toEqual({ phase: 'catching-up', since: 10 });
    expect(combinedResumeCatchUp({ phase: 'idle', since: null }, { phase: 'catching-up', since: 20 }))
      .toEqual({ phase: 'catching-up', since: 20 });
    expect(combinedResumeCatchUp()).toEqual({ phase: 'idle', since: null });
  });
  test('either failure takes priority while the other source is still reading', () => {
    expect(combinedResumeCatchUp({ phase: 'catching-up', since: 10 }, { phase: 'failed', since: 20 }))
      .toEqual({ phase: 'failed', since: 10 });
    expect(combinedResumeCatchUp({ phase: 'failed', since: 10 }, { phase: 'idle', since: null }))
      .toEqual({ phase: 'failed', since: 10 });
  });
});
