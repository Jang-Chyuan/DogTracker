import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import HistoryPanel from '../src/mapHistory/HistoryPanel';
import HistoryScreen from '../src/mapHistory/HistoryScreen';
import { buildFixture } from '../src/dev/ScreenFixtures';
import { historyTargetOf, useHistoryScreen } from '../src/mapHistory/useHistoryScreen';
import { historyPanelMaxHeight } from '../src/map/MapPanelHeight';
import { size, space } from '../src/theme/tokens';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: jest.fn(() => ({ top: 24, bottom: 20, left: 0, right: 0 })),
}));

const nativeNode = (tree, id) => tree.root.findAll(node =>
  typeof node.type === 'string' && node.props.testID === id)[0];

// Independent vertical clipping calculation from the rendered native styles.
// React-test-renderer has no Yoga/native accessibility implementation; this
// models the ancestor intersection responsible for the recorded inverted rect.
function visibleFrameBounds(tree, height, frameHeight) {
  const frame = nativeNode(tree, 'frame-target');
  let container = frame.parent;
  while (typeof container.type !== 'string') container = container.parent;
  const offset = StyleSheet.flatten(container.props.style);
  const ancestors = [];
  for (let parent = container.parent; parent; parent = parent.parent)
    if (typeof parent.type === 'string') ancestors.push(parent);
  const panel = ancestors.find(node => node.props.testID === 'history-panel');
  const panelHeight = StyleSheet.flatten(nativeNode(tree, 'history-panel').props.style).height;
  const origin = panel ? height - panelHeight : 0;
  const parentHeight = panel ? panelHeight : height;
  const top = origin + (offset.top ?? parentHeight - offset.bottom - frameHeight);
  const clipTop = panel ? height - panelHeight : 0;
  return { top: Math.max(top, clipTop), bottom: Math.min(top + frameHeight, height),
    visualTop: top, panelHeight, underPanel: !!panel };
}

test.each([
  { width: 393, height: 851, fontScale: 1, topInset: 24 },
  { width: 393, height: 851, fontScale: 2, topInset: 48 },
  { width: 851, height: 393, fontScale: 2, topInset: 24 },
])('frame target retains its full real rectangle above the panel: %j', async viewport => {
  const dimensions = jest.spyOn(require('react-native'), 'useWindowDimensions')
    .mockReturnValue({ ...viewport, scale: 2.75 });
  const safeArea = require('react-native-safe-area-context').useSafeAreaInsets;
  safeArea.mockReturnValue({ top: viewport.topInset, bottom: 20, left: 0, right: 0 });
  const onHeightChange = jest.fn();
  let tree;
  try {
    await act(async () => { tree = Renderer.create(
      <View testID="screen" style={{ width: viewport.width, height: viewport.height }}>
        <HistoryPanel header={<Text>Fixed header</Text>} onHeightChange={onHeightChange}
          above={<Pressable testID="frame-target" accessibilityRole="button"
            style={{ width: size.floatingButton, height: size.floatingButton }} />}>
          <Text>Timeline</Text>
        </HistoryPanel>
      </View>); });
    const rect = visibleFrameBounds(tree, viewport.height, size.floatingButton);
    expect(rect.bottom - rect.top).toBe(size.floatingButton);
    expect(rect.top).toBeGreaterThanOrEqual(viewport.topInset);
    expect(rect.underPanel).toBe(false);
    const cap = historyPanelMaxHeight(viewport.height, viewport.topInset);
    expect(rect.visualTop).toBe(viewport.height - cap - space.m - size.floatingButton);
    expect(rect.panelHeight).toBe(cap);
    expect(onHeightChange).toHaveBeenLastCalledWith(cap);
  } finally {
    if (tree) await act(async () => tree.unmount());
    dimensions.mockRestore();
    safeArea.mockReturnValue({ top: 24, bottom: 20, left: 0, right: 0 });
  }
});

test('opening a modal hides the separately positioned frame target along with its panel', async () => {
  let tree;
  const render = hidden => <HistoryPanel hidden={hidden} header={<Text>Header</Text>}
    above={<Pressable testID="frame-target" style={{ width: 48, height: 48 }} />}>
    <Text>Timeline</Text>
  </HistoryPanel>;
  try {
    await act(async () => { tree = Renderer.create(render(false)); });
    const frameParent = () => {
      let parent = nativeNode(tree, 'frame-target').parent;
      while (typeof parent.type !== 'string') parent = parent.parent;
      return parent;
    };
    expect(frameParent().props.importantForAccessibility).toBe('auto');
    await act(async () => tree.update(render(true)));
    expect(frameParent().props.importantForAccessibility).toBe('no-hide-descendants');
    expect(nativeNode(tree, 'history-panel').props.importantForAccessibility).toBe('no-hide-descendants');
  } finally { if (tree) await act(async () => tree.unmount()); }
});


test('rotation and top-inset changes move the frame target with the actual fixed panel', async () => {
  let viewport = { width: 393, height: 851, scale: 2.75, fontScale: 1 };
  const dimensions = jest.spyOn(require('react-native'), 'useWindowDimensions')
    .mockImplementation(() => viewport);
  const safeArea = require('react-native-safe-area-context').useSafeAreaInsets;
  const onHeightChange = jest.fn();
  const render = () => <View style={{ width: viewport.width, height: viewport.height }}>
    <HistoryPanel onHeightChange={onHeightChange} header={<Text>Fixed header</Text>}
      above={<Pressable testID="frame-target" style={{ width: 48, height: 48 }} />}>
      <Text>Timeline</Text>
    </HistoryPanel>
  </View>;
  let tree;
  try {
    await act(async () => { tree = Renderer.create(render()); });
    for (const next of [
      { width: 851, height: 393, scale: 2.75, fontScale: 2, top: 24 },
      { width: 393, height: 851, scale: 2.75, fontScale: 2, top: 48 },
    ]) {
      viewport = next;
      safeArea.mockReturnValue({ top: next.top, bottom: 20, left: 0, right: 0 });
      await act(async () => tree.update(render()));
      const rect = visibleFrameBounds(tree, next.height, size.floatingButton);
      const cap = historyPanelMaxHeight(next.height, next.top);
      expect(rect.bottom - rect.top).toBe(size.floatingButton);
      expect(rect.visualTop).toBe(next.height - cap - space.m - size.floatingButton);
      expect(onHeightChange).toHaveBeenLastCalledWith(cap);
    }
  } finally {
    if (tree) await act(async () => tree.unmount());
    dimensions.mockRestore();
    safeArea.mockReturnValue({ top: 24, bottom: 20, left: 0, right: 0 });
  }
});


function ScreenHarness({ fixture, onFrame }) {
  const screen = useHistoryScreen({ target: historyTargetOf(fixture.history.preferences),
    read: fixture.history.readDay, readDays: fixture.history.readDays,
    owner: fixture.cloudSync.ownerId, clock: () => fixture.now,
    memoryScope: 'frame-bounds:', preset: fixture.historyView });
  return <HistoryScreen screen={screen} top={24} bottomInset={20} onFrame={onFrame} />;
}

test('the actual route frame control keeps the latest callback and is hidden behind the calendar', async () => {
  const dimensions = jest.spyOn(require('react-native'), 'useWindowDimensions')
    .mockReturnValue({ width: 393, height: 851, scale: 2.75, fontScale: 1 });
  const fixture = buildFixture('history-my-route');
  const first = jest.fn(), latest = jest.fn();
  const actionable = (tree, id) => tree.root.findAll(node =>
    node.props.testID === id && typeof node.props.onPress === 'function')[0];
  let tree;
  try {
    await act(async () => { tree = Renderer.create(<ScreenHarness fixture={fixture} onFrame={first} />); });
    const panel = nativeNode(tree, 'history-panel');
    expect(panel.findAllByProps({ testID: 'history-frame-all' })).toHaveLength(0);
    expect(nativeNode(tree, 'history-panel-above').props.importantForAccessibility).toBe('auto');
    await act(async () => actionable(tree, 'history-frame-all').props.onPress());
    expect(first).toHaveBeenCalledTimes(1);
    await act(async () => tree.update(<ScreenHarness fixture={fixture} onFrame={latest} />));
    await act(async () => actionable(tree, 'history-frame-all').props.onPress());
    expect(first).toHaveBeenCalledTimes(1);
    expect(latest).toHaveBeenCalledTimes(1);
    await act(async () => actionable(tree, 'history-date').props.onPress());
    expect(nativeNode(tree, 'history-panel-above').props.importantForAccessibility).toBe('no-hide-descendants');
    expect(nativeNode(tree, 'history-panel').props.importantForAccessibility).toBe('no-hide-descendants');
  } finally {
    if (tree) await act(async () => tree.unmount());
    dimensions.mockRestore();
  }
});
