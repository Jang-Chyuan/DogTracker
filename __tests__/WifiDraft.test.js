import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { TextInput } from 'react-native';
import WifiSettings from '../src/settings/WifiSettings';

test('K09: a suspended Wi-Fi draft restores fields, password visibility and scroll', async () => {
  const draft = { current: null };
  const wifi = { connected: true, ssids: [] };
  let renderer;
  await act(async () => { renderer = Renderer.create(<WifiSettings wifi={wifi} draft={draft} />); });
  const inputs = renderer.root.findAllByType(TextInput);
  await act(async () => { inputs[0].props.onChangeText('FieldNet'); inputs[1].props.onChangeText('secret'); });
  const show = renderer.root.findAll(node => typeof node.props.onPress === 'function' && node.props.accessibilityLabel === '顯示密碼')[0];
  await act(async () => show.props.onPress());
  await act(async () => renderer.root.findAllByProps({ testID: 'wifi-settings' })[0].props.onScroll({ nativeEvent: { contentOffset: { y: 120 } } }));
  await act(async () => renderer.unmount());
  await act(async () => { renderer = Renderer.create(<WifiSettings wifi={wifi} draft={draft} />); });
  const restored = renderer.root.findAllByType(TextInput);
  expect(restored.map(node => node.props.value)).toEqual(['FieldNet', 'secret']);
  expect(restored[1].props.secureTextEntry).toBe(false);
  expect(renderer.root.findAllByProps({ testID: 'wifi-settings' })[0].props.contentOffset.y).toBe(120);
  await act(async () => renderer.unmount());
});
