import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Modal, StyleSheet, Text } from 'react-native';
import DenseDogSelector from '../src/map/DenseDogSelector';
import { denseDogScene } from '../__fixtures__/DenseDogScene';
import { touch } from '../src/theme/tokens';

let renderer;
const rows = () => renderer.root.findAll(node => typeof node.type === 'string'
  && /^dense-dog-row-/.test(node.props.testID || ''));
const item = id => renderer.root.findAllByProps({ testID: id })[0];
const open = async () => act(async () => item('dense-dog-entry').props.onPress());
const props = count => ({ markers: denseDogScene(count).markers, sourceKey: 'owner-a', onSelect: jest.fn() });
beforeEach(() => jest.useFakeTimers());
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; jest.useRealTimers(); });
const render = async value => act(async () => { renderer = Renderer.create(<DenseDogSelector {...value} />); });

test.each([16, 32, 64])('%i dogs: explicit entry reveals every stable identity and selects an arbitrary last dog once', async count => {
  const p = props(count);
  await render(p);
  expect(rows()).toHaveLength(0);
  expect(StyleSheet.flatten(item('dense-dog-entry').props.style({ pressed: false })).minHeight).toBe(touch.min);
  await open();
  expect(rows().map(row => row.props.testID)).toEqual(p.markers.map(marker => `dense-dog-row-${marker.slaveId}`));
  const press = item(`dense-dog-row-${count}`).props.onPress;
  expect(item(`dense-dog-row-${count}`).props.accessibilityState.selected).toBe(true);
  await act(async () => { press(); press(); });
  expect(p.onSelect.mock.calls).toEqual([[count]]);
  expect(rows()).toHaveLength(0);
});

test('status/coordinate/input order changes preserve rows; selection uses the newest callback', async () => {
  const p = props(16);
  await render(p); await open();
  const press = item('dense-dog-row-7').props.onPress, next = jest.fn();
  await act(async () => renderer.update(<DenseDogSelector {...p} onSelect={next}
    markers={[...p.markers].reverse().map(marker => ({ ...marker, coordinate: { latitude: 1, longitude: 2 }, note: { text: 'Fresh status' } }))} />));
  expect(rows().map(row => row.props.testID)).toEqual(p.markers.map(marker => `dense-dog-row-${marker.slaveId}`));
  expect(item('dense-dog-row-7').props.accessibilityLabel).toBe(p.markers[6].label);
  expect(item('dense-dog-row-7').findAllByType(Text).map(node => node.props.children)).toContain('Fresh status');
  await act(async () => press());
  expect(p.onSelect).not.toHaveBeenCalled(); expect(next).toHaveBeenCalledWith(7);
});

test.each(['scope', 'receiver', 'remove', 'add'])('%s change immediately closes and rejects an already queued row event', async change => {
  const p = props(16);
  await render(p); await open();
  const press = item('dense-dog-row-7').props.onPress;
  const next = change === 'scope' ? { ...p, sourceKey: 'owner-b' }
    : change === 'receiver' ? { ...p, markers: p.markers.map(marker => ({ ...marker, masterId: 'new-receiver' })) }
    : { ...p, markers: change === 'remove' ? p.markers.filter(marker => marker.slaveId !== 7)
      : [...p.markers, { ...p.markers[0], slaveId: 17 }] };
  await act(async () => renderer.update(<DenseDogSelector {...next} />));
  expect(rows()).toHaveLength(0);
  await act(async () => press());
  expect(p.onSelect).not.toHaveBeenCalled();
  await open();
  expect(rows()).toHaveLength(next.markers.length);
});

test.each(['back', 'outside', 'close'])('%s dismisses without selection; old row callback cannot act on a reopened picker', async how => {
  const p = props(16);
  await render(p); await open();
  const press = item('dense-dog-row-7').props.onPress;
  await act(async () => how === 'back' ? renderer.root.findByType(Modal).props.onRequestClose()
    : item(`dense-dog-${how}`).props.onPress());
  expect(rows()).toHaveLength(0);
  await open(); await act(async () => press());
  expect(p.onSelect).not.toHaveBeenCalled(); expect(rows()).toHaveLength(16);
});

test('zero/one dog has no redundant entry and disappearing all dogs closes safely', async () => {
  const p = props(16); await render(p); await open();
  const press = item('dense-dog-row-7').props.onPress;
  await act(async () => renderer.update(<DenseDogSelector {...p} markers={[]} />));
  expect(renderer.toJSON()).toBeNull(); await act(async () => press());
  expect(p.onSelect).not.toHaveBeenCalled();
  await act(async () => renderer.update(<DenseDogSelector {...p} markers={p.markers.slice(0, 1)} />));
  expect(renderer.toJSON()).toBeNull();
});
