import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { isOtherReceiver, receiverLink, receiverNumber, RECEIVER_QUIET_MS } from '../src/map/ReceiverState';
import { useReceiverState } from '../src/map/useReceiverState';

const NOW = Date.parse('2026-10-07T01:30:00Z');
const up = { enabled: true, running: true, connected: true, receiving: true, lastReceivedAt: NOW - 2000 };

test('the receiver is named by its QR Master ID, or by its device name on an older build', () => {
  expect(receiverNumber({ expectedMasterId: 7, deviceName: 'DogGPS-Master3' })).toBe(7);
  expect(receiverNumber({ expectedMasterId: 0, deviceName: 'DogGPS-Master3' })).toBe(3);
  expect(receiverNumber({ deviceName: 'DogGPS Master' })).toBeNull();
  expect(receiverNumber(null)).toBeNull();
});

test('the link says one thing; first waiting is never a disconnection', () => {
  expect(receiverLink(null, NOW)).toBe('none');
  expect(receiverLink({ ...up, enabled: false }, NOW)).toBe('none');
  expect(receiverLink({ ...up, running: false }, NOW)).toBe('stopped');
  expect(receiverLink({ ...up, connected: false, lastReceivedAt: 0 }, NOW)).toBe('connecting');
  expect(receiverLink({ ...up, connected: false }, NOW)).toBe('disconnected');
  expect(receiverLink({ ...up, receiving: false }, NOW)).toBe('quiet');
  expect(receiverLink({ ...up, lastReceivedAt: NOW - RECEIVER_QUIET_MS - 1 }, NOW)).toBe('quiet');
  expect(receiverLink(up, NOW)).toBe('receiving');
});

test('a stored packet from another Master is not this receiver\'s', () => {
  const state = { ...up, expectedMasterId: 7 };
  expect(isOtherReceiver({ id: 5, masterId: 3 }, state)).toBe(true);
  expect(isOtherReceiver({ id: 5, masterId: 7 }, state)).toBe(false);
  // Nothing stored yet, or no idea which receiver is set up: nothing to hide.
  expect(isOtherReceiver({ id: null, masterId: null }, state)).toBe(false);
  expect(isOtherReceiver({ id: 5, masterId: 3 }, { ...up, deviceName: 'DogGPS Master' })).toBe(false);
  expect(isOtherReceiver({ id: 5, masterId: 3 }, null)).toBe(false);
});

test('the hook reads the given reader while active and forgets it when switched', async () => {
  jest.useFakeTimers();
  const first = { getState: jest.fn(async () => ({ ...up, expectedMasterId: 7 })) };
  const second = { getState: jest.fn(async () => ({ ...up, expectedMasterId: 9 })) };
  let value;
  function Probe({ active, reader }) {
    value = useReceiverState(active, reader);
    return null;
  }
  let tree;
  await act(async () => { tree = Renderer.create(<Probe active reader={first} />); });
  expect(value.expectedMasterId).toBe(7);
  await act(async () => { jest.advanceTimersByTime(2000); });
  expect(first.getState).toHaveBeenCalledTimes(2);
  await act(async () => { tree.update(<Probe active reader={second} />); });
  expect(value.expectedMasterId).toBe(9);
  await act(async () => { tree.update(<Probe active={false} reader={second} />); });
  expect(value).toBeNull();
  const calls = second.getState.mock.calls.length;
  await act(async () => { jest.advanceTimersByTime(10000); });
  expect(second.getState).toHaveBeenCalledTimes(calls);
  jest.useRealTimers();
});

test('the hook says "pending" until the first read answers, and null when it fails', async () => {
  let answer;
  const slow = { getState: jest.fn(() => new Promise(resolve => { answer = resolve; })) };
  const broken = { getState: jest.fn(async () => { throw new Error('no service'); }) };
  let value = 'unset';
  function Probe({ active, reader }) {
    value = useReceiverState(active, reader);
    return null;
  }
  let tree;
  await act(async () => { tree = Renderer.create(<Probe active reader={slow} />); });
  expect(value).toBeUndefined();
  await act(async () => answer({ ...up, expectedMasterId: 7 }));
  expect(value.expectedMasterId).toBe(7);
  await act(async () => { tree.update(<Probe active reader={broken} />); });
  expect(value).toBeNull();
  await act(async () => { tree.update(<Probe active reader={null} />); });
  // No native module in jest: nothing to wait for.
  expect(value).toBeNull();
  tree.unmount();
});

test('equal native polls retain identity without commits, while packets and nested pause changes publish', async () => {
  jest.useFakeTimers();
  let payload = { ...up, receiverPauses: [{ pausedAt: 100, resumedAt: null }] };
  const reader = { getState: jest.fn(async () => JSON.parse(JSON.stringify(payload))) };
  const commit = jest.fn();
  let value;
  function Probe() { value = useReceiverState(true, reader); return null; }
  let tree;
  try {
    await act(async () => { tree = Renderer.create(<React.Profiler id="receiver" onRender={commit}><Probe /></React.Profiler>); });
    const initial = value;
    commit.mockClear();
    for (let i = 0; i < 5; i += 1)
      await act(async () => jest.advanceTimersByTimeAsync(2000));
    expect(reader.getState).toHaveBeenCalledTimes(6);
    expect(commit).not.toHaveBeenCalled();
    expect(value).toBe(initial);
    payload = { ...payload, lastReceivedAt: NOW };
    await act(async () => jest.advanceTimersByTimeAsync(2000));
    expect(value.lastReceivedAt).toBe(NOW);
    expect(commit).toHaveBeenCalledTimes(1);
    payload = { ...payload, receiverPauses: [{ pausedAt: 100, resumedAt: 200 }] };
    await act(async () => jest.advanceTimersByTimeAsync(2000));
    expect(value.receiverPauses[0].resumedAt).toBe(200);
    expect(commit).toHaveBeenCalledTimes(2);
    payload = { ...payload, newNativeError: 'fixture error', battery: 42 };
    await act(async () => jest.advanceTimersByTimeAsync(2000));
    expect(value).toMatchObject({ newNativeError: 'fixture error', battery: 42 });
    expect(commit).toHaveBeenCalledTimes(3);
  } finally {
    await act(async () => tree?.unmount());
    jest.useRealTimers();
  }
});
