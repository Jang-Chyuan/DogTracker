import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { useCloudDogs } from '../src/cloud/useCloudDogs';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { mergeDogMarkers } from '../src/map/DogMerge';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';

// On resume the latest-first sync publishes each dog's newest packet and fix
// at once; the dog's half-hour context (and so its indoor anchor) is read
// seconds later. A dog held indoors keeps sending packets, so its latest pair
// is always new on resume. It must stay at its house in between, not be drawn
// at the newest drifting fix and then snap back. Fictional dog and place.
const NOW = Date.parse('2026-10-10T12:00:00Z');
let clockNow = NOW;
const clock = () => clockNow;
const row = (event, offset, overrides = {}) => ({ event_id: event, slave_id: 4, master_id: 7,
  received_at: NOW + offset, track_at: NOW + offset, slave_lat: 25, slave_lon: 121,
  activity_valid: 0, battery_valid: 0, usb_present: 0, ...overrides });
const noFix = { slave_lat: 0, slave_lon: 0, satellites: 0, hdop: 655.35 };
// A weak indoor fix ~20 m beside the house (the drift the user saw).
const drift = { slave_lat: 25.00018, slave_lon: 121.00005, satellites: 3, hdop: 6 };

function Probe({ state, active = true, busy, success, revision, publication }) {
  state.current = useCloudDogs(database, 'a', true, clock, null, { active, latestFirst: true,
    revision, cloudBusy: busy, cloudSuccess: success, getMapPublication: publication });
  return null;
}
let connection, database, screen;
beforeEach(async () => {
  jest.useFakeTimers(); clockNow = NOW; jest.setSystemTime(NOW);
  connection = createMemoryConnection(); await createDogDatabase(connection).initialize();
  database = createCloudDatabase(connection); await database.initialize();
});
afterEach(async () => { await act(async () => screen?.unmount()); connection.close(); screen = null; jest.useRealTimers(); });

const position = value => mergeDogMarkers({ cloudRows: value.rows, packetRows: value.packets,
  holds: value.holds, statuses: value.statuses, now: clockNow })[0].coordinate;

// A dog that walked in with good fixes and has sent only no-fix packets since:
// held at its house, with the context downloaded by the first attempt.
async function heldDog() {
  const good = [0, 5000, 10000].map((offset, index) => row(`good-${index}`, offset - 300000,
    { satellites: 9, hdop: 0.9, slave_lat: 25 + index * 0.00002 }));
  const silent = Array.from({ length: 58 }, (_, index) => row(`none-${index}`, index * 5000 - 285000, noFix));
  const packet = silent[silent.length - 1], lastFix = good[good.length - 1];
  await database.publishLatestSnapshot('a', { cutoff: NOW, dogs: [{ slaveId: 4, packet, fix: lastFix,
    context: [...good, ...silent], seeds: [] }] });
  const state = { current: null }, scope = {};
  let version = { owner: 'a', scope, generation: 1, attempt: 1, pending: false, busy: false, mapSuccessRevision: 1 };
  const publication = () => version;
  await act(async () => { screen = Renderer.create(<Probe state={state} publication={publication}
    busy={false} success={1} revision={1} />); });
  const house = state.current.holds[4]?.coordinate;
  expect(house).toBeDefined();
  expect(position(state.current)).toEqual(house);
  let attempt = 1;
  return {
    state, house, lastFix,
    // Leave the app, come back after `awayMs`, and publish the newest pair
    // while the hold/context read is still outstanding.
    async resume(awayMs, latest, fix) {
      await act(async () => { screen.update(<Probe state={state} publication={publication} active={false}
        busy={false} success={attempt} revision={attempt * 2} />); });
      clockNow += awayMs; jest.setSystemTime(clockNow);
      attempt++;
      version = { ...version, generation: version.generation + 1, attempt, pending: true, busy: true };
      await act(async () => { screen.update(<Probe state={state} publication={publication}
        busy success={attempt - 1} revision={attempt * 2} />); });
      await database.publishLatestSnapshot('a', { cutoff: clockNow, dogs: [{ slaveId: 4, packet: latest, fix }] });
      version = { ...version, pending: false, busy: false, mapSuccessRevision: attempt };
      await act(async () => { screen.update(<Probe state={state} publication={publication}
        busy={false} success={attempt} revision={attempt * 2 + 1} />); });
      expect(state.current.cloudCommit).toBe(attempt);
      expect(state.current.packets.find(value => value.slave_id === 4).event_id).toBe(latest.event_id);
    },
  };
}
// Holds the context/hold reread (the archive is still draining on resume).
function holdContext() {
  const read = database.holdRows;
  let release;
  const held = new Promise(resolve => { release = resolve; });
  database.holdRows = async (...args) => { await held; return read(...args); };
  return async () => { database.holdRows = read; await act(async () => { release(); for (let i = 0; i < 40; i++) await Promise.resolve(); }); };
}

test.each([
  ['a newer no-fix packet and the same old fix', 60000, () => row('resume-packet', 59000, noFix), dog => dog.lastFix],
  ['a newer packet with a weak fix drifting beside the house', 60000,
    () => row('resume-drift', 59000, drift), () => row('resume-drift', 59000, drift)],
  ['a no-fix packet after forty minutes away', 2400000, () => row('resume-late', 2399000, noFix), dog => dog.lastFix],
])('a held dog stays at its house on resume with %s while context is pending', async (_, awayMs, packet, fix) => {
  const dog = await heldDog();
  const release = holdContext();
  const latest = packet();
  await dog.resume(awayMs, latest, fix(dog));
  // The first accepted latest frame must not move the house to the raw fix.
  expect(position(dog.state.current)).toEqual(dog.house);
  await release();
  expect(position(dog.state.current)).toEqual(dog.house);
});

test('a dog that has clearly left the house shows at its new good fix without waiting for context', async () => {
  const dog = await heldDog();
  const release = holdContext();
  // ~220 m away, sharp fix: real movement, not indoor drift.
  const away = row('resume-away', 59000, { slave_lat: 25.002, satellites: 9, hdop: 0.8 });
  await dog.resume(60000, away, away);
  expect(dog.state.current.holds[4]).toBeUndefined();
  expect(position(dog.state.current)).toEqual({ latitude: 25.002, longitude: 121 });
  await release();
});

test('another Master reporting the dog cannot inherit the old house before context', async () => {
  const dog = await heldDog();
  const release = holdContext();
  const other = row('resume-other-master', 59000, { ...drift, master_id: 8 });
  await dog.resume(60000, other, other);
  expect(dog.state.current.holds[4]).toBeUndefined();
  await release();
});
