// 067: one failed read of the recording's live state keeps the last one (it
// turned the 「今天 x km」 walker grey as if recording had stopped).
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { useLiveLocation } from '../src/locationTracker/useLiveLocation';

const mockLive = jest.fn();
jest.mock('../src/locationTracker/LocationTrackerService', () => ({ locationTrackerNative: { live: (...a) => mockLive(...a) } }));

let value;
function Probe() { value = useLiveLocation(true); return null; }

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('a failed read keeps the last snapshot', async () => {
  mockLive.mockResolvedValueOnce(JSON.stringify({ running: true, ageSeconds: 1 }))
    .mockRejectedValueOnce(new Error('busy'));
  let renderer;
  await act(async () => { renderer = Renderer.create(<Probe />); });
  expect(value).toMatchObject({ running: true });
  await act(async () => { jest.advanceTimersByTime(1000); });
  expect(mockLive).toHaveBeenCalledTimes(2);
  expect(value).toMatchObject({ running: true });
  await act(async () => renderer.unmount());
});

test('with no snapshot yet, a failed read says it cannot read the live state', async () => {
  mockLive.mockRejectedValueOnce(new Error('busy'));
  let renderer;
  await act(async () => { renderer = Renderer.create(<Probe />); });
  expect(value).toMatchObject({ running: false });
  await act(async () => renderer.unmount());
});
