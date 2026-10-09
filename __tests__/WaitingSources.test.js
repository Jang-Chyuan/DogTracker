import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { ScrollView } from 'react-native';
import { dismissWaitingSources, waitingSourcesCount, waitingSourcesState } from '../src/map/WaitingSources';
import { topCards, gearReasons } from '../src/map/TopAlerts';
import { validateTrackingPreferences } from '../src/tracking/TrackingPreferences';
import { buildFixture } from '../src/dev/ScreenFixtures';
import TopAlertCards from '../src/map/TopAlertCards';
import ReceiverSettings from '../src/settings/ReceiverSettings';

const now = 100000;
const receiver = { deviceId: 'AA', expectedMasterId: 7, enabled: true, connected: true };
const packet = (id, time = now - 10000, extra = {}) => ({ source: 'ble', master_id: 7, slave_id: id,
  received_at: time, slave_lat: 0, slave_lon: 0, ...extra });
const next = (state, packets, at = now, device = receiver, switching = false) => waitingSourcesState(state, device, packets, at, switching);

test('10-second grace uses first reception and filters cloud and other receiver sources', () => {
  let state = next(null, [packet(4), packet(6, now - 9999), packet(8, now - 10000, { source: 'cloud' }),
    packet(9, now - 10000, { master_id: 8 })]);
  expect(waitingSourcesCount(state, now)).toBe(1);
  state = next(state, [packet(4, now), packet(6, now)], now + 1);
  expect(waitingSourcesCount(state, now + 1)).toBe(2);
});

test('ever fixed sources disappear; losing a fix later does not add them back', () => {
  let state = next(null, [packet(4), packet(6), packet(8)]);
  expect(waitingSourcesCount(state, now)).toBe(3);
  state = next(state, [packet(4, now, { slave_lat: 25, slave_lon: 121 })]);
  expect(waitingSourcesCount(state, now)).toBe(2);
  state = next(state, [packet(4)]);
  expect(waitingSourcesCount(state, now)).toBe(2);
  state = next(state, [6, 8].map(id => packet(id, now, { slave_lat: 25, slave_lon: 121 })));
  expect(waitingSourcesCount(state, now)).toBe(0);
});

test('dismissal survives preference save/restart and reductions; only a new source reopens it', () => {
  let state = dismissWaitingSources(next(null, [packet(4), packet(6)]));
  const preferences = validateTrackingPreferences({ waitingLocationSources: JSON.parse(JSON.stringify(state)) });
  state = next(preferences.waitingLocationSources, [packet(4, now, { slave_lat: 25, slave_lon: 121 })]);
  expect(waitingSourcesCount(state, now)).toBe(0);
  state = next(state, [packet(8, now)]);
  expect(waitingSourcesCount(state, now + 9999)).toBe(0);
  expect(waitingSourcesCount(state, now + 10000)).toBe(2);
});

test('radio disconnect keeps the card; user disconnect or change resets it and fresh packets recompute', () => {
  const state = next(null, [packet(4)]);
  expect(waitingSourcesCount(next(state, [], now, { ...receiver, connected: false }), now)).toBe(1);
  for (const stopped of [next(state, [], now, { ...receiver, enabled: false }), next(state, [], now, receiver, true)]) {
    expect(waitingSourcesCount(stopped, now)).toBe(0);
    expect(waitingSourcesCount(next(stopped, [packet(4)]), now)).toBe(0);
    expect(waitingSourcesCount(next(stopped, [packet(4, now + 1)], now + 10001), now + 10001)).toBe(1);
  }
  const changed = next(state, [packet(4)], now, { ...receiver, deviceId: 'BB', expectedMasterId: 8 });
  expect(waitingSourcesCount(changed, now)).toBe(0);
});

test('waiting card is info, takes precedence over A6, follows outage, and adds no badge reason', () => {
  const cards = topCards({ waitingSources: 3, noDogs: true, outage: { key: 1, since: 1, number: 7 } });
  expect(cards.map(card => card.id)).toEqual(['receiver', 'waiting-sources']);
  expect(cards[1]).toMatchObject({ kind: 'info', actions: [], tapAction: 'waiting-source-settings',
    label: '3 個訊號源等待定位，定位後狗會出現在地圖上，點兩下看訊號源', closeLabel: '關閉等待定位提示' });
  expect(gearReasons({ waitingSources: 3, now })).toEqual([]);
});

test.each([
  ['waiting-sources', 3], ['waiting-sources-grace', 0], ['waiting-sources-partial', 2],
  ['waiting-sources-dismissed', 0], ['waiting-sources-new', 4],
  ['waiting-sources-disconnected', 3], ['waiting-sources-cloud-only', 0],
])('fixture %s follows the real waiting-source rules (%s)', (name, count) => {
  const fixture = buildFixture(name);
  expect(waitingSourcesCount(waitingSourcesState(fixture.waitingLocationSources, fixture.receiverState,
    fixture.cloudDogs.packets, fixture.now), fixture.now)).toBe(count);
});

test('waiting card and close control invoke independent actions with the approved labels', async () => {
  const onAction = jest.fn(), onClose = jest.fn();
  let renderer;
  await act(async () => { renderer = Renderer.create(<TopAlertCards cards={topCards({ waitingSources: 1 })}
    top={20} onAction={onAction} onClose={onClose} />); });
  const card = renderer.root.findAll(node => node.props.accessibilityLabel?.includes('1 個訊號源等待定位')
    && typeof node.props.onPress === 'function')[0];
  await act(async () => card.props.onPress());
  expect(onAction).toHaveBeenCalledWith('waiting-source-settings');
  const close = renderer.root.findAll(node => node.props.accessibilityLabel === '關閉等待定位提示'
    && typeof node.props.onPress === 'function')[0];
  const stopPropagation = jest.fn();
  await act(async () => close.props.onPress({ stopPropagation }));
  expect(stopPropagation).toHaveBeenCalled();
  expect(onClose).toHaveBeenCalled();
  expect(onAction).toHaveBeenCalledTimes(1);
  await act(async () => renderer.unmount());
});

test('S2 entry from waiting card scrolls to the sources heading once', async () => {
  const scroll = jest.spyOn(ScrollView.prototype, 'scrollTo').mockImplementation(() => {});
  let renderer;
  const page = { setUp: true, sources: [], title: '接收器 7' };
  await act(async () => { renderer = Renderer.create(<ReceiverSettings page={page} fromWaitingSources />); });
  const heading = renderer.root.findAll(node => node.props.testID === 'receiver-sources-heading'
    && typeof node.props.onLayout === 'function')[0];
  await act(async () => { heading.props.onLayout({ nativeEvent: { layout: { y: 280 } } }); });
  expect(scroll).toHaveBeenCalledWith({ y: 280, animated: false });
  await act(async () => renderer.unmount());
  scroll.mockRestore();
});


test('reconnection never treats a previously located dog as waiting when its new packet has no fix', () => {
  const paused = next(null, [], now, { ...receiver, enabled: false });
  const state = next(paused, [packet(4, now + 1), packet(4, now - 60000, { slave_lat: 25, slave_lon: 121 })], now + 10001);
  expect(waitingSourcesCount(state, now + 10001)).toBe(0);
});
