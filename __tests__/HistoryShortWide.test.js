import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { PanResponder, PixelRatio, ScrollView, StyleSheet } from 'react-native';
import HistoryScreen from '../src/mapHistory/HistoryScreen';
import { buildFixture } from '../src/dev/ScreenFixtures';
import { historyTargetOf, useHistoryScreen } from '../src/mapHistory/useHistoryScreen';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: jest.fn(() => ({ top: 24, bottom: 20, left: 0, right: 0 })),
}));

function Harness({ fixture, state }) {
  const target = historyTargetOf(fixture.history.preferences);
  const screen = useHistoryScreen({ target, read: fixture.history.readDay, readDays: fixture.history.readDays,
    owner: fixture.cloudSync.ownerId, clock: () => fixture.now, memoryScope: `wide:${fixture.name}:`, preset: fixture.historyView,
    cloud: fixture.historyCloud?.cloud ?? null, online: fixture.historyCloud?.online !== false, cloudSeed: fixture.historyCloud?.seed ?? null });
  state.screen = screen;
  return <HistoryScreen ref={state.ref} screen={screen} top={24} bottomInset={20}
    initialRangeOpen={!!fixture.historyView?.rangeOpen} />;
}

let dimensions;
let fonts;
beforeEach(() => {
  dimensions = jest.spyOn(require('react-native'), 'useWindowDimensions').mockReturnValue({ width: 851, height: 393, scale: 2.75, fontScale: 2 });
  fonts = jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(2);
});
afterEach(() => { dimensions.mockRestore(); fonts.mockRestore(); });
const one = (tree, id) => tree.root.findAll(node => typeof node.type === 'string' && node.props.testID === id)[0];
async function mount(name) {
  const fixture = buildFixture(name);
  const state = { ref: React.createRef() };
  let tree;
  await act(async () => { tree = Renderer.create(<Harness fixture={fixture} state={state} />); });
  return { fixture, state, tree };
}

test('short landscape keeps a fixed half panel and side-by-side full-scale date and summary outside the list', async () => {
  const { tree } = await mount('history-my-route');
  try {
    const columns = one(tree, 'history-header-columns');
    expect(StyleSheet.flatten(columns.props.style)).toMatchObject({ flexDirection: 'row' });
    const header = one(tree, 'history-panel-header');
    expect(header.findAllByProps({ testID: 'history-date' })).not.toHaveLength(0);
    expect(header.findAllByProps({ testID: 'history-summary' })).not.toHaveLength(0);
    expect(StyleSheet.flatten(one(tree, 'history-panel').props.style).height).toBe(Math.floor((393 - 24) / 2));
    const scroll = tree.root.findByType(ScrollView);
    expect(scroll.findAllByProps({ testID: 'history-summary' })).toHaveLength(0);
    expect(scroll.findAllByProps({ testID: 'timeline-end' })).not.toHaveLength(0);
    expect(one(tree, 'history-range-floating')).toBeUndefined();
  } finally { await act(async () => tree.unmount()); }
});

test('wide expanded handles live outside the clipped sheet; real accessible stepping and Back remain effective', async () => {
  const { tree, state } = await mount('history-range-open');
  try {
    const floating = one(tree, 'history-range-floating');
    expect(floating).toBeDefined();
    expect(StyleSheet.flatten(floating.props.style)).toMatchObject({ position: 'absolute', bottom: '100%' });
    expect(one(tree, 'history-panel-header').findAllByProps({ testID: 'history-range-bar' })).toHaveLength(0);
    const before = state.screen.range.start;
    const handle = tree.root.findAll(node => node.props.testID === 'range-handle-start' && node.props.onAccessibilityAction)[0];
    await act(async () => handle.props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }));
    expect(state.screen.range.start).toBeGreaterThanOrEqual(before + 60000);
    let used;
    await act(async () => { used = state.ref.current.back(); });
    expect(used).toBe(true);
    expect(one(tree, 'history-range-floating')).toBeUndefined();
    expect(one(tree, 'history-range-bar')).toBeUndefined();
    await act(async () => { used = state.ref.current.back(); });
    expect(used).toBe(false);
  } finally { await act(async () => tree.unmount()); }
});

test.each([{ width: 393, height: 851 }, { width: 1024, height: 768 }, { width: 560, height: 393 }])('portrait/tall/narrow windows retain inline controls: %j', async viewport => {
  dimensions.mockReturnValue({ ...viewport, scale: 1, fontScale: 2 });
  const { tree } = await mount('history-range-open');
  try {
    expect(one(tree, 'history-header-columns')).toBeUndefined();
    expect(one(tree, 'history-range-floating')).toBeUndefined();
    expect(one(tree, 'history-panel-header').findAllByProps({ testID: 'history-range-bar' })).not.toHaveLength(0);
  } finally { await act(async () => tree.unmount()); }
});

test.each([{ width: 393, height: 851, floating: false }, { width: 800, height: 393, floating: true }])('rotation/resize cancels pending preview and rejects old release: %j', async viewport => {
  jest.useFakeTimers();
  const handlers = [];
  const pan = jest.spyOn(PanResponder, 'create').mockImplementation(value => { handlers.push(value); return { panHandlers: {} }; });
  const { tree, fixture, state } = await mount('history-range-open');
  try {
    expect(one(tree, 'history-range-floating')).toBeDefined();
    const original = { ...state.screen.range };
    const bar = one(tree, 'history-range-bar');
    const measured = bar.findAll(node => node.props.onLayout)[0];
    await act(async () => measured.props.onLayout({ nativeEvent: { layout: { width: 600 } } }));
    const old = handlers[0];
    await act(async () => {
      old.onPanResponderGrant({ nativeEvent: { locationX: 24, pageX: 100 } });
      old.onPanResponderMove({ nativeEvent: { pageX: 140 } }, { dx: 40 });
    });
    dimensions.mockReturnValue({ ...viewport, scale: 2.75, fontScale: 2 });
    await act(async () => tree.update(<Harness fixture={fixture} state={state} />));
    expect(!!one(tree, 'history-range-floating')).toBe(viewport.floating);
    expect(one(tree, 'history-panel-header').findAllByProps({ testID: 'history-range-bar' }).length > 0).toBe(!viewport.floating);
    await act(async () => {
      jest.advanceTimersByTime(200);
      old.onPanResponderRelease({ nativeEvent: { pageX: 160 } }, { dx: 60 });
    });
    expect(state.screen.range).toEqual(original);
  } finally {
    await act(async () => tree.unmount());
    pan.mockRestore();
    jest.useRealTimers();
  }
});


test('wide download keeps cancel reachable and Back cancellation does not reveal an unfinished route', async () => {
  jest.useFakeTimers();
  const { tree, state } = await mount('history-cloud-downloading');
  try {
    expect(one(tree, 'history-header-columns')).toBeDefined();
    for (let i = 0; i < 6; i += 1) await act(async () => jest.advanceTimersByTime(300));
    expect(state.screen.download.kind).toBe('downloading');
    expect(one(tree, 'history-downloading')).toBeDefined();
    expect(one(tree, 'history-download-cancel').props.accessibilityRole).toBe('button');
    expect(one(tree, 'history-summary')).toBeUndefined();
    expect(one(tree, 'history-range-floating')).toBeUndefined();
    let used;
    await act(async () => { used = state.ref.current.back(); });
    expect(used).toBe(true);
    expect(state.screen.download.kind).not.toBe('downloading');
    expect(one(tree, 'history-downloading')).toBeUndefined();
    expect(one(tree, 'history-range-floating')).toBeUndefined();
    // Existing incomplete/retry contract remains reachable; no partial model
    // is fabricated to fill the newly wider timeline viewport.
    expect(one(tree, 'history-download-retry')).toBeDefined();
  } finally { await act(async () => tree.unmount()); jest.useRealTimers(); }
});
