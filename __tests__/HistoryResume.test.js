import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { useMapHistory } from '../src/mapHistory/useMapHistory';
import { HISTORY_DEFAULTS } from '../src/mapHistory/HistoryDatabase';

// 056: the old export's history query (read every 10 s) is gone; the
// export uses the history screen's own day rows (useHistoryExport).
test('the history no longer polls the old query, on screen or after a resume', async () => {
  jest.useFakeTimers();
  const db = {
    load: jest.fn(async () => HISTORY_DEFAULTS),
    read: jest.fn(async () => null),
    listDevices: jest.fn(async () => []),
  };
  function Probe({ active = true, owner = 'alice' }) {
    useMapHistory(db, true, active, owner);
    return null;
  }
  let renderer;
  try {
    await act(async () => { renderer = Renderer.create(<Probe />); });
    await act(async () => jest.advanceTimersByTime(30000));
    await act(async () => renderer.update(<Probe active={false} />));
    await act(async () => renderer.update(<Probe owner="bob" />));
    expect(db.read).not.toHaveBeenCalled();
    expect(db.listDevices).toHaveBeenCalled();
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    jest.useRealTimers();
  }
});

test('signing out hides the previous account\'s devices at once, even while inactive', async () => {
  const db = {
    load: jest.fn(async () => HISTORY_DEFAULTS),
    read: jest.fn(async () => null),
    listDevices: jest.fn(async (_source, owner) => (owner ? [{ masterId: 7, slaveId: 4, source: 'cloud' }] : [])),
  };
  let history;
  function Probe({ active = true, owner = 'alice' }) {
    history = useMapHistory(db, true, active, owner);
    return null;
  }
  let renderer;
  try {
    await act(async () => { renderer = Renderer.create(<Probe />); });
    expect(history.devices).toHaveLength(1);
    // Signed out while the history card is not on screen: nothing re-reads.
    await act(async () => renderer.update(<Probe active={false} owner={null} />));
    expect(history.devices).toEqual([]);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
  }
});
