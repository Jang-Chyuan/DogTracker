// 058b: the alerts' Android side as the app uses it (AlertNotifications,
// useNativeAlertState; the native module is jest.setup.js's in-memory fake).
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import Native from '../specs/NativeAlertNotifications';
import {
  alertSnapshot, handOverAlerts, loadAlertState, notificationDestination, notificationPermission,
  saveAlertState, sendAlertEffects,
} from '../src/alerts/AlertNotifications';
import { useNativeAlertState } from '../src/alerts/useNativeAlertState';
import { isLocalDog, LOCAL_RECEPTION_MS } from '../src/alerts/AlertNotifications';
import { localReception } from '../src/alerts/LocalReception';
import { mergeDogMarkers } from '../src/map/DogMerge';
import { advanceRange } from '../src/tracking/ReceiverRange';

const content = { title: 'DogTracker・1 隻狗要注意', lines: ['豆豆 不在接收範圍'], target: { screen: 'map', dogId: 4 },
  actions: [] };
const sent = () => Native.deliver.mock.calls.map(([text]) => JSON.parse(text));

beforeEach(() => {
  Native.deliver.mockClear();
  Native.handOver.mockClear();
  Native.store.revision = 0;
  Native.store.state = null;
});

// N1: the notification with its lines and target; the attention with it.
test('a step\'s effects go to the native side once; an unchanged silent step is not sent again', () => {
  sendAlertEffects({ notification: 'notify', content, vibration: [0, 500, 150, 200, 150, 500], critical: true,
    sound: true });
  expect(sent()[0]).toEqual({ command: 'notify', content: { title: content.title, lines: content.lines,
    target: content.target }, vibration: [0, 500, 150, 200, 150, 500], critical: true, sound: true });
  sendAlertEffects({ notification: 'update', content, vibration: null });
  sendAlertEffects({ notification: 'update', content, vibration: null });
  expect(sent()).toHaveLength(2);
  // In front: no system notification, but the vibration still goes.
  sendAlertEffects({ notification: 'cancel', content, vibration: [0, 250] });
  expect(sent()[2]).toMatchObject({ command: 'cancel', content: null, vibration: [0, 250] });
});

// 「限制」: only this phone's dogs are handed over; a cloud dog waits for the app.
test('the hand-over: this phone\'s dogs with their names, holds and range judgements', () => {
  const range = { status: 'out', clearing: [], nearBack: 0, cloudOnly: false };
  const snapshot = alertSnapshot([
    { slaveId: 4, name: '豆豆', coordinate: { latitude: 24.99, longitude: 121.31 }, fixAt: 10, fixSource: 'ble',
      packetAt: 12, packetSource: 'ble', batteryPercentage: 40, charging: false, range },
    { slaveId: 5, name: '小黑', coordinate: { latitude: 24.99, longitude: 121.31 }, fixAt: 10, fixSource: 'cloud',
      packetAt: 10, packetSource: 'cloud' },
    { slaveId: 6, name: '阿福', coordinate: { latitude: 24.99, longitude: 121.31 }, fixAt: 5, fixSource: 'ble',
      packetAt: 30, packetSource: 'ble', heldReason: '室內', heldSource: 'indoor', charging: true },
  ], { dogStale: false });
  expect(snapshot.preferences).toEqual({ dogStale: false });
  expect(snapshot.dogs.map(dog => dog.slaveId)).toEqual([4, 6]);
  expect(snapshot.dogs[0]).toMatchObject({ name: '豆豆', fixAt: 10, packetAt: 12, held: false, range,
    batteryPercentage: 40 });
  expect(snapshot.dogs[1]).toMatchObject({ held: true, charging: true, batteryPercentage: null });
  handOverAlerts(snapshot);
  handOverAlerts(snapshot);
  expect(Native.handOver).toHaveBeenCalledTimes(1);
});

// F7: the same collar heard by this phone's receiver and by a teammate's. The
// teammate's cloud row is newer, yet the dog is still this phone's: it is
// handed over with its name and range judgement, timed by this phone's packets.
describe('a dog a teammate also hears', () => {
  const NOW = Date.parse('2026-10-15T08:00:00Z');
  const receiver = { masterLat: 24.989, masterLon: 121.313 };
  const point = { slaveId: 4, masterId: 3, slaveLat: 24.99, slaveLon: 121.314, receivedAt: NOW - 20000, ...receiver };
  const teammate = { slave_id: 4, master_id: 9, slave_lat: 24.9901, slave_lon: 121.3141,
    track_at: NOW - 5000, received_at: NOW - 5000 };
  const range = advanceRange(undefined, { time: NOW - 20000, source: 'ble', latitude: 24.99, longitude: 121.314,
    receiverLatitude: 24.989, receiverLongitude: 121.313 });
  const shared = () => {
    const [dog] = mergeDogMarkers({ point, cloudRows: [teammate], now: NOW, windowMs: 180000 });
    const reception = localReception({ point });
    return { ...dog, name: '豆豆', range, localPacketAt: reception[4].packetAt, localFixAt: reception[4].fixAt };
  };

  test('is handed over although the cloud row is newest', () => {
    const dog = shared();
    expect(dog).toMatchObject({ fixSource: 'cloud', packetSource: 'cloud' });
    const snapshot = alertSnapshot([dog], null, NOW);
    expect(snapshot.dogs).toHaveLength(1);
    // This phone's own times, not the teammate's (another clock).
    expect(snapshot.dogs[0]).toMatchObject({ slaveId: 4, name: '豆豆', fixAt: NOW - 20000, packetAt: NOW - 20000,
      range: { status: 'in', lastLocalAt: NOW - 20000 } });
    expect(snapshot.others).toEqual([]);
  });

  test('stays this phone\'s from the range judgement alone', () => {
    const { localPacketAt, localFixAt, ...dog } = shared();
    expect(localPacketAt).toBe(NOW - 20000);
    expect(localFixAt).toBe(NOW - 20000);
    expect(isLocalDog(dog, NOW)).toBe(true);
    expect(alertSnapshot([dog], null, NOW).dogs[0]).toMatchObject({ packetAt: NOW - 20000, fixAt: null });
  });

  test('becomes the cloud\'s once this phone has stopped hearing it', () => {
    const silent = { ...shared(), localPacketAt: NOW - LOCAL_RECEPTION_MS - 60000, localFixAt: null };
    expect(isLocalDog(silent, NOW)).toBe(false);
    const snapshot = alertSnapshot([silent], null, NOW);
    expect(snapshot.dogs).toEqual([]);
    // Its name and judgement still go, for a packet while the app is away.
    expect(snapshot.others).toEqual([{ slaveId: 4, name: '豆豆', range }]);
    // Nobody hears it lately, but this phone heard it last within the window
    // of the teammate's row: still this phone's.
    expect(isLocalDog({ ...silent, packetAt: NOW - LOCAL_RECEPTION_MS }, NOW)).toBe(true);
    // A dog only ever heard through the cloud.
    expect(isLocalDog({ slaveId: 5, fixSource: 'cloud', packetSource: 'cloud', packetAt: NOW }, NOW)).toBe(false);
  });

  test('this phone\'s reception: the newest BLE packet and the newest BLE fix', () => {
    const packets = [
      { slave_id: 4, source: 'ble', received_at: NOW - 9000, track_at: NOW - 9000, slave_lat: 0, slave_lon: 0 },
      { slave_id: 4, source: 'ble', received_at: NOW - 30000, track_at: NOW - 30000, slave_lat: 24.99, slave_lon: 121.3 },
      { slave_id: 4, source: 'cloud', received_at: NOW - 1000, track_at: NOW - 1000, slave_lat: 24.99, slave_lon: 121.3 },
      { slave_id: 6, source: 'cloud', received_at: NOW - 1000, slave_lat: 24.99, slave_lon: 121.3 },
    ];
    expect(localReception({ packets })).toEqual({ 4: { packetAt: NOW - 9000, fixAt: NOW - 30000 } });
    expect(localReception({ packets, point })).toEqual({ 4: { packetAt: NOW - 9000, fixAt: NOW - 20000 } });
    expect(localReception()).toEqual({});
  });
});

test('the shared state: a save on an old revision is refused', async () => {
  expect(await loadAlertState()).toEqual({ revision: 0, state: null });
  expect(await saveAlertState({ version: 1 }, 0)).toBe(true);
  Native.store.revision = 3;
  expect(await saveAlertState({ version: 1, lastAttentionAt: 5 }, 0)).toBe(false);
  expect(Native.store.state).toEqual({ version: 1 });
  expect(await notificationPermission()).toEqual({ required: true, granted: true, alertsEnabled: true });
});

test('where a notification tap leads', () => {
  expect(notificationDestination('dogtracker://notification/map?dogId=8')).toEqual({ screen: 'map', dogId: 8 });
  expect(notificationDestination('dogtracker://notification/open-map')).toEqual({ screen: 'open-map', dogId: null });
  expect(notificationDestination('dogtracker://notification/system-storage')).toEqual({ screen: 'system-storage',
    dogId: null });
  expect(notificationDestination('dogtracker://notification/map?dogId=%zz')).toEqual({ screen: 'map', dogId: null });
  expect(notificationDestination('dogtracker://notification/elsewhere')).toBeNull();
  expect(notificationDestination('dogtracker://dev/fixture?name=a')).toBeNull();
  expect(notificationDestination(null)).toBeNull();
});

test('useNativeAlertState reads again when the native side moved the state on', async () => {
  jest.useFakeTimers();
  let value;
  function Probe({ active }) {
    value = useNativeAlertState(active, { period: 1000 });
    return null;
  }
  const state = { version: 1, active: {}, batteries: {}, seen: {}, pending: {}, lastAttentionAt: 7, pause: null };
  Native.store.state = state;
  let renderer;
  await act(async () => { renderer = Renderer.create(<Probe active />); });
  expect(value).toEqual({ ready: true, revision: 0, state });
  // The background check (or 暫停提醒 30 分) wrote a newer one.
  Native.store.revision = 1;
  Native.store.state = { ...state, lastAttentionAt: 9 };
  await act(async () => { jest.advanceTimersByTime(1000); });
  expect(value).toMatchObject({ revision: 1, state: { lastAttentionAt: 9 } });
  await act(async () => { renderer.unmount(); });
  jest.useRealTimers();
});
