// 060: TalkBack items over the map's bitmap dog markers.
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import MarkerA11yLayer, { markerA11yItems } from '../src/map/MarkerA11yLayer';

const markers = [
  { slaveId: 4, label: '豆豆' },
  { slaveId: 6, label: '小黑・室內，充電中 62%' },
  { slaveId: 8, label: '阿福' },
];

test('one item per dog on screen, with its marker sentence or its group tag', () => {
  const items = markerA11yItems(markers, { 4: { x: 100, y: 200 }, 6: { x: 120, y: 210 }, 8: { x: -30, y: 50 } },
    { width: 393, height: 851, groupLabel: marker => (marker.slaveId === 6 ? '2 隻：豆豆、小黑' : null) });
  expect(items).toEqual([
    { id: 4, label: '豆豆', x: 100, y: 200 },
    { id: 6, label: '2 隻：豆豆、小黑', x: 120, y: 210 },
  ]);
  expect(markerA11yItems(markers, null)).toEqual([]);
  // Dogs inside a group tag are read with the group only.
  expect(markerA11yItems(markers, { 4: { x: 100, y: 200 }, 6: { x: 120, y: 210 } },
    { grouped: marker => marker.slaveId === 4 }).map(item => item.id)).toEqual([6]);
});

test('a double tap (activate) does what a tap on the dog does; fingers pass through', async () => {
  const onActivate = jest.fn();
  let renderer;
  await act(async () => {
    renderer = Renderer.create(<MarkerA11yLayer items={[{ id: 4, label: '豆豆', x: 100, y: 200 }]}
      onActivate={onActivate} />);
  });
  const layer = renderer.root.findByProps({ testID: 'marker-a11y-layer' });
  expect(layer.props.pointerEvents).toBe('none');
  const item = renderer.root.findByProps({ testID: 'marker-a11y-4' });
  expect(item.props).toMatchObject({ accessible: true, accessibilityLabel: '豆豆', accessibilityRole: 'button' });
  item.props.onAccessibilityAction({ nativeEvent: { actionName: 'activate' } });
  expect(onActivate).toHaveBeenCalledWith(4);
});

test('a history stop reads its number, times and minutes, and what a double tap does', () => {
  const { stopSpeech } = require('../src/map/MarkerA11yLayer');
  const at = (h, m) => new Date(2026, 9, 7, h, m).getTime();
  expect(stopSpeech({ kind: 'number', number: 2, start: at(9, 35), end: at(10, 5) }))
    .toBe('停留 2，09:35 到 10:05，30 分鐘，點兩下跳到開始');
  expect(stopSpeech({ kind: 'indoor', start: at(9, 10), end: at(9, 50) }))
    .toBe('室內，09:10 到 09:50，40 分鐘，點兩下跳到開始');
});

test('a switch of transport and an interrupted stay are read as on the list (060 review)', () => {
  const { stopSpeech } = require('../src/map/MarkerA11yLayer');
  const at = (h, m) => new Date(2026, 9, 7, h, m).getTime();
  expect(stopSpeech({ kind: 'number', type: 'switch', number: 3, start: at(10, 12), end: at(10, 12) }))
    .toBe('換交通方式 3，10:12，點兩下跳到這裡');
  expect(stopSpeech({ kind: 'number', type: 'stop', number: 1, start: at(9, 0), end: at(9, 30),
    durationMs: 25 * 60000 })).toBe('停留 1，09:00 到 09:30，25 分鐘，點兩下跳到開始');
});
