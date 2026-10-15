import fs from 'fs';
import path from 'path';
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { AppState } from 'react-native';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { latestArchiveRest, cloudEvent } from '../__fixtures__/LatestArchiveRest';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { createDogDataStore } from '../src/database/DogDataStore';
import { useTrackingSession } from '../src/app/useTrackingSession';
import { useAppCloudSync } from '../src/app/useAppCloudSync';
import { useAppCloudDogs } from '../src/app/useAppCloudDogs';
import { useDeleteDogData } from '../src/settings/DeleteDogData';
import { latestMapApplied, mapDownloadBusy } from '../src/cloud/CloudPublication';
import { launchScreen } from '../src/app/Launch';
import { t } from '../src/i18n';
const NOW = Date.parse('2026-10-10T12:00:00Z'), owner = 'invented-owner';
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };
let archive, latest, local, native, real, database, factory, clientFactory, network, renderer, tracking, sync, dogs, deletion, restarted, info, oldAppState;
const auth = { reportAuthFailure: jest.fn(), isDiscarded: () => false };
function Harness() {
  tracking = useTrackingSession(factory);
  // This is the actual hook binding used by TrackerApp, including its actual
  // useCloudSync scheduler, auth restore, session command facade and map ACK.
  sync = useAppCloudSync(tracking, auth, clientFactory);
  dogs = useAppCloudDogs(tracking, sync, { active: tracking.foreground });
  deletion = useDeleteDogData({ countUnsent: tracking.countUnsentUploads, deleteAll: tracking.deleteDogData,
    onDeleted: () => { restarted++; } });
  return null;
}
const advance = async n => { await act(async () => jest.advanceTimersByTimeAsync(n)); };
const applied = () => info.mock.calls.filter(([tag]) => tag === '[CloudSync] latest-applied');
beforeEach(async () => {
  jest.useFakeTimers(); jest.setSystemTime(NOW); restarted = 0; tracking = sync = dogs = null;
  oldAppState = AppState.currentState; AppState.currentState = 'active';
  info = jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
  archive = createMemoryConnection(); latest = createMemoryConnection();
  real = createDogDatabase(archive); await real.initialize(); archive.executeAsync.mockClear();
  local = deferred(); native = deferred();
  const execute = latest.executeAsync.getMockImplementation(); let held = false;
  latest.executeAsync.mockImplementation(async (...args) => {
    if (!held) { held = true; await native.promise; }
    return execute(...args);
  });
  database = createCloudDatabase(archive, { latestConnection: latest });
  const initialize = real.initialize;
  const databases = { real: { ...real, initialize: () => local.promise.then(initialize) }, cloud: database,
    dogData: createDogDataStore(archive, database),
    settings: { initialize: async () => {}, load: async () => ({ mode: 'real' }), save: async () => {} }, close: jest.fn() };
  factory = () => databases; factory.latestStorageIsolated = true;
  network = latestArchiveRest({ events: [cloudEvent(1, NOW - 1000)] });
  network.client.auth = { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: jest.fn() } } }),
    getSession: async () => ({ data: { session: { user: { id: owner } } } }),
    startAutoRefresh: jest.fn(), stopAutoRefresh: jest.fn() };
  clientFactory = () => network.client;
});
afterEach(async () => {
  native.resolve(); local.resolve();
  await act(async () => { renderer?.unmount(); await jest.advanceTimersByTimeAsync(1); });
  archive.close(); latest.close(); jest.restoreAllMocks(); AppState.currentState = oldAppState; jest.useRealTimers();
});
async function mount() { await act(async () => { renderer = Renderer.create(<Harness />); }); await advance(1); }

test('real App binding starts latest HTTP and durable map ACK before local migration or first local snapshot completes', async () => {
  // Guard the actual TrackerApp callsite too; a passing isolated hook test alone
  // must not hide the original tracking.ready.real admission in App.js.
  const app = fs.readFileSync(path.join(__dirname, '../App.js'), 'utf8');
  expect(app).toContain('const cloudSync = useAppCloudSync(tracking, auth);');
  expect(app).toContain('const cloudDogs = useAppCloudDogs(tracking, cloudSync, {');
  expect(app).toContain('databaseReady: tracking.ready.real,');
  await mount();
  expect(tracking.cloudReady).toBe(true); expect(tracking.ready.real).toBe(false);
  expect(tracking.initialSnapshotReady).toBe(false); expect(applied()).toEqual([]);
  expect(sync).toMatchObject({ mapAttempt: 1, busy: true, snapshotPending: false });
  expect(network.calls.some(call => call.phase === 'masters')).toBe(true);
  expect(network.calls.some(call => ['packet', 'fix'].includes(call.phase))).toBe(true);
  native.resolve(); await advance(1);
  expect(applied()).toHaveLength(1);
  expect(latestMapApplied(sync, owner, dogs)).toBe(true);
  expect((await database.readLatestSnapshot(owner, { positionsOnly: true })).verified).toBe(true);
  expect(tracking.ready.real).toBe(false); expect(tracking.initialSnapshotReady).toBe(false);
  expect(archive.executeAsync.mock.calls).toEqual([]);
  expect(launchScreen({ databaseReady: tracking.ready.real, preferencesSettled: true, authSettled: true })).toBe('splash');
  // The archive cannot initialize on the strength of cloud ACK alone.
  expect(archive.executeAsync.mock.calls.some(([sql]) => sql === 'PRAGMA table_info(supabase_dog_status)')).toBe(false);
  local.resolve(); await advance(1);
  expect(tracking.ready.real).toBe(true); expect(tracking.initialSnapshotReady).toBe(true);
});

test('local initialization failure does not fabricate local readiness while the independently committed cloud map ACK remains truthful', async () => {
  await mount(); native.resolve(); await advance(1);
  local.reject(new Error('invented local schema failure')); await advance(1);
  expect(applied()).toHaveLength(1); expect(latestMapApplied(sync, owner, dogs)).toBe(true);
  expect(tracking.ready.real).toBe(false); expect(tracking.initialSnapshotReady).toBe(false);
  expect(tracking.errors.real).toContain('invented local schema failure');
  expect(tracking.cloudReady).toBe(true);
});

test('ordinary resume accepts a new independent latest while local initialization is pending and does not start BLE/hold/context reads', async () => {
  await mount(); native.resolve(); await advance(1);
  expect(applied()).toHaveLength(1);
  const before = dogs.acceptedReadback;
  const change = state => AppState.addEventListener.mock.calls.filter(([name]) => name === 'change').forEach(([, listener]) => listener(state));
  await act(async () => { change('background'); await jest.advanceTimersByTimeAsync(5); });
  await act(async () => { change('active'); await jest.advanceTimersByTimeAsync(1); });
  expect(tracking.ready.real).toBe(false);
  expect(tracking.initialSnapshotReady).toBe(false);
  expect(applied()).toHaveLength(2);
  expect(dogs.acceptedReadback).not.toBe(before);
  expect(sync.getMapPublication().acknowledgeMapRead(before)).toBe(false);
  expect(latestMapApplied(sync, owner, dogs)).toBe(true);
  expect(archive.executeAsync.mock.calls).toEqual([]);
  local.resolve(); await advance(1);
  expect(tracking.ready.real).toBe(true);
  expect(tracking.initialSnapshotReady).toBe(true);
  expect(applied()).toHaveLength(2);
  expect(latestMapApplied(sync, owner, dogs)).toBe(true);
});

test('real engine and S7 failure/cancel clear update indicators but keep deletion fenced; retry succeeds for App restart', async () => {
  local.resolve(); native.resolve(); await mount(); await advance(1);
  expect(applied()).toHaveLength(1);
  archive.sqlite.exec(`INSERT INTO supabase_dog_status(received_at,slave_id) VALUES(1000,6);
    CREATE TRIGGER refuse_delete BEFORE DELETE ON supabase_dog_status
      BEGIN SELECT RAISE(ABORT,'invented delete failure'); END`);
  await act(async () => deletion.start()); await act(async () => deletion.confirm());
  expect(deletion.dialog.visible).toBe(true); expect(restarted).toBe(0);
  expect(sync).toMatchObject({ error: t('c1275'), mapPending: false, snapshotPending: false });
  expect(mapDownloadBusy(sync)).toBe(false); expect(sync.catchUp.phase).toBe('failed');
  act(() => deletion.cancel()); expect(deletion.dialog.visible).toBe(false);
  await advance(30000);
  expect(applied()).toHaveLength(1); expect(sync.snapshotPending).toBe(false);
  await expect(database.readLatestSnapshot(owner)).rejects.toThrow(t('c1275'));
  archive.sqlite.exec('DROP TRIGGER refuse_delete');
  await act(async () => deletion.start()); await act(async () => deletion.confirm());
  expect(restarted).toBe(1); expect(deletion.dialog.visible).toBe(false);
  const marker = latest.sqlite.prepare('SELECT deletion_pending FROM cloud_latest_lifecycle').get();
  expect(marker.deletion_pending).toBe(0);
});
