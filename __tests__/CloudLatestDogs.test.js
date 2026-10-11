import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { useCloudDogs } from '../src/cloud/useCloudDogs';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { mergeDogMarkers } from '../src/map/DogMerge';
import { latestMapApplied } from '../src/cloud/CloudPublication';
import { initialLatestAccepted } from '../src/app/useInitialLatest';
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
    rows: [expect.objectContaining({ event_id: 'cached' })], cloudPublication: null });
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
  expect(initialLatestAccepted('a', version, state.current)).toBe(true);
  await database.publishLatestSnapshot('a', { cutoff: NOW + 1000, dogs: [] });
  version = { ...version, attempt: 2, mapSuccessRevision: 2 };
  await act(async () => { screen.update(<Probe database={database} state={state} publication={publication} busy={false} success={2} revision={4} />); });
  expect(state.current.rows).toEqual([]);
  expect(initialLatestAccepted('a', version, state.current)).toBe(true);
  expect(initialLatestAccepted('a', { ...version, scope: {} }, state.current)).toBe(false);
  expect([...new Set(state.current.packets.map(row => row.slave_id))]).toEqual([9]);
  expect(state.current.packets.every(row => row.source !== 'cloud')).toBe(true);
});

// The combined PR96/105 contract uses the same three distinct fixes over at
// least thirty seconds as JS history and Kotlin live holds. A missing context
// refresh does not turn a snapshot revision or a repeated packet into a fix.
async function indoorSnapshotProbe(usb = 0, variedGood = false) {
  const good = [0, 5000, 10000].map((offset, index) => ({ ...fix(`good-${index}`),
    received_at: NOW - 300000 + offset, track_at: NOW - 300000 + offset,
    satellites: 9, hdop: 0.9, slave_lat: variedGood ? 25 + index * 0.00002 : 25, usb_present: usb }));
  const none = Array.from({ length: 58 }, (_, index) => ({ ...fix(`none-${index}`),
    received_at: NOW - 285000 + index * 5000, track_at: NOW - 285000 + index * 5000,
    slave_lat: 0, slave_lon: 0, satellites: 0, hdop: 655.35, usb_present: usb }));
  await database.savePage('a', [...good, ...none]);
  await database.readLatestSnapshot('a');
  const state = { current: null }, scope = {};
  let version = { owner: 'a', scope, generation: 1, attempt: 1, pending: true,
    mapSuccessRevision: 0, snapshotBaseRevision: 0 };
  const publication = () => version;
  await act(async () => { screen = Renderer.create(<Probe database={database} state={state} publication={publication} />); });
  if (variedGood) expect(state.current.holds[4]).toBeDefined();
  else expect(state.current.holds[4].coordinate).toEqual({ latitude: 25, longitude: 121 });
  let revision = 0;
  return {
    state,
    async publish(packet, validFix = packet) {
      await database.publishLatestSnapshot('a', { cutoff: packet.received_at + 1,
        dogs: [{ slaveId: 4, packet, fix: validFix }] });
      revision++;
      version = { ...version, pending: false, mapSuccessRevision: revision };
      await act(async () => { screen.update(<Probe database={database} state={state} publication={publication}
        busy={false} success={revision} revision={revision + 1} />); });
      expect(state.current.cloudCommit).toBe(revision);
      expect(state.current.packets.find(row => row.slave_id === 4).event_id).toBe(packet.event_id);
    },
  };
}
const away = (event, offset, overrides = {}) => ({ ...fix(event, 4, 25.002),
  received_at: NOW + offset, track_at: NOW + offset, satellites: 9, hdop: 0.9, ...overrides });

// This was the old two-fix PR105 assertion. PR96 intentionally retains the
// house on the first TWO observations: latest raw packets publish immediately,
// while the indoor marker remains explicit until a third real observation.
test('upgrade cache retains the house through two fresh packets and releases on a third when context refresh fails', async () => {
  const { state, publish } = await indoorSnapshotProbe();
  for (const [index, offset] of [1000, 31000, 61000].entries()) {
    const packet = away(`away-${index}`, offset);
    await publish(packet);
    expect(state.current.rows[0]).toMatchObject({ event_id: packet.event_id, slave_lat: 25.002 });
    if (index < 2) expect(state.current.holds[4]).toMatchObject({ reason: '室內',
      coordinate: { latitude: 25, longitude: 121 } });
  }
  expect(state.current.holds[4]).toBeUndefined();
});

test('republishing the same latest packet cannot manufacture a third departure observation', async () => {
  const { state, publish } = await indoorSnapshotProbe();
  const first = away('first', 1000), second = away('second', 31000);
  await publish(first); await publish(first);
  await publish(second); await publish(second);
  expect(state.current.holds[4]).toBeDefined();
  await publish(away('third', 61000));
  expect(state.current.holds[4]).toBeUndefined();
});

test('three distinct good snapshots in a short burst retain the house until agreement spans thirty seconds', async () => {
  const { state, publish } = await indoorSnapshotProbe();
  for (const offset of [1000, 2000, 3000]) await publish(away(`burst-${offset}`, offset));
  expect(state.current.holds[4]).toBeDefined();
  await publish(away('sustained', 31000));
  expect(state.current.holds[4]).toBeUndefined();
});

test('a measured return breaks snapshot departure agreement before the next excursion', async () => {
  const { state, publish } = await indoorSnapshotProbe();
  await publish(away('first', 1000)); await publish(away('second', 31000));
  await publish(away('return', 41000, { slave_lat: 25, satellites: 3, hdop: 5 }));
  await publish(away('next-excursion', 51000));
  expect(state.current.holds[4]).toBeDefined();
  expect(state.current.rows[0].event_id).toBe('next-excursion');
});

test('no-fix latest packets do not count an old cached fix as new departure evidence', async () => {
  const { state, publish } = await indoorSnapshotProbe();
  const first = away('only-away', 1000);
  await publish(first);
  for (const offset of [31000, 61000, 91000]) {
    await publish(away(`no-fix-${offset}`, offset, { slave_lat: 0, slave_lon: 0, satellites: 0, hdop: 655.35 }), first);
    expect(state.current.holds[4]).toBeDefined();
  }
});

test('charging cache also waits for three real good observations over time, without trapping a confirmed departure', async () => {
  const { state, publish } = await indoorSnapshotProbe(1);
  for (const [index, offset] of [1000, 31000, 61000].entries()) {
    await publish(away(`charging-${index}`, offset, { usb_present: 1 }));
    if (index < 2) expect(state.current.holds[4]).toBeDefined();
  }
  expect(state.current.holds[4]).toBeUndefined();
});


test('native publish alone cannot prove initial acceptance while every atomic snapshot read is deferred', async () => {
  await database.publishLatestSnapshot('a', { cutoff: NOW, dogs: [] });
  const state = { current: null }, scope = {};
  const version = { owner: 'a', scope, generation: 1, attempt: 1, pending: false,
    mapSuccessRevision: 1, snapshotBaseRevision: 0 };
  let release;
  const deferred = new Promise(resolve => { release = resolve; });
  const readSnapshot = database.readLatestSnapshot;
  database.readLatestSnapshot = async (...args) => { await deferred; return readSnapshot(...args); };
  await act(async () => { screen = Renderer.create(<Probe database={database} state={state}
    publication={() => version} busy={false} success={1} revision={1} />); });
  expect(initialLatestAccepted('a', version, state.current)).toBe(false);
  await act(async () => { release(); for (let i = 0; i < 30; i++) await Promise.resolve(); });
  expect(state.current.rows).toEqual([]);
  expect(initialLatestAccepted('a', version, state.current)).toBe(true);
});


test('a real second-attempt deferred snapshot read retains old proof until an atomic position read succeeds', async () => {
  const state = { current: null }, scope = {};
  let version = { owner: 'a', scope, generation: 1, attempt: 1, pending: false, busy: false,
    mapSuccessRevision: 1, snapshotBaseRevision: 0 };
  const publication = () => version;
  const sync = () => ({ latestFirst: true, snapshotPending: false,
    mapSuccessRevision: version.mapSuccessRevision, getMapPublication: publication });
  await database.publishLatestSnapshot('a', { cutoff: NOW, dogs: [{ slaveId: 4,
    packet: fix('first'), fix: fix('first') }] });
  await act(async () => { screen = Renderer.create(<Probe database={database} state={state}
    publication={publication} busy={false} success={1} revision={1} />); });
  expect(state.current.cloudPublication).toMatchObject({ attempt: 1, revision: 1 });
  expect(latestMapApplied(sync(), 'a', state.current)).toBe(true);
  let release, entered;
  const holdEntered = new Promise(resolve => { entered = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  const readSnapshot = database.readLatestSnapshot;
  database.readLatestSnapshot = async (...args) => { entered(); await held; return readSnapshot(...args); };
  try {
    await database.publishLatestSnapshot('a', { cutoff: NOW + 1000, dogs: [{ slaveId: 6,
      packet: fix('second', 6, 26), fix: fix('second', 6, 26) }] });
    version = { ...version, attempt: 2, mapSuccessRevision: 2 };
    await act(async () => { screen.update(<Probe database={database} state={state}
      publication={publication} busy={false} success={2} revision={2} />); });
    await holdEntered;
    expect(state.current.rows.map(row => row.event_id)).toEqual(['first']);
    expect(state.current.cloudPublication).toMatchObject({ attempt: 1, revision: 1 });
    expect(latestMapApplied(sync(), 'a', state.current)).toBe(false);
    await act(async () => { release(); for (let i = 0; i < 30; i++) await Promise.resolve(); });
    expect(state.current.rows.map(row => row.event_id)).toEqual(['second']);
    expect(state.current.cloudPublication).toMatchObject({ attempt: 2, revision: 2 });
    expect(latestMapApplied(sync(), 'a', state.current)).toBe(true);
    version = { ...version, pending: true };
    expect(latestMapApplied(sync(), 'a', state.current)).toBe(true);
    version = { ...version, pending: false, mapSuccessRevision: 3 };
    expect(latestMapApplied(sync(), 'a', state.current)).toBe(true);
  } finally { release(); }
});


test('latest positions and exact proof are accepted while the previous hold read is still pending', async () => {
  await database.publishLatestSnapshot('a', { cutoff: NOW, dogs: [{ slaveId: 4, packet: fix('old'), fix: fix('old'), context: [], seeds: [] }] });
  const originalHolds = database.holdRows;
  let release, entered;
  const held = new Promise(resolve => { release = resolve; });
  const reached = new Promise(resolve => { entered = resolve; });
  database.holdRows = jest.fn(async (...args) => { if (database.holdRows.mock.calls.length === 1) { entered(); await held; } return originalHolds(...args); });
  const state = { current: null }, scope = {};
  let version = { owner: 'a', scope, generation: 1, attempt: 1, pending: false, busy: false, mapSuccessRevision: 1 };
  const publication = () => version;
  const sync = () => ({ latestFirst: true, snapshotPending: false, mapSuccessRevision: version.mapSuccessRevision, getMapPublication: publication });
  try {
    await act(async () => { screen = Renderer.create(<Probe database={database} state={state} publication={publication} busy={false} success={1} revision={1} />); });
    await reached;
    await database.publishLatestSnapshot('a', { cutoff: NOW + 1000, dogs: [{ slaveId: 4, packet: fix('current', 4, 26), fix: fix('current', 4, 26) }] });
    version = { ...version, attempt: 2, mapSuccessRevision: 2 };
    await act(async () => { screen.update(<Probe database={database} state={state} publication={publication} busy={false} success={2} revision={2} />); });
    expect(state.current.rows.map(row => row.event_id)).toEqual(['current']);
    expect(state.current.cloudPublication).toMatchObject({ attempt: 2, revision: 2 });
    expect(latestMapApplied(sync(), 'a', state.current)).toBe(true);
    expect(state.current.holds).toEqual({});
    await act(async () => { release(); for (let i=0;i<40;i++) await Promise.resolve(); });
    expect(state.current.rows.map(row => row.event_id)).toEqual(['current']);
    expect(state.current.cloudPublication.attempt).toBe(2);
  } finally { release(); }
});

test('late optional-context rejection cannot overwrite the newly accepted attempt or create a latest-position error', async () => {
  await database.publishLatestSnapshot('a', { cutoff: NOW, dogs: [{ slaveId: 4, packet: fix('before'), fix: fix('before') }] });
  const read = database.readLatestSnapshot;
  let reject, entered, heldOnce = false;
  const reached = new Promise(resolve => { entered = resolve; });
  const held = new Promise((resolve, rejectPromise) => { reject = rejectPromise; });
  database.readLatestSnapshot = async (owner, options) => {
    if (!options?.positionsOnly && !heldOnce) { heldOnce = true; entered(); await held; }
    return read(owner, options);
  };
  const state = { current: null }, scope = {};
  let version = { owner: 'a', scope, generation: 1, attempt: 1, pending: false, busy: false, mapSuccessRevision: 1 };
  const publication = () => version;
  const sync = () => ({ latestFirst: true, snapshotPending: false, mapSuccessRevision: version.mapSuccessRevision, getMapPublication: publication });
  try {
    await act(async () => { screen = Renderer.create(<Probe database={database} state={state} publication={publication} busy={false} success={1} revision={1} />); });
    await reached;
    await database.publishLatestSnapshot('a', { cutoff: NOW + 1000, dogs: [{ slaveId: 4, packet: fix('after', 4, 26), fix: fix('after', 4, 26) }] });
    version = { ...version, attempt: 2, mapSuccessRevision: 2 };
    await act(async () => { screen.update(<Probe database={database} state={state} publication={publication} busy={false} success={2} revision={2} />); });
    expect(state.current.rows.map(row => row.event_id)).toEqual(['after']);
    expect(latestMapApplied(sync(), 'a', state.current)).toBe(true);
    await act(async () => { reject(Error('invented context failure')); for(let i=0;i<40;i++) await Promise.resolve(); });
    expect(state.current.error).toBe('');
    expect(state.current.rows.map(row => row.event_id)).toEqual(['after']);
    expect(state.current.cloudPublication.attempt).toBe(2);
    expect(latestMapApplied(sync(), 'a', state.current)).toBe(true);
  } finally { reject(Error('cleanup')); }
});

test('a corrupt optional context does not block verified position acceptance or fabricate an indoor anchor', async () => {
  await database.publishLatestSnapshot('a', { cutoff: NOW, dogs: [{ slaveId: 4, packet: fix('position', 4, 26), fix: fix('position', 4, 26) }] });
  await connection.executeAsync("UPDATE cloud_latest_snapshot SET context_json='{invalid-context' WHERE owner_user_id='a'");
  const state = { current: null }, scope = {};
  const version = { owner: 'a', scope, generation: 1, attempt: 1, pending: false, busy: false, mapSuccessRevision: 1 };
  await act(async () => { screen = Renderer.create(<Probe database={database} state={state} publication={() => version} busy={false} success={1} revision={1} />); });
  expect(state.current.rows[0].slave_lat).toBe(26);
  expect(state.current.holds).toEqual({});
  expect(state.current.error).toBe('');
  expect(latestMapApplied({ latestFirst: true, snapshotPending: false, mapSuccessRevision: 1, getMapPublication: () => version }, 'a', state.current)).toBe(true);
});

test.each(['attempt', 'generation', 'scope', 'owner'])('an atomic position result cannot accept after its %s fence changes without a React update', async kind => {
  await database.publishLatestSnapshot('a', { cutoff: NOW, dogs: [{ slaveId: 4, packet: fix('old-fenced'), fix: fix('old-fenced') }] });
  const read = database.readLatestSnapshot;
  let release;
  const held = new Promise(resolve => { release = resolve; });
  database.readLatestSnapshot = async (...args) => { const captured = await read(...args); await held; return captured; };
  const state = { current: null }, scope = {};
  let version = { owner: 'a', scope, generation: 1, attempt: 1, pending: false, busy: false, mapSuccessRevision: 1 };
  try {
    await act(async () => { screen = Renderer.create(<Probe database={database} state={state} publication={() => version} busy={false} success={1} revision={1} />); });
    version = { ...version, [kind]: kind === 'owner' ? 'b' : kind === 'scope' ? {} : 2 };
    await act(async () => { release(); for(let i=0;i<40;i++) await Promise.resolve(); });
    expect(state.current.rows).toEqual([]);
    expect(state.current.cloudPublication).toBeNull();
    expect(state.current.cloudCommit).toBeNull();
  } finally { release(); }
});

test('a failed atomic position read still exposes an error while optional context is pending', async () => {
  await database.publishLatestSnapshot('a', { cutoff: NOW, dogs: [{ slaveId: 4, packet: fix('unread'), fix: fix('unread') }] });
  const read = database.readLatestSnapshot;
  let release;
  const held = new Promise(resolve => { release = resolve; });
  database.readLatestSnapshot = async (owner, options) => {
    if (options?.positionsOnly) throw Error('invented position failure');
    await held; return read(owner, options);
  };
  const state = { current: null }, scope = {};
  const version = { owner: 'a', scope, generation: 1, attempt: 1, pending: false, busy: false, mapSuccessRevision: 1 };
  try {
    await act(async () => { screen = Renderer.create(<Probe database={database} state={state} publication={() => version} busy={false} success={1} revision={1} />); });
    expect(state.current.error).toBe('invented position failure');
    expect(state.current.cloudCommit).toBeUndefined();
    expect(latestMapApplied({ latestFirst: true, snapshotPending: false, mapSuccessRevision: 1, getMapPublication: () => version }, 'a', state.current)).toBe(false);
  } finally { await act(async () => release()); }
});


const dogPosition = value => mergeDogMarkers({ cloudRows: value.rows, packetRows: value.packets,
  holds: value.holds, statuses: value.statuses, now: NOW })[0].coordinate;

test('an unchanged latest packet and fix retain the accepted indoor marker across a new snapshot revision before context completes', async () => {
  const { state, publish } = await indoorSnapshotProbe(0, true);
  const packet = state.current.packets.find(row => row.source === 'cloud');
  const lastFix = state.current.rows[0];
  const anchor = dogPosition(state.current);
  expect(anchor.latitude).not.toBe(lastFix.slave_lat);
  const read = database.holdRows;
  let release;
  const held = new Promise(resolve => { release = resolve; });
  database.holdRows = async (...args) => { await held; return read(...args); };
  try {
    await publish(packet, lastFix);
    expect(dogPosition(state.current)).toEqual(anchor);
    expect(state.current.holds[4]).toBeDefined();
  } finally { await act(async () => release()); }
});

test.each(['time', 'coordinate', 'master', 'status'])('repairing the same event id changes its %s content and cannot borrow the old indoor marker', async kind => {
  const { state, publish } = await indoorSnapshotProbe(0, true);
  const packet = state.current.packets.find(row => row.source === 'cloud');
  const lastFix = state.current.rows[0];
  const repaired = kind === 'time' ? { ...packet, track_at: packet.track_at + 1 }
    : kind === 'master' ? { ...packet, master_id: 8 }
      : kind === 'status' ? { ...packet, usb_present: 1 } : packet;
  const repairedFix = kind === 'coordinate' ? { ...lastFix, slave_lat: lastFix.slave_lat + 0.001 }
    : kind === 'master' ? { ...lastFix, master_id: 8 } : lastFix;
  const read = database.holdRows;
  let release;
  const held = new Promise(resolve => { release = resolve; });
  database.holdRows = async (...args) => { await held; return read(...args); };
  try {
    await publish(repaired, repairedFix);
    expect(repaired.event_id).toBe(packet.event_id);
    expect(state.current.holds[4]).toBeUndefined();
    expect(dogPosition(state.current)).toEqual({ latitude: repairedFix.slave_lat, longitude: repairedFix.slave_lon });
  } finally { await act(async () => release()); }
});

test('an empty cloud refresh preserves independently accepted BLE-only indoor context and packet source', async () => {
  for (let i=0;i<61;i++) {
    const good = i < 3;
    await connection.executeAsync(`INSERT INTO dog_status(slave_id,master_id,received_at,slave_lat,slave_lon,satellites,hdop,usb_present)
      VALUES(9,7,?,?,?,?,?,0)`, [NOW-300000+i*5000, good ? 25+i*0.00002 : 0, good ? 121 : 0, good ? 9 : 0, good ? 0.9 : 655.35]);
  }
  await database.publishLatestSnapshot('a', { cutoff: NOW, dogs: [] });
  const state = { current: null }, scope = {};
  let version = { owner: 'a', scope, generation: 1, attempt: 1, pending: false, busy: false, mapSuccessRevision: 1 };
  const publication = () => version;
  await act(async () => { screen = Renderer.create(<Probe database={database} state={state} publication={publication} busy={false} success={1} revision={1} />); });
  const prior = state.current.holds[9];
  expect(prior).toBeDefined();
  expect(state.current.packets.find(row => row.slave_id === 9).source).toBe('ble');
  const read = database.holdRows;
  let release;
  const held = new Promise(resolve => { release=resolve; });
  database.holdRows = async (...args) => { await held; return read(...args); };
  try {
    await database.publishLatestSnapshot('a', { cutoff: NOW+1000, dogs: [] });
    version = { ...version, attempt: 2, mapSuccessRevision: 2 };
    await act(async () => { screen.update(<Probe database={database} state={state} publication={publication} busy={false} success={2} revision={2} />); });
    expect(state.current.holds[9]).toEqual(prior);
    expect(state.current.packets.find(row => row.slave_id === 9).source).toBe('ble');
    expect(mergeDogMarkers({ packetRows: state.current.packets, holds: state.current.holds,
      statuses: state.current.statuses, now: NOW }).find(row => row.slaveId===9).coordinate).toEqual(prior.coordinate);
  } finally { await act(async () => release()); }
});
