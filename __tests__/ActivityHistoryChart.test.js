import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Polyline } from 'react-native-svg';
import ActivityHistoryChart from '../src/map/ActivityHistoryChart';

test('chart leaves gaps and stops database polling in background', async () => {
  jest.useFakeTimers();
  const data = Array.from({ length: 480 }, (_, i) => ({ time: i * 60000,
    value: [0, 1, 3, 4].includes(i) ? 0.475 : null }));
  const database = { activityHistory: jest.fn(async () => data) };
  let renderer;
  try {
    await act(async () => { renderer = Renderer.create(<ActivityHistoryChart database={database} owner="a" active />); });
    expect(renderer.root.findAllByType(Polyline)).toHaveLength(2);
    await act(async () => { await jest.advanceTimersByTimeAsync(60000); });
    expect(database.activityHistory).toHaveBeenCalledTimes(2);
    await act(async () => { renderer.update(<ActivityHistoryChart database={database} owner="a" active={false} />); });
    await act(async () => { await jest.advanceTimersByTimeAsync(120000); });
    expect(database.activityHistory).toHaveBeenCalledTimes(2);
    await act(async () => { renderer.update(<ActivityHistoryChart database={database} owner="b" active={false} />); });
    expect(renderer.root.findAllByType(Polyline)).toHaveLength(0);
  } finally {
    await act(async () => { renderer?.unmount(); });
    jest.useRealTimers();
  }
});
