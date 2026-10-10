// 067: 「存到下載」 beside each export format, and the tip after saving.
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { ThemeProvider, ThemeScope, lightTheme, darkTheme } from '../src/theme/ThemeProvider';
import { StyleSheet, Text, View } from 'react-native';
import Glyph from '../src/map/Glyph';
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

test.each([lightTheme, darkTheme])('each format has independent share/download icons ($isDark)', async theme => {
  const dimensions = jest.spyOn(require('react-native'), 'useWindowDimensions').mockReturnValue({
    width: 400, height: 800, scale: 1, fontScale: 2,
  });
  const exporter = exporterOf();
  const renderer = await mount(<ThemeScope theme={theme}><HistoryExportSheet exporter={exporter} bottomInset={0} /></ThemeScope>);
  for (const id of ['png', 'gpx', 'csv']) {
    const save = pressable(renderer, `history-export-save-${id}`);
    expect(save.props.accessibilityLabel).toMatch(/，存到下載$/);
    const share = pressable(renderer, `history-export-${id}`);
    expect(share.props.accessibilityLabel).toMatch(/，分享$/);
    for (const [button, name] of [[share, 'share'], [save, 'download']]) {
      const style = StyleSheet.flatten(button.props.style);
      expect(style.minHeight).toBe(48);
      expect(style.minWidth).toBe(48);
      expect(style.backgroundColor).toBeUndefined();
      const disc = button.findAllByType(View).find(node => StyleSheet.flatten(node.props.style)?.borderRadius);
      expect(StyleSheet.flatten(disc.props.style)).toMatchObject({ width: 40, height: 40, backgroundColor: theme.colors.brandSoft });
      expect(button.findByType(Glyph).props).toMatchObject({ name, color: theme.colors.tonalText, size: 24 });
      expect(button.findAllByType(Text)).toHaveLength(0);
    }
    await act(async () => save.props.onPress());
    expect(exporter.save).toHaveBeenLastCalledWith(id);
    await act(async () => pressable(renderer, `history-export-${id}`).props.onPress());
    expect(exporter.start).toHaveBeenLastCalledWith(id);
  }
  expect(renderer.root.findAllByType(Text).map(node => node.props.children)).not.toContain('存到下載');
  await act(async () => renderer.unmount());
  dimensions.mockRestore();
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
