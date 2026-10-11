import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { useHistoryDayRows } from '../src/mapHistory/useHistoryScreen';
const day = new Date(2026, 0, 1).getTime();
const late = () => { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; };
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

test('a first day read blocked by native publication wakes on its completed publication signal', async () => {
  jest.useFakeTimers(); let renderer, state;
  const ledger = { scope: {}, owner: 'a', generation: 1, publishedPending: true, publishedRevision: 1, dataRevision: 1 };
  const getter = () => ledger;
  const read = jest.fn(async () => ({ rows: [{ id: 2, time: day + 2000 }], after: {} }));
  function Probe() { state = useHistoryDayRows({ read, subject: 'dog', slaveId: 6, day, owner: 'a', clock: () => day + 86400000,
    getPublication: getter, publishedReads: true, publicationRevision: ledger.publishedRevision, requireFresh: true }); return null; }
  try {
    await act(async () => { renderer = Renderer.create(<Probe />); });
    expect(read).not.toHaveBeenCalled(); expect(state.loaded).toBe(false);
    ledger.publishedRevision++;
    await act(async () => renderer.update(<Probe />));
    await act(async () => jest.advanceTimersByTimeAsync(1));
    expect(read).not.toHaveBeenCalled();
    ledger.publishedPending = false; ledger.publishedRevision++;
    await act(async () => renderer.update(<Probe />));
    await act(async () => jest.advanceTimersByTimeAsync(1));
    expect(read).toHaveBeenCalledTimes(1); expect(state.loaded).toBe(true);
    expect(state.rows.map(row => row.id)).toEqual([2]);
  } finally { if (renderer) await act(async () => renderer.unmount()); jest.useRealTimers(); }
});

test.each(['resolve', 'reject'])('completed publication signals retry an invalid in-flight %s without accepting stale rows or waiting fifteen seconds', async outcome => {
  jest.useFakeTimers(); let renderer, state;
  const pending = late();
  const ledger = { scope: {}, owner: 'a', generation: 1, publishedPending: false, publishedRevision: 0, dataRevision: 1 };
  const getter = () => ledger;
  const read = jest.fn().mockImplementationOnce(() => pending.promise)
    .mockResolvedValue({ rows: [{ id: 2, time: day + 2000 }], after: {} });
  function Probe() { state = useHistoryDayRows({ read, subject: 'dog', slaveId: 6, day, owner: 'a', clock: () => day + 86400000,
    getPublication: getter, publishedReads: true, publicationRevision: ledger.publishedRevision, requireFresh: true }); return null; }
  try {
    await act(async () => { renderer = Renderer.create(<Probe />); });
    ledger.publishedPending = true; ledger.publishedRevision++;
    await act(async () => renderer.update(<Probe />));
    ledger.publishedPending = false; ledger.publishedRevision++;
    await act(async () => renderer.update(<Probe />));
    expect(read).toHaveBeenCalledTimes(1);
    await act(async () => {
      if (outcome === 'reject') pending.reject(new Error('old read failed'));
      else pending.resolve({ rows: [{ id: 99, time: day + 1000 }], after: { cloud: 99 } });
    });
    expect(state.loaded).toBe(false); expect(state.rows).toEqual([]);
    await act(async () => jest.advanceTimersByTimeAsync(1));
    expect(read).toHaveBeenCalledTimes(2); expect(state.loaded).toBe(true);
    expect(state.rows.map(row => row.id)).toEqual([2]);
    expect(read.mock.calls[1][0].after).toEqual({});
  } finally { if (renderer) await act(async () => renderer.unmount()); jest.useRealTimers(); }
});

test('a completed publication wakes only the current owner, dog and day while the replaced reader is still pending', async () => {
  jest.useFakeTimers(); let renderer, state;
  const old = late();
  const ledger = { scope: {}, owner: 'a', generation: 1, publishedPending: false, publishedRevision: 0, dataRevision: 1 };
  const getter = () => ledger;
  let selectedDay = day, selectedDog = 6;
  const read = jest.fn().mockImplementationOnce(() => old.promise)
    .mockResolvedValue({ rows: [{ id: 2, time: day + 86402000 }], after: {} });
  function Probe() { state = useHistoryDayRows({ read, subject: 'dog', slaveId: selectedDog, day: selectedDay, owner: ledger.owner,
    clock: () => day + 2 * 86400000, getPublication: getter, publishedReads: true,
    publicationRevision: ledger.publishedRevision, requireFresh: true }); return null; }
  try {
    await act(async () => { renderer = Renderer.create(<Probe />); });
    ledger.owner = 'b'; ledger.scope = {}; ledger.generation++; ledger.publishedPending = true; ledger.publishedRevision++;
    selectedDay += 86400000; selectedDog = 4;
    await act(async () => renderer.update(<Probe />));
    expect(state.loaded).toBe(false); expect(state.rows).toEqual([]);
    ledger.publishedPending = false; ledger.publishedRevision++;
    await act(async () => renderer.update(<Probe />));
    await act(async () => jest.advanceTimersByTimeAsync(1));
    expect(read).toHaveBeenCalledTimes(2);
    expect(read.mock.calls[1][0]).toMatchObject({ owner: 'b', slaveId: 4, start: selectedDay, after: {} });
    expect(state.rows.map(row => row.id)).toEqual([2]);
    await act(async () => old.resolve({ rows: [{ id: 99, time: day + 1000 }], after: { cloud: 99 } }));
    await act(async () => jest.advanceTimersByTimeAsync(1));
    expect(read).toHaveBeenCalledTimes(2); expect(state.rows.map(row => row.id)).toEqual([2]);
  } finally { if (renderer) await act(async () => renderer.unmount()); jest.useRealTimers(); }
});
