import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import DogDetails from '../src/map/DogDetails';

const now = 1_800_000_000_000;
const dog = {
  slaveId: 7, masterId: 3, source: 'ble', receivedAt: now - 5000, lastPacketAt: now - 5000,
  lastPositionAt: now - 5000, coordinate: { latitude: 25.033, longitude: 121.5654 },
  batteryPercentage: 80, speedKmh: 3,
};
const button = (renderer, label) => renderer.root.findAll(
  node => node.props.accessibilityLabel === label && node.props.accessibilityRole === 'button',
  )[0];

test('a hidden dog cannot be followed, and the path waits for a save to finish', async () => {
  let renderer;
  const view = props => (
    <DogDetails dog={dog} point={{}} now={now} onFollow={jest.fn()} onTodayPath={jest.fn()}
      onRename={jest.fn()} onToggleHidden={jest.fn()} {...props} />
  );
  await act(async () => { renderer = Renderer.create(view({})); });
  expect(button(renderer, '跟隨這隻狗').props.accessibilityState.disabled).toBe(false);
  expect(button(renderer, '今天的路徑').props.accessibilityState.disabled).toBe(false);
  // Following an invisible dog would move the camera to nothing on screen.
  await act(async () => renderer.update(view({ hidden: true, todayPathBusy: true })));
  expect(button(renderer, '跟隨這隻狗').props.accessibilityState.disabled).toBe(true);
  expect(button(renderer, '今天的路徑').props.accessibilityState.disabled).toBe(true);
  // Without a history store there is nothing to rename into.
  await act(async () => renderer.update(view({ onRename: undefined })));
  expect(button(renderer, '改名')).toBeUndefined();
  await act(async () => renderer.unmount());
});

test('renaming can be cancelled without saving', async () => {
  const rename = jest.fn();
  let renderer;
  await act(async () => {
    renderer = Renderer.create(<DogDetails dog={dog} point={{}} now={now} onRename={rename} />);
  });
  await act(async () => button(renderer, '改名').props.onPress());
  await act(async () => button(renderer, '取消').props.onPress());
  expect(rename).not.toHaveBeenCalled();
  expect(button(renderer, '改名')).toBeDefined();
  await act(async () => renderer.unmount());
});
