import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { PanResponder, ScrollView, StyleSheet, Text, View } from 'react-native';
import HistoryPanel from '../src/mapHistory/HistoryPanel';
import { historyPanelSnapHeights } from '../src/map/MapPanelHeight';
import { space } from '../src/theme/tokens';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 24, bottom: 20, left: 0, right: 0 }),
}));

let dimensions, pan, responders, tree;
const panelHeight = () => StyleSheet.flatten(tree.root.findByProps({ testID: 'history-panel' }).props.style).height;
const render = ({ day = 'day1', scope = 'owner1:phone', open = false, hidden = false } = {}) => <HistoryPanel
  scopeKey={scope} measureKey={day} rangeOpen={open} hidden={hidden} dateHeight={60} bottomInset={20} topControlBottom={96}
  collapsedHeader={<Text testID="only-date">Date {day}</Text>}
  header={handlers => <View testID="date-drag" {...handlers}><Text>Date {day}</Text><Text testID="summary">Summary</Text></View>}>
  <Text testID="timeline">Rows {day}</Text>
</HistoryPanel>;
const drag = async dy => {
  const responder = responders[0];
  await act(async () => responder.onPanResponderGrant());
  await act(async () => responder.onPanResponderMove(null, { dy }));
  await act(async () => responder.onPanResponderRelease(null, { dy }));
};
beforeEach(() => {
  responders = [];
  dimensions = jest.spyOn(require('react-native'), 'useWindowDimensions').mockReturnValue({ width: 400, height: 800, fontScale: 1 });
  pan = jest.spyOn(PanResponder, 'create').mockImplementation(value => { responders.push(value); return { panHandlers: {} }; });
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; pan.mockRestore(); dimensions.mockRestore(); });

test('three positions retain date and independently scroll timeline; new day keeps position', async () => {
  await act(async () => { tree = Renderer.create(render()); });
  expect(panelHeight()).toBe(388);
  await drag(300);
  expect(panelHeight()).toBe(80);
  expect(tree.root.findAllByProps({ testID: 'summary' })).toHaveLength(0);
  expect(tree.root.findAllByType(ScrollView)).toHaveLength(0);
  await act(async () => tree.update(render({ day: 'day2' })));
  expect(panelHeight()).toBe(80);
  expect(tree.root.findByProps({ testID: 'only-date' })).toBeTruthy();
  await drag(-700);
  expect(panelHeight()).toBe(688);
  expect(tree.root.findByType(ScrollView).findByProps({ testID: 'timeline' })).toBeTruthy();
  expect(tree.root.findByType(ScrollView).props.onMoveShouldSetResponderCapture).toBeUndefined();
});

test('resize/font uses same expanded level, new owner resets half and cancels retained gesture', async () => {
  await act(async () => { tree = Renderer.create(render()); });
  await drag(-350);
  dimensions.mockReturnValue({ width: 851, height: 393, fontScale: 2 });
  await act(async () => tree.update(render({ day: 'day2' })));
  expect(panelHeight()).toBe(281);
  const responder = responders[0];
  await act(async () => responder.onPanResponderGrant());
  await act(async () => tree.update(render({ scope: 'owner2:phone' })));
  await act(async () => responder.onPanResponderRelease(null, { dy: 300 }));
  expect(panelHeight()).toBe(184);
});

test('date vertical gesture does not claim horizontal handle/press or timeline; cancel returns previous level', async () => {
  await act(async () => { tree = Renderer.create(render()); });
  const responder = responders[0];
  await drag(10);
  expect(panelHeight()).toBe(388);
  expect(responder.onMoveShouldSetPanResponderCapture(null, { dx: 40, dy: 5 })).toBe(false);
  expect(responder.onMoveShouldSetPanResponderCapture(null, { dx: 0, dy: 4 })).toBe(false);
  expect(responder.onMoveShouldSetPanResponderCapture(null, { dx: 2, dy: 40 })).toBe(true);
  await act(async () => responder.onPanResponderGrant());
  await act(async () => responder.onPanResponderMove(null, { dy: -200 }));
  expect(panelHeight()).toBe(588);
  await act(async () => responder.onPanResponderTerminate());
  expect(panelHeight()).toBe(388);
  await drag(300);
  await act(async () => tree.update(render({ open: true })));
  expect(panelHeight()).toBe(388);
  await drag(300);
  expect(panelHeight()).toBe(80);
  // An already-open range remains reopenable through the date row.
  await drag(-100);
  expect(panelHeight()).toBe(388);
  await act(async () => responder.onPanResponderGrant());
  await act(async () => tree.update(render({ hidden: true })));
  await act(async () => responder.onPanResponderRelease(null, { dy: -350 }));
  expect(panelHeight()).toBe(388);
  expect(responder.onMoveShouldSetPanResponderCapture(null, { dx: 2, dy: 40 })).toBe(false);
});

test.each([{ height: 800, topControlBottom: 96 }, { height: 393, topControlBottom: 96 }, { height: 140, topControlBottom: 120 }])('top controls have reserved gap and all levels fit finite viewport %j', input => {
  const heights = historyPanelSnapHeights({ ...input, topInset: 24, bottomInset: 20, dateHeight: 60 });
  expect(heights.collapsed).toBeLessThanOrEqual(heights.half);
  expect(heights.half).toBeLessThanOrEqual(heights.expanded);
  expect(heights.expanded).toBeGreaterThanOrEqual(0);
  expect(input.height - heights.expanded).toBeGreaterThanOrEqual(input.topControlBottom + space.l);
});


test('expanded short-wide range reserves actual floating controls instead of putting them over top button', async () => {
  dimensions.mockReturnValue({ width: 851, height: 393, fontScale: 2 });
  await act(async () => { tree = Renderer.create(<HistoryPanel topControlBottom={96} dateHeight={60} bottomInset={20}
    header={<Text>Date</Text>} floating={<Text>Range handles</Text>} above={<Text>Frame</Text>}><Text>Rows</Text></HistoryPanel>); });
  await act(async () => tree.root.findByProps({ testID: 'history-range-floating' }).props.onLayout({ nativeEvent: { layout: { height: 80 } } }));
  await drag(-350);
  expect(panelHeight()).toBe(193);
  expect(393 - panelHeight() - 80 - space.s).toBe(96 + space.l);
  expect(tree.root.findByProps({ testID: 'history-range-floating' })).toBeTruthy();
});
