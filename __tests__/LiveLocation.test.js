// 067: one failed read of the recording's live state keeps the last one (it
// turned the 「今天 x km」 walker grey as if recording had stopped).
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { useLiveLocation } from '../src/locationTracker/useLiveLocation';

const mockLive = jest.fn();
jest.mock('../src/locationTracker/LocationTrackerService', () => ({ locationTrackerNative: { live: (...a) => mockLive(...a) } }));

let value;
function Probe({ active = true }) { value = useLiveLocation(active); return null; }

beforeEach(() => { jest.useFakeTimers(); mockLive.mockReset(); value = null; });
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


test.each([
  ['ageSeconds', 2], ['received', 22], ['accepted', 20], ['rejected', 2],
  ['saved', 18], ['writeErrors', 1], ['status', 'write failed'],
  ['enabled', false], ['stoppedAt', 1234], ['sessionId', 'new session'],
  ['position', { latitude: 24.989, longitude: 121.31, timestamp: 456, accuracy: 15 }],
  ['futureNativeField', { battery: 0, error: 'new native error' }],
])('a changed %s publishes the full native snapshot', async (field, next) => {
  let snapshot = { running: true, enabled: true, ageSeconds: 1, status: 'recording' };
  mockLive.mockImplementation(async () => JSON.stringify(snapshot));
  let renderer;
  try {
    await act(async () => { renderer = Renderer.create(<Probe />); });
    const previous = value;
    snapshot = { ...snapshot, [field]: next };
    await act(async () => jest.advanceTimersByTimeAsync(1000));
    expect(value).toEqual(snapshot);
    expect(value).not.toBe(previous);
    const published = value;
    await act(async () => jest.advanceTimersByTimeAsync(1000));
    expect(value).toBe(published);
    expect(mockLive).toHaveBeenCalledTimes(3);
  } finally { await act(async () => renderer?.unmount()); }
});

test('unchanged live payload and a failed read keep the same published snapshot', async () => {
  const snapshot = { running: false, enabled: false, stoppedAt: 123, status: 'stopped' };
  mockLive.mockResolvedValue(JSON.stringify(snapshot));
  let renderer;
  try {
    await act(async () => { renderer = Renderer.create(<Probe />); });
    const published = value;
    mockLive.mockRejectedValueOnce(new Error('native busy'));
    await act(async () => jest.advanceTimersByTimeAsync(1000));
    expect(value).toBe(published);
    await act(async () => jest.advanceTimersByTimeAsync(1000));
    expect(value).toBe(published);
  } finally { await act(async () => renderer?.unmount()); }
});

test('returning to the foreground reads immediately and publishes recording changes', async () => {
  let snapshot = { running: false, enabled: false, stoppedAt: 123 };
  mockLive.mockImplementation(async () => JSON.stringify(snapshot));
  let renderer;
  try {
    await act(async () => { renderer = Renderer.create(<Probe />); });
    await act(async () => renderer.update(<Probe active={false} />));
    expect(value).toBeNull();
    await act(async () => jest.advanceTimersByTimeAsync(5000));
    expect(mockLive).toHaveBeenCalledTimes(1);
    snapshot = { running: true, enabled: true, ageSeconds: 0, sessionId: 'resumed' };
    await act(async () => renderer.update(<Probe />));
    expect(mockLive).toHaveBeenCalledTimes(2);
    expect(value).toEqual(snapshot);
  } finally { await act(async () => renderer?.unmount()); }
});

test('a read from the previous active interval cannot replace the foreground snapshot', async () => {
  let resolveOld;
  mockLive.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  mockLive.mockResolvedValue(JSON.stringify({ running: true, enabled: true, saved: 99 }));
  let renderer;
  try {
    await act(async () => { renderer = Renderer.create(<Probe />); });
    await act(async () => renderer.update(<Probe active={false} />));
    await act(async () => renderer.update(<Probe />));
    const current = value;
    await act(async () => resolveOld(JSON.stringify({ running: false, enabled: false })));
    expect(value).toBe(current);
    await act(async () => jest.advanceTimersByTimeAsync(1000));
    expect(value).toBe(current);
    expect(mockLive).toHaveBeenCalledTimes(3);
  } finally { await act(async () => renderer?.unmount()); }
});
