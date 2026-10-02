import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import HomeStatus from '../src/map/HomeStatusBar';

const NOW = new Date(2026, 9, 2, 9, 0).getTime();

// Every rendered string, joined, including text split across nested <Text>.
const textOf = tree => {
  const parts = [];
  const walk = node => {
    if (typeof node === 'string') parts.push(node);
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node?.children) node.children.forEach(walk);
  };
  walk(tree.toJSON());
  return parts.join('');
};

async function render(props) {
  let tree;
  await act(async () => {
    tree = Renderer.create(<HomeStatus active top={0} {...props} />);
  });
  await act(async () => {});
  return tree;
}

beforeEach(() => jest.useFakeTimers({ now: NOW }));
afterEach(() => jest.useRealTimers());

test('when the receiver receives and the cloud syncs, nothing covers the map', async () => {
  const onHeight = jest.fn();
  const readState = { getState: jest.fn(async () => ({
    enabled: true, running: true, connected: true, receiving: true,
    deviceName: 'DogGPS-Master7', lastReceivedAt: NOW - 12000,
  })) };
  const tree = await render({ readState, onHeight, cloudSync: { ownerId: 'u', lastSuccess: NOW - 5000 } });
  expect(readState.getState).toHaveBeenCalled();
  expect(tree.toJSON()).toBeNull();
  expect(onHeight).toHaveBeenLastCalledWith(0);
  await act(async () => tree.unmount());
});

test('a dropped receiver shows the alert card, and its button opens the receiver settings', async () => {
  const onReceiver = jest.fn();
  const readState = { getState: jest.fn(async () => ({
    enabled: true, running: true, connected: false, receiving: false,
    deviceName: 'DogGPS-Master7', lastReceivedAt: new Date(2026, 9, 2, 8, 40).getTime(),
  })) };
  const tree = await render({ readState, onReceiver, cloudSync: { ownerId: 'u' } });
  const alert = tree.root.findByProps({ testID: 'home-alert' });
  expect(alert.props.accessibilityRole).toBe('alert');
  expect(textOf(tree)).toContain('接收器 7 已斷線');
  expect(textOf(tree)).toContain('最後收訊 08:40・會自動重連');
  // The card already says it; no second pill repeats the receiver.
  expect(tree.root.findAllByProps({ testID: 'home-receiver-pill' })).toHaveLength(0);
  await act(async () => tree.root.findByProps({ accessibilityLabel: '開啟接收器設定' }).props.onPress());
  expect(onReceiver).toHaveBeenCalledTimes(1);
  await act(async () => tree.unmount());
});

test('no receiver set up and a failing cloud show one pill each', async () => {
  const readState = { getState: jest.fn(async () => ({ enabled: false })) };
  const tree = await render({ readState, cloudSync: { ownerId: 'u', error: 'x' } });
  expect(textOf(tree)).toContain('接收器｜未連接');
  expect(textOf(tree)).toContain('雲端｜同步失敗');
  await act(async () => tree.unmount());
});

test('the receiver is only polled while the map is active', async () => {
  const readState = { getState: jest.fn(async () => null) };
  const tree = await render({ readState, active: false, cloudSync: {} });
  await act(async () => { jest.advanceTimersByTime(6000); });
  expect(readState.getState).not.toHaveBeenCalled();
  await act(async () => tree.unmount());
});
