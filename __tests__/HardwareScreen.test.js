import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { AppState } from 'react-native';
import HardwareScreen from '../src/screens/HardwareScreen';
import { createBleService } from '../src/ble/BleService';

jest.mock('../src/ble/BleService', () => ({
  createBleService: jest.fn(() => ({
    restoreBackground: jest.fn(async () => null),
    getBackgroundState: jest.fn(async () => null),
    disconnect: jest.fn(),
  })),
}));

test('native storage errors reach the App while hardware UI is hidden, then recover', async () => {
  jest.useFakeTimers();
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  const ble = createBleService.mock.results[0].value;
  const database = { initialize: jest.fn(async () => {}), listHistory: jest.fn() };
  const report = jest.fn();
  let renderer;
  try {
    ble.getBackgroundState.mockResolvedValue({ storageError: 'SQLite disk full' });
    await act(async () => { renderer = Renderer.create(
      <HardwareScreen dogDatabase={database} active={false} onStorageError={report} />,
    ); });
    expect(renderer.toJSON()).toBeNull();
    expect(database.listHistory).not.toHaveBeenCalled();
    expect(report).toHaveBeenLastCalledWith('SQLite disk full');
    ble.getBackgroundState.mockResolvedValue({ storageError: '' });
    await act(async () => jest.advanceTimersByTimeAsync(2000));
    expect(report).toHaveBeenLastCalledWith(null);
    expect(ble.disconnect).not.toHaveBeenCalled();
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    jest.useRealTimers();
  }
});
