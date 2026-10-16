import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { StyleSheet } from 'react-native';
import BackRow from '../src/components/BackRow';
import { ThemeProvider } from '../src/theme/ThemeProvider';
import { space, touch } from '../src/theme/tokens';

let renderer;
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  renderer = null;
});
const render = async () => {
  await act(async () => {
    renderer = Renderer.create(
      <ThemeProvider><BackRow rowId="b" title="標題" label="返回" onPress={() => {}} /></ThemeProvider>,
    );
  });
};
const row = () => renderer.root.findAll(n => n.props.testID === 'b' && n.props.accessibilityRole === 'button')[0];
const rowStyle = () => StyleSheet.flatten(row().props.style({ pressed: false }));
const byType = name => renderer.root.findAll(n => n.type === name)[0];

test('back icon is vertically centred on the title in a 48dp row with an 8dp gap', async () => {
  await render();
  const style = rowStyle();
  expect(style.flexDirection).toBe('row');
  expect(style.alignItems).toBe('center');
  expect(style.minHeight).toBe(touch.min);
  expect(style.gap).toBe(space.s);
  const title = StyleSheet.flatten(byType('Text').props.style);
  expect(title.includeFontPadding).toBe(false);
  expect(title.textAlignVertical).toBe('center');
});

test('a wrapped title keeps the icon on the first line', async () => {
  await render();
  const text = byType('Text');
  await act(async () => text.props.onTextLayout({ nativeEvent: { lines: [{ height: 56 }, { height: 56 }] } }));
  expect(rowStyle().alignItems).toBe('flex-start');
  const icon = renderer.root.findAll(n => n.props.testID === 'b-icon')[0];
  expect(StyleSheet.flatten(icon.props.style).height).toBe(56);
  await act(async () => byType('Text').props.onTextLayout({ nativeEvent: { lines: [{ height: 56 }] } }));
  expect(rowStyle().alignItems).toBe('center');
});
