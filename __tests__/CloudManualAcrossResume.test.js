// Follow-ups to audit B (2026-10-15) in the independent cloud sync:
// - F10: a leave/return of the app and 重試 on the catch-up pill bump the
//   sync generation; a manual history download in progress used to be
//   aborted by it and lose what it had downloaded. It now belongs to the
//   account's lineage: it keeps going, and an account switch still ends it.
// - F12: a failed attempt no longer replaces an archive pass an earlier
//   success queued.
// - F11: a native latest-store call that never answers ends with the
//   attempt's 120 s timeout instead of holding every later attempt.
import React, { useState } from 'react';
import Renderer, { act } from 'react-test-renderer';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { latestArchiveRest, cloudEvent } from '../__fixtures__/LatestArchiveRest';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { createCloudSync } from '../src/cloud/CloudSync';
import { useCloudDogs } from '../src/cloud/useCloudDogs';
import { completedMapRevision, mapDownloadBusy, mapReadRevision } from '../src/cloud/CloudPublication';
import { t } from '../src/i18n';

const NOW = Date.parse('2026-10-10T12:00:00Z');
const OWNER = 'invented-owner';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
let archive, latest, database, engine, screen, update, current, events, info, network, failing, release;

function Harness() {
  const [state, setState] = useState({ latestFirst: true }); update = setState;
  useCloudDogs(database, OWNER, true, Date.now, null,
    { latestFirst: true, active: current?.foreground ?? true, cloudBusy: mapDownloadBusy(state),
      cloudSuccess: completedMapRevision(state), revision: mapReadRevision(state), getMapPublication: () => engine.mapPublication() });
  return null;
}

beforeEach(async () => {
  jest.useFakeTimers(); jest.setSystemTime(NOW); update = current = screen = null; failing = false;
  archive = createMemoryConnection(); latest = createMemoryConnection(); await createDogDatabase(archive).initialize();
  database = createCloudDatabase(archive, { latestConnection: latest }); events = [cloudEvent(1, NOW - 1000)];
  info = jest.spyOn(console, 'info').mockImplementation(() => {});
  network = latestArchiveRest({ events, beforeRead: async call => {
    if (failing && call.phase === 'masters') throw new TypeError('Network request failed');
  } });
  engine = createCloudSync({ client: network.client, database,
    downloadContext: async () => { throw new Error('optional context unavailable'); },
    onChange: value => { current = value; update?.(value); } });
});
afterEach(async () => {
  release?.(); release = null;
  await act(async () => { screen?.unmount(); update = null; await jest.advanceTimersByTimeAsync(1); await engine.dispose(); });
  archive.close(); latest.close(); info.mockRestore(); jest.useRealTimers();
});
async function start() {
  await act(async () => { screen = Renderer.create(<Harness />); });
  await act(async () => { engine.setSession({ user: { id: OWNER } }); engine.setForeground(true); await jest.advanceTimersByTimeAsync(1); });
}
const logged = tag => info.mock.calls.filter(([name]) => name === `[CloudSync] ${tag}`);

test('a manual download keeps its lease and publishes across a leave/return and 重試', async () => {
  await start();
  const held = deferred(); release = held.resolve;
  const manualPublished = [];
  const original = database.publishDownload;
  database.publishDownload = async (...args) => { if (args[1] === 'manual') manualPublished.push(args); return original(...args); };
  let lease, scoped, manual;
  await act(async () => {
    manual = engine.runManual(async (leaseCurrent, publishScoped) => {
      lease = leaseCurrent;
      await held.promise;
      scoped = await publishScoped(async () => ({ dataRevision: 4 }));
      return 9;
    });
    await jest.advanceTimersByTimeAsync(1);
  });
  expect(lease()).toBe(true);
  // A share sheet, a permission dialog, the home button.
  await act(async () => { engine.setForeground(false); await jest.advanceTimersByTimeAsync(1000); });
  expect(lease()).toBe(true);
  expect(current.mode).toBe('manual');
  // Back with no network: the catch-up fails, and 重試 bumps the generation.
  failing = true;
  const before = engine.historyPublication();
  await act(async () => { engine.setForeground(true); await jest.advanceTimersByTimeAsync(1); });
  expect(current.catchUp.phase).toBe('failed');
  failing = false;
  await act(async () => { engine.retry(); await jest.advanceTimersByTimeAsync(1); });
  expect(engine.historyPublication().generation).not.toBe(before.generation);
  expect(engine.historyPublication().lineage).toBe(before.lineage);
  expect(current.catchUp.phase).toBe('idle');
  expect(lease()).toBe(true);
  held.resolve();
  await act(async () => { expect(await manual).toBe(9); await jest.advanceTimersByTimeAsync(1); });
  expect(scoped).toEqual({ dataRevision: 4 });
  expect(manualPublished).toHaveLength(1);
  // The publication's own lease, checked in the native lock, holds too.
  expect(manualPublished[0][3]()).toBe(true);
  expect(current.mode).toBeNull();
  database.publishDownload = original;
});

test('an account switch during a manual download still ends its lease and refuses its publication', async () => {
  await start();
  const held = deferred(); release = held.resolve;
  let lease, manual;
  await act(async () => {
    manual = engine.runManual(async (leaseCurrent, publishScoped) => {
      lease = leaseCurrent; await held.promise; await publishScoped(async () => ({}));
      return 1;
    });
    manual.catch(() => {});
    await jest.advanceTimersByTimeAsync(1);
  });
  await act(async () => { engine.setForeground(false); engine.setForeground(true); await jest.advanceTimersByTimeAsync(1); });
  expect(lease()).toBe(true);
  await act(async () => { engine.setSession({ user: { id: 'another-invented-owner' } }); await jest.advanceTimersByTimeAsync(1); });
  expect(lease()).toBe(false);
  held.resolve();
  await act(async () => { await expect(manual).rejects.toThrow(); await jest.advanceTimersByTimeAsync(1); });
});

test('a failed attempt keeps the archive pass an earlier success queued behind a manual download', async () => {
  await start();
  await act(async () => jest.advanceTimersByTimeAsync(1000));
  const published = logged('archive-published').length;
  const held = deferred(); release = held.resolve;
  let manual;
  await act(async () => { manual = engine.runManual(async () => { await held.promise; return 0; }); await jest.advanceTimersByTimeAsync(1); });
  // A success while the manual download holds the archive lane queues its pass.
  events.push(cloudEvent(2, NOW + 29000));
  await act(async () => jest.advanceTimersByTimeAsync(30000));
  expect(current.error).toBe('');
  // The next attempt fails (no network): its offline proof must not replace it.
  failing = true;
  await act(async () => jest.advanceTimersByTimeAsync(30000));
  expect(current.offline).toBe(true);
  failing = false;
  held.resolve();
  await act(async () => { await manual; await jest.advanceTimersByTimeAsync(1000); });
  // The queued pass ran at once (before the next 30 s attempt).
  expect(logged('archive-published').length).toBe(published + 1);
});

test('a native latest call that never answers ends with the attempt timeout; the next attempt runs', async () => {
  await start();
  const attempt = current.mapAttempt;
  const original = database.initializeLatest;
  let hung = 0;
  database.initializeLatest = () => { hung++; return new Promise(() => {}); };
  await act(async () => jest.advanceTimersByTimeAsync(30000));
  expect(hung).toBe(1);
  expect(current.mapAttempt).toBe(attempt + 1);
  await act(async () => jest.advanceTimersByTimeAsync(120000));
  expect(current.error).toBe(t('c587'));
  expect(current.busy).toBe(false);
  database.initializeLatest = original;
  await act(async () => jest.advanceTimersByTimeAsync(30000));
  expect(current.mapAttempt).toBeGreaterThan(attempt + 1);
  expect(current.error).toBe('');
});
