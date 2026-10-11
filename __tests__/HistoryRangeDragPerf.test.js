import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { PanResponder } from 'react-native';
import { buildFixture, FIXTURE_NOW } from '../src/dev/ScreenFixtures';
import { historyTargetOf, useHistoryScreen } from '../src/mapHistory/useHistoryScreen';
import HistoryRangeSummary, { RANGE_PREVIEW_MIN_MS } from '../src/mapHistory/HistoryRangeSummary';
import { RANGE_RECOMPUTE_DELAY_MS } from '../src/mapHistory/useRangeRecompute';
import { dragRangeHandle } from '../src/history/screen/HistoryRangeBar';
import * as models from '../src/history/screen/HistoryMultiModel';

let tree, serial = 0;
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(FIXTURE_NOW); });
afterEach(async () => {
  await act(async () => tree?.unmount());
  tree = null;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

async function open({ gestureHold = false } = {}) {
  const fixture = buildFixture('history-my-route');
  const target = historyTargetOf(fixture.history.preferences);
  const state = { screen: null, handlers: null, commit: jest.fn(), preview: jest.fn(), frames: [] };
  jest.spyOn(PanResponder, 'create').mockImplementation(value => {
    state.handlers = value;
    return { panHandlers: {} };
  });
  const clock = () => FIXTURE_NOW;
  const scope = `range-perf:${++serial}:`;
  function Probe({ active = true, bar = true, previewScope, previewDelay, owner = fixture.cloudSync.ownerId }) {
    const screen = useHistoryScreen({ target, read: fixture.history.readDay,
      readDays: fixture.history.readDays, owner,
      clock, memoryScope: scope, active });
    state.screen = screen;
    state.frames.push(screen);
    if (!screen.model || !bar) return null;
    return <HistoryRangeSummary model={screen.model} subject={screen.subject}
      range={screen.range} track={screen.track} today={screen.today}
      dayPoints={screen.dayPoints} open active={screen.rangeActive}
      previewDelay={previewDelay ?? screen.rangePreviewDelay}
      previewScope={previewScope ?? screen.rangePreviewScope}
      onBegin={gestureHold ? screen.beginRangeDrag : undefined}
      onDrag={value => { state.preview(value); screen.dragRange(value); }}
      onCommit={value => { state.commit(value); screen.commitRange(value); }} />;
  }
  state.update = props => tree.update(<Probe {...props} />);
  await act(async () => { tree = Renderer.create(<Probe />); });
  const area = tree.root.findAll(node => node.props.testID === 'history-range-bar')[0]
    .findAll(node => typeof node.props.onLayout === 'function')[0];
  await act(async () => area.props.onLayout({ nativeEvent: { layout: { width: 348 } } }));
  state.endLabel = () => tree.root.findAll(node => node.props.testID === 'range-handle-end')[0].props.accessibilityLabel;
  state.grant = () => state.handlers.onPanResponderGrant({ nativeEvent: { locationX: 348, pageX: 900 } });
  state.move = dx => state.handlers.onPanResponderMove({ nativeEvent: { pageX: 900 + dx } }, { dx });
  return state;
}

test('twenty moves update the thumb immediately, coalesce to one latest preview, and release builds at most once', async () => {
  const build = jest.spyOn(models, 'multiDayModel');
  const project = jest.spyOn(models, 'multiMapPresentation');
  const s = await open();
  const initial = s.screen.range;
  const label = s.endLabel();
  build.mockClear();
  project.mockClear();
  await act(async () => s.grant());
  for (let i = 1; i <= 20; i += 1)
    await act(async () => s.move(-i * 0.8));
  expect(s.endLabel()).not.toBe(label);
  expect(build).toHaveBeenCalledTimes(0);
  expect(s.screen.range).toBe(initial);
  await act(async () => jest.advanceTimersByTimeAsync(RANGE_PREVIEW_MIN_MS));
  expect(s.preview).toHaveBeenCalledTimes(1);
  expect(s.screen.rangePending).toBe(true);
  expect(s.screen.dayModel).toBeNull();
  expect(build).toHaveBeenCalledTimes(0);
  expect(project).toHaveBeenCalledTimes(0);
  expect(s.screen.map).toBeNull();
  await act(async () => jest.advanceTimersByTimeAsync(RANGE_RECOMPUTE_DELAY_MS));
  expect(build).toHaveBeenCalledTimes(1);
  expect(s.screen.range.end).toBeLessThan(initial.end);
  build.mockClear();
  await act(async () => s.move(-20));
  // #76: release pageX is newer than the stale gesture.dx. Reaching the
  // actual right edge restores following now and discards the old preview.
  await act(async () => s.handlers.onPanResponderRelease({ nativeEvent: { pageX: 920 } }, { dx: -20 }));
  expect(s.commit).toHaveBeenCalledTimes(1);
  expect(s.screen.rangePending).toBe(true);
  await act(async () => jest.advanceTimersByTimeAsync(RANGE_RECOMPUTE_DELAY_MS));
  expect(s.screen.range.following).toBe(true);
  expect(build.mock.calls.length).toBeLessThanOrEqual(1);
  const final = s.screen.dayModel;
  await act(async () => jest.advanceTimersByTimeAsync(1000));
  expect(s.preview).toHaveBeenCalledTimes(1);
  expect(s.screen.dayModel).toBe(final);
});

test.each(['blur', 'scope', 'close'])('%s cancels queued preview and old gesture release', async kind => {
  const s = await open();
  const initial = s.screen.range;
  await act(async () => { s.grant(); s.move(-10); });
  await act(async () => jest.advanceTimersByTimeAsync(RANGE_PREVIEW_MIN_MS));
  expect(s.screen.rangePending).toBe(true);
  await act(async () => jest.advanceTimersByTimeAsync(RANGE_RECOMPUTE_DELAY_MS));
  expect(s.screen.range.end).toBeLessThan(initial.end);
  await act(async () => s.move(-12));
  await act(async () => s.update(kind === 'blur' ? { active: false }
    : kind === 'scope' ? { previewScope: 'another-day' } : { bar: false }));
  const previews = s.preview.mock.calls.filter(([value]) => value != null).length;
  await act(async () => jest.advanceTimersByTimeAsync(1000));
  expect(s.preview.mock.calls.filter(([value]) => value != null)).toHaveLength(previews);
  expect(s.screen.range).toEqual(initial);
  await act(async () => s.handlers.onPanResponderRelease({ nativeEvent: { pageX: 880 } }, { dx: -20 }));
  expect(s.commit).not.toHaveBeenCalled();
});

test('a costly preview delays the next model update while thumb feedback and release remain immediate', async () => {
  const s = await open();
  await act(async () => s.update({ previewDelay: 1000 }));
  await act(async () => { s.grant(); s.move(-10); });
  const label = s.endLabel();
  await act(async () => jest.advanceTimersByTimeAsync(999));
  expect(s.preview).not.toHaveBeenCalled();
  await act(async () => s.move(-12));
  expect(s.endLabel()).not.toBe(label);
  await act(async () => jest.advanceTimersByTimeAsync(1));
  expect(s.preview).toHaveBeenCalledTimes(1);
  await act(async () => s.move(-20));
  await act(async () => s.handlers.onPanResponderRelease({ nativeEvent: { pageX: 880 } }, { dx: -12 }));
  expect(s.commit).toHaveBeenCalledTimes(1);
  expect(s.screen.rangePending).toBe(true);
  await act(async () => jest.advanceTimersByTimeAsync(RANGE_RECOMPUTE_DELAY_MS));
  expect(s.screen.range).toEqual(s.commit.mock.calls[0][0]);
  await act(async () => jest.advanceTimersByTimeAsync(1000));
  expect(s.preview).toHaveBeenCalledTimes(1);
});

test('termination commits actual finger position once and accessibility commits without preview delay', async () => {
  const s = await open();
  const initial = s.screen.range;
  await act(async () => { s.grant(); s.move(-5); });
  await act(async () => s.handlers.onPanResponderTerminate({ nativeEvent: { pageX: 890 } }, { dx: -5 }));
  expect(s.commit).toHaveBeenCalledTimes(1);
  expect(s.screen.rangePending).toBe(true);
  await act(async () => jest.advanceTimersByTimeAsync(RANGE_RECOMPUTE_DELAY_MS));
  expect(s.screen.range.end).toBeLessThan(initial.end);
  const end = s.screen.range.end;
  const handle = tree.root.findAll(node => node.props.testID === 'range-handle-end')[0];
  await act(async () => handle.props.onAccessibilityAction({ nativeEvent: { actionName: 'decrement' } }));
  expect(s.screen.rangePending).toBe(true);
  await act(async () => jest.advanceTimersByTimeAsync(RANGE_RECOMPUTE_DELAY_MS));
  expect(s.screen.range.end).toBeLessThanOrEqual(end - 60000);
  expect(s.commit).toHaveBeenCalledTimes(2);
  await act(async () => jest.advanceTimersByTimeAsync(1000));
  expect(s.preview).not.toHaveBeenCalled();
});

test('80k sorted fixes use logarithmic timestamp probes, preserving earlier ties and endpoints', () => {
  let probes = 0;
  const dayPoints = Array.from({ length: 80000 }, (_, i) => ({ get time() { probes += 1; return i * 120000; } }));
  const track = { start: 0, end: 80000 * 120000 };
  const current = { start: 0, end: 79999 * 120000, following: false };
  const result = dragRangeHandle(current, 'start', 40000.5, 80000, { track, dayPoints, today: false });
  expect(result.range.start).toBe(40000 * 120000);
  expect(probes).toBeLessThan(30);
  expect(dragRangeHandle(current, 'start', -1, 80000, { track, dayPoints, today: false }).range.start).toBe(0);
  expect(dragRangeHandle(current, 'end', 80001, 80000, { track, dayPoints, today: true }).range.following).toBe(true);
});


test('changing only the read owner cancels queued commit and never reuses the previous owner model in pending controls', async () => {
  const s = await open();
  const initial = s.screen.range;
  const priorModel = s.screen.model;
  const later = s.screen.dayPoints.find(p => p.time > initial.start + 60000);
  await act(async () => s.screen.commitRange({ start: later.time, end: initial.end, following: false }));
  expect(s.screen.rangePending).toBe(true);
  s.frames.length = 0;
  await act(async () => s.update({ owner: 'independent-owner' }));
  const pendingFrames = s.frames.filter(screen => screen.rangePending);
  expect(pendingFrames.length).toBeGreaterThan(0);
  expect(pendingFrames.every(screen => screen.model === null && screen.map === null && screen.dayModel === null)).toBe(true);
  await act(async () => jest.advanceTimersByTimeAsync(1000));
  expect(s.screen.range.start).toBe(initial.start);
  expect(s.screen.rangePending).toBe(false);
  expect(s.screen.model).not.toBe(priorModel);
});


test('a held gesture keeps model/map pending through multiple preview intervals and computes only the actual release', async () => {
  const build = jest.spyOn(models, 'multiDayModel');
  const project = jest.spyOn(models, 'multiMapPresentation');
  const s = await open({ gestureHold: true });
  const initial = s.screen.range;
  const label = s.endLabel();
  build.mockClear(); project.mockClear(); s.frames.length = 0;
  await act(async () => { s.grant(); s.move(-10); });
  expect(s.screen.rangePending).toBe(true);
  expect(s.endLabel()).not.toBe(label);
  for (const dx of [-12, -15, -20]) {
    await act(async () => jest.advanceTimersByTimeAsync(500));
    await act(async () => s.move(dx));
    expect(s.screen.rangePending).toBe(true);
    expect(s.screen.map).toBeNull();
    expect(s.screen.dayModel).toBeNull();
  }
  expect(build).not.toHaveBeenCalled();
  expect(project).not.toHaveBeenCalled();
  expect(s.preview).not.toHaveBeenCalled();
  expect(s.frames.every(screen => screen.rangePending && screen.map === null)).toBe(true);
  await act(async () => s.handlers.onPanResponderRelease({ nativeEvent: { pageX: 885 } }, { dx: -20 }));
  expect(s.commit).toHaveBeenCalledTimes(1);
  expect(s.screen.rangePending).toBe(true);
  await act(async () => jest.advanceTimersByTimeAsync(RANGE_RECOMPUTE_DELAY_MS));
  expect(s.screen.range).toEqual(s.commit.mock.calls[0][0]);
  expect(s.screen.range.end).toBeLessThan(initial.end);
  expect(build).toHaveBeenCalledTimes(1);
  expect(project).toHaveBeenCalledTimes(1);
  await act(async () => jest.advanceTimersByTimeAsync(2000));
  expect(build).toHaveBeenCalledTimes(1);
});


test.each(['blur', 'scope', 'close', 'owner'])('held %s cancels without publishing the partial range or old release', async kind => {
  const s = await open({ gestureHold: true });
  const initial = s.screen.range;
  await act(async () => { s.grant(); s.move(-10); });
  expect(s.screen.rangePending).toBe(true);
  const oldRelease = s.handlers.onPanResponderRelease;
  await act(async () => s.update(kind === 'blur' ? { active: false }
    : kind === 'scope' ? { previewScope: 'another-day' }
      : kind === 'owner' ? { owner: 'different-owner' } : { bar: false }));
  await act(async () => { oldRelease({ nativeEvent: { pageX: 880 } }, { dx: -20 }); });
  await act(async () => jest.advanceTimersByTimeAsync(2000));
  expect(s.commit).not.toHaveBeenCalled();
  expect(s.preview.mock.calls.filter(([value]) => value != null)).toHaveLength(0);
  expect(s.screen.range).toEqual(initial);
  expect(s.screen.rangePending).toBe(false);
});

test('held release uses actual right edge to resume following; termination and accessibility remain independent commits', async () => {
  const s = await open({ gestureHold: true });
  await act(async () => { s.grant(); s.move(-10); });
  await act(async () => jest.advanceTimersByTimeAsync(1000));
  await act(async () => s.handlers.onPanResponderRelease({ nativeEvent: { pageX: 920 } }, { dx: -10 }));
  await act(async () => jest.advanceTimersByTimeAsync(RANGE_RECOMPUTE_DELAY_MS));
  expect(s.screen.range.following).toBe(true);
  await act(async () => s.grant());
  // A final finger position may arrive before any move callback.
  await act(async () => s.handlers.onPanResponderTerminate({ nativeEvent: { pageX: 880 } }, { dx: 0 }));
  expect(s.screen.rangePending).toBe(true);
  await act(async () => jest.advanceTimersByTimeAsync(RANGE_RECOMPUTE_DELAY_MS));
  expect(s.screen.range.following).toBe(false);
  const end = s.screen.range.end;
  const handle = tree.root.findAll(node => node.props.testID === 'range-handle-end')[0];
  await act(async () => handle.props.onAccessibilityAction({ nativeEvent: { actionName: 'decrement' } }));
  expect(s.screen.rangePending).toBe(true);
  await act(async () => jest.advanceTimersByTimeAsync(RANGE_RECOMPUTE_DELAY_MS));
  expect(s.screen.range.end).toBeLessThanOrEqual(end - 60000);
  expect(s.commit).toHaveBeenCalledTimes(3);
  expect(s.preview).not.toHaveBeenCalled();
});
