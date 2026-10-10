import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { useHistoryCloud } from '../src/mapHistory/useHistoryCloud';
import { dayState } from '../src/history/screen/HistoryCalendar';

const day = '2026-10-09';
test('a pre-download completeness read cannot erase a cancelled cloud-only day needing retry', async () => {
  let resolveStates, rejectDownload, state, renderer;
  const states = new Promise(resolve => { resolveStates = resolve; });
  const pendingDownload = new Promise((_, reject) => { rejectDownload = reject; });
  const cloud = { downloadStates: jest.fn(() => states), download: jest.fn(() => pendingDownload) };
  const seed = { cloud: [day], checked: [day] };
  const local = [];
  function Probe() {
    state = useHistoryCloud({ cloud, slaveId: 6, scope: 'manual-cancel-stale-read', todayKey: day, local, seed });
    return null;
  }
  try {
    await act(async () => { renderer = Renderer.create(<Probe />); });
    await act(async () => state.startDownload(day));
    expect(cloud.download).toHaveBeenCalledTimes(1);
    await act(async () => state.cancelDownload());
    expect(state.download.status).toBe('cancelled');
    expect(dayState(day, day, state.knowledge)).toBe('partial');
    await act(async () => resolveStates([]));
    expect(dayState(day, day, state.knowledge)).toBe('partial');
  } finally {
    await act(async () => { rejectDownload(new Error('cancelled')); renderer?.unmount(); });
  }
});

test('a pre-retry incomplete snapshot cannot turn a newly published day back into partial', async () => {
  let resolveStates, state, renderer;
  const pendingStates = new Promise(resolve => { resolveStates = resolve; });
  const complete = [{ slave_id: 6, day, complete: 1 }];
  const cloud = {
    downloadStates: jest.fn().mockReturnValueOnce(pendingStates).mockResolvedValue(complete),
    download: jest.fn(async ({ onDogEnd }) => onDogEnd(6, 'done')),
  };
  const local = [day];
  function Probe() {
    state = useHistoryCloud({ cloud, slaveId: 6, scope: 'manual-complete-stale-read', todayKey: day, local });
    return null;
  }
  try {
    await act(async () => { renderer = Renderer.create(<Probe />); });
    await act(async () => state.startDownload(day));
    expect(state.download.status).toBe('done');
    expect(dayState(day, day, state.knowledge)).toBe('local');
    await act(async () => resolveStates([{ slave_id: 6, day, complete: 0 }]));
    expect(dayState(day, day, state.knowledge)).toBe('local');
    // A fresh post-operation durable read is still accepted.
    await act(async () => state.retryCompleteness());
    expect(cloud.downloadStates).toHaveBeenCalledTimes(2);
    expect(dayState(day, day, state.knowledge)).toBe('local');
  } finally { await act(async () => renderer?.unmount()); }
});

test('a pre-download completeness error cannot mark a newly completed day partial', async () => {
  let rejectStates, state, renderer;
  const pendingStates = new Promise((_, reject) => { rejectStates = reject; });
  const cloud = {
    downloadStates: jest.fn(() => pendingStates),
    download: jest.fn(async ({ onDogEnd }) => onDogEnd(6, 'done')),
  };
  const local = [day];
  function Probe() {
    state = useHistoryCloud({ cloud, slaveId: 6, scope: 'manual-complete-stale-error', todayKey: day, local });
    return null;
  }
  try {
    await act(async () => { renderer = Renderer.create(<Probe />); });
    await act(async () => state.startDownload(day));
    expect(dayState(day, day, state.knowledge)).toBe('local');
    await act(async () => rejectStates(new Error('old read failed')));
    expect(dayState(day, day, state.knowledge)).toBe('local');
  } finally { await act(async () => renderer?.unmount()); }
});

test.each(['resolve', 'reject'])('a late %s from the prior account and dog cannot replace the new scope', async settlement => {
  let resolveOld, rejectOld, state, renderer;
  const oldRead = new Promise((resolve, reject) => { resolveOld = resolve; rejectOld = reject; });
  const complete = [{ slave_id: 4, day, complete: 1 }];
  const cloud = { downloadStates: jest.fn().mockReturnValueOnce(oldRead).mockResolvedValue(complete) };
  const local = [day];
  function Probe({ scope, slaveId }) {
    state = useHistoryCloud({ cloud, slaveId, scope, todayKey: day, local });
    return null;
  }
  try {
    await act(async () => { renderer = Renderer.create(<Probe scope={`old-owner-${settlement}`} slaveId={6} />); });
    await act(async () => renderer.update(<Probe scope={`new-owner-${settlement}`} slaveId={4} />));
    expect(cloud.downloadStates.mock.calls.map(([args]) => args.slaveId)).toEqual([6, 4]);
    expect(dayState(day, day, state.knowledge)).toBe('local');
    await act(async () => {
      if (settlement === 'resolve') resolveOld([{ slave_id: 6, day, complete: 0 }]);
      else rejectOld(new Error('old scope read failed'));
    });
    expect(dayState(day, day, state.knowledge)).toBe('local');
    expect(state.knowledge.incomplete).toEqual([]);
  } finally { await act(async () => renderer?.unmount()); }
});

test.each(['resolve', 'reject'])('a read started during download cannot %s over its later success', async settlement => {
  let resolveStates, rejectStates, finishDownload, state, renderer;
  const pendingStates = new Promise((resolve, reject) => { resolveStates = resolve; rejectStates = reject; });
  const pendingDownload = new Promise(resolve => { finishDownload = resolve; });
  const cloud = {
    downloadStates: jest.fn().mockResolvedValueOnce([]).mockReturnValueOnce(pendingStates),
    download: jest.fn(async ({ onDogEnd }) => { await pendingDownload; onDogEnd(6, 'done'); }),
  };
  const local = [day];
  function Probe() {
    state = useHistoryCloud({ cloud, slaveId: 6, scope: `manual-mid-download-${settlement}`, todayKey: day, local });
    return null;
  }
  try {
    await act(async () => { renderer = Renderer.create(<Probe />); });
    await act(async () => state.startDownload(day));
    await act(async () => state.retryCompleteness());
    expect(state.download.status).toBe('downloading');
    await act(async () => finishDownload());
    expect(state.download.status).toBe('done');
    expect(dayState(day, day, state.knowledge)).toBe('local');
    await act(async () => {
      if (settlement === 'resolve') resolveStates([{ slave_id: 6, day, complete: 0 }]);
      else rejectStates(new Error('mid-download read failed'));
    });
    expect(dayState(day, day, state.knowledge)).toBe('local');
  } finally { await act(async () => renderer?.unmount()); }
});

test('a multi-dog completion invalidates old reads without invalidating remaining dog callbacks', async () => {
  let resolveStates, finishDownload, reportDog, state, renderer;
  const pendingStates = new Promise(resolve => { resolveStates = resolve; });
  const pendingDownload = new Promise(resolve => { finishDownload = resolve; });
  const cloud = {
    downloadStates: jest.fn().mockResolvedValueOnce([
      { slave_id: 4, day, complete: 0 }, { slave_id: 6, day, complete: 0 },
    ]).mockReturnValueOnce(pendingStates),
    download: jest.fn(async ({ onDogEnd }) => { reportDog = onDogEnd; await pendingDownload; }),
  };
  const local = [day];
  const localByDog = { 4: local, 6: local };
  const slaveId = [4, 6];
  function Probe() {
    state = useHistoryCloud({ cloud, slaveId, scope: 'manual-mid-multi-dog', todayKey: day, local, localByDog });
    return null;
  }
  try {
    await act(async () => { renderer = Renderer.create(<Probe />); });
    await act(async () => state.startDownload(day));
    expect(cloud.download.mock.calls[0][0].slaveId).toEqual([4, 6]);
    await act(async () => state.retryCompleteness());
    await act(async () => reportDog(4, 'done'));
    await act(async () => resolveStates([{ slave_id: 4, day, complete: 0 }, { slave_id: 6, day, complete: 0 }]));
    expect(state.download.status).toBe('downloading');
    expect(dayState(day, day, state.knowledge)).toBe('partial');
    expect(state.dogDownloads[4].status).toBe('done');
    await act(async () => { reportDog(6, 'done'); finishDownload(); });
    expect(state.download.status).toBe('done');
    expect(state.dogDownloads[6].status).toBe('done');
    expect(dayState(day, day, state.knowledge)).toBe('local');
  } finally { await act(async () => renderer?.unmount()); }
});

test('a read started during download cannot erase a later failure needing retry', async () => {
  let resolveStates, rejectDownload, state, renderer;
  const pendingStates = new Promise(resolve => { resolveStates = resolve; });
  const pendingDownload = new Promise((_, reject) => { rejectDownload = reject; });
  const cloud = {
    downloadStates: jest.fn().mockResolvedValueOnce([]).mockReturnValueOnce(pendingStates),
    download: jest.fn(() => pendingDownload),
  };
  const local = [day];
  function Probe() {
    state = useHistoryCloud({ cloud, slaveId: 6, scope: 'manual-mid-failure', todayKey: day, local });
    return null;
  }
  try {
    await act(async () => { renderer = Renderer.create(<Probe />); });
    await act(async () => state.startDownload(day));
    await act(async () => state.retryCompleteness());
    await act(async () => rejectDownload(new Error('download failed')));
    expect(state.download.status).toBe('failed');
    await act(async () => resolveStates([{ slave_id: 6, day, complete: 1 }]));
    expect(dayState(day, day, state.knowledge)).toBe('partial');
  } finally { await act(async () => renderer?.unmount()); }
});

test('a read resolving during a cloud-only download cannot erase its cancellation retry state', async () => {
  let finishDownload, state, renderer;
  const pendingDownload = new Promise(resolve => { finishDownload = resolve; });
  const cloud = {
    downloadStates: jest.fn().mockResolvedValue([]),
    download: jest.fn(() => pendingDownload),
  };
  const local = [];
  const seed = { cloud: [day], checked: [day] };
  function Probe() {
    state = useHistoryCloud({ cloud, slaveId: 6, scope: 'manual-cloud-read-while-pending', todayKey: day, local, seed });
    return null;
  }
  try {
    await act(async () => { renderer = Renderer.create(<Probe />); });
    await act(async () => state.startDownload(day));
    await act(async () => state.retryCompleteness());
    expect(state.download.status).toBe('downloading');
    expect(dayState(day, day, state.knowledge)).toBe('partial');
    await act(async () => state.cancelDownload());
    expect(state.download.status).toBe('cancelled');
    expect(dayState(day, day, state.knowledge)).toBe('partial');
  } finally { await act(async () => { finishDownload(); renderer?.unmount(); }); }
});
