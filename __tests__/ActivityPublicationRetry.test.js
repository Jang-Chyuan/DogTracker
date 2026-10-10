import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { createCloudSync } from '../src/cloud/CloudSync';
import { useActivityView } from '../src/activity/useActivityView';

const day = new Date(2026, 9, 9).getTime();
const now = day + 86400000 + 12 * 3600000;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('past activity retries a discarded read after foreground generation changes even if offline publication never advances', async () => {
  jest.useFakeTimers();
  const first = deferred();
  const sync = createCloudSync({ client: { from: () => { throw new Error('offline'); } }, database: {}, now: () => now });
  sync.setSession({ user: { id: 'owner-a' } });
  sync.setForeground(true);
  const getter = () => sync.mapPublication();
  const readEarliest = jest.fn().mockImplementationOnce(() => first.promise).mockResolvedValue(day);
  const read = jest.fn(async () => ({ local: [], cloud: [{ time: day + 60000, activity: 0.4, activity_valid: 1, slave_id: 6 }] }));
  let renderer, value;
  function Probe() {
    value = useActivityView({ read, readEarliest, slaveId: 6, mode: 'day', date: day, now,
      owner: 'owner-a', getPublication: getter, publishedReads: true, revision: getter().publishedRevision });
    return null;
  }
  try {
    await act(async () => { renderer = Renderer.create(<Probe />); });
    expect(readEarliest).toHaveBeenCalledTimes(1);
    const revision = getter().publishedRevision;
    sync.setForeground(false);
    sync.setForeground(true);
    await act(async () => { renderer.update(<Probe />); first.resolve(day); });
    expect(getter().publishedRevision).toBe(revision);
    expect(read).not.toHaveBeenCalled(); // the old-generation read must not publish
    await act(async () => jest.advanceTimersByTimeAsync(15000));
    expect(value.status).toBe('ready');
    expect(value.view).not.toBeNull();
    expect(readEarliest).toHaveBeenCalledTimes(2);
    expect(getter().publishedRevision).toBe(revision);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    await sync.dispose();
    jest.clearAllTimers();
    jest.restoreAllMocks();
    jest.useRealTimers();
  }
});

const ledger = () => ({ scope: {}, owner: 'owner-a', generation: 1, publishedRevision: 0, publishedPending: false });
const answer = value => ({ local: [], cloud: [{ time: day + 60000, activity: value, activity_valid: 1, slave_id: 6 }] });

test('closed publication never reads partial values and retries without polling an accepted period', async () => {
  jest.useFakeTimers();
  const timeout = jest.spyOn(global, 'setTimeout');
  const publication = ledger();
  const getPublication = () => publication;
  const readEarliest = jest.fn(async () => day), read = jest.fn(async () => answer(0.4));
  let renderer, value;
  function Probe({ revision = 0 }) {
    value = useActivityView({ read, readEarliest, slaveId: 6, mode: 'day', date: day, now,
      owner: 'owner-a', getPublication, publishedReads: true, revision });
    return null;
  }
  try {
    await act(async () => { renderer = Renderer.create(<Probe />); });
    expect(value.status).toBe('ready');
    expect(timeout.mock.calls.filter(call => call[1] === 15000)).toHaveLength(0);
    await act(async () => jest.advanceTimersByTimeAsync(60000));
    expect(read).toHaveBeenCalledTimes(1);
    publication.publishedPending = true; publication.publishedRevision = 1;
    read.mockResolvedValue(answer(0.9));
    await act(async () => renderer.update(<Probe revision={1} />));
    await act(async () => jest.advanceTimersByTimeAsync(30000));
    expect(read).toHaveBeenCalledTimes(1);
    expect(value.view.points.find(p => p.minute === day + 60000).value).toBe(0.4);
    publication.publishedPending = false; publication.publishedRevision = 2;
    // Deliberately no React revision notification: bounded retry uses the live getter.
    await act(async () => jest.advanceTimersByTimeAsync(15000));
    expect(value.view.points.find(p => p.minute === day + 60000).value).toBe(0.9);
    expect(read).toHaveBeenCalledTimes(2);
    const retries = timeout.mock.calls.filter(call => call[1] === 15000).length;
    await act(async () => jest.advanceTimersByTimeAsync(60000));
    expect(read).toHaveBeenCalledTimes(2);
    expect(timeout.mock.calls.filter(call => call[1] === 15000)).toHaveLength(retries);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    jest.restoreAllMocks();
    jest.useRealTimers();
  }
});

test('unmount cancels a closed-fence retry before it can read another scope', async () => {
  jest.useFakeTimers();
  const timeout = jest.spyOn(global, 'setTimeout');
  const clear = jest.spyOn(global, 'clearTimeout');
  const publication = { ...ledger(), publishedPending: true };
  const getter = () => publication;
  const readEarliest = jest.fn(async () => day), read = jest.fn(async () => answer(0.4));
  let renderer;
  function Probe() {
    useActivityView({ read, readEarliest, slaveId: 6, mode: 'day', date: day, now,
      owner: 'owner-a', getPublication: getter, publishedReads: true });
    return null;
  }
  try {
    await act(async () => { renderer = Renderer.create(<Probe />); });
    const retryIndex = timeout.mock.calls.findIndex(call => call[1] === 15000);
    expect(retryIndex).toBeGreaterThanOrEqual(0);
    const retryId = timeout.mock.results[retryIndex].value;
    await act(async () => renderer.unmount()); renderer = null;
    expect(clear).toHaveBeenCalledWith(retryId);
    publication.owner = 'owner-b'; publication.publishedPending = false;
    await act(async () => jest.advanceTimersByTimeAsync(60000));
    expect(readEarliest).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    jest.restoreAllMocks();
    jest.useRealTimers();
  }
});
