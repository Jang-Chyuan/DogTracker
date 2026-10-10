// 058a: useAlertEngine runs the alerts while the app is in front.
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Vibration } from 'react-native';
import { useAlertEngine } from '../src/alerts/useAlertEngine';
import { lastAlertNotification } from '../src/alerts/AlertNotifications';
import { VIBRATION_PATTERNS } from '../src/alerts/AlertScheduler';
import NativeAlerts from '../specs/NativeAlertNotifications';

// What the native side was asked to vibrate (058b: alerts vibrate natively).
const vibrations = () => NativeAlerts.deliver.mock.calls.map(([text]) => JSON.parse(text).vibration).filter(Boolean);

const M = 60000;
const outDog = { slaveId: 4, name: '豆豆', coordinate: { latitude: 0, longitude: 0 }, fixAt: 0, fixSource: 'ble',
  batteryPercentage: 80, range: { status: 'out' } };
let result;
function Probe(props) {
  result = useAlertEngine(props);
  return null;
}

beforeEach(() => {
  NativeAlerts.deliver.mockClear();
  jest.useFakeTimers();
  jest.spyOn(Vibration, 'vibrate').mockImplementation(() => {});
  jest.spyOn(Vibration, 'cancel').mockImplementation(() => {});
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('vibrates once, saves what changed, waits for the input, keeps a fixture apart', async () => {
  // The first write is refused: it is tried again on the next tick.
  const save = jest.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
  let input = null;
  const props = { running: true, source: 'live', clock: () => 5 * M, readInput: () => input, save };
  let renderer;
  await act(async () => { renderer = Renderer.create(<Probe {...props} />); });
  // Nothing read yet: nothing judged, nothing saved.
  expect(vibrations()).toEqual([]);
  expect(save).not.toHaveBeenCalled();
  input = { dogs: [outDog] };
  await act(async () => { jest.advanceTimersByTime(5000); });
  expect(vibrations()).toEqual([[...VIBRATION_PATTERNS.critical]]);
  expect(Vibration.vibrate).not.toHaveBeenCalled();
  expect(result).toMatchObject({ badgeCount: 1, content: { title: 'DogTracker・1 隻狗要注意' } });
  expect(save).toHaveBeenCalledTimes(1);
  await act(async () => { jest.advanceTimersByTime(15000); });
  expect(vibrations()).toHaveLength(1);
  expect(save).toHaveBeenCalledTimes(2);
  // In front: never posted.
  expect(lastAlertNotification().command).toBe('cancel');
  // 暫停提醒 30 分: saved, shown.
  await act(async () => { result.pauseNow(); await Promise.resolve(); });
  expect(result.pause.until).toBe(35 * M);
  expect(save).toHaveBeenCalledTimes(3);
  // A fixture starts from its own state and never saves.
  await act(async () => { renderer.update(<Probe {...props} source="alerts-two-dogs" save={null} />); });
  await act(async () => { jest.advanceTimersByTime(5000); });
  expect(vibrations()).toHaveLength(2);
  expect(result.pause).toBeNull();
  expect(save).toHaveBeenCalledTimes(3);
  await act(async () => { renderer.unmount(); });
});
