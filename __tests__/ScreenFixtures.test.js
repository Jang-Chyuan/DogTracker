import { t as i18nT } from '../src/i18n';
import fs from 'fs';
import path from 'path';
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Linking } from 'react-native';
import {
  applyScreenFixture, buildFixture, FIXTURE_NAMES, FIXTURE_NOW, FIXTURE_ORIGIN, fixtureNameFromUrl,
  fixturePageFromUrl,
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
import { LATEST_SINCE } from '../src/cloud/useCloudDogs';
import { dogMarkers } from '../src/map/DogMarkers';
import { lastTimeText } from '../src/tracking/DogFreshness';
import { createHoldStore, HOLD_LOOKBACK_MS } from '../src/placement/HoldStore';
import { coldStartCoordinates, frameAllCoordinates, framePadding, phoneFix } from '../src/map/MapFraming';
import { edgeHints } from '../src/map/EdgeHints';
import { CARD_ACTIVITY_LOOKBACK_MS, dogCardReadings } from '../src/activity/DogCardReadings';
import { dogCard, phoneReading } from '../src/map/DogCardModel';
import { cloudClock, dogFreshness, isIndoorHold } from '../src/tracking/DogFreshness';

// Where each dog lands on a 392×830 dp screen (Pixel 4a) once `coordinates`
// are fitted into the part left by the top controls (100 dp) and the card
// (260 dp), like fitToCoordinates with the framing padding: a flat
// projection, close enough over a few km.
function fitProjection(coordinates, markers, { width = 392, height = 830, top = 100, bottom = 260 } = {}) {
  const pad = framePadding(markers);
  const lats = coordinates.map(point => point.latitude);
  const lons = coordinates.map(point => point.longitude);
  const [south, north, west, east] = [Math.min(...lats), Math.max(...lats), Math.min(...lons), Math.max(...lons)];
  const cos = Math.cos(((south + north) / 2) * Math.PI / 180);
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - top - bottom - pad.top - pad.bottom;
  const scale = Math.min(innerWidth / Math.max(1e-9, (east - west) * cos), innerHeight / Math.max(1e-9, north - south));
  const cx = pad.left + innerWidth / 2;
  const cy = top + pad.top + innerHeight / 2;
  const project = point => ({ x: cx + (point.longitude - (west + east) / 2) * cos * scale,
    y: cy - (point.latitude - (south + north) / 2) * scale });
  const points = Object.fromEntries(markers.map(marker => [marker.slaveId, project(marker.coordinate)]));
  return { points, view: { width, height, top, bottom } };
}

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
  // MapScreen draws every dog that has had a position, as DogMarkers says.
  const drawnDogs = merged.filter(dog => dog.coordinate);
  const markers = dogMarkers(drawnDogs, { now, cloud: fixture.cloudSync, ranges: dogs.ranges,
    aliases: fixture.dogAliases });
  return {
    markers,
    marker: id => markers.find(marker => marker.slaveId === id),
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
    const places = [...fixture.raw.ble, ...fixture.raw.cloud, ...fixture.raw.history]
      .filter(row => row.slave_lat || row.slave_lon)
      .map(row => ({ latitude: row.slave_lat, longitude: row.slave_lon }))
      // (Today's route is checked for the history fixtures, which draw it.)
      .concat(fixture.phoneRoute, name.startsWith('history-') ? fixture.raw.today : []);
    for (const place of places) {
      // Invented, never the team's real area: within ~2 km of the station,
      // except the far dogs of the framing fixtures, which lie west and south
      // (away from the real area, north of the station) within ~10 km.
      const far = ['dogs-offscreen', 'cold-start-far-cloud'].includes(name);
      expect(place.latitude - FIXTURE_ORIGIN.latitude).toBeLessThan(0.02);
      expect(FIXTURE_ORIGIN.latitude - place.latitude).toBeLessThan(far ? 0.1 : 0.02);
      expect(Math.abs(place.longitude - FIXTURE_ORIGIN.longitude)).toBeLessThan(far ? 0.1 : 0.02);
    }
    for (const row of [...fixture.raw.ble, ...fixture.raw.cloud, ...fixture.raw.history]) {
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

test('signed-out-map: no account, only receiver 7\'s own dogs; nothing from the cloud', async () => {
  const state = await screen('signed-out-map');
  expect(state.fixture.cloudSync.ownerId).toBeNull();
  // The phone still holds rows an earlier account downloaded; none is drawn.
  expect(state.fixture.raw.cloud.length).toBeGreaterThan(0);
  expect(state.fixture.cloudDogs.rows).toEqual([]);
  expect(state.fixture.cloudDogs.packets.every(row => row.source === 'ble')).toBe(true);
  expect(state.drawn).toEqual([4, 5]);
  expect(state.dogs.every(dog => dog.source !== 'cloud')).toBe(true);
  // Signed out is a choice, not a cloud failure: no problem badge on any dog.
  expect(state.link).toBe('receiving');
  expect(state.ring.radiusMeters).toBe(1000);
  expect(state.markers.every(marker => !marker.problem)).toBe(true);
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
  // Still drawn at its last position, and not yet 「沒有新位置」 (5 < 10 minutes).
  expect(state.drawn).toEqual([4, 6, 8]);
  expect(state.marker(4)).toMatchObject({ stale: false, problem: false, size: 40 });
  // Disconnected: no range ring, although the receiver's last position is known.
  expect(state.ring).toBeNull();
  // The judgement made before the drop stays as it was (豆豆 in range).
  expect(rangeView(state.ranges[4]).status).toBe(RANGE_STATUS.IN);
});

test('range-out: 豆豆 walked 1.6 km away — out of range, red dashed line from the ring edge', async () => {
  const state = await screen('range-out');
  expect(state.link).toBe('receiving');
  expect(state.ring).not.toBeNull();
  const dog4 = state.dog(4);
  expect(distanceMeters(state.ring.center, dog4.coordinate)).toBeGreaterThan(1550);
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
  expect(dog6.heldReason).toBe(i18nT('c114'));
  expect(dog6.stale).toBe(false);
  // Held at its last clear fixes, not at 0,0 or a drifting point.
  expect(Math.abs(dog6.coordinate.latitude - (FIXTURE_ORIGIN.latitude - 0.0018))).toBeLessThan(0.0001);
  expect(Math.abs(dog6.coordinate.longitude - (FIXTURE_ORIGIN.longitude + 0.0024))).toBeLessThan(0.0001);
  expect(state.dogs.filter(dog => dog.heldReason).map(dog => dog.slaveId)).toEqual([6]);
});

test('dogs-aged: current, four minutes (still current), forty minutes (grey, red "!")', async () => {
  const state = await screen('dogs-aged');
  const byId = Object.fromEntries(state.dogs.map(dog => [dog.slaveId, dog]));
  const age = dog => Math.round((FIXTURE_NOW - dog.lastPacketAt) / 60000);
  expect([age(byId[4]), age(byId[6]), age(byId[8])]).toEqual([0, 4, 40]);
  expect(state.dogs.some(dog => dog.heldReason)).toBe(false);
  expect(state.drawn).toEqual([4, 6, 8]);
  expect(state.markers.map(marker => [marker.tag, marker.stale, marker.problem, marker.size])).toEqual([
    ['豆豆', false, false, 40], ['小黑', false, false, 40], ['阿福', true, true, 48]]);
  // 阿福 came from the cloud: judged against the last download (5 s ago).
  expect(state.marker(8).label).toBe(`阿福，沒有新位置，最後 ${lastTimeText(FIXTURE_NOW - 40 * 60000, FIXTURE_NOW)}`);
});

test('dog-low-battery: 15% is a problem, 15% while charging is not', async () => {
  const state = await screen('dog-low-battery');
  expect(state.dogs.some(dog => dog.heldReason)).toBe(false);
  expect(state.markers.map(marker => [marker.tag, marker.problem, marker.size, marker.label])).toEqual([
    ['豆豆', true, 48, '豆豆，電量 15%，偏低'], ['小黑', false, 40, '小黑，充電中 15%'], ['阿福', false, 40, '阿福']]);
});

test('dog-indoor: house and 「小黑・室內」 on the map, read out the same', async () => {
  const state = await screen('dog-indoor');
  expect(state.marker(6)).toMatchObject({ indoor: true, stale: false, problem: false, size: 40,
    tag: '小黑・室內', label: '小黑・室內' });
  expect(state.markers.filter(marker => marker.indoor).map(marker => marker.slaveId)).toEqual([6]);
});

test('dogs-indoor-stacked: three dogs held in one kennel, their tags merge into 「3 隻・室內」', async () => {
  const { nameTags } = require('../src/map/DogMarkers');
  const state = await screen('dogs-indoor-stacked');
  expect(state.markers.filter(marker => marker.indoor).map(marker => marker.slaveId)).toEqual([4, 6, 8]);
  const held = state.markers.filter(marker => marker.indoor);
  // Within a few metres of each other.
  for (const marker of held) expect(distanceMeters(held[0].coordinate, marker.coordinate)).toBeLessThan(15);
  // On screen (any zoom where 15 m is a few dp) they are one group.
  const points = Object.fromEntries(state.markers.map((marker, index) => [marker.slaveId,
    marker.indoor ? { x: 200 + index, y: 300 + index } : { x: 40, y: 40 }]));
  const tags = nameTags(state.markers, points);
  expect(Object.values(tags).filter(Boolean).map(tag => tag.text).sort()).toEqual(['3 隻・室內', '狗 5']);
});

test('dogs-overlap: three dogs together merge into 「3 隻」 with a red dot for 阿福\'s battery', async () => {
  const { nameTags } = require('../src/map/DogMarkers');
  const state = await screen('dogs-overlap');
  expect(state.markers.map(marker => [marker.slaveId, marker.problem])).toEqual([[4, false], [6, false], [8, true]]);
  for (const marker of state.markers) {
    expect(distanceMeters(state.markers[0].coordinate, marker.coordinate)).toBeLessThan(15);
  }
  const points = Object.fromEntries(state.markers.map((marker, index) => [marker.slaveId, { x: 200 + index, y: 300 }]));
  expect(Object.values(nameTags(state.markers, points)).filter(Boolean))
    .toEqual([{ text: '3 隻', group: 3, problem: true, members: [4, 6, 8] }]);
});

test('dogs-overlap: tapping 「3 隻」 lists the three dogs, 阿福 with its low battery', async () => {
  const state = await screen('dogs-overlap');
  expect(state.marker(8).note).toEqual({ text: '電量 12%・偏低', level: 'crit' });
  expect(state.marker(4).note).toBeNull();
});

test('dogs-offscreen: the first view frames 豆豆 and the phone; five dogs off the left (3 faces + 「+2」, 阿福 first), one off the right', async () => {
  const state = await screen('dogs-offscreen');
  const phone = phoneFix(state.fixture.livePhone);
  const first = coldStartCoordinates(state.markers, phone);
  expect(first).toEqual([state.marker(4).coordinate, phone]);
  expect(state.marker(8)).toMatchObject({ problem: true, stale: true, source: 'cloud' });
  const { points, view } = fitProjection(first, state.markers);
  const hints = edgeHints(state.markers, points, view);
  expect(hints.map(hint => hint.side)).toEqual(['left', 'right']);
  const [left, right] = hints;
  expect(left.faces.map(face => face.slaveId)[0]).toBe(8);
  expect(left.faces).toHaveLength(3);
  expect(left.extra).toBe(2);
  expect(left.slaveIds.sort()).toEqual([2, 3, 5, 6, 8]);
  expect(right.slaveIds).toEqual([9]);
  expect(left.label).toMatch(/^左邊畫面外有 5 隻狗：阿福、.*，其中阿福有問題，點兩下移過去$/);
});

test('cold-start-far-cloud: 阿福 (26 h, ~10 km) is left out of the first view; 框住全部 frames it', async () => {
  const state = await screen('cold-start-far-cloud');
  const phone = phoneFix(state.fixture.livePhone);
  const far = state.marker(8);
  expect(far).toMatchObject({ source: 'cloud', stale: true });
  expect(distanceMeters(far.coordinate, state.marker(4).coordinate)).toBeGreaterThan(9000);
  const first = coldStartCoordinates(state.markers, phone);
  expect(first).toEqual([state.marker(4).coordinate, state.marker(5).coordinate, phone]);
  const { points, view } = fitProjection(first, state.markers);
  // Off the first view: an edge hint points at it.
  expect(edgeHints(state.markers, points, view).flatMap(hint => hint.slaveIds)).toEqual([8]);
  const all = frameAllCoordinates(state.markers, phone);
  expect(all).toContainEqual(far.coordinate);
  const fitted = fitProjection(all, state.markers);
  expect(edgeHints(state.markers, fitted.points, fitted.view)).toEqual([]);
});

test('dog-never-fixed: collar 9 talks but never had a fix — not drawn', async () => {
  const state = await screen('dog-never-fixed');
  expect(state.dogs.map(dog => dog.slaveId)).toEqual([4, 9]);
  expect(state.dog(9).coordinate).toBeNull();
  expect(state.markers.map(marker => marker.slaveId)).toEqual([4]);
});

test('dog-stale-24h: a position 26 hours old stays on the map, grey with the date', async () => {
  const state = await screen('dog-stale-24h');
  expect(state.marker(8)).toMatchObject({ stale: true, problem: true, size: 48, tag: '阿福',
    label: `阿福，沒有新位置，最後 ${lastTimeText(FIXTURE_NOW - 26 * 3600000, FIXTURE_NOW)}` });
  expect(lastTimeText(FIXTURE_NOW - 26 * 3600000, FIXTURE_NOW)).toContain('/');
  expect(state.marker(4)).toMatchObject({ stale: false, problem: false });
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
  // Buttons on a fixture screen never save into the real preferences, history
  // query or dog names (the card's 看軌跡 and rename).
  expect(inputs.tracking.saveTrackingPreferences).not.toBe(live.tracking.saveTrackingPreferences);
  await inputs.tracking.saveTrackingPreferences({ showTrails: true });
  expect(live.tracking.saveTrackingPreferences).not.toHaveBeenCalled();
  live.history.save = jest.fn();
  expect(await applyScreenFixture(fixture, live).history.save({ slaves: [6] })).toBe(true);
  expect(live.history.save).not.toHaveBeenCalled();
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

test('a fixture link can open a settings page of its state (&page=)', async () => {
  const url = 'dogtracker://dev/fixture?name=receiver-connecting&page=receiver';
  expect(fixtureNameFromUrl(url)).toBe('receiver-connecting');
  expect(fixturePageFromUrl(url)).toBe('receiver');
  expect(fixturePageFromUrl('dogtracker://dev/fixture?name=all-good&page=nowhere')).toBeNull();
  expect(fixturePageFromUrl('dogtracker://dev/fixture?name=all-good')).toBeNull();
  const initial = jest.spyOn(Linking, 'getInitialURL').mockResolvedValue(url);
  const listen = jest.spyOn(Linking, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
  let result;
  function Probe() {
    result = useScreenFixture(true);
    return null;
  }
  await act(async () => { Renderer.create(<Probe />); });
  expect(result).toMatchObject({ name: 'receiver-connecting', openRoute: 'receiver' });
  // The settings fixtures open their own page; the map ones none.
  expect(buildFixture('settings-problems').openRoute).toBe('settings');
  expect(buildFixture('phone-permissions-missing').openRoute).toBe('phone');
  expect(buildFixture('all-good').openRoute).toBeNull();
  initial.mockRestore();
  listen.mockRestore();
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
    // What useCloudDogs asks for: every dog's newest rows, however old.
    const since = LATEST_SINCE;
    const pick = row => [row.slave_id, row.master_id, row.source, Number(row.track_at), row.slave_lat, row.slave_lon,
      row.battery_percentage, row.usb_present, row.environment?.environment ?? null];
    const order = (left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right));
    // Signed out, useCloudDogs reads no cloud rows (latestBySlave needs an owner).
    expect((owner ? await cloud.latestBySlave(owner, since) : []).map(pick).sort(order))
      .toEqual(fixture.cloudDogs.rows.map(pick).sort(order));
    expect((await cloud.latestStatusRows(owner, since, fixture.now)).map(pick).sort(order))
      .toEqual(fixture.cloudDogs.packets.map(pick).sort(order));
    const store = createHoldStore();
    store.ingest(await cloud.holdRows(owner, fixture.now - HOLD_LOOKBACK_MS, null));
    expect(store.holds(fixture.now)).toEqual(fixture.cloudDogs.holds);
    expect(store.ranges()).toEqual(fixture.cloudDogs.ranges);
    // A card fixture's activity and battery readings, as the open card reads them.
    if (fixture.openDog != null) {
      const cardSince = fixture.now - CARD_ACTIVITY_LOOKBACK_MS;
      expect(dogCardReadings(await cloud.dogCardRows(owner, fixture.openDog, cardSince), fixture.now))
        .toEqual(dogCardReadings(await fixture.readCardRows(fixture.openDog, cardSince), fixture.now));
    }
  } finally { db.close(); }
});

const findAncestor = (node, test) => {
  for (let item = node.parent; item; item = item.parent) if (test(item)) return item;
  return null;
};

// The real MapScreen, given what App hands it for a fixture.
async function renderFixture(name, { edits = null, inspect = null } = {}) {
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
    history: { key: 'live', preferences: { source: 'local', dogAliases: {} }, save: jest.fn() },
    dogAvatars: { avatars: {}, save: jest.fn() },
  };
  const inputs = applyScreenFixture(fixture, live, edits);
  let renderer;
  await act(async () => {
    renderer = Renderer.create(<MapScreen tracking={inputs.tracking} phone={inputs.phone} history={inputs.history}
      cloudDogs={inputs.cloudDogs} cloudOwner={inputs.cloudSync.ownerId} bottomInset={80}
      dogAvatars={inputs.dogAvatars} mapProvider={GOOGLE_MAP_PROVIDER} fixture={fixture}
      todayRoute={inputs.todayRoute} />);
  });
  await act(async () => renderer.root.findByType(MapView).props.onMapReady());
  await act(async () => renderer.root.findByType(MapView).props.onMapLoaded());
  const markers = renderer.root.findAllByType(Marker).map(node => node.props.identifier).filter(Boolean);
  const { Polygon, Polyline } = require('react-native-maps');
  const { colors } = require('../src/theme/tokens');
  const rings = renderer.root.findAllByType(Polygon).length;
  expect(renderer.root.findAllByType(Polyline).filter(node => node.props.testID === 'range-ring')).toHaveLength(rings);
  const redLines = renderer.root.findAllByType(Polyline)
    .filter(node => node.props.strokeColor === colors.critLine).length;
  const text = JSON.stringify(renderer.toJSON());
  // Every photo face drawn, where, and whether it is greyscale.
  const photos = renderer.root.findAll(node => node.props.testID === 'dog-avatar-photo' && typeof node.type === 'string')
    .map(node => {
      const inCard = !!findAncestor(node, item => item.props.testID === 'dog-card');
      // On the map the photo is an SVG image (drawn into the marker bitmap),
      // greyed by a saturate-0 filter; elsewhere an Image with a CSS filter.
      const vector = node.findAll(child => child.props.href?.uri)[0];
      if (vector) {
        return { inCard, grey: vector.props.filter === 'url(#grey)', uri: vector.props.href.uri, vector: true };
      }
      const image = node.findAll(child => child.props.source?.uri)[0];
      const style = [image.props.style].flat(3).filter(Boolean);
      return { inCard, grey: style.some(item => item.filter?.[0]?.grayscale === 1), uri: image.props.source.uri };
    });
  const result = { markers, rings, redLines, text, photos, saved: live.tracking.saveTrackingPreferences, live,
    renderer, inputs };
  if (inspect) await inspect(result);
  await act(async () => { renderer.unmount(); });
  Platform.OS = originalOS;
  return result;
}

// The first map fixture lazily loads the RN screen; startup latency is measured separately.
test('the real map draws a fixture: receiver 3 neither drawn nor its battery shown as ours', async () => {
  const good = await renderFixture('all-good');
  expect(good.markers).toEqual(expect.arrayContaining(['real:fixture:all-good-dog-4', 'real:fixture:all-good-dog-6', 'real:fixture:all-good-dog-8']));
  // The receiver itself is never drawn; its ring is.
  expect(good.markers.some(id => id.endsWith('-master'))).toBe(false);
  expect(good.rings).toBe(1);
  expect(good.redLines).toBe(0);
  // The receiver's own battery is not on the map (settings → receiver, S2).
  expect(good.text).not.toContain('64%');
  const connecting = await renderFixture('receiver-connecting');
  expect(connecting.markers).toEqual(expect.arrayContaining(['real:fixture:receiver-connecting-dog-4',
    'real:fixture:receiver-connecting-dog-6', 'real:fixture:receiver-connecting-dog-8']));
  expect(connecting.markers.some(id => id.endsWith('-master'))).toBe(false);
  expect(connecting.rings).toBe(0);
  const indoor = await renderFixture('dog-indoor');
  expect(indoor.text).toContain('小黑');
  expect(indoor.text).toContain(i18nT('c114'));
  expect(good.saved).not.toHaveBeenCalled();
}, 15000);

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

// ---- the dog's card (046) ---------------------------------------------------

// The card MapScreen opens for a card-* fixture: the same calls it makes.
// The fixture's own address lookup (053a), asked like the card asks it.
async function addressOf(lookup, point) {
  let value = lookup.lookup(point);
  for (let tries = 0; value === undefined && tries < 50; tries += 1) {
    await new Promise(resolve => setTimeout(resolve, 50));
    value = lookup.lookup(point);
  }
  return value;
}

async function card(name) {
  const state = await screen(name);
  const { fixture } = state;
  const dog = state.dog(fixture.openDog);
  const now = fixture.now;
  const freshness = dogFreshness(dog, { now, cloud: fixture.cloudSync });
  const readings = dogCardReadings(await fixture.readCardRows(dog.slaveId, now - CARD_ACTIVITY_LOOKBACK_MS), now);
  const model = dogCard(dog, { freshness, range: fixture.cloudDogs.ranges[dog.slaveId] ?? null,
    battery: readings.battery, activity: readings.activity, phone: phoneReading(fixture.livePhone, now), now,
    reference: freshness.source === 'cloud' ? cloudClock(fixture.cloudSync, now) : now,
    name: state.label(dog),
    address: isIndoorHold(dog) ? await addressOf(fixture.addressLookup, dog.coordinate) : null });
  const rows = Object.fromEntries(model.rows.map(row => [row.key, row]));
  return { model, rows, keys: model.rows.map(row => row.key), state };
}

test('card-ok: in range, 62%, resting 18 minutes; no 位置 row', async () => {
  const { model, rows, keys } = await card('card-ok');
  expect(model.name).toBe('豆豆');
  expect(model.sourceLabel).toBe('訊號源 4');
  expect(keys).toEqual(['battery', 'range', 'activity']);
  expect(rows.battery).toMatchObject({ value: '62%', tone: null });
  expect(rows.range).toMatchObject({ value: i18nT('c348'), tone: null });
  expect(rows.activity).toMatchObject({ value: i18nT('c069'), detail: '已 18 分鐘', activityTone: 'rest', at: null });
  expect(model.headline).toMatchObject({ kind: 'distance', suffix: i18nT('c064') });
});

test('card-near-edge (A3): 快離開接收範圍 in amber, no distance written', async () => {
  const { rows, keys, state } = await card('card-near-edge');
  expect(keys).toEqual(['battery', 'range', 'activity']);
  expect(rows.range).toMatchObject({ value: i18nT('c067'), tone: 'warn' });
  // The marker itself does not change for 快離開.
  expect(state.marker(4)).toMatchObject({ problem: false });
  expect(rows.activity).toMatchObject({ value: i18nT('c069'), detail: '已 18 分鐘' });
});

test('card-problems (A3b): every problem row red, 活動量 「—」, the distance is to the last position', async () => {
  const { model, rows, keys } = await card('card-problems');
  expect(keys).toEqual(['position', 'battery', 'range', 'activity']);
  expect(rows.position).toMatchObject({ value: '沒有新位置・最後 09:05', tone: 'crit' });
  expect(rows.battery).toMatchObject({ value: '15%・偏低', tone: 'crit' });
  expect(rows.range).toMatchObject({ value: i18nT('c078'), tone: 'crit' });
  expect(rows.activity).toMatchObject({ value: '—', tone: null });
  expect(model.headline).toMatchObject({ kind: 'distance', suffix: '離手機・最後位置' });
  expect(model.headline.distance).toMatch(/km$/);
  expect(model.rows.map(row => row.speech).join('；'))
    .toBe('位置，沒有新位置，最後 09:05；電量 15%，偏低；接收範圍，不在接收範圍；活動量，沒有資料');
});

test('card-indoor (A7b): 位置 「室內」 over its address, charging 62%, resting 40 minutes, no 接收範圍 row', async () => {
  const { model, rows, keys, state } = await card('card-indoor');
  expect(state.marker(6)).toMatchObject({ indoor: true, tag: '小黑・室內' });
  expect(keys).toEqual(['position', 'battery', 'activity']);
  expect(rows.position).toMatchObject({ value: i18nT('c114'), tone: null, detail: '桃園區中正路 1 號附近', twoLine: true,
    speech: '位置，室內，桃園區中正路 1 號附近' });
  expect(rows.battery).toMatchObject({ value: '充電中 62%', tone: null });
  expect(rows.activity).toMatchObject({ value: i18nT('c069'), detail: '已 40 分鐘' });
  expect(model.headline).toMatchObject({ kind: 'distance', suffix: '離手機・室內' });
});

test('dog-indoor-no-address: offline, nothing is asked; 位置 is 「室內」 alone, no second line', async () => {
  const { rows, state } = await card('dog-indoor-no-address');
  expect(state.marker(6)).toMatchObject({ indoor: true, tag: '小黑・室內' });
  expect(rows.position).toMatchObject({ value: i18nT('c114'), detail: null, twoLine: true });
});

test('card-indoor-geocoder asks this phone\'s own Geocoder (none under jest: no address)', async () => {
  const { rows } = await card('card-indoor-geocoder');
  expect(rows.position).toMatchObject({ value: i18nT('c114'), detail: null });
});

test('card-cloud-dog: a cloud dog has no 接收範圍 row; running hard (劇烈活動)', async () => {
  const { model, rows, keys } = await card('card-cloud-dog');
  expect(model.name).toBe('小黑');
  expect(keys).toEqual(['battery', 'activity']);
  expect(rows.battery.value).toBe('76%');
  expect(rows.activity).toMatchObject({ value: i18nT('c350'), activityTone: 'vigorous' });
  expect(rows.activity.detail).toMatch(/^已 \d+ 分鐘$/);
  // The direction and distance are from the phone, cloud dog or not.
  expect(model.headline.kind).toBe('distance');
});

test('card-phone-no-fix: the headline says 手機沒有定位 instead of a direction', async () => {
  const { model, state } = await card('card-phone-no-fix');
  expect(phoneFix(state.fixture.livePhone)).toBeNull();
  expect(model.headline).toEqual({ kind: 'no-phone', text: i18nT("c726") });
  expect(model.headlineSpeech).toBe('豆豆，手機沒有定位');
});

test('card-readings-old: readings older than the position carry their time', async () => {
  const { model, rows } = await card('card-readings-old');
  expect(model.stale).toBe(false);
  expect(rows.battery).toMatchObject({ value: '62%（09:11）', tone: null });
  expect(rows.activity).toMatchObject({ value: i18nT('c069'), detail: '已 12 分鐘' });
  expect(new Date(rows.activity.at).getMinutes()).toBe(11);
});

test('the real map opens a card fixture\'s card with its rows', async () => {
  const problems = await renderFixture('card-problems');
  for (const words of ['豆豆', '訊號源 4', '沒有新位置・最後 09:05', '15%・偏低', '不在接收範圍', '看軌跡', '離手機・最後位置']) {
    expect(problems.text).toContain(words);
  }
  // No receiver row on a dog's card.
  expect(problems.text).not.toContain(i18nT('c075'));
  const indoor = await renderFixture('card-indoor');
  expect(indoor.text).toContain('充電中 62%');
  expect(indoor.text).not.toContain(i18nT('c066'));
});

// ---- the dog's page and faces (047) ----------------------------------------

test('dog-edit: card-ok with the pencil pressed opens 豆豆\'s page (A5) over its card', async () => {
  const fixture = buildFixture('dog-edit');
  expect(fixture).toMatchObject({ openDog: 4, openPage: 'edit' });
  const edit = await renderFixture('dog-edit');
  expect(edit.text).toContain('dog-profile');
  expect(edit.text).toContain('訊號源 4');
  // card-ok itself opens only the card.
  const ok = await renderFixture('card-ok');
  expect(ok.text).toContain('dog-card');
  expect(ok.text).not.toContain('dog-profile');
});

test('dog-photo-avatar: 小黑\'s photo on the map and on its card, in colour', async () => {
  const { photos, text } = await renderFixture('dog-photo-avatar');
  expect(text).toContain('小黑');
  expect(photos.filter(photo => photo.inCard)).toHaveLength(1);
  expect(photos.filter(photo => !photo.inCard)).toEqual([expect.objectContaining({ vector: true })]);
  expect(photos.every(photo => !photo.grey && photo.uri.startsWith('data:image/jpeg;base64,'))).toBe(true);
  const state = await screen('dog-photo-avatar');
  expect(state.marker(6)).toMatchObject({ stale: false });
});

test('dog-photo-stale: 阿福\'s photo turns greyscale on the map and on its card', async () => {
  const state = await screen('dog-photo-stale');
  expect(state.marker(8)).toMatchObject({ stale: true, problem: true });
  const { photos } = await renderFixture('dog-photo-stale');
  expect(photos.filter(photo => photo.inCard)).toEqual([expect.objectContaining({ grey: true })]);
  expect(photos.filter(photo => !photo.inCard)).toEqual([expect.objectContaining({ grey: true })]);
});

test('on a fixture, the dog page\'s name and face live in memory, never in this phone\'s data', async () => {
  const fixture = buildFixture('dog-edit');
  const edits = { aliases: null, avatars: null, setAliases: jest.fn(), setAvatars: jest.fn() };
  const live = { tracking: { preferences: { value: {} }, ready: {}, errors: {} }, phone: {}, cloudSync: {},
    history: { preferences: { dogAliases: { 4: 'real' } }, save: jest.fn() },
    dogAvatars: { avatars: { 4: { kind: 'art', art: 'curly', color: 'blue' } }, save: jest.fn() } };
  const inputs = applyScreenFixture(fixture, live, edits);
  expect(inputs.history.preferences.dogAliases[4]).toBe('豆豆');
  expect(inputs.dogAvatars.avatars).toEqual({});
  expect(await inputs.history.save({ ...inputs.history.preferences, dogAliases: { 4: '小白' } })).toBe(true);
  expect(edits.setAliases).toHaveBeenCalledWith({ 4: '小白' });
  const face = { kind: 'art', art: 'short', color: 'mint' };
  expect(await inputs.dogAvatars.save(4, face)).toBe(true);
  expect(edits.setAvatars.mock.calls[0][0](null)).toEqual({ 4: face });
  expect(live.history.save).not.toHaveBeenCalled();
  expect(live.dogAvatars.save).not.toHaveBeenCalled();
  // What was changed is drawn.
  const changed = applyScreenFixture(fixture, live, { ...edits, aliases: { 4: '小白' }, avatars: { 4: face } });
  expect(changed.history.preferences.dogAliases[4]).toBe('小白');
  expect(changed.dogAvatars.avatars[4]).toBe(face);
  // Off: the live names and faces, untouched.
  expect(applyScreenFixture(null, live).dogAvatars).toBe(live.dogAvatars);
});

test('the real map: the pencil opens the page, a new name and face show on the card and the map', async () => {
  let state = { aliases: null, avatars: null };
  const edits = { ...state, setAliases: value => { state = { ...state, aliases: value }; },
    setAvatars: value => { state = { ...state, avatars: typeof value === 'function' ? value(state.avatars) : value }; } };
  await renderFixture('card-ok', { edits, inspect: async ({ renderer, live }) => {
    const pencil = renderer.root.findAll(node => node.props.testID === 'dog-card-edit'
      && typeof node.props.onPress === 'function')[0];
    await act(async () => pencil.props.onPress());
    expect(renderer.root.findAll(node => node.props.testID === 'dog-profile')).not.toHaveLength(0);
    const name = renderer.root.findAll(node => node.props.testID === 'dog-profile-name'
      && typeof node.props.onPress === 'function')[0];
    await act(async () => name.props.onPress());
    const { TextInput } = require('react-native');
    await act(async () => renderer.root.findByType(TextInput).props.onChangeText('小白'));
    await act(async () => renderer.root.findByType(TextInput).props.onSubmitEditing());
    expect(live.history.save).not.toHaveBeenCalled();
  } });
  expect(state.aliases).toEqual({ 4: '小白', 6: '小黑', 8: '阿福' });
  const face = { kind: 'photo', uri: 'data:image/jpeg;base64,AAAA' };
  const after = await renderFixture('card-ok', { edits: { ...edits, aliases: state.aliases, avatars: { 4: face } } });
  expect(after.text).toContain('小白');
  expect(after.photos.filter(photo => photo.inCard)).toHaveLength(1);
  expect(after.photos.filter(photo => !photo.inCard)).toHaveLength(1);
});

test('a photo face is drawn into the map marker: tracked while it loads, fixed once it has', async () => {
  const { PHOTO_SETTLE_MS } = require('../src/map/GoogleTrackingMap');
  await renderFixture('dog-photo-avatar', { inspect: async ({ renderer }) => {
    const { Marker } = require('react-native-maps');
    const marker = id => renderer.root.findAllByType(Marker).find(node => node.props.identifier?.endsWith(`-dog-${id}`));
    // Every new marker follows its view until it has been laid out once
    // (else the SDK's default red pin shows for a moment).
    expect(marker(4).props.tracksViewChanges).toBe(true);
    const layout = id => marker(id).findAll(node => typeof node.props.onLayout === 'function'
      && node.props.collapsable === false)[0].props.onLayout();
    await act(async () => { layout(4); layout(6); await new Promise(resolve => setTimeout(resolve, 50)); });
    // Then an illustration keeps a fixed bitmap; a photo is followed until it loaded.
    expect(marker(4).props.tracksViewChanges).toBe(false);
    expect(marker(6).props.tracksViewChanges).toBe(true);
    const image = marker(6).findAll(node => node.props.href?.uri && typeof node.props.onLoad === 'function')[0];
    await act(async () => image.props.onLoad());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, PHOTO_SETTLE_MS + 100)); });
    expect(marker(6).props.tracksViewChanges).toBe(false);
  } });
});

// 「今天 x km」 (A1/A2, 判定表「右下『今天 x km』」): each phone state through
// the same pill the live map draws.
test.each([
  ['phone-recording', '今天 2.7 km', 'walk', false],
  ['phone-recording-off', '今天 2.7 km', 'walk-muted', true],
  ['phone-no-permission', '今天 2.7 km', 'walk-off', true],
  ['phone-no-route', '未記錄', 'walk-muted', true],
])('%s: the pill says %s with the %s icon', async (name, words, icon, muted) => {
  const { todayPill } = require('../src/tracking/TodayDistance');
  const fixture = buildFixture(name);
  const inputs = applyScreenFixture(fixture, {
    tracking: { ready: {}, errors: {}, preferences: { value: {} } }, phone: {}, cloudSync: {},
  });
  const pill = todayPill({ route: inputs.todayRoute, livePhone: fixture.livePhone, phone: inputs.phone });
  expect(pill).toMatchObject({ text: words, icon, muted });
  await renderFixture(name, { inspect: async ({ renderer }) => {
    const shown = renderer.root.findAll(node => node.props.testID === 'map-today' && typeof node.type === 'string');
    expect(shown).toHaveLength(1);
    expect(JSON.stringify(shown[0].findAll(node => typeof node.props.children === 'string')
      .map(node => node.props.children))).toContain(words);
    expect(renderer.root.findAll(node => node.props.testID === `map-today-icon-${icon}`
      && typeof node.type === 'string')).toHaveLength(1);
    // The gear sits top right; a missing location permission lights its red
    // dot (049), recording switched off does not.
    expect(renderer.root.findAll(node => node.props.testID === 'map-settings' && typeof node.type === 'string'))
      .toHaveLength(1);
    expect(renderer.root.findAll(node => node.props.testID === 'map-settings-dot' && typeof node.type === 'string'))
      .toHaveLength(name === 'phone-no-permission' ? 1 : 0);
  } });
});

test('phone-no-permission: no permission means no recording and no blue dot', () => {
  const fixture = buildFixture('phone-no-permission');
  const inputs = applyScreenFixture(fixture, {
    tracking: { ready: {}, errors: {}, preferences: { value: {} } }, phone: {}, cloudSync: {},
  });
  expect(inputs.phone).toMatchObject({ permission: 'denied', enabled: false });
  expect(fixture.livePhone.running).toBe(false);
  expect(phoneFix(fixture.livePhone)).toBeNull();
});

test('phone-no-route: yesterday\'s walk is not today\'s route', () => {
  expect(buildFixture('phone-no-route').todayRoute).toEqual({ count: 0, metres: 0, status: 'not-departed' });
  expect(buildFixture('phone-recording').todayRoute.count).toBeGreaterThan(300);
});

test('activity-* (A4): 小黑\'s page with the reads its name says', async () => {
  const { buildActivityView, activityPeriod } = require('../src/activity/views');
  const { activityViewInput } = require('../src/activity/ActivityData');
  const open = async (name, detail = 'raw') => {
    const fixture = buildFixture(name);
    const now = fixture.activityNow ?? fixture.now;
    const { mode, date } = fixture.activityView;
    const period = activityPeriod(mode, date);
    const first = await fixture.readActivityEarliest(6);
    const answer = await fixture.readActivity(6, { start: period.start, end: period.end, detail });
    return { fixture, view: buildActivityView({ mode, date, now, earliest: first ?? now, since: first,
      ...activityViewInput(answer) }) };
  };
  const day = await open('activity-day');
  expect(day.fixture).toMatchObject({ openDog: 6, openPage: 'activity' });
  expect(day.view.label).toBe('10/6（二）');
  expect(day.view.totals.missing).toBe(0);
  expect(day.view.totals.rest).toBeGreaterThan(8 * 60);
  expect(day.view.totals.vigorous).toBeGreaterThan(15);
  const gap = await open('activity-day-gap');
  expect(gap.view.rows[2]).toMatchObject({ rangeLabels: ['08:40–09:10', '11:05–11:20', '13:00–13:12'],
    additionalText: '另外 1 段', durationText: '1 小時 12 分' });
  const today = await open('activity-today');
  expect(today.view.label).toBe('10/7（三）今天');
  expect(today.view.points.at(-1).minute).toBe(FIXTURE_NOW - 60000);
  expect(today.view.points.at(-1).value).toBeLessThan(0.8);
  expect(today.view.rows[2].rangeLabels).toEqual(['08:40–09:10']);
  const week = await open('activity-week-gap', 'minute');
  expect(week.view.label).toBe('9/27（日）– 10/3（六）');
  expect(week.view.rows[2].rangeLabels).toEqual(['10/1（四）整天']);
  const month = await open('activity-month', 'minute');
  expect(month.view.rows[2].rangeLabels).toEqual(['9/12（六）整天', '9/20（日） 10:00–16:00']);
  const none = buildFixture('activity-none');
  expect(await none.readActivityEarliest(6)).toBeNull();
  expect(buildFixture('activity-card').openPage).toBeNull();
  expect(buildFixture('activity-year').activityView.mode).toBe('year');
  await expect(buildFixture('activity-error').readActivity(6, { start: 0, end: 1, detail: 'raw' })).rejects.toThrow();
  const hang = buildFixture('activity-loading').readActivity(6, { start: 0, end: 1, detail: 'raw' });
  expect(await Promise.race([hang, new Promise(resolve => setTimeout(() => resolve('waiting'), 20))])).toBe('waiting');
});

test('E09/E10 every fixture keeps history and activity reads inside its own dataset', async () => {
  const fixture = buildFixture('card-ok');
  const start = FIXTURE_NOW - 24 * 60 * 60000;
  const end = FIXTURE_NOW + 60000;
  const history = await fixture.history.readDay({ subject: 'dog', slaveId: 6, start, end });
  expect(history.rows.length).toBeGreaterThan(0);
  const card = await fixture.readCardRows(6, start);
  const activity = await fixture.readActivity(6, { start, end, detail: 'raw' });
  expect(activity.local).toEqual(card.local);
  expect(activity.cloud).toEqual(card.cloud);
  expect(await fixture.readActivityEarliest(6)).toBe(Math.min(...card.local.map(row => row.time)));
  const other = await fixture.readActivity(4, { start, end, detail: 'raw' });
  const otherCard = await fixture.readCardRows(4, start);
  expect(other.local).toEqual(otherCard.local);
  const live = { tracking: { preferences: {}, ready: {}, errors: {} }, phone: {}, cloudSync: {},
    history: { preferences: {}, readDay: jest.fn() }, dogAvatars: {} };
  const applied = applyScreenFixture(fixture, live, { aliases: { 6: '新名字' } });
  expect(applied.history.preferences.dogAliases[6]).toBe('新名字');
  expect(applied.history.readDay).toBe(fixture.history.readDay);
  expect(applied.historyCloud).toBeNull();
});


test('E10 activity-specific fixtures also read other dogs from their card rows', async () => {
  const fixture = buildFixture('activity-today');
  const start = FIXTURE_NOW - 24 * 60 * 60000, end = FIXTURE_NOW + 60000;
  const readings = await fixture.readActivity(4, { start, end, detail: 'raw' });
  expect(readings.local).toEqual((await fixture.readCardRows(4, start)).local);
  expect(readings.local.length).toBeGreaterThan(0);
});
