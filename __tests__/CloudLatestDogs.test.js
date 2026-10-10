import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { useCloudDogs } from '../src/cloud/useCloudDogs';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
const NOW = Date.parse('2026-10-10T12:00:00Z');
const clock = () => NOW;
const fix = (event, slave = 4, latitude = 25) => ({ event_id: event, slave_id: slave, master_id: 7,
  received_at: NOW - 1000, track_at: NOW - 1000, slave_lat: latitude, slave_lon: 121,
  activity_valid: 0, battery_valid: 0 });
function Probe({ database, owner = 'a', state, observe = () => {}, revision = 0, busy = true, success = null, publication }) {
  state.current = useCloudDogs(database, owner, true, clock, null,
    { latestFirst: true, revision, cloudBusy: busy, cloudSuccess: success, getMapPublication: publication });
  observe(state.current);
  return null;
}
let connection, database, screen;
beforeEach(async () => {
  jest.useFakeTimers(); jest.setSystemTime(NOW);
  connection = createMemoryConnection(); await createDogDatabase(connection).initialize();
  database = createCloudDatabase(connection); await database.initialize();
});

test.each([1, 2])('a deferred old baseline cannot flash after remote attempt %s has succeeded', async attempt => {
  await database.savePage('a', [fix('cached')]); await database.readLatestSnapshot('a');
  const readHolds = database.holdRows; let release, entered;
  const enteredHold = new Promise(resolve => { entered = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  database.holdRows = jest.fn(async (...args) => { if (database.holdRows.mock.calls.length === 1) { entered(); await held; } return readHolds(...args); });
  const state = { current: null }, observed = [], scope = {};
  let version = { owner: 'a', scope, generation: 1, attempt: 1, pending: true,
    mapSuccessRevision: 0, snapshotBaseRevision: 0 };
  const publication = () => version, observe = value => observed.push(value);
  await act(async () => { screen = Renderer.create(<Probe database={database} state={state} observe={observe} publication={publication} />); });
  await enteredHold;
  await database.publishLatestSnapshot('a', { cutoff: NOW, dogs: [{ slaveId: 6, packet: fix('new', 6), fix: fix('new', 6), context: [], seeds: [] }] });
  version = { ...version, attempt, pending: false, mapSuccessRevision: 1 };
  // The synchronous scheduler advances before React renders the coalesced
  // parent status. Releasing this old read must not seed the atomic map cache.
  const afterSuccess = observed.length;
  await act(async () => { release(); for (let i = 0; i < 30; i++) await Promise.resolve(); });
  expect(observed.slice(afterSuccess).some(value => value.rows.some(row => row.event_id === 'cached'))).toBe(false);
  await act(async () => { screen.update(<Probe database={database} state={state} observe={observe} publication={publication} busy={false} success={1} revision={2} />); });
  expect(state.current.rows.map(row => row.event_id)).toEqual(['new']);
  expect(state.current.cloudCommit).toBe(1);
});
afterEach(async () => { await act(async () => screen?.unmount()); connection.close(); screen = null; jest.useRealTimers(); });

test('cold cached dogs survive initial network failure without claiming success; archive writes cannot move them', async () => {
  await database.savePage('a', [fix('cached')]);
  await database.readLatestSnapshot('a');
  const state = { current: null }, scope = {};
  const publication = () => ({ owner: 'a', scope, generation: 1, attempt: 1, pending: true,
    mapSuccessRevision: 0, snapshotBaseRevision: 0 });
  await act(async () => { screen = Renderer.create(<Probe database={database} state={state} publication={publication} />); });
  expect(state.current).toMatchObject({ loaded: true, cachedBaseline: true, cloudCommit: null,
    rows: [expect.objectContaining({ event_id: 'cached' })] });
  await database.savePage('a', [fix('archive-new', 4, 26), fix('extra-dog', 6)]);
  await act(async () => { screen.update(<Probe database={database} state={state} publication={publication} busy={false} revision={1} />); });
  expect(state.current.rows.map(row => [row.event_id, row.slave_lat])).toEqual([['cached', 25]]);
  expect(state.current.cloudCommit).toBeNull();
});

test('a complete new snapshot replaces the cache as one set and complete-empty keeps only BLE packets', async () => {
  await database.savePage('a', [fix('cached')]);
  await database.readLatestSnapshot('a');
  await connection.executeAsync('INSERT INTO dog_status(slave_id,master_id,received_at,slave_lat,slave_lon) VALUES(9,7,?,25,121)', [NOW]);
  const state = { current: null }, scope = {};
  let version = { owner: 'a', scope, generation: 1, attempt: 1, pending: true,
    mapSuccessRevision: 0, snapshotBaseRevision: 0 };
  const publication = () => version;
  await act(async () => { screen = Renderer.create(<Probe database={database} state={state} publication={publication} />); });
  await database.publishLatestSnapshot('a', { cutoff: NOW, dogs: [{ slaveId: 6, packet: fix('new', 6), fix: fix('new', 6), context: [], seeds: [] }] });
  version = { ...version, pending: false, mapSuccessRevision: 1 };
  await act(async () => { screen.update(<Probe database={database} state={state} publication={publication} busy={false} success={1} revision={2} />); });
  expect(state.current.rows.map(row => row.slave_id)).toEqual([6]);
  expect(state.current.cloudCommit).toBe(1);
  await database.publishLatestSnapshot('a', { cutoff: NOW + 1000, dogs: [] });
  version = { ...version, attempt: 2, mapSuccessRevision: 2 };
  await act(async () => { screen.update(<Probe database={database} state={state} publication={publication} busy={false} success={2} revision={4} />); });
  expect(state.current.rows).toEqual([]);
  expect([...new Set(state.current.packets.map(row => row.slave_id))]).toEqual([9]);
  expect(state.current.packets.every(row => row.source !== 'cloud')).toBe(true);
});

test('upgrade cache restores a known indoor house; fresh good packets can release it even when context refresh fails', async () => {
  const good = [0, 5000, 10000].map((offset, index) => ({ ...fix(`good-${index}`),
    received_at: NOW - 300000 + offset, track_at: NOW - 300000 + offset, satellites: 9, hdop: 0.9 }));
  const none = Array.from({ length: 58 }, (_, index) => ({ ...fix(`none-${index}`),
    received_at: NOW - 285000 + index * 5000, track_at: NOW - 285000 + index * 5000,
    slave_lat: 0, slave_lon: 0, satellites: 0, hdop: 655.35 }));
  await database.savePage('a', [...good, ...none]);
  await database.readLatestSnapshot('a');
  const state = { current: null }, scope = {};
  let version = { owner: 'a', scope, generation: 1, attempt: 1, pending: true,
    mapSuccessRevision: 0, snapshotBaseRevision: 0 };
  const publication = () => version;
  await act(async () => { screen = Renderer.create(<Probe database={database} state={state} publication={publication} />); });
  expect(state.current.holds[4].coordinate).toEqual({ latitude: 25, longitude: 121 });
  for (const [index, offset] of [1000, 31000].entries()) {
    const packet = { ...fix(`away-${index}`, 4, 25.002), received_at: NOW + offset, track_at: NOW + offset,
      satellites: 9, hdop: 0.9 };
    await database.publishLatestSnapshot('a', { cutoff: NOW + offset + 1, dogs: [{ slaveId: 4, packet, fix: packet }] });
    version = { ...version, pending: false, mapSuccessRevision: index + 1 };
    await act(async () => { screen.update(<Probe database={database} state={state} publication={publication}
      busy={false} success={index + 1} revision={index + 2} />); });
    if (index === 0) expect(state.current.holds[4]).toBeDefined();
  }
  expect(state.current.holds[4]).toBeUndefined();
});
