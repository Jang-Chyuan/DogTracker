// 067: 「存到下載」 beside each export format, and the tip after saving.
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { ThemeProvider } from '../src/theme/ThemeProvider';
import HistoryExportSheet from '../src/mapHistory/HistoryExportSheet';
import { MapTip } from '../src/map/MapControls';

const exporterOf = extra => ({ phase: 'choose', range: { start: 0, end: 60000 }, start: jest.fn(), save: jest.fn(),
  stop: jest.fn(), close: jest.fn(), retry: jest.fn(), canSave: true, ...extra });
const mount = async element => {
  let renderer;
  await act(async () => { renderer = Renderer.create(<ThemeProvider>{element}</ThemeProvider>); });
  return renderer;
};
const pressable = (renderer, testID) => renderer.root.findAll(node => node.props.testID === testID
  && typeof node.props.onPress === 'function')[0];

test('each format row: the row shares, 「存到下載」 saves', async () => {
  const exporter = exporterOf();
  const renderer = await mount(<HistoryExportSheet exporter={exporter} bottomInset={0} />);
  for (const id of ['png', 'gpx', 'csv']) {
    const save = pressable(renderer, `history-export-save-${id}`);
    expect(save.props.accessibilityLabel).toMatch(/，存到下載$/);
    await act(async () => save.props.onPress());
    expect(exporter.save).toHaveBeenLastCalledWith(id);
    await act(async () => pressable(renderer, `history-export-${id}`).props.onPress());
    expect(exporter.start).toHaveBeenLastCalledWith(id);
  }
  expect(JSON.stringify(renderer.toJSON())).toContain('存到下載');
  await act(async () => renderer.unmount());
});

test('no native save (an older build): no 「存到下載」', async () => {
  const renderer = await mount(<HistoryExportSheet exporter={exporterOf({ canSave: false })} bottomInset={0} />);
  expect(pressable(renderer, 'history-export-save-csv')).toBeUndefined();
  await act(async () => renderer.unmount());
});

test('the tip after saving: the words and 「開啟」, which can be tapped', async () => {
  const onPress = jest.fn();
  const message = { text: '已存到 下載／DogTracker／a.csv', key: 1, action: { label: '開啟', onPress } };
  const renderer = await mount(<MapTip message={message} bottom={16} onDone={() => {}} />);
  const tip = renderer.root.findAll(node => node.props.testID === 'map-tip' && node.props.pointerEvents)[0];
  expect(tip.props.pointerEvents).toBe('box-none');
  const text = JSON.stringify(renderer.toJSON());
  expect(text).toContain('已存到 下載／DogTracker／a.csv');
  await act(async () => pressable(renderer, 'map-tip-action').props.onPress());
  expect(onPress).toHaveBeenCalled();
  await act(async () => renderer.unmount());
  // A plain tip still lets taps through.
  const plain = await mount(<MapTip message={{ text: 'x', key: 2 }} bottom={16} onDone={() => {}} />);
  expect(plain.root.findAll(node => node.props.testID === 'map-tip' && node.props.pointerEvents)[0].props.pointerEvents)
    .toBe('none');
  await act(async () => plain.unmount());
});
