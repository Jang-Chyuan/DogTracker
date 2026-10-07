import fs from 'fs';
import path from 'path';
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Linking } from 'react-native';
import {
  applyScreenFixture, buildFixture, FIXTURE_NAMES, FIXTURE_NOW, FIXTURE_ORIGIN, fixtureNameFromUrl,
} from '../src/dev/ScreenFixtures';
import { useScreenFixture } from '../src/dev/useScreenFixture';
import { mergeDogMarkers, LIVE_PACKET_WINDOW_MS } from '../src/map/DogMerge';
import {
  createTrackingMapPresentation, outOfRangeLines, receiverRangeRing,
} from '../src/map/TrackingMapPresentation';
import { distanceMeters, rangeView, RANGE_STATUS } from '../src/tracking/ReceiverRange';
import { isOtherReceiver, receiverLink, receiverNumber } from '../src/map/ReceiverState';
import { dogHistoryLabel, dogMapLabel } from '../src/mapHistory/DogAliases';
import { DEFAULT_TRACKING_PREFERENCES } from '../src/tracking/TrackingPreferences';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { MAX_AGE_MS } from '../src/map/DogMerge';
import { createHoldStore, HOLD_LOOKBACK_MS } from '../src/placement/HoldStore';

// What the live map would draw for a fixture: the same calls MapScreen makes.
async function screen(name) {
  const fixture = buildFixture(name);
  const { point, positionSamples, route } = fixture.tracking;
  const receiver = await fixture.readReceiverState.getState();
  const { cloudDogs: dogs, now } = fixture;
  const merged = mergeDogMarkers({ point, samples: positionSamples, cloudRows: dogs.rows,
    packetRows: dogs.packets, holds: dogs.holds, statuses: dogs.statuses, ride: fixture.ride,
    now, windowMs: LIVE_PACKET_WINDOW_MS });
  const base = createTrackingMapPresentation(point, route, positionSamples,
    { ...DEFAULT_TRACKING_PREFERENCES, windowMinutes: 2 }, now);
  const other = isOtherReceiver(point, receiver);
  const link = receiverLink(receiver, now);
  const ring = receiverRangeRing(other ? null : base.positions.master, link);
  const drawnDogs = merged.filter(dog => !dog.stale);
  return {
    fixture,
    link,
    receiver: receiverNumber(receiver),
    otherReceiver: other,
    ring,
    lines: outOfRangeLines(ring, drawnDogs, dogs.ranges),
    ranges: dogs.ranges,
    dog: id => merged.find(dog => dog.slaveId === id),
    dogs: merged,
    drawn: drawnDogs.map(dog => dog.slaveId),
    label: dog => dogMapLabel(dogHistoryLabel(dog.slaveId, fixture.dogAliases)),
  };
}

test('only well-formed fixture links are accepted', () => {
  expect(fixtureNameFromUrl('dogtracker://dev/fixture?name=dogs-aged')).toBe('dogs-aged');
  expect(fixtureNameFromUrl('dogtracker://dev/fixture?name=off')).toBe('off');
  expect(fixtureNameFromUrl('dogtracker://dev/fixture?name=nope')).toBeNull();
  expect(fixtureNameFromUrl('dogtracker://dev/fixture?name=all-good&x=1')).toBeNull();
  expect(fixtureNameFromUrl('https://example.com/?name=dogs-aged')).toBeNull();
  expect(fixtureNameFromUrl(null)).toBeNull();
  expect(buildFixture('nope')).toBeNull();
});

test('every fixture is reproducible, near Taoyuan station, and on the fixed clock', () => {
  expect(FIXTURE_NAMES).toEqual(expect.arrayContaining(['all-good', 'no-data', 'receiver-connecting',
    'receiver-disconnected', 'dog-indoor', 'dogs-aged']));
  for (const name of FIXTURE_NAMES) {
    const fixture = buildFixture(name);
    expect(fixture.now).toBe(FIXTURE_NOW);
    // Built twice, the same rows: a screenshot does not depend on when it was taken.
    expect(JSON.stringify(buildFixture(name))).toBe(JSON.stringify(fixture));
    const places = [...fixture.raw.ble, ...fixture.raw.cloud]
      .filter(row => row.slave_lat || row.slave_lon)
      .map(row => ({ latitude: row.slave_lat, longitude: row.slave_lon }))
      .concat(fixture.phoneRoute);
    for (const place of places) {
      // Within ~2 km of the station: invented, never the team's real area.
      expect(Math.abs(place.latitude - FIXTURE_ORIGIN.latitude)).toBeLessThan(0.02);
      expect(Math.abs(place.longitude - FIXTURE_ORIGIN.longitude)).toBeLessThan(0.02);
    }
    for (const row of [...fixture.raw.ble, ...fixture.raw.cloud]) {
      expect(row.received_at).toBeLessThanOrEqual(FIXTURE_NOW);
    }
  }
});

test('all-good: receiver receiving, cloud synced, every dog current, phone recording', async () => {
  const state = await screen('all-good');
  expect(state.link).toBe('receiving');
  expect(state.receiver).toBe(7);
  expect(state.otherReceiver).toBe(false);
  // Connected and the receiver has a position: the 1 km ring around it.
  expect(state.ring.radiusMeters).toBe(1000);
  expect(state.ring.center).toEqual(state.fixture.tracking.positionSamples
    .find(sample => sample.master).master);
  expect(state.lines).toEqual([]);
  expect(state.drawn).toEqual([4, 6, 8]);
  expect(state.dogs.some(dog => dog.heldReason || dog.retained)).toBe(false);
  expect(state.fixture.cloudSync.error).toBeFalsy();
  expect(state.fixture.livePhone.running).toBe(true);
  expect(state.fixture.livePhone.ageSeconds).toBeLessThanOrEqual(3);
});

test('no-data: no receiver set up and no dogs from anywhere', async () => {
  const state = await screen('no-data');
  expect(state.link).toBe('none');
  expect(state.receiver).toBeNull();
  expect(state.dogs).toEqual([]);
  expect(state.fixture.cloudDogs.rows).toEqual([]);
  expect(state.fixture.tracking.point.id).toBeNull();
  expect(state.ring).toBeNull();
});

test('receiver-connecting: never received yet, and receiver 3\'s old packet does not pose as receiver 7', async () => {
  const state = await screen('receiver-connecting');
  expect(state.link).toBe('connecting');
  expect(state.receiver).toBe(7);
  expect(state.fixture.tracking.point.masterId).toBe(3);
  expect(state.otherReceiver).toBe(true);
  // Receiver 3's position would otherwise be drawn: it is a minute old.
  expect(createTrackingMapPresentation(state.fixture.tracking.point, state.fixture.tracking.route,
    state.fixture.tracking.positionSamples, DEFAULT_TRACKING_PREFERENCES, state.fixture.now).positions.master)
    .not.toBeNull();
  // Not connected yet, and the stored position is receiver 3's: no ring either way.
  expect(state.ring).toBeNull();
  expect(receiverRangeRing(state.fixture.tracking.positionSamples.find(sample => sample.master)
    && { coordinate: state.fixture.tracking.positionSamples.find(sample => sample.master).master }, 'receiving'))
    .not.toBeNull();
  // The dogs themselves are still drawn: dog 4's own fix was real.
  expect(state.drawn).toEqual([4, 6, 8]);
});

test('receiver-disconnected: dropped after receiving, its dog has gone quiet', async () => {
  const state = await screen('receiver-disconnected');
  expect(state.link).toBe('disconnected');
  const dog4 = state.dogs.find(dog => dog.slaveId === 4);
  expect(dog4.stale).toBe(true);
  expect(FIXTURE_NOW - dog4.lastPacketAt).toBeGreaterThanOrEqual(5 * 60000);
  expect(state.drawn).toEqual([6, 8]);
  // Disconnected: no range ring, although the receiver's last position is known.
  expect(state.ring).toBeNull();
  // The judgement made before the drop stays as it was (豆豆 in range).
  expect(rangeView(state.ranges[4]).status).toBe(RANGE_STATUS.IN);
});

test('range-out: 豆豆 walked 1.3 km away — out of range, red dashed line from the ring edge', async () => {
  const state = await screen('range-out');
  expect(state.link).toBe('receiving');
  expect(state.ring).not.toBeNull();
  const dog4 = state.dog(4);
  expect(distanceMeters(state.ring.center, dog4.coordinate)).toBeGreaterThan(1250);
  expect(state.ranges[4].status).toBe(RANGE_STATUS.OUT);
  expect(rangeView(state.ranges[4])).toMatchObject({ status: 'out', problem: true, showConfirmedAt: false });
  expect(state.ranges[6].status).toBe(RANGE_STATUS.IN);
  // 阿福 only comes from the cloud: no judgement at all.
  expect(state.ranges[8]).toBeUndefined();
  expect(state.lines.map(line => line.slaveId)).toEqual([4]);
  const [edge, end] = state.lines[0].coordinates;
  expect(distanceMeters(state.ring.center, edge)).toBeCloseTo(1000, -1);
  expect(end).toEqual(dog4.coordinate);
  // The edge point lies on the way from the centre to the dog.
  expect(distanceMeters(state.ring.center, edge) + distanceMeters(edge, end))
    .toBeCloseTo(distanceMeters(state.ring.center, end), 0);
});

test('range-near-edge: 豆豆 880 m away — 快離開, no line, ring still drawn', async () => {
  const state = await screen('range-near-edge');
  const distance = distanceMeters(state.ring.center, state.dog(4).coordinate);
  expect(distance).toBeGreaterThan(800);
  expect(distance).toBeLessThan(1000);
  expect(rangeView(state.ranges[4])).toMatchObject({ status: 'near', warning: true, problem: false });
  expect(state.lines).toEqual([]);
});

test('range-returning: back within 1 km but not cleared — still out, drawn inside the ring, no line', async () => {
  const state = await screen('range-returning');
  const distance = distanceMeters(state.ring.center, state.dog(4).coordinate);
  expect(distance).toBeGreaterThan(900);
  expect(distance).toBeLessThan(1000);
  expect(state.ranges[4].status).toBe(RANGE_STATUS.OUT);
  expect(state.lines).toEqual([]);
});

test('range-stale-inside: 小黑 judged in range at its last position — no line though that spot is now outside the ring', async () => {
  const state = await screen('range-stale-inside');
  const dog6 = state.dog(6);
  // No new position for almost three minutes, still drawn.
  expect(FIXTURE_NOW - dog6.lastPositionAt).toBeGreaterThan(2.5 * 60000);
  expect(state.drawn).toContain(6);
  // The receiver walked off: the last position is outside the ring now…
  expect(distanceMeters(state.ring.center, dog6.coordinate)).toBeGreaterThan(1000);
  // …but the judgement stays the one made at that position.
  expect(state.ranges[6].status).toBe(RANGE_STATUS.IN);
  expect(state.lines).toEqual([]);
});

test('cloud-only: no receiver, so no ring and no range judgement', async () => {
  const state = await screen('cloud-only');
  expect(state.link).toBe('none');
  expect(state.ring).toBeNull();
  expect(state.ranges).toEqual({});
  expect(state.drawn).toEqual([6, 8]);
  expect(state.dogs.every(dog => dog.source === 'cloud')).toBe(true);
});

test('dog-indoor: the real indoor-hold rules hold 小黑 where it went inside', async () => {
  const state = await screen('dog-indoor');
  expect(state.link).toBe('receiving');
  const dog6 = state.dogs.find(dog => dog.slaveId === 6);
  expect(state.label(dog6)).toBe('小黑');
  expect(dog6.heldReason).toBe('室內');
  expect(dog6.stale).toBe(false);
  // Held at its last clear fixes, not at 0,0 or a drifting point.
  expect(Math.abs(dog6.coordinate.latitude - (FIXTURE_ORIGIN.latitude - 0.0018))).toBeLessThan(0.0001);
  expect(Math.abs(dog6.coordinate.longitude - (FIXTURE_ORIGIN.longitude + 0.0024))).toBeLessThan(0.0001);
  expect(state.dogs.filter(dog => dog.heldReason).map(dog => dog.slaveId)).toEqual([6]);
});

test('dogs-aged: one current, one just past the live window, one forty minutes old', async () => {
  const state = await screen('dogs-aged');
  const byId = Object.fromEntries(state.dogs.map(dog => [dog.slaveId, dog]));
  const age = dog => Math.round((FIXTURE_NOW - dog.lastPacketAt) / 60000);
  expect([byId[4].stale, byId[6].stale, byId[8].stale]).toEqual([false, true, true]);
  expect([age(byId[4]), age(byId[6]), age(byId[8])]).toEqual([0, 4, 40]);
  expect(state.dogs.some(dog => dog.heldReason)).toBe(false);
  expect(state.drawn).toEqual([4]);
});

test('a fixture replaces the map inputs and leaves them untouched when off', async () => {
  const live = {
    tracking: { mode: 'real', foreground: true, ready: { real: false }, errors: { real: 'x' },
      preferences: { ready: false, value: { ...DEFAULT_TRACKING_PREFERENCES, hiddenSlaveIds: [6], focusSlaveId: 4 } },
      saveTrackingPreferences: jest.fn() },
    phone: { permission: 'denied', enabled: false, retry: jest.fn() },
    cloudDogs: { rows: [{ slave_id: 99 }] },
    cloudSync: { ownerId: 'real-user', retry: jest.fn() },
    history: { key: 'k', preferences: { source: 'local', dogAliases: { 99: 'real' } } },
  };
  expect(applyScreenFixture(null, live)).toBe(live);
  const fixture = buildFixture('dog-indoor');
  const inputs = applyScreenFixture(fixture, live);
  expect(inputs.tracking.point).toBe(fixture.tracking.point);
  expect(inputs.tracking.ready.real).toBe(true);
  expect(inputs.tracking.errors.real).toBeNull();
  expect(inputs.tracking.preferences.value.hiddenSlaveIds).toEqual([]);
  expect(inputs.tracking.preferences.value.focusSlaveId).toBeNull();
  // Buttons on a fixture screen never save into the real preferences.
  expect(inputs.tracking.saveTrackingPreferences).not.toBe(live.tracking.saveTrackingPreferences);
  await inputs.tracking.saveTrackingPreferences({ hiddenSlaveIds: [6] });
  expect(live.tracking.saveTrackingPreferences).not.toHaveBeenCalled();
  expect(inputs.phone.enabled).toBe(true);
  expect(inputs.cloudDogs).toBe(fixture.cloudDogs);
  expect(inputs.cloudSync.ownerId).not.toBe('real-user');
  expect(inputs.history.preferences.dogAliases[6]).toBe('小黑');
  expect(inputs.history.preferences.source).toBe('local');
});

test('outside debug builds the hook never listens and never returns a fixture', async () => {
  const listen = jest.spyOn(Linking, 'addEventListener');
  const initial = jest.spyOn(Linking, 'getInitialURL');
  let result;
  function Probe() {
    result = useScreenFixture(false);
    return null;
  }
  await act(async () => { Renderer.create(<Probe />); });
  expect(result).toBeNull();
  expect(listen).not.toHaveBeenCalled();
  expect(initial).not.toHaveBeenCalled();
  listen.mockRestore();
  initial.mockRestore();
});

test('in debug builds a link opens a fixture and name=off returns to the live data', async () => {
  let emit;
  const listen = jest.spyOn(Linking, 'addEventListener').mockImplementation((_, handler) => {
    emit = handler;
    return { remove: jest.fn() };
  });
  const initial = jest.spyOn(Linking, 'getInitialURL')
    .mockResolvedValue('dogtracker://dev/fixture?name=receiver-connecting');
  let result;
  function Probe() {
    result = useScreenFixture(true);
    return null;
  }
  await act(async () => { Renderer.create(<Probe />); });
  expect(result.name).toBe('receiver-connecting');
  await act(async () => emit({ url: 'dogtracker://dev/fixture?name=dog-indoor' }));
  expect(result.name).toBe('dog-indoor');
  await act(async () => emit({ url: 'dogtracker://dev/fixture?name=unknown' }));
  expect(result.name).toBe('dog-indoor');
  await act(async () => emit({ url: 'dogtracker://dev/fixture?name=off' }));
  expect(result).toBeNull();
  listen.mockRestore();
  initial.mockRestore();
});

test('only the debug manifest declares the fixture link', () => {
  const read = file => fs.readFileSync(path.join(__dirname, '..', 'android/app/src', file), 'utf8');
  expect(read('debug/AndroidManifest.xml')).toMatch(/android:scheme="dogtracker"/);
  expect(read('main/AndroidManifest.xml')).not.toMatch(/dogtracker/);
  const releaseDir = path.join(__dirname, '..', 'android/app/src/release');
  if (fs.existsSync(releaseDir)) {
    for (const file of fs.readdirSync(releaseDir, { recursive: true })) {
      if (String(file).endsWith('.xml')) expect(read(`release/${file}`)).not.toMatch(/dogtracker:\/\/|scheme="dogtracker"/);
    }
  }
});

// The fixture reproduces what useCloudDogs reads from SQLite in plain JS (the
// app's database lives in the native module, not in a debug JS screen). Store
// the same rows in a real database and compare.
test.each(FIXTURE_NAMES)('%s: the rows read the same as the real CloudDatabase reads them', async name => {
  const fixture = buildFixture(name);
  const db = createMemoryConnection();
  try {
    await createDogDatabase(db).initialize();
    const cloud = createCloudDatabase(db);
    await cloud.initialize();
    const insert = async (table, row) => {
      const columns = new Set((await db.executeAsync(`PRAGMA table_info(${table})`)).results.map(c => c.name));
      const keys = Object.keys(row).filter(key => columns.has(key));
      await db.executeAsync(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`,
        keys.map(key => row[key]));
    };
    for (const row of fixture.raw.ble) await insert('dog_status', row);
    for (const row of fixture.raw.cloud) await insert('supabase_dog_status', row);
    const owner = fixture.cloudSync.ownerId;
    const since = fixture.now - MAX_AGE_MS;
    const pick = row => [row.slave_id, row.master_id, row.source, Number(row.track_at), row.slave_lat, row.slave_lon,
      row.battery_percentage, row.usb_present, row.environment?.environment ?? null];
    const order = (left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right));
    expect((await cloud.latestBySlave(owner, since)).map(pick).sort(order))
      .toEqual(fixture.cloudDogs.rows.map(pick).sort(order));
    expect((await cloud.latestStatusRows(owner, since, fixture.now)).map(pick).sort(order))
      .toEqual(fixture.cloudDogs.packets.map(pick).sort(order));
    const store = createHoldStore();
    store.ingest(await cloud.holdRows(owner, fixture.now - HOLD_LOOKBACK_MS, null));
    expect(store.holds(fixture.now)).toEqual(fixture.cloudDogs.holds);
    expect(store.ranges()).toEqual(fixture.cloudDogs.ranges);
  } finally { db.close(); }
});

// The real MapScreen, given what App hands it for a fixture.
async function renderFixture(name) {
  const MapView = require('react-native-maps').default;
  const { Marker } = require('react-native-maps');
  const { Platform } = require('react-native');
  const NativePlatform = require('../specs/NativeTrackingPlatform').default;
  const MapScreen = require('../src/screens/MapScreen').default;
  const { GOOGLE_MAP_PROVIDER } = require('../src/map/GoogleMapProvider');
  const { emptyLiveRoute } = require('../src/tracking/LiveRouteWindow');
  const originalOS = Platform.OS;
  Platform.OS = 'android';
  NativePlatform.isMapConfigured.mockReturnValue(true);
  const fixture = buildFixture(name);
  const live = {
    tracking: { mode: 'real', point: {}, route: emptyLiveRoute(), positionSamples: [], ready: { real: true },
      errors: {}, initialSnapshotReady: true, foreground: true,
      preferences: { ready: true, busy: false, value: DEFAULT_TRACKING_PREFERENCES },
      saveTrackingPreferences: jest.fn() },
    phone: { enabled: true }, cloudDogs: { rows: [] }, cloudSync: { ownerId: 'real' },
    history: { key: 'live', preferences: { source: 'local', dogAliases: {} } },
  };
  const inputs = applyScreenFixture(fixture, live);
  let renderer;
  await act(async () => {
    renderer = Renderer.create(<MapScreen tracking={inputs.tracking} phone={inputs.phone} history={inputs.history}
      cloudDogs={inputs.cloudDogs} cloudOwner={inputs.cloudSync.ownerId} bottomInset={80}
      mapProvider={GOOGLE_MAP_PROVIDER} fixture={fixture} />);
  });
  await act(async () => renderer.root.findByType(MapView).props.onMapReady());
  await act(async () => renderer.root.findByType(MapView).props.onMapLoaded());
  const markers = renderer.root.findAllByType(Marker).map(node => node.props.identifier).filter(Boolean);
  const { Polygon, Polyline } = require('react-native-maps');
  const { colors } = require('../src/theme/tokens');
  const rings = renderer.root.findAllByType(Polygon).length;
  const redLines = renderer.root.findAllByType(Polyline)
    .filter(node => node.props.strokeColor === colors.critLine).length;
  const text = JSON.stringify(renderer.toJSON());
  await act(async () => { renderer.unmount(); });
  Platform.OS = originalOS;
  return { markers, rings, redLines, text, saved: live.tracking.saveTrackingPreferences };
}

test('the real map draws a fixture: receiver 3 neither drawn nor its battery shown as ours', async () => {
  const good = await renderFixture('all-good');
  expect(good.markers).toEqual(expect.arrayContaining(['real:fixture:all-good-dog-4', 'real:fixture:all-good-dog-6', 'real:fixture:all-good-dog-8']));
  // The receiver itself is never drawn; its ring is.
  expect(good.markers.some(id => id.endsWith('-master'))).toBe(false);
  expect(good.rings).toBe(1);
  expect(good.redLines).toBe(0);
  expect(good.text).toContain('64%');
  const connecting = await renderFixture('receiver-connecting');
  expect(connecting.markers).toEqual(expect.arrayContaining(['real:fixture:receiver-connecting-dog-4',
    'real:fixture:receiver-connecting-dog-6', 'real:fixture:receiver-connecting-dog-8']));
  expect(connecting.markers.some(id => id.endsWith('-master'))).toBe(false);
  expect(connecting.rings).toBe(0);
  expect(connecting.text).not.toContain('64%');
  const indoor = await renderFixture('dog-indoor');
  expect(indoor.text).toContain('小黑');
  expect(indoor.text).toContain('室內');
  expect(good.saved).not.toHaveBeenCalled();
});

test('the real map draws the range ring and the red line only where the rules say', async () => {
  const counts = async name => {
    const { rings, redLines } = await renderFixture(name);
    return [rings, redLines];
  };
  expect(await counts('range-out')).toEqual([1, 1]);
  expect(await counts('range-near-edge')).toEqual([1, 0]);
  expect(await counts('range-returning')).toEqual([1, 0]);
  expect(await counts('range-stale-inside')).toEqual([1, 0]);
  expect(await counts('receiver-disconnected')).toEqual([0, 0]);
  expect(await counts('cloud-only')).toEqual([0, 0]);
});
