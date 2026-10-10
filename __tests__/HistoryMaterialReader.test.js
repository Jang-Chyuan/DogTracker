import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { useHistoryDayRows } from '../src/mapHistory/useHistoryScreen';
const day = new Date(2026, 0, 1).getTime();
const late = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
test('unchanged physical publication preserves rows and hold pass; material change restarts them', async () => {
  let renderer, state;
  const ledger = { scope: {}, owner: 'a', generation: 1, publishedPending: false, publishedRevision: 0, dataRevision: 1 };
  const getter = () => ledger;
  const read = jest.fn(async () => ({ rows: [{ id: 1, source: 'cloud', time: day + 1000 }], after: { cloud: 1 } }));
  function Probe() { state = useHistoryDayRows({ read, subject: 'dog', slaveId: 6, day, owner: ledger.owner,
    clock: () => day + 86400000, getPublication: getter, publishedReads: true, publicationRevision: ledger.publishedRevision, requireFresh: true }); return null; }
  try {
    await act(async () => { renderer = Renderer.create(<Probe />); });
    const accepted = state.rows, replay = state.replayHolds;
    ledger.publishedPending = true; ledger.publishedRevision++;
    await act(async () => renderer.update(<Probe />));
    ledger.publishedPending = false; ledger.publishedRevision++;
    await act(async () => renderer.update(<Probe />));
    expect(read).toHaveBeenCalledTimes(1);
    expect(state.rows).toBe(accepted); expect(state.replayHolds).toBe(replay);
    ledger.dataRevision++;
    await act(async () => renderer.update(<Probe />));
    expect(read).toHaveBeenCalledTimes(2); expect(state.replayHolds).not.toBe(replay);
    ledger.owner = 'b'; ledger.generation++;
    await act(async () => renderer.update(<Probe />));
    expect(read).toHaveBeenCalledTimes(3);
  } finally { if (renderer) await act(async () => renderer.unmount()); }
});
test('unchanged material token never admits a read crossing a physical publication', async () => {
  jest.useFakeTimers(); let renderer, state;
  const pending = late();
  const ledger = { scope: {}, owner: 'a', generation: 1, publishedPending: false, publishedRevision: 0, dataRevision: 1 };
  const getter = () => ledger;
  const read = jest.fn().mockImplementationOnce(() => pending.promise)
    .mockResolvedValue({ rows: [{ id: 2, time: day + 2000 }], after: {} });
  function Probe() { state = useHistoryDayRows({ read, subject: 'dog', slaveId: 6, day, owner: 'a', clock: () => day + 86400000,
    getPublication: getter, publishedReads: true, publicationRevision: ledger.publishedRevision }); return null; }
  try {
    await act(async () => { renderer = Renderer.create(<Probe />); });
    ledger.publishedRevision += 2;
    await act(async () => pending.resolve({ rows: [{ id: 99, time: day + 1000 }], after: {} }));
    expect(state.loaded).toBe(false); expect(state.rows).toEqual([]);
    await act(async () => jest.advanceTimersByTimeAsync(15000));
    expect(read).toHaveBeenCalledTimes(2);
    expect(state.loaded).toBe(true); expect(state.rows.map(row => row.id)).toEqual([2]);
  } finally { if (renderer) await act(async () => renderer.unmount()); jest.useRealTimers(); }
});
test.each([null, undefined, NaN, -1])('unknown material token %s preserves legacy physical refresh and does not collide with known revision', async initial => {
  let renderer;
  const ledger = { scope: {}, owner: 'a', generation: 1, publishedPending: false, publishedRevision: 1, dataRevision: initial };
  const getter = () => ledger;
  const read = jest.fn(async () => ({ rows: [], after: {} }));
  function Probe() { useHistoryDayRows({ read, subject: 'dog', slaveId: 6, day, owner: 'a', clock: () => day + 86400000,
    getPublication: getter, publishedReads: true, publicationRevision: ledger.publishedRevision, requireFresh: true }); return null; }
  try {
    await act(async () => { renderer = Renderer.create(<Probe />); });
    ledger.dataRevision = 1;
    await act(async () => renderer.update(<Probe />));
    expect(read).toHaveBeenCalledTimes(2);
    ledger.dataRevision = null; ledger.publishedRevision = 2;
    await act(async () => renderer.update(<Probe />));
    expect(read).toHaveBeenCalledTimes(3);
    ledger.publishedRevision = 4;
    await act(async () => renderer.update(<Probe />));
    expect(read).toHaveBeenCalledTimes(4);
  } finally { if (renderer) await act(async () => renderer.unmount()); }
});
