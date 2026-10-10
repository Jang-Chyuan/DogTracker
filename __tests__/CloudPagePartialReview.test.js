// Actual page reader regressions: page writes are not a completed publication.
import React, { useState } from 'react';
import Renderer, { act } from 'react-test-renderer';
import { useActivityView } from '../src/activity/useActivityView';
import { useHistoryDayRows } from '../src/mapHistory/useHistoryScreen';
import { captureMapRead } from '../src/cloud/CloudPublication';
import { useHistoryCloud } from '../src/mapHistory/useHistoryCloud';

const MINUTE = 60000;
const day = new Date(2026, 9, 9).getTime();
const now = day + 12 * 60 * MINUTE;
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

test.each(['busy', 'failed'])('activity retains its accepted complete values after an auto %s partial batch', async phase => {
  let state, renderer, value = 0.2;
  const time = now - 10 * MINUTE;
  const ledger = { scope: {}, generation: 1, attempt: 0, owner: 'owner-a', pending: false, busy: false, mapSuccessRevision: 1 };
  const getPublication = () => ledger;
  const read = jest.fn(async () => ({ local: [], cloud: [{ time, activity: value, activity_valid: 1, slave_id: 6, master_id: 7 }] }));
  const readEarliest = jest.fn(async () => time);
  function Probe({ clock }) {
    // Mirrors the real reader path: MapScreen binds activityPeriod(owner),
    // which sees already-written pages. Neither hook input consumes ledger.
    state = useActivityView({ read, readEarliest, slaveId: 6, mode: 'day', date: day, now: clock, owner: 'owner-a', getPublication, revision: ledger.mapSuccessRevision });
    return null;
  }
  try {
    await act(async () => { renderer = Renderer.create(<Probe clock={now} />); });
    expect(state.view.points.find(p => p.minute === time).value).toBe(0.2);
    // A download writer has committed one page, but not its complete pass.
    ledger.pending = true;
    value = 0.9;
    if (phase === 'failed') ledger.error = 'download failed';
    await act(async () => { renderer.update(<Probe clock={now + MINUTE} />); });
    expect(read).toHaveBeenCalledTimes(1);
    expect(ledger.mapSuccessRevision).toBe(1);
    expect(state.view.points.find(p => p.minute === time).value).toBe(0.2);
  } finally { if (renderer) await act(async () => renderer.unmount()); }
});

test.each(['busy', 'failed', 'cancelled'])('history retains accepted rows after a manual %s partial batch', async phase => {
  jest.useFakeTimers();
  let renderer, rowsState, history;
  const work = deferred();
  let stored = [{ id: 1, time: now - MINUTE, source: 'cloud' }];
  const read = jest.fn(async ({ after }) => ({ rows: stored.filter(row => row.id > (after.cloud ?? 0)),
    after: { cloud: stored.at(-1).id }, seed: [] }));
  const cloud = { download: jest.fn(() => work.promise), downloadStates: async () => [] };
  const local = ['2026-10-09'];
  const clock = () => now;
  const ledger = { scope: {}, generation: 1, attempt: 0, owner: 'owner-a', pending: false, busy: false, mapSuccessRevision: 1 };
  const getPublication = () => ledger;
  function Probe() {
    const [revision, setRevision] = useState(0);
    rowsState = useHistoryDayRows({ read, subject: 'dog', slaveId: 6, day, owner: 'owner-a', clock, revision, getPublication });
    history = useHistoryCloud({ cloud, slaveId: 6, scope: 'partial-review-owner-a', todayKey: local[0], local });
    return <button onClick={() => history.startDownload(local[0], () => setRevision(r => r + 1))} />;
  }
  try {
    await act(async () => { renderer = Renderer.create(<Probe />); });
    expect(rowsState.rows.map(row => row.id)).toEqual([1]);
    await act(async () => renderer.root.findByType('button').props.onClick());
    ledger.pending = true; ledger.attempt += 1;
    stored = [...stored, { id: 2, time: now, source: 'cloud' }];
    if (phase === 'cancelled') await act(async () => { history.cancelDownload(); work.reject(new Error('cancelled')); });
    else if (phase === 'failed') await act(async () => work.reject(new Error('page two failed')));
    else await act(async () => jest.advanceTimersByTimeAsync(15000));
    expect(history.download.status).toBe(phase === 'busy' ? 'downloading' : phase);
    expect(history.knowledge.incomplete).toContain(local[0]);
    expect(rowsState.rows.map(row => row.id)).toEqual([1]);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    jest.useRealTimers();
  }
});

test('activity rejects a late answer from a replaced account reader', async () => {
  let state, renderer;
  const old = deferred();
  const time = now - MINUTE;
  const earliest = async () => time;
  const readerA = () => old.promise;
  const readerB = async () => ({ local: [], cloud: [{ time, activity: 0.4, activity_valid: 1, slave_id: 6 }] });
  function Probe({ read }) { state = useActivityView({ read, readEarliest: earliest, slaveId: 6, mode: 'day', date: day, now }); return null; }
  try {
    await act(async () => { renderer = Renderer.create(<Probe read={readerA} />); });
    await act(async () => renderer.update(<Probe read={readerB} />));
    await act(async () => old.resolve({ local: [], cloud: [{ time, activity: 0.9, activity_valid: 1, slave_id: 6 }] }));
    expect(state.view.points.find(p => p.minute === time).value).toBe(0.4);
  } finally { if (renderer) await act(async () => renderer.unmount()); }
});

test('a completed published manual window is readable after auto failure without releasing live map quarantine', async () => {
  let renderer, state, rows = [{ id: 1, time: now }];
  const ledger = { scope: {}, generation: 1, attempt: 3, owner: 'owner-a', pending: false, busy: false, mapSuccessRevision: 1 };
  const getPublication = () => ledger;
  const read = jest.fn(async () => ({ rows, after: {}, seed: [] }));
  function Probe({ complete, revision }) {
    state = useHistoryDayRows({ read, subject: 'dog', slaveId: 6, day, owner: 'owner-a', clock: () => now,
      getPublication, completedWindow: complete, publishedReads: true, revision });
    return null;
  }
  try {
    await act(async () => { renderer = Renderer.create(<Probe complete={false} revision={0} />); });
    ledger.pending = true; ledger.attempt++;
    rows = [{ id: 2, time: now }];
    await act(async () => renderer.update(<Probe complete={false} revision={1} />));
    expect(state.rows.map(row => row.id)).toEqual([1]);
    await act(async () => renderer.update(<Probe complete revision={2} />));
    expect(state.rows.map(row => row.id)).toEqual([2]);
    expect(ledger.pending).toBe(true);
    expect(ledger.mapSuccessRevision).toBe(1);
    expect(captureMapRead(getPublication, 'owner-a', 1).open).toBe(false);
  } finally { if (renderer) await act(async () => renderer.unmount()); }
});

test('history rejects an answer if a complete download starts and fails without a React busy render', async () => {
  let renderer, state;
  const late = deferred();
  const ledger = { scope: {}, generation: 1, attempt: 0, owner: 'owner-a', pending: false, busy: false, mapSuccessRevision: 1 };
  const getPublication = () => ledger;
  function Probe() {
    state = useHistoryDayRows({ read: () => late.promise, subject: 'dog', slaveId: 6, day, owner: 'owner-a', clock: () => now, getPublication });
    return null;
  }
  try {
    await act(async () => { renderer = Renderer.create(<Probe />); });
    ledger.attempt++; ledger.pending = true;
    await act(async () => late.resolve({ rows: [{ id: 99, time: now }], after: {}, seed: [] }));
    expect(state.rows).toEqual([]);
    expect(state.loaded).toBe(false);
  } finally { if (renderer) await act(async () => renderer.unmount()); }
});

test('signed-out local history and initial complete zero-row reads remain available', async () => {
  let renderer, state;
  const read = jest.fn(async () => ({ rows: [], after: {}, seed: [] }));
  const getPublication = () => ({ owner: 'old-owner', pending: true, mapSuccessRevision: 0 });
  function Probe() {
    state = useHistoryDayRows({ read, subject: 'dog', slaveId: 6, day, owner: null, clock: () => now,
      getPublication });
    return null;
  }
  try {
    await act(async () => { renderer = Renderer.create(<Probe />); });
    expect(read).toHaveBeenCalledTimes(1);
    expect(state.loaded).toBe(true);
    expect(state.rows).toEqual([]);
  } finally { if (renderer) await act(async () => renderer.unmount()); }
});

test('activity keeps its accepted view on read failure and replaces it on successful retry', async () => {
  let renderer, state, fail = false;
  const time = now - MINUTE;
  const read = jest.fn(async () => {
    if (fail) throw new Error('read failed');
    return { local: [{ time, activity: read.mock.calls.length === 1 ? 0.2 : 0.8, activity_valid: 1, slave_id: 6 }], cloud: [] };
  });
  const readEarliest = async () => time;
  function Probe({ clock }) { state = useActivityView({ read, readEarliest, slaveId: 6, mode: 'day', date: day, now: clock }); return null; }
  try {
    await act(async () => { renderer = Renderer.create(<Probe clock={now} />); });
    fail = true;
    await act(async () => renderer.update(<Probe clock={now + MINUTE} />));
    expect(state.status).toBe('error');
    expect(state.view.points.find(p => p.minute === time).value).toBe(0.2);
    fail = false;
    await act(async () => state.retry());
    expect(state.status).toBe('ready');
    expect(state.view.points.find(p => p.minute === time).value).toBe(0.8);
  } finally { if (renderer) await act(async () => renderer.unmount()); }
});

test('cold history reads only published cache during a pending download, then holds it across partial writes', async () => {
  jest.useFakeTimers();
  let renderer, state, rows = [{ id: 1, time: now }];
  const ledger = { scope: {}, generation: 1, attempt: 1, owner: 'owner-a', pending: true, busy: true, mapSuccessRevision: 0 };
  const getPublication = () => ledger;
  const read = jest.fn(async () => ({ rows, after: {}, seed: [] }));
  function Probe() {
    state = useHistoryDayRows({ read, subject: 'dog', slaveId: 6, day, owner: 'owner-a', clock: () => now,
      getPublication, publishedReads: true });
    return null;
  }
  try {
    await act(async () => { renderer = Renderer.create(<Probe />); });
    expect(state.rows.map(row => row.id)).toEqual([1]);
    rows = [{ id: 2, time: now }];
    await act(async () => jest.advanceTimersByTimeAsync(15000));
    expect(state.rows.map(row => row.id)).toEqual([1]);
    expect(read).toHaveBeenCalledTimes(1);
  } finally { if (renderer) await act(async () => renderer.unmount()); jest.useRealTimers(); }
});

test('cold activity displays published cache while the initial auto pass is pending', async () => {
  let renderer, state;
  const time = now - MINUTE;
  const ledger = { scope: {}, generation: 1, attempt: 1, owner: 'owner-a', pending: true, busy: true, mapSuccessRevision: 0 };
  const getPublication = () => ledger;
  const read = async () => ({ local: [], cloud: [{ time, activity: 0.3, activity_valid: 1, slave_id: 6 }] });
  const readEarliest = async () => time;
  function Probe() {
    state = useActivityView({ read, readEarliest, slaveId: 6, mode: 'day', date: day, now,
      owner: 'owner-a', getPublication, publishedReads: true });
    return null;
  }
  try {
    await act(async () => { renderer = Renderer.create(<Probe />); });
    expect(state.status).toBe('ready');
    expect(state.view.points.find(p => p.minute === time).value).toBe(0.3);
    expect(ledger.mapSuccessRevision).toBe(0);
  } finally { if (renderer) await act(async () => renderer.unmount()); }
});
