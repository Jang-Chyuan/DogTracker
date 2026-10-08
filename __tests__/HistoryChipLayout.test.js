import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { PressScale } from '../src/map/MapControls';
import { StyleSheet } from 'react-native';
import { TopRow, historyChipsOverflow } from '../src/mapHistory/HistoryScreen';

test('chip layout includes spacing, waits for measurements, and accepts an exact fit', () => {
  expect(historyChipsOverflow(0, [100], 80)).toBe(false);
  expect(historyChipsOverflow(100, [undefined], 80)).toBe(false);
  expect(historyChipsOverflow(292, [100, 92], 80)).toBe(false);
  expect(historyChipsOverflow(291, [100, 92], 80)).toBe(true);
});

test('overflow fixes a round add button beside export; resizing restores the inline chip', async () => {
  const onAdd = jest.fn();
  let renderer;
  await act(async () => { renderer = Renderer.create(<TopRow top={0} subject="dog"
    dogs={[{ id: 1, protagonist: true, hasData: true }]} nameOf={() => '小黑'}
    onAdd={onAdd} onBack={() => {}} onExport={() => {}} exportEnabled full />); });
  const host = id => renderer.root.findAll(node => typeof node.type === 'string' && node.props.testID === id)[0];
  const layout = (id, width) => host(id).props.onLayout({ nativeEvent: { layout: { x: 0, width } } });
  await act(async () => {
    layout('history-chip-space', 200);
    layout('history-dog-1', 120);
    const measure = renderer.root.findAll(node => typeof node.type === 'string'
      && node.props.onLayout && !node.props.testID)[0];
    measure.props.onLayout({ nativeEvent: { layout: { width: 80 } } });
  });
  const add = renderer.root.findAllByType(PressScale).find(node => node.props.testID === 'history-add');
  expect(add.props.accessibilityLabel).toBe('加入狗');
  expect(StyleSheet.flatten(add.props.style)).toMatchObject({ width: 48, height: 48 });
  const round = add.findAll(node => typeof node.type === 'string' && StyleSheet.flatten(node.props.style)?.width === 36)[0];
  expect(StyleSheet.flatten(round.props.style)).toMatchObject({ height: 36, borderRadius: 18 });
  expect(host('history-chips').findAll(node => node.props.testID === 'history-add')).toHaveLength(0);
  await act(async () => add.props.onPress());
  expect(onAdd).toHaveBeenCalledTimes(1);
  await act(async () => layout('history-chip-space', 300));
  expect(host('history-chips').findAll(node => typeof node.type === 'string' && node.props.testID === 'history-add')).toHaveLength(1);
  await act(async () => renderer.unmount());
});
