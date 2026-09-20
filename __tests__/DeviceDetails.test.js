import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { BackHandler, ScrollView, Switch } from 'react-native';
import DeviceDetails from '../src/map/DeviceDetails';
import { trackingPoint } from '../__fixtures__/TrackingPointFixtures';

test('Master details are information-only and close by backdrop, close button or Android Back', async () => {
  let renderer, onBack;
  const close = jest.fn(),
    save = jest.fn(),
    remove = jest.fn();
  const listener = jest
    .spyOn(BackHandler, 'addEventListener')
    .mockImplementation((_, callback) => {
      onBack = callback;
      return { remove };
    });
  try {
    await act(async () => {
      renderer = Renderer.create(
        <DeviceDetails
          tracking={{ point: trackingPoint, saveTrackingPreferences: save }}
          subject={{ kind: 'master' }}
          master={null}
          topInset={80}
          bottomInset={120}
          onClose={close}
        />,
      );
    });
    expect(renderer.root.findAllByType(Switch)).toHaveLength(0);
    expect(JSON.stringify(renderer.toJSON())).not.toContain('路徑');
    expect(JSON.stringify(renderer.toJSON())).toContain('領犬員裝置電量');
    for (const label of ['關閉領犬員資訊', '關閉領犬員資訊面板']) {
      const button = renderer.root.findAll(
        node =>
          node.props.accessibilityLabel === label &&
          typeof node.props.onPress === 'function',
      )[0];
      await act(async () => button.props.onPress());
    }
    expect(onBack()).toBe(true);
    expect(close).toHaveBeenCalledTimes(3);
    expect(save).not.toHaveBeenCalled();
    await act(async () => renderer.unmount());
    renderer = null;
    expect(remove).toHaveBeenCalledTimes(1);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    listener.mockRestore();
  }
});

test('a dog and the handler answer a tap with the same panel', async () => {
  const close = jest.fn();
  const dog = {
    slaveId: 7, masterId: 3, source: 'ble', receivedAt: trackingPoint.receivedAt,
    coordinate: { latitude: 25.033, longitude: 121.5654 },
    distanceMeters: 82.4, retained: false, stale: false,
  };
  const view = subject => (
    <DeviceDetails tracking={{ point: trackingPoint }} subject={subject}
      master={null} topInset={80} bottomInset={120} onClose={close} />
  );
  let renderer;
  await act(async () => { renderer = Renderer.create(view({ kind: 'dog', dog })); });
  // Rendered text only: JSON keeps every interpolation as its own child.
  const flatten = node => {
    if (node == null || typeof node === 'boolean') return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(flatten).join('');
    return flatten(node.children);
  };
  const text = () => flatten(renderer.toJSON());
  expect(text()).toContain('狗 7');
  // The hardware and LoRa readings describe this pair, which is why they live
  // here and not on a card that can hold several dogs.
  expect(text()).toContain('82.4 m');
  // No coordinates: the marker this panel belongs to is already on the map.
  expect(text()).not.toContain('25.033000');
  expect(text()).toContain('LoRa 訊號品質');
  expect(text()).toContain('衛星');

  // A cloud dog has no hardware feed, and the panel says so instead of showing
  // the connected pair's numbers under another dog's name.
  const cloud = { ...dog, slaveId: 4, masterId: 5, source: 'cloud' };
  await act(async () => renderer.update(view({ kind: 'dog', dog: cloud })));
  expect(text()).toContain('狗 4');
  expect(text()).toContain('經 Master 5・雲端');
  expect(text()).not.toContain('LoRa 訊號品質');
  expect(text()).toContain('只有這支手機正在收的那一對才有');
  await act(async () => renderer.unmount());
});

test('a history marker opens the same panel, with what a past moment can say', async () => {
  const close = jest.fn();
  const track = {
    name: 'Nana 狗 4', role: 'slave', slaveId: 4, count: 340, sourceLabel: '來源：雲端下載的資料',
    latest: { time: trackingPoint.receivedAt, speed_kmh: 3.4, latitude: 25, longitude: 121 },
  };
  let renderer;
  await act(async () => {
    renderer = Renderer.create(
      <DeviceDetails tracking={{ point: trackingPoint }} subject={{ kind: 'track', track }}
        dogAliases={{ 4: 'Nana' }}
        master={null} topInset={80} bottomInset={120} onClose={close} />,
    );
  });
  const flatten = node => {
    if (node == null || typeof node === 'boolean') return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(flatten).join('');
    return flatten(node.children);
  };
  const text = flatten(renderer.toJSON());
  expect(text).toContain('Nana(id_4)');
  expect(text).toContain('來源：雲端下載的資料');
  expect(text).toContain('3.4 km/h');
  expect(text).toContain('340 筆');
  // A past moment has no hardware feed, and the panel says so rather than
  // showing the connected pair's numbers under another dog's name.
  expect(text).not.toContain('LoRa 訊號品質');
  expect(text).toContain('硬體回報與 LoRa 訊號只有即時連線那一對才有');
  await act(async () => renderer.unmount());
});

test('the panel keeps its title and close button while the content scrolls', async () => {
  const close = jest.fn();
  let renderer;
  await act(async () => {
    renderer = Renderer.create(
      <DeviceDetails tracking={{ point: trackingPoint }} subject={{ kind: 'master' }}
        master={null} topInset={80} bottomInset={120} onClose={close} />,
    );
  });
  // Scrolling the content away from its own close button is how a panel traps
  // someone, so the heading sits outside the scroll view.
  const scroll = renderer.root.findByType(ScrollView);
  expect(renderer.root.findAll(
    node => node.props.accessibilityLabel === '關閉領犬員資訊面板',
    { deep: false })[0]).toBeDefined();
  expect(scroll.findAll(
    node => node.props.accessibilityLabel === '關閉領犬員資訊面板')).toHaveLength(0);
  await act(async () => renderer.unmount());
});
