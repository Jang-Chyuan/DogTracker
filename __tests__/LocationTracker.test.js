import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { readLocationPage } from '../src/locationTracker/LocationTrackerDatabase';
import { useLocationTracker } from '../src/locationTracker/useLocationTracker';
import { locationTrackerNative, startLocationTracker, stopLocationTracker } from '../src/locationTracker/LocationTrackerService';

jest.mock('../src/locationTracker/LocationTrackerService', () => ({
  locationTrackerNative: { page: jest.fn() },
  startLocationTracker: jest.fn(), stopLocationTracker: jest.fn(),
}));

test('native SQLite statements cap at 80000 newest rows and roll back on retention failure', () => {
  const source = fs.readFileSync(path.join(__dirname, '../android/app/src/main/java/com/dogtracker/location/LocationTrackerStore.kt'), 'utf8');
  const sql = prefix => source.match(new RegExp('"(' + prefix + '[^"]+)"'))[1];
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(sql('CREATE TABLE'));
    db.exec(sql('CREATE INDEX'));
    const insert = db.prepare(sql('INSERT INTO'));
    db.exec('BEGIN');
    for (let i = 0; i < 80002; i += 1) insert.run(i, i, 25, 121, 5, null, null, null);
    db.exec(sql('DELETE FROM'));
    db.exec('COMMIT');
    expect(db.prepare('SELECT COUNT(*) AS n, MIN(recorded_at) AS oldest FROM myLocationTracker').get()).toMatchObject({ n: 80000, oldest: 2 });
    // Timestamp ties remove the older id, not the more recently inserted row.
    insert.run(2, 2, 25, 121, 5, null, null, null);
    db.exec(sql('DELETE FROM'));
    expect(db.prepare('SELECT id FROM myLocationTracker WHERE id = 3').get()).toBeUndefined();
    db.exec("CREATE TRIGGER reject_trim BEFORE DELETE ON myLocationTracker BEGIN SELECT RAISE(ABORT, 'blocked'); END");
    db.exec('BEGIN');
    insert.run(999999, 999999, 25, 121, null, null, null, null);
    expect(() => db.exec(sql('DELETE FROM'))).toThrow();
    db.exec('ROLLBACK');
    expect(db.prepare('SELECT COUNT(*) AS n FROM myLocationTracker').get().n).toBe(80000);
    expect(db.prepare('SELECT id FROM myLocationTracker WHERE recorded_at = 999999').get()).toBeUndefined();
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
