// 054a wiring: the rows the list reads, its words, the fixtures, the old
// history page showing the list, and 「今天 x km」 equal to the list's total.
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createHistoryDatabase, HISTORY_DAY_CONTEXT_MS } from '../src/mapHistory/HistoryDatabase';
import { dogHistoryRow, phoneHistoryRow } from '../src/history/HistoryRows';
import { historyTimeline } from '../src/history';
import {
  clock, emptyText, km, listDuration, nodePill, placeLines, sectionText, summaryDuration, summaryText,
} from '../src/history/HistoryText';
import { AddressLookupContext, createAddressLookup } from '../src/placement/AddressLookup';
import HistoryTimelineList from '../src/mapHistory/HistoryTimelineList';
import { applyScreenFixture, buildFixture, FIXTURE_NOW } from '../src/dev/ScreenFixtures';
import { endOfDay, formatTodayDistance, startOfToday } from '../src/tracking/TodayDistance';
import { historyTargetOf, useHistoryDayRows } from '../src/mapHistory/useHistoryScreen';
import { DEFAULT_TRACKING_PREFERENCES } from '../src/tracking/TrackingPreferences';

const MINUTE = 60000;
const DAY = startOfToday(FIXTURE_NOW);

// The list of a history fixture, as the old history page computes it.
async function fixtureList(name) {
  const fixture = buildFixture(name);
  const target = { ...historyTargetOf(fixture.history.preferences), day: startOfToday(fixture.now) };
  const answer = await fixture.history.readDay({ subject: target.subject, slaveId: target.slaveId, start: target.day,
    end: endOfDay(target.day), source: 'all', owner: fixture.cloudSync.ownerId });
  const model = historyTimeline(answer.rows, { subject: target.subject, dayStart: target.day,
    dayEnd: endOfDay(target.day), today: true, now: fixture.now });
  return { fixture, target, model, kinds: model.nodes.map(n => (n.type === 'movement' ? n.mode : n.type)) };
}

describe('rows', () => {
  // 判定表「停在原處封包的去重」「同一隻狗本機和雲端同時有」.
  test('a dog row: packet time from the phone, the fix by the collar\'s gps_time', () => {
    const local = dogHistoryRow({ id: 1, received_at: 1000, slave_id: 4, slave_lat: 24.98, slave_lon: 121.31, gps_time: '777' }, 'local');
    const cloud = dogHistoryRow({ id: 9, received_at: 5000, track_at: 1000, slave_id: 4, slave_lat: 24.98, slave_lon: 121.31, gps_time: '777' }, 'cloud');
    expect(local).toMatchObject({ source: 'local', time: 1000, packetTime: 1000, locationTime: 'gps:777', latitude: 24.98 });
    expect(cloud).toMatchObject({ source: 'cloud', time: 1000, packetTime: 1000, locationTime: 'gps:777' });
    const model = historyTimeline([local, cloud], { holdOptions: { classify: () => null } });
    expect(model.packets).toHaveLength(1); expect(model.packets[0].source).toBe('local');
    expect(dogHistoryRow({ received_at: 2000, gps_time: null }, 'local').locationTime).toBe(2000);
  });
  test('a phone row: recorded time and accuracy, the 「今天 x km」 rows', () => {
    expect(phoneHistoryRow({ id: 3, time: 10, latitude: 1, longitude: 2, accuracy: 5 }))
      .toMatchObject({ source: 'local', slave_id: 'phone', time: 10, locationTime: 10, accuracy: 5 });
    expect(phoneHistoryRow({ recorded_at: 20, latitude: 1, longitude: 2, accuracy_meters: null }).accuracy).toBeNull();
  });

  test('historyDayRows reads one dog\'s day from both tables, with the source filter and a cursor', async () => {
    const connection = createMemoryConnection();
    const database = createHistoryDatabase(connection);
    connection.sqlite.exec(`CREATE TABLE dog_status(id INTEGER PRIMARY KEY, received_at INTEGER, master_id INTEGER,
      slave_id INTEGER, slave_lat REAL, slave_lon REAL, satellites INTEGER, hdop REAL, usb_present INTEGER,
      rssi INTEGER, snr REAL, gps_time TEXT)`);
    connection.sqlite.exec(`CREATE TABLE supabase_dog_status(id INTEGER PRIMARY KEY, owner_user_id TEXT,
      received_at INTEGER, track_at INTEGER, master_id INTEGER, slave_id INTEGER, slave_lat REAL, slave_lon REAL,
      satellites INTEGER, hdop REAL, usb_present INTEGER, rssi INTEGER, snr REAL, gps_time TEXT)`);
    const local = connection.sqlite.prepare('INSERT INTO dog_status VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
    const cloud = connection.sqlite.prepare('INSERT INTO supabase_dog_status VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    // Before the context (seed only), in the context, the day, just past midnight.
    local.run(1, DAY - 2 * HISTORY_DAY_CONTEXT_MS, 7, 4, 24.98, 121.31, 9, 0.9, 0, -70, 5, '1');
    local.run(2, DAY - 10 * MINUTE, 7, 4, 24.98, 121.31, 9, 0.9, 0, -70, 5, '2');
    local.run(3, DAY + MINUTE, 7, 4, 24.981, 121.31, 9, 0.9, 0, -70, 5, '3');
    local.run(4, DAY + MINUTE, 7, 6, 24.981, 121.31, 9, 0.9, 0, -70, 5, '3');
    local.run(5, endOfDay(DAY) + MINUTE, 7, 4, 24.982, 121.31, 9, 0.9, 0, -70, 5, '9');
    cloud.run(1, 'me', DAY + 9 * MINUTE, DAY + 2 * MINUTE, 9, 4, 24.982, 121.31, 9, 1, 0, -80, 5, '4');
    cloud.run(2, 'someone', DAY + 3 * MINUTE, DAY + 3 * MINUTE, 9, 4, 24.983, 121.31, 9, 1, 0, -80, 5, '5');
    const day = { subject: 'dog', slaveId: 4, start: DAY, end: endOfDay(DAY) };
    const all = await database.historyDayRows({ ...day, owner: 'me' });
    expect(all.rows.map(row => [row.source, row.id, row.time])).toEqual([
      ['local', 2, DAY - 10 * MINUTE], ['local', 3, DAY + MINUTE], ['local', 5, endOfDay(DAY) + MINUTE],
      ['cloud', 1, DAY + 2 * MINUTE]]);
    expect(all.seed.map(row => row.time)).toEqual([DAY - 2 * HISTORY_DAY_CONTEXT_MS]);
    expect((await database.historyDayRows({ ...day, source: 'local', owner: 'me' })).rows).toHaveLength(3);
    expect((await database.historyDayRows({ ...day, source: 'cloud', owner: 'me' })).rows).toHaveLength(1);
    // Signed out: no cloud rows at all.
    expect((await database.historyDayRows({ ...day, source: 'cloud' })).rows).toHaveLength(0);
    // Only rows added since, even older ones (a download, 判定表「補下載完成」).
    local.run(6, DAY + 5 * MINUTE, 7, 4, 24.984, 121.31, 9, 0.9, 0, -70, 5, '6');
    cloud.run(3, 'me', DAY + 30 * MINUTE, DAY - 5 * MINUTE, 9, 4, 24.98, 121.31, 9, 1, 0, -80, 5, '0');
    const next = await database.historyDayRows({ ...day, owner: 'me', after: all.after });
    expect(next.rows.map(row => [row.source, row.id])).toEqual([['local', 6], ['cloud', 3]]); expect(next.seed).toEqual([]);
    // A few minutes past midnight are read for 「接續隔天」.
    local.run(7, endOfDay(DAY) + 2 * MINUTE, 7, 4, 24.984, 121.31, 9, 0.9, 0, -70, 5, '7');
    expect((await database.historyDayRows({ ...day, owner: 'me', after: next.after })).rows.map(row => row.id)).toEqual([7]);
    connection.close();
  });

  test('historyDayRows reads my route from myLocationTracker', async () => {
    const connection = createMemoryConnection();
    const database = createHistoryDatabase(connection);
    expect((await database.historyDayRows({ subject: 'phone', start: DAY, end: endOfDay(DAY) })).rows).toEqual([]);
    connection.sqlite.exec(`CREATE TABLE myLocationTracker(id INTEGER PRIMARY KEY, recorded_at INTEGER,
      location_at INTEGER, latitude REAL, longitude REAL, accuracy_meters REAL)`);
    connection.sqlite.prepare('INSERT INTO myLocationTracker VALUES(?,?,?,?,?,?)').run(1, DAY + 5, DAY + 4, 24.98, 121.31, 6);
    const { rows } = await database.historyDayRows({ subject: 'phone', start: DAY, end: endOfDay(DAY) });
    expect(rows).toEqual([expect.objectContaining({ slave_id: 'phone', time: DAY + 5, accuracy: 6, latitude: 24.98 })]);
    connection.close();
  });
});

describe('words (copy deck)', () => {
  test('durations, distances, clock', () => {
    expect(listDuration(28 * MINUTE)).toBe('28 分');
    expect(listDuration(73 * MINUTE)).toBe('1 時 13 分');
    expect(listDuration(120 * MINUTE)).toBe('2 時');
    expect(summaryDuration(248 * MINUTE)).toBe('4 小時 8 分');
    expect(km(1449)).toBe('1.4 km'); expect(km(1450)).toBe('1.5 km');
    expect(clock(new Date(2026, 9, 3, 8, 3).getTime())).toBe('08:03');
  });
  test('movement rows: 走路／開車 for my route, 移動／坐車 for a dog, 沒有資料', () => {
    const base = { type: 'movement', durationMs: 28 * MINUTE, distanceM: 6300, countedDistanceM: 1400 };
    expect(sectionText({ ...base, mode: 'walking' })).toEqual({ icon: 'walk', lead: '走路', time: '28 分', rest: '・1.4 km' });
    expect(sectionText({ ...base, mode: 'driving' })).toMatchObject({ icon: 'car', lead: '開車', rest: '・6.3 km・不算距離' });
    expect(sectionText({ ...base, mode: 'moving' })).toMatchObject({ icon: 'paw', lead: '移動' });
    expect(sectionText({ ...base, mode: 'ride' })).toMatchObject({ icon: 'car', lead: '坐車', rest: '・6.3 km・不算距離' });
    const gap = sectionText({ type: 'gap', start: new Date(2026, 9, 3, 10, 21).getTime(), end: new Date(2026, 9, 3, 10, 40).getTime() });
    expect(`${gap.lead}${gap.rest}`).toBe('沒有資料 10:21–10:40');
  });
  test('pills', () => {
    expect(nodePill({ type: 'departure' })).toEqual({ text: '出發', tone: 'plain' });
    expect(nodePill({ type: 'departure', manual: true })).toEqual({ text: '出發（手動）', tone: 'manual' });
    expect(nodePill({ type: 'departure', continuesPreviousDay: true }).text).toBe('接續前一天');
    expect(nodePill({ type: 'stop', durationMs: 17 * MINUTE })).toEqual({ text: '停 17 分', tone: 'stay' });
    expect(nodePill({ type: 'stop', durationMs: 17 * MINUTE, continuesPreviousDay: true }).text).toBe('接續前一天・停 17 分');
    expect(nodePill({ type: 'indoor', start: 0, end: 40 * MINUTE })).toEqual({ text: '室內・40 分', tone: 'indoor' });
    expect(nodePill({ type: 'resume' }).text).toBe('恢復記錄');
    expect(nodePill({ type: 'switch' })).toBeNull();
    expect(nodePill({ type: 'end', label: '現在' }).text).toBe('現在');
    expect(nodePill({ type: 'end', label: '結束' }).text).toBe('結束');
    expect(nodePill({ type: 'end', label: '最後', end: new Date(2026, 9, 3, 12, 5).getTime() }).text).toBe('最後 12:05');
    expect(nodePill({ type: 'end', label: '記錄已關閉', closedAt: new Date(2026, 9, 3, 10, 20).getTime() }))
      .toEqual({ text: '記錄已關閉 10:20', tone: 'closed' });
    expect(nodePill({ type: 'end', label: '結束', continuesNextDay: true }).text).toBe('接續隔天');
  });
  test('H8 lines', () => {
    expect(emptyText({ subject: 'phone', today: true })).toBe('今天還沒有路線');
    expect(emptyText({ subject: 'phone', today: false })).toBe('這天沒有路線');
    expect(emptyText({ subject: 'dog', name: '小黑' })).toBe('這天沒有小黑的紀錄');
  });
});

describe('fixtures', () => {
  test('history-today: my route out at about 07:05, two stays, now; the pill is the summary\'s distance', async () => {
    const { fixture, target, model, kinds } = await fixtureList('history-today');
    expect(target).toEqual({ subject: 'phone', slaveId: null, day: DAY });
    expect(model.departure.status).toBe('confirmed');
    expect(kinds).toEqual(['departure', 'walking', 'stop', 'walking', 'stop', 'walking', 'end']);
    const summary = summaryText(model, { subject: 'phone' });
    expect(summary.title).toBe(`${clock(model.range.start)} – 現在`);
    // 「今天 x km」 (stops.txt: 和歷史摘要同一個數).
    expect(formatTodayDistance(fixture.todayRoute.metres)).toBe(`今天 ${km(model.distanceM)}`);
    expect(summary.detail.startsWith(`走了 ${km(model.distanceM)}`)).toBe(true);
    // The hour at home before it is not counted.
    expect(model.range.start).toBeGreaterThan(DAY + 7 * 60 * MINUTE);
  });
  test('history-no-departure: 還沒出發, the whole day is the range, no stays', async () => {
    const { model, kinds } = await fixtureList('history-no-departure');
    expect(model.departure.status).toBe('not-departed');
    expect(summaryText(model, { subject: 'phone' }).title).toBe('還沒出發');
    expect(model.range.start).toBe(model.points[0].time);
    expect(kinds).toEqual(['departure', 'walking', 'end']);
  });
  test('history-mode-switch: walk → drive → walk with a numbered switch point at each change', async () => {
    const { model, kinds } = await fixtureList('history-mode-switch');
    expect(kinds).toEqual(['departure', 'walking', 'switch', 'driving', 'switch', 'walking', 'stop', 'end']);
    expect(model.nodes.filter(n => n.number).map(n => n.number)).toEqual([1, 2, 3]);
    expect(model.sections.find(s => s.mode === 'driving').countedDistanceM).toBe(0);
  });
  test('history-gap: 沒有資料 twice, 恢復記錄 only after the 40-minute break', async () => {
    const { model, kinds } = await fixtureList('history-gap');
    expect(kinds).toEqual(['departure', 'moving', 'gap', 'moving', 'gap', 'resume', 'moving', 'end']);
    expect(model.sections.filter(s => s.type === 'gap').every(s => s.countedDistanceM === 0)).toBe(true);
  });
  test('history-indoor: the house node, unnumbered, without distance', async () => {
    const { model, kinds } = await fixtureList('history-indoor');
    expect(kinds).toContain('indoor');
    const house = model.nodes.find(n => n.type === 'indoor');
    expect(house.number).toBeUndefined();
    expect(nodePill(house).text).toMatch(/^室內・2\d 分$/);
  });
});

// The fixture's own lookup, asked in the list's order (053a).
async function placeNames(lookup, places) {
  let values = places.map(node => lookup.lookup(node));
  for (let tries = 0; values.includes(undefined) && tries < 80; tries += 1) {
    await new Promise(resolve => setTimeout(resolve, 50));
    values = places.map(node => lookup.lookup(node));
  }
  return values;
}
const placesOf = model => model.nodes.filter(node => !['movement', 'gap'].includes(node.type));

describe('addresses (053a)', () => {
  const stop = { type: 'stop', latitude: 24.93111, longitude: 121.28794, durationMs: 17 * MINUTE };
  const house = { type: 'indoor', latitude: 24.9378, longitude: 121.2954, start: 0, end: 28 * MINUTE };
  test('a place\'s two lines: found, asking, not found; a hold not found says 停留（室內）', () => {
    expect(placeLines(stop, { state: 'found', text: '八德區和平路 552 號附近' }))
      .toEqual({ title: '八德區和平路 552 號附近', titleMuted: false, coordinates: '24.9311, 121.2879', missing: '' });
    expect(placeLines(stop, { state: 'found', text: '大園區航站南路 9 號附近（約 140 m）' }).title)
      .toBe('大園區航站南路 9 號附近（約\u00A0140\u00A0m）');
    expect(placeLines(stop, { state: 'pending' }))
      .toEqual({ title: '查地址中…', titleMuted: true, coordinates: '24.9311, 121.2879', missing: '' });
    expect(placeLines(stop, { state: 'none' }))
      .toEqual({ title: '24.9311, 121.2879', titleMuted: false, coordinates: '', missing: '查不到地址' });
    expect(placeLines(house, { state: 'none' }))
      .toEqual({ title: '停留（室內）', titleMuted: false, coordinates: '24.9378, 121.2954', missing: '' });
    expect(placeLines(house, { state: 'found', text: '八德區介壽路一段 728 號附近' }).title).toBe('八德區介壽路一段 728 號附近');
  });

  test('history-today: 出發, stays 1 and 2 and 現在 named; one 120 m off; stay 2 without an answer', async () => {
    const { fixture, model } = await fixtureList('history-today');
    const names = await placeNames(fixture.addressLookup, placesOf(model));
    expect(names).toEqual(['桃園區大興西路二段 105 號附近', '桃園區同德六街 76 號附近（約 120 m）', null,
      '桃園區中山路 552 號附近']);
  });

  test('history-indoor: no answers, the house node says 停留（室內） over its coordinates', async () => {
    const { fixture, model } = await fixtureList('history-indoor');
    const places = placesOf(model);
    const names = await placeNames(fixture.addressLookup, places);
    expect(names.every(name => name === null)).toBe(true);
    const held = places.find(node => node.type === 'indoor');
    expect(placeLines(held, { state: 'none' }).title).toBe('停留（室內）');
  });

  test('the list: 查地址中… while asking, the address when it comes, coordinates after 5 s without one', async () => {
    jest.useFakeTimers();
    try {
      const { model } = await fixtureList('history-today');
      const answers = [];
      const native = { reverseGeocode: jest.fn(() => new Promise(resolve => answers.push(resolve))) };
      const lookup = createAddressLookup({ native });
      let renderer;
      await act(async () => {
        renderer = Renderer.create(<AddressLookupContext.Provider value={lookup}>
          <HistoryTimelineList model={model} subject="phone" today color="#2F6FDE" />
        </AddressLookupContext.Provider>);
      });
      const titles = () => renderer.root.findAll(node => typeof node.type === 'string'
        && node.props.testID === 'place-title').map(node => [node.props.children].flat().join(''));
      const text = () => JSON.stringify(renderer.toJSON());
      expect(titles()).toEqual(['查地址中…', '查地址中…', '查地址中…', '查地址中…']);
      // The first place answers: its address; the others still asking.
      const first = placesOf(model)[0];
      await act(async () => answers[0](JSON.stringify([{ line: '330台灣桃園市桃園區大興西路二段105號',
        latitude: first.latitude, longitude: first.longitude }])));
      expect(titles()[0]).toBe('桃園區大興西路二段 105 號附近');
      expect(titles().slice(1)).toEqual(['查地址中…', '查地址中…', '查地址中…']);
      // Five seconds on, the rest count as not found: coordinates, 查不到地址.
      await act(async () => { jest.advanceTimersByTime(5000); });
      expect(titles()[1]).toMatch(/^\d+\.\d{4}, \d+\.\d{4}$/);
      expect(text()).toContain('查不到地址');
      await act(async () => renderer.unmount());
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('the history screen shows the list', () => {
  test('historyTargetOf: the dog the query was saved for, else my route', () => {
    expect(historyTargetOf({ client: true, phone: true, slaves: [6] })).toEqual({ subject: 'dog', slaveId: 6 });
    expect(historyTargetOf({ client: false, phone: true, slaves: [4] })).toEqual({ subject: 'phone', slaveId: null });
    expect(historyTargetOf({ client: false, phone: false, slaves: [4] })).toBeNull();
    expect(historyTargetOf(null)).toBeNull();
  });

  test('useHistoryDayRows reads once for a past day and follows new rows today', async () => {
    jest.useFakeTimers();
    const reads = [];
    let extra = [];
    const path = Array.from({ length: 60 }, (_, i) => phoneHistoryRow({ id: i + 1, time: DAY + 8 * 60 * MINUTE + i * 10000,
      latitude: 24.98 + i * 0.0001, longitude: 121.31, accuracy: 5 }));
    const read = jest.fn(async request => {
      reads.push(request.after);
      const rows = request.after.done ? extra : path;
      extra = [];
      return { rows, seed: [], after: { done: true } };
    });
    let result;
    function Probe({ target }) {
      result = useHistoryDayRows({ read, subject: target.subject, slaveId: null, day: target.day, clock: () => FIXTURE_NOW });
      return null;
    }
    const today = { subject: 'phone', slaveId: null, day: DAY };
    let renderer;
    await act(async () => { renderer = Renderer.create(<Probe target={today} />); });
    expect(result.rows).toHaveLength(60);
    expect(result.loaded).toBe(true);
    extra = [phoneHistoryRow({ id: 61, time: DAY + 8 * 60 * MINUTE + 600000, latitude: 24.987, longitude: 121.31, accuracy: 5 })];
    await act(async () => jest.advanceTimersByTimeAsync(15000));
    expect(result.rows).toHaveLength(61);
    expect(reads[1]).toEqual({ done: true });
    // A past day: read again only every minute (a download can add rows).
    const past = { subject: 'phone', slaveId: null, day: DAY - 86400000 };
    read.mockClear();
    await act(async () => renderer.update(<Probe target={past} />));
    await act(async () => jest.advanceTimersByTimeAsync(30000));
    expect(read).toHaveBeenCalledTimes(1);
    await act(async () => jest.advanceTimersByTimeAsync(30000));
    expect(read).toHaveBeenCalledTimes(2);
    await act(async () => renderer.unmount());
    jest.useRealTimers();
  });

  test('history-mode-switch on the history screen: summary, two numbered switch points, the car row', async () => {
    const MapView = require('react-native-maps').default;
    const { Platform } = require('react-native');
    const NativePlatform = require('../specs/NativeTrackingPlatform').default;
    const MapScreen = require('../src/screens/MapScreen').default;
    const { GOOGLE_MAP_PROVIDER } = require('../src/map/GoogleMapProvider');
    const { emptyLiveRoute } = require('../src/tracking/LiveRouteWindow');
    const original = Platform.OS;
    Platform.OS = 'android';
    NativePlatform.isMapConfigured.mockReturnValue(true);
    const fixture = buildFixture('history-mode-switch');
    const inputs = applyScreenFixture(fixture, {
      tracking: { mode: 'real', point: {}, route: emptyLiveRoute(), positionSamples: [], ready: { real: true },
        errors: {}, initialSnapshotReady: true, foreground: true,
        preferences: { ready: true, busy: false, value: DEFAULT_TRACKING_PREFERENCES }, saveTrackingPreferences: jest.fn() },
      phone: { enabled: true }, cloudDogs: { rows: [] }, cloudSync: { ownerId: 'real' },
      history: { key: 'live', preferences: { source: 'ble', dogAliases: {}, slaves: [4], masters: [7] }, save: jest.fn() },
      dogAvatars: { avatars: {}, save: jest.fn() },
    });
    let renderer;
    await act(async () => {
      renderer = Renderer.create(<MapScreen tracking={inputs.tracking} phone={inputs.phone} history={inputs.history}
        cloudDogs={inputs.cloudDogs} cloudOwner={inputs.cloudSync.ownerId} bottomInset={80} historical active
        dogAvatars={inputs.dogAvatars} mapProvider={GOOGLE_MAP_PROVIDER} fixture={fixture}
        historyTarget={historyTargetOf(inputs.history.preferences)} />);
    });
    await act(async () => renderer.root.findByType(MapView).props.onMapReady());
    await act(async () => {});
    const ids = renderer.root.findAll(node => typeof node.type === 'string' && /^timeline-/.test(node.props.testID || ''))
      .map(node => node.props.testID);
    expect(ids).toEqual(['timeline-departure', 'timeline-movement-walking', 'timeline-switch', 'timeline-movement-driving',
      // The cursor opens on the newest fix, inside the last stay: that row is lit.
      'timeline-switch', 'timeline-movement-walking', 'timeline-stop', 'timeline-selected', 'timeline-end']);
    const text = JSON.stringify(renderer.toJSON());
    expect(text).toContain('開車');
    expect(text).toContain('不算距離');
    expect(text).toContain('現在');
    await act(async () => renderer.unmount());
    Platform.OS = original;
  });
});
