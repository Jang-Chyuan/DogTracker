import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { useCloudDogs, POLL_MS } from '../src/cloud/useCloudDogs';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';

// Audit F6/F8: what the live map's 10 s poll costs must not grow with the
// session. A synthetic two-hour session: six cloud dogs (two live, four
// silent), a latest snapshot with each dog's half-hour context every 30 s.
// Invented positions and clocks.
const START = Date.parse('2026-10-10T06:00:00Z');
const TICK_MS = 30000, ROW_MS = 10000, CONTEXT_MS = 30 * 60000, DOGS = 6, LIVE = 2;
let id = 0;
const row = (slave, time) => {
  id++;
  return { event_id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`, slave_id: slave, master_id: 7,
    received_at: time, track_at: time, slave_lat: 24.99 + slave * 0.001, slave_lon: 121.3132, satellites: 9, hdop: 0.9,
    usb_present: 0, activity_valid: 0, battery_valid: 0, raw_payload: JSON.stringify({ event_id: id, payload: { lat: 1 } }) };
};

let archive, latest, screen;
afterEach(async () => {
  await act(async () => screen?.unmount());
  archive?.close(); latest?.close(); screen = null; jest.useRealTimers();
});

test('two hours of downloads: each poll reads only the contexts that changed, and range state is written only on change', async () => {
  jest.useFakeTimers(); jest.setSystemTime(START);
  archive = createMemoryConnection(); latest = createMemoryConnection();
  await createDogDatabase(archive).initialize();
  const database = createCloudDatabase(archive, { latestConnection: latest });
  await database.initialize();
  const saveRangeState = jest.spyOn(database, 'saveRangeState');
  const history = new Map();
  for (let slave = 1; slave <= DOGS; slave++) {
    const until = slave <= LIVE ? START : START - 10 * 60000;
    const list = [];
    for (let time = until - CONTEXT_MS; time <= until; time += ROW_MS) list.push(row(slave, time));
    history.set(slave, list);
  }
  const dogs = () => [...history.entries()].map(([slave, list]) => ({ slaveId: slave, packet: list.at(-1), fix: list.at(-1),
    context: list.filter(item => item.track_at >= list.at(-1).track_at - CONTEXT_MS), seeds: [] }));
  const scope = {};
  let version = { owner: 'a', scope, generation: 1, attempt: 0, pending: false, mapSuccessRevision: 0, snapshotBaseRevision: 0 };
  let success = null, revision = 0;
  const state = { current: null };
  function Probe() {
    state.current = useCloudDogs(database, 'a', true, Date.now, null,
      { latestFirst: true, revision, cloudBusy: false, cloudSuccess: success, getMapPublication: () => version });
    return null;
  }
  await act(async () => { screen = Renderer.create(<Probe />); });
  // Contexts that left SQLite for the poll (not the writer's own compare).
  let contextsRead = 0, polls = 0;
  const execute = latest.executeAsync.getMockImplementation();
  latest.executeAsync.mockImplementation(async (query, params) => {
    const result = await execute(query, params);
    if (/^SELECT slave_id,context_json FROM cloud_latest_snapshot/.test(query.trim())) contextsRead += result.results.length;
    if (/^SELECT s\.revision,s\.cutoff,s\.origin,d\.slave_id/.test(query.trim())) polls++;
    return result;
  });
  const ticks = 2 * 3600000 / TICK_MS;
  let changedContexts = 0;
  for (let tick = 1; tick <= ticks; tick++) {
    const now = Date.now();
    for (let slave = 1; slave <= LIVE; slave++) {
      const list = history.get(slave);
      for (let time = list.at(-1).track_at + ROW_MS; time <= now; time += ROW_MS) list.push(row(slave, time));
    }
    changedContexts += tick === 1 ? DOGS : LIVE;
    await database.publishLatestSnapshot('a', { cutoff: now, masterIds: [7], dogs: dogs() });
    version = { ...version, attempt: tick, mapSuccessRevision: tick };
    success = tick; revision++;
    await act(async () => { screen.update(<Probe />); });
    await act(async () => { await jest.advanceTimersByTimeAsync(TICK_MS); });
    latest.executeAsync.mockClear(); archive.executeAsync.mockClear();
  }
  expect(polls).toBeGreaterThanOrEqual(ticks * TICK_MS / POLL_MS);
  // Before: every poll read every dog's context (six per poll, ~1,700 in two
  // hours). Now: the contexts that changed, about once each.
  expect(contextsRead).toBeLessThanOrEqual(changedContexts + DOGS);
  expect(contextsRead).toBeGreaterThanOrEqual(changedContexts - LIVE);
  // Cloud rows never judge the receiver range: nothing changed, one write.
  expect(saveRangeState).toHaveBeenCalledTimes(1);
  // The map still has every dog, at its newest packet.
  expect(state.current.packets.filter(item => item.source === 'cloud').map(item => item.slave_id)).toEqual([1, 2, 3, 4, 5, 6]);
  expect(state.current.packets.find(item => item.slave_id === 1).track_at).toBe(history.get(1).at(-1).track_at);
}, 120000);
