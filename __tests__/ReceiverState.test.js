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

test('switching the receiver off and on is remembered for the dogs\' freshness grace', () => {
  const { trackReceiverPause } = require('../src/map/ReceiverState');
  let record = trackReceiverPause(null, up, NOW);
  expect(record).toEqual({ running: true, pausedAt: null, resumedAt: null });
  // No read (inactive map) says nothing.
  expect(trackReceiverPause(record, null, NOW + 1000)).toBe(record);
  // A dropped link is not the user disconnecting.
  record = trackReceiverPause(record, { ...up, connected: false }, NOW + 2000);
  expect(record.pausedAt).toBeNull();
  record = trackReceiverPause(record, { ...up, running: false }, NOW + 3000);
  expect(record).toEqual({ running: false, pausedAt: NOW + 3000, resumedAt: null });
  // Still off later: the pause keeps its start.
  expect(trackReceiverPause(record, { ...up, enabled: false }, NOW + 4000)).toBe(record);
  record = trackReceiverPause(record, { ...up, connected: false, lastReceivedAt: 0 }, NOW + 5000);
  expect(record.resumedAt).toBeNull();
  record = trackReceiverPause(record, { ...up, lastReceivedAt: NOW + 6000 }, NOW + 6000);
  expect(record).toEqual({ running: true, pausedAt: NOW + 3000, resumedAt: NOW + 6000 });
  // Never running before (first start, no receiver): no pause.
  expect(trackReceiverPause(null, { ...up, enabled: false }, NOW).pausedAt).toBeNull();
});
