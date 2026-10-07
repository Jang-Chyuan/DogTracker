import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { useMapHistory } from '../src/mapHistory/useMapHistory';
import { HISTORY_DEFAULTS } from '../src/mapHistory/HistoryDatabase';

test('short resume reuses history; elapsed cadence or another account queries again', async () => {
  jest.useFakeTimers();
  const db = {
    load: jest.fn(async () => HISTORY_DEFAULTS),
    read: jest.fn(async () => null),
    listDevices: jest.fn(async () => []),
    hasPhoneTrack: jest.fn(async () => true),
  };
  function Probe({ active = true, owner = 'alice' }) {
    useMapHistory(db, true, active, owner);
    return null;
  }
  let renderer;
  try {
    await act(async () => { renderer = Renderer.create(<Probe />); });
    expect(db.read).toHaveBeenCalledTimes(1);
    await act(async () => renderer.update(<Probe active={false} />));
    await act(async () => jest.advanceTimersByTime(2000));
    await act(async () => renderer.update(<Probe />));
    expect(db.read).toHaveBeenCalledTimes(1);
    await act(async () => jest.advanceTimersByTime(8000));
    expect(db.read).toHaveBeenCalledTimes(2);
    await act(async () => renderer.update(<Probe active={false} />));
    await act(async () => jest.advanceTimersByTime(15000));
    expect(db.read).toHaveBeenCalledTimes(2);
    await act(async () => renderer.update(<Probe />));
    expect(db.read).toHaveBeenCalledTimes(3);
    await act(async () => renderer.update(<Probe owner="bob" />));
    expect(db.read).toHaveBeenCalledTimes(4);
    expect(db.read.mock.calls[3][1]).toBe('bob');
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    jest.useRealTimers();
  }
});

test('signing out hides the previous account\'s devices and days at once, even while inactive', async () => {
  const db = {
    load: jest.fn(async () => HISTORY_DEFAULTS),
    read: jest.fn(async () => null),
    listDevices: jest.fn(async (_source, owner) => (owner ? [{ masterId: 7, slaveId: 4, source: 'cloud' }] : [])),
    listDays: jest.fn(async (_query, owner) => (owner ? [{ day: '2026-10-06', count: 3 }] : [])),
    hasPhoneTrack: jest.fn(async () => true),
  };
  let history;
  function Probe({ active = true, owner = 'alice' }) {
    history = useMapHistory(db, true, active, owner);
    return null;
  }
  let renderer;
  try {
    await act(async () => { renderer = Renderer.create(<Probe />); });
    await act(async () => history.wantDays(true));
    expect(history.devices).toHaveLength(1);
    expect(history.days).toHaveLength(1);
    // Signed out while the history card is not on screen: nothing re-reads.
    await act(async () => renderer.update(<Probe active={false} owner={null} />));
    expect(history.devices).toEqual([]);
    expect(history.days).toEqual([]);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
  }
});
