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
      onEdit={jest.fn()} onToggleHidden={jest.fn()} {...props} />
  );
  await act(async () => { renderer = Renderer.create(view({})); });
  expect(button(renderer, '跟隨這隻狗').props.accessibilityState.disabled).toBe(false);
  expect(button(renderer, '今天的路徑').props.accessibilityState.disabled).toBe(false);
  // Following an invisible dog would move the camera to nothing on screen.
  await act(async () => renderer.update(view({ hidden: true, todayPathBusy: true })));
  expect(button(renderer, '跟隨這隻狗').props.accessibilityState.disabled).toBe(true);
  expect(button(renderer, '今天的路徑').props.accessibilityState.disabled).toBe(true);
  // Without a history store there is nothing to save a name into.
  await act(async () => renderer.update(view({ onEdit: undefined })));
  expect(button(renderer, '編輯名稱與頭像')).toBeUndefined();
  await act(async () => renderer.unmount());
});

test('編輯 opens the page for the dog name and face', async () => {
  const edit = jest.fn();
  let renderer;
  await act(async () => {
    renderer = Renderer.create(<DogDetails dog={dog} point={{}} now={now} onEdit={edit} />);
  });
  await act(async () => button(renderer, '編輯名稱與頭像').props.onPress());
  expect(edit).toHaveBeenCalledTimes(1);
  await act(async () => renderer.unmount());
});

test('a distance from an old phone fix says how old the fix is', async () => {
  let renderer;
  const phone = { latitude: 25.032, longitude: 121.5654, ageSeconds: 150 };
  await act(async () => {
    renderer = Renderer.create(<DogDetails dog={dog} point={{}} now={now} phone={phone} />);
  });
  const reading = renderer.root.findAll(node => node.props.accessibilityLabel?.startsWith('方向與距離'))[0];
  expect(reading.props.accessibilityLabel).toContain('手機位置 2 分鐘前');
  await act(async () => renderer.update(<DogDetails dog={dog} point={{}} now={now} phone={{ ...phone, ageSeconds: 5 }} />));
  expect(renderer.root.findAll(node => node.props.accessibilityLabel?.startsWith('方向與距離'))[0]
    .props.accessibilityLabel).not.toContain('手機位置');
  await act(async () => renderer.unmount());
});
