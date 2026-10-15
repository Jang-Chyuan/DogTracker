import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { readLocationPage, deletePhoneRoutes } from '../src/locationTracker/LocationTrackerDatabase';
import { useLocationTracker } from '../src/locationTracker/useLocationTracker';
import { locationTrackerNative, startLocationTracker, stopLocationTracker } from '../src/locationTracker/LocationTrackerService';

jest.mock('../src/locationTracker/LocationTrackerService', () => ({
  locationTrackerNative: { page: jest.fn(), deleteAll: jest.fn() },
  startLocationTracker: jest.fn(), stopLocationTracker: jest.fn(),
}));

// Retention (30 days, a cap as written): __tests__/LocalRetention.test.js.
test('the newest row is the one written last, whatever its time', () => {
  const source = fs.readFileSync(path.join(__dirname, '../android/app/src/main/java/com/dogtracker/location/LocationTrackerStore.kt'), 'utf8');
  const sql = prefix => source.match(new RegExp('"(' + prefix + '[^"]+)"'))[1];
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(sql('CREATE TABLE'));
    const insert = db.prepare(sql('INSERT INTO'));
    // The first row was written while the clock ran a day ahead.
    insert.run(86_400_000 + 1, 1, 25, 121, 5, null, null, null);
    for (let i = 0; i < 1000; i += 1) insert.run(1000 + i, 1000 + i, 25, 121, 5, null, null, null);
    const newest = source.match(/fun newestLocationAt[\s\S]*?executeSql\("([^"]+)"/)[1];
    expect(db.prepare(newest).get().location_at).toBe(1999);
  } finally { db.close(); }
});

let renderer;
let state;
function Harness({ foreground = true }) {
  state = useLocationTracker(foreground);
  return null;
}
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  locationTrackerNative.page.mockResolvedValue(JSON.stringify({ rows: [], total: 0, running: false, status: '已停止記錄' }));
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  renderer = null;
  jest.useRealTimers();
});

test('page adapter limits memory to 50 rows and provides a continuation flag', async () => {
  locationTrackerNative.page.mockResolvedValueOnce(JSON.stringify({ rows: Array.from({ length: 51 }, (_, id) => ({ id })), total: 80000 }));
  const result = await readLocationPage(100);
  expect(locationTrackerNative.page).toHaveBeenCalledWith(100);
  expect(result.rows).toHaveLength(50);
  expect(result.hasMore).toBe(true);
});

test('screen polling pauses in background and unmount does not stop native tracking', async () => {
  await act(async () => { renderer = Renderer.create(<Harness />); });
  expect(locationTrackerNative.page).toHaveBeenCalledTimes(1);
  await act(async () => jest.advanceTimersByTime(10000));
  expect(locationTrackerNative.page).toHaveBeenCalledTimes(2);
  await act(async () => renderer.update(<Harness foreground={false} />));
  await act(async () => jest.advanceTimersByTime(30000));
  expect(locationTrackerNative.page).toHaveBeenCalledTimes(2);
  await act(async () => renderer.update(<Harness />));
  expect(locationTrackerNative.page).toHaveBeenCalledTimes(3);
  await act(async () => renderer.unmount());
  renderer = null;
  expect(stopLocationTracker).not.toHaveBeenCalled();
});

test('start failures are visible and repeated taps do not start duplicate services', async () => {
  let reject;
  startLocationTracker.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  await act(async () => { renderer = Renderer.create(<Harness />); });
  let pending;
  await act(async () => { pending = state.toggle(); state.toggle(); });
  expect(startLocationTracker).toHaveBeenCalledTimes(1);
  await act(async () => { reject(new Error('請允許定位權限')); await pending; });
  expect(state.error).toBe('請允許定位權限');
  expect(state.busy).toBe(false);
});

test('phone route deletion clears native rows, remembered ranges, saved addresses and exports in order', async () => {
  const { NativeModules } = require('react-native');
  const { rememberRangeFor, rememberedRange } = require('../src/history/screen/RangeMemory');
  const { addressLookup } = require('../src/placement/AddressLookup');
  // The stays' saved addresses (home too) go with the route (audit L5).
  const clear = jest.spyOn(addressLookup, 'clear').mockImplementation(async () => {
    expect(locationTrackerNative.deleteAll).toHaveBeenCalled();
  });
  rememberRangeFor('phone:today', { start: 1, end: 2 });
  NativeModules.HistoryExport = { clearExports: jest.fn(async () => {
    expect(locationTrackerNative.deleteAll).toHaveBeenCalled();
    expect(rememberedRange('phone:today')).toBeNull();
    expect(clear).toHaveBeenCalledTimes(1);
  }) };
  try {
    await deletePhoneRoutes();
    expect(NativeModules.HistoryExport.clearExports).toHaveBeenCalledTimes(1);
  } finally {
    delete NativeModules.HistoryExport;
    clear.mockRestore();
  }
});

test('native phone deletion SQL preserves dog data and metadata', () => {
  const source = fs.readFileSync(path.join(__dirname, '../android/app/src/main/java/com/dogtracker/location/LocationTrackerStore.kt'), 'utf8');
  const query = source.match(/fun deleteAll\(\)[\s\S]*?store.executeSql\("([^"]+)"/)[1];
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE myLocationTracker(id INTEGER); INSERT INTO myLocationTracker VALUES(1); CREATE TABLE dog_status(id INTEGER); INSERT INTO dog_status VALUES(2); CREATE TABLE dog_avatars(name TEXT); INSERT INTO dog_avatars VALUES("Spot")'.replace('"Spot"', "'Spot'"));
    db.exec(query);
    expect(db.prepare('SELECT COUNT(*) n FROM myLocationTracker').get().n).toBe(0);
    expect(db.prepare('SELECT id FROM dog_status').get().id).toBe(2);
    expect(db.prepare('SELECT name FROM dog_avatars').get().name).toBe('Spot');
  } finally { db.close(); }
});
