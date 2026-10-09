import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { BackHandler, ScrollView, Switch } from 'react-native';
import DeviceDetails from '../src/map/DeviceDetails';
import ActivityHistoryChart from '../src/map/ActivityHistoryChart';
import { trackingPoint } from '../__fixtures__/TrackingPointFixtures';

const trackOf = slaveId => ({
  name: `Nana 狗 ${slaveId}`, role: 'slave', slaveId, count: 3, sourceLabel: '來源：雲端下載的資料',
  latest: { time: trackingPoint.receivedAt, speed_kmh: 1, latitude: 25, longitude: 121 },
});

test.each([1, 4, 8, 255])('dog %i has the same activity chart in its history panel', async slaveId => {
  let renderer;
  try {
    await act(async () => {
      renderer = Renderer.create(<DeviceDetails
        tracking={{ mode: 'real', point: trackingPoint, foreground: true, ready: { real: true } }}
        subject={{ kind: 'track', track: trackOf(slaveId) }}
        activityOwner="a" dogAliases={{ [slaveId]: 'Nana' }}
        topInset={80} bottomInset={120} onClose={() => {}} />);
    });
    expect(renderer.root.findByType(ActivityHistoryChart).props).toMatchObject({ slaveId, owner: 'a', active: true });
  } finally {
    await act(async () => { renderer?.unmount(); });
  }
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
        topInset={80} bottomInset={120} onClose={close} />,
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

test('the panel keeps its title and close button while the content scrolls, and closes by back', async () => {
  const close = jest.fn();
  let renderer, onBack;
  const remove = jest.fn();
  const listener = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_, callback) => {
    onBack = callback;
    return { remove };
  });
  try {
    await act(async () => {
      renderer = Renderer.create(
        <DeviceDetails tracking={{ point: trackingPoint }} subject={{ kind: 'track', track: trackOf(4) }}
          topInset={80} bottomInset={120} onClose={close} />,
      );
    });
    // Scrolling the content away from its own close button is how a panel
    // traps someone, so the heading sits outside the scroll view.
    const scroll = renderer.root.findByType(ScrollView);
    const label = '關閉Nana 狗 4面板';
    expect(renderer.root.findAll(node => node.props.accessibilityLabel === label, { deep: false })[0]).toBeDefined();
    expect(scroll.findAll(node => node.props.accessibilityLabel === label)).toHaveLength(0);
    expect(renderer.root.findAllByType(Switch)).toHaveLength(0);
    expect(onBack()).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => renderer?.unmount());
    listener.mockRestore();
  }
});
