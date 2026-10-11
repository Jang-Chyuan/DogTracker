import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { StyleSheet, Text } from 'react-native';
import HistoryPanel from '../src/mapHistory/HistoryPanel';
import HistoryScreen, { TopRow } from '../src/mapHistory/HistoryScreen';
import { buildFixture } from '../src/dev/ScreenFixtures';
import { historyTargetOf, useHistoryScreen } from '../src/mapHistory/useHistoryScreen';

const layout = (node, rect) => node.props.onLayout({ nativeEvent: { layout: rect } });
const hosts = (tree, id) => tree.root.findAll(node => typeof node.type === 'string' && node.props.testID === id);
let tree, dimensions;
beforeEach(() => {
  dimensions = jest.spyOn(require('react-native'), 'useWindowDimensions')
    .mockReturnValue({ width: 400, height: 800, scale: 1, fontScale: 1 });
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; dimensions.mockRestore(); });

test('frame-all uses its actual root rectangle, deduplicates layout and clears absent/hidden/owner rectangles', async () => {
  const report = jest.fn();
  const props = { header: <Text>Date</Text>, above: <Text>Frame</Text>, controlScope: 'phone:one',
    onControlRects: report, topControlBottom: 72 };
  const render = extra => <HistoryPanel {...props} {...extra} />;
  await act(async () => { tree = Renderer.create(render()); });
  expect(report).toHaveBeenLastCalledWith({ boxes: [], ready: false });
  const rect = { x: 323, y: 341, width: 48, height: 48 };
  await act(async () => layout(hosts(tree, 'history-panel-above')[0], rect));
  expect(report).toHaveBeenLastCalledWith({ boxes: [rect], ready: true });
  const calls = report.mock.calls.length;
  const old = hosts(tree, 'history-panel-above')[0].props.onLayout;
  await act(async () => layout(hosts(tree, 'history-panel-above')[0], { ...rect }));
  expect(report).toHaveBeenCalledTimes(calls);
  await act(async () => tree.update(render({ above: null })));
  expect(report).toHaveBeenLastCalledWith({ boxes: [], ready: true });
  await act(async () => old({ nativeEvent: { layout: rect } }));
  expect(report).toHaveBeenLastCalledWith({ boxes: [], ready: true });
  await act(async () => tree.update(render({ controlScope: 'dog:two' })));
  expect(report).toHaveBeenLastCalledWith({ boxes: [], ready: false });
  await act(async () => old({ nativeEvent: { layout: rect } }));
  expect(report).toHaveBeenLastCalledWith({ boxes: [], ready: false });
  await act(async () => layout(hosts(tree, 'history-panel-above')[0], { ...rect, x: 319 }));
  await act(async () => tree.update(render({ controlScope: 'dog:two', hidden: true })));
  expect(report).toHaveBeenLastCalledWith({ boxes: [], ready: true });
  await act(async () => tree.update(render({ controlScope: 'dog:two' })));
  expect(report).toHaveBeenLastCalledWith({ boxes: [], ready: false });
});

test('wide floating range combines real panel origin with local layout; resize waits for new measurements', async () => {
  dimensions.mockReturnValue({ width: 850, height: 500, scale: 1, fontScale: 1 });
  const report = jest.fn();
  const props = { header: <Text>Date</Text>, floating: <Text>Range</Text>, controlScope: 'phone:day',
    onControlRects: report, topControlBottom: 60 };
  await act(async () => { tree = Renderer.create(<HistoryPanel {...props} />); });
  const panel = hosts(tree, 'history-panel')[0];
  const cap = StyleSheet.flatten(panel.props.style).height;
  await act(async () => layout(panel, { x: 7, y: 500 - cap, width: 830, height: cap }));
  expect(report.mock.calls.at(-1)[0].ready).toBe(false);
  await act(async () => layout(hosts(tree, 'history-range-floating')[0], { x: 16, y: -100, width: 800, height: 92 }));
  expect(report).toHaveBeenLastCalledWith({ boxes: [{ x: 23, y: 400 - cap, width: 800, height: 92 }], ready: true });
  const stale = hosts(tree, 'history-range-floating')[0].props.onLayout;
  dimensions.mockReturnValue({ width: 820, height: 520, scale: 1, fontScale: 1 });
  await act(async () => tree.update(<HistoryPanel {...props} />));
  expect(report).toHaveBeenLastCalledWith({ boxes: [], ready: false });
  await act(async () => stale({ nativeEvent: { layout: { x: 0, y: -300, width: 850, height: 292 } } }));
  expect(report).toHaveBeenLastCalledWith({ boxes: [], ready: false });
  await act(async () => tree.update(<HistoryPanel {...props} floating={null} />));
  expect(report).toHaveBeenLastCalledWith({ boxes: [], ready: true });
});

test('HistoryScreen aggregates top and frame layouts without treating the bottom control as top padding', async () => {
  const report = jest.fn();
  const fixture = buildFixture('history-my-route');
  const target = historyTargetOf(fixture.history.preferences);
  function Probe({ pending = false }) {
    const screen = useHistoryScreen({ target, read: fixture.history.readDay, readDays: fixture.history.readDays,
      owner: fixture.cloudSync.ownerId, clock: () => fixture.now, memoryScope: 'control-geometry:',
      preset: fixture.historyView ?? null });
    return <HistoryScreen screen={{ ...screen, rangePending: pending }} top={24} bottomInset={0} onControlRects={report} />;
  }
  await act(async () => { tree = Renderer.create(<Probe />); });
  const top = tree.root.findByType(TopRow);
  const row = top.findAll(node => typeof node.type === 'string' && node.props.pointerEvents === 'box-none' && node.props.onLayout)[0];
  await act(async () => {
    layout(row, { x: 8, y: 24, width: 384, height: 48 });
    layout(hosts(tree, 'history-back-now')[0], { x: 0, y: 0, width: 112, height: 48 });
    layout(hosts(tree, 'history-export')[0], { x: 336, y: 0, width: 48, height: 48 });
  });
  expect(report.mock.calls.at(-1)[0].ready).toBe(false);
  const frame = { x: 336, y: 352, width: 48, height: 48 };
  await act(async () => layout(hosts(tree, 'history-panel-above')[0], frame));
  const geometry = report.mock.calls.at(-1)[0];
  expect(geometry.ready).toBe(true);
  expect(geometry.topBoxes).toHaveLength(2);
  expect(geometry.boxes).toEqual([...geometry.topBoxes, { x: 332, y: 348, width: 56, height: 56 }]);
  const calls = report.mock.calls.length;
  await act(async () => layout(hosts(tree, 'history-panel-above')[0], frame));
  expect(report).toHaveBeenCalledTimes(calls);
  await act(async () => tree.update(<Probe pending />));
  expect(report.mock.calls.at(-1)[0]).toEqual({ boxes: geometry.topBoxes, topBoxes: geometry.topBoxes, ready: true });
});
