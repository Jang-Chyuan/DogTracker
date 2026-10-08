import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Platform } from 'react-native';
import {
  DISCONNECT_GRACE_MS, RECEIVER_MISSING_MS, gearLabel, gearReasons, receiverOutage, showsNoDogs,
  storageProblem, topCards, trackReceiverWait,
} from '../src/map/TopAlerts';
import { applyScreenFixture, buildFixture, FIXTURE_NOW } from '../src/dev/ScreenFixtures';
import { DEFAULT_TRACKING_PREFERENCES, validateTrackingPreferences } from '../src/tracking/TrackingPreferences';
import { formatClock } from '../src/map/MapFormat';

const NOW = Date.parse('2026-10-07T02:20:00Z');
const receiving = { enabled: true, running: true, connected: true, receiving: true, deviceId: 'AA',
  deviceName: 'DogGPS-Master7', expectedMasterId: 7, lastReceivedAt: NOW - 3000, disconnectedAt: 0 };
const dropped = (ago, extra = {}) => ({ ...receiving, connected: false, receiving: false,
  lastReceivedAt: NOW - ago, disconnectedAt: NOW - ago, ...extra });

// ---- 判定表「接收器斷線什麼時候算」 -----------------------------------------------

test('a dropped link is a disconnection only after 30 s of failed reconnecting', () => {
  expect(receiverOutage(dropped(DISCONNECT_GRACE_MS - 1000), NOW)).toBeNull();
  expect(receiverOutage(dropped(DISCONNECT_GRACE_MS), NOW)).toEqual(
    { key: NOW - DISCONNECT_GRACE_MS, since: NOW - DISCONNECT_GRACE_MS, number: 7 });
});

test('not a disconnection: no receiver, the user\'s 中斷連線, never connected yet, connected again', () => {
  expect(receiverOutage(null, NOW)).toBeNull();
  expect(receiverOutage({ enabled: false, deviceId: 'AA' }, NOW)).toBeNull();
  // Opened the app, the receiver has not connected in this service run.
  expect(receiverOutage({ ...receiving, connected: false, receiving: false, lastReceivedAt: NOW - 3600000,
    disconnectedAt: 0 }, NOW)).toBeNull();
  // The service is not running (killed, or stopped): no card.
  expect(receiverOutage({ ...dropped(60000), running: false }, NOW)).toBeNull();
  expect(receiverOutage(receiving, NOW)).toBeNull();
});

test('the receiver card says which receiver and when it dropped (c058, c059 as suggested)', () => {
  const outage = receiverOutage(dropped(8 * 60000), NOW);
  const [card] = topCards({ outage });
  expect(card).toMatchObject({ id: 'receiver', kind: 'alert', title: '接收器 7 斷線了',
    detail: `${formatClock(NOW - 8 * 60000)} 斷線・正在自動重連`, closable: true,
    actions: [{ id: 'receiver-settings', label: '接收器設定' }] });
  expect(topCards({ outage: { ...outage, number: null } })[0].title).toBe('接收器斷線了');
});

test('✕ collapses that disconnection into the gear dot; the next one shows again', () => {
  const outage = receiverOutage(dropped(60000), NOW);
  const dismissed = { receiver: outage.key };
  expect(topCards({ outage, dismissed })).toEqual([]);
  expect(gearReasons({ outage, dismissed, now: NOW })).toEqual(['receiver-disconnected']);
  // While the card shows, no dot for it.
  expect(gearReasons({ outage, now: NOW })).toEqual([]);
  // Reconnected and dropped again: a new start, a new card.
  const again = receiverOutage(dropped(40000), NOW);
  expect(topCards({ outage: again, dismissed })).toHaveLength(1);
  expect(gearReasons({ outage: again, dismissed, now: NOW })).toEqual([]);
});

test('a receiver that never connects lights the gear after 2 minutes, never a card', () => {
  const waiting = { ...receiving, connected: false, receiving: false, lastReceivedAt: 0 };
  let memory = trackReceiverWait(null, waiting, NOW);
  expect(memory.waitingSince).toBe(NOW);
  memory = trackReceiverWait(memory, waiting, NOW + RECEIVER_MISSING_MS - 1);
  expect(gearReasons({ receiverState: waiting, receiverWait: memory, now: NOW + RECEIVER_MISSING_MS - 1 }))
    .toEqual([]);
  expect(gearReasons({ receiverState: waiting, receiverWait: memory, now: NOW + RECEIVER_MISSING_MS }))
    .toEqual(['receiver-missing']);
  expect(topCards({ outage: receiverOutage(waiting, NOW + RECEIVER_MISSING_MS) })).toEqual([]);
  // Connected: forgotten.
  expect(trackReceiverWait(memory, receiving, NOW).waitingSince).toBeNull();
});

test('a link that drops before its first packet is still a disconnection', () => {
  const state = { ...receiving, connected: false, receiving: false, lastReceivedAt: 0, disconnectedAt: NOW - 60000 };
  expect(receiverOutage(state, NOW)).toMatchObject({ since: NOW - 60000 });
  expect(trackReceiverWait(null, state, NOW).waitingSince).toBeNull();
});

test('a restarted service with a packet from an earlier run is waiting, not disconnected', () => {
  const state = { ...receiving, connected: false, receiving: false, lastReceivedAt: NOW - 3600000, disconnectedAt: 0 };
  expect(receiverOutage(state, NOW)).toBeNull();
  const memory = trackReceiverWait(null, state, NOW);
  expect(gearReasons({ receiverState: state, receiverWait: memory, now: NOW + RECEIVER_MISSING_MS }))
    .toEqual(['receiver-missing']);
  // Another receiver chosen meanwhile waits from the start again.
  const other = trackReceiverWait(memory, { ...state, deviceId: 'BB' }, NOW + 60000);
  expect(other.waitingSince).toBe(NOW + 60000);
  // The service not running counts as waiting too.
  expect(trackReceiverWait(null, { ...receiving, running: false }, NOW).waitingSince).toBe(NOW);
  // Switched off by the user (中斷連線): nothing.
  expect(trackReceiverWait(null, { ...receiving, enabled: false }, NOW).waitingSince).toBeNull();
});

// ---- 位置存不進手機 -------------------------------------------------------------

test('storage: phone full → 檢查空間, any other reason → 看原因 with the reason', () => {
  expect(storageProblem(null)).toBeNull();
  expect(storageProblem('  ')).toBeNull();
  const full = storageProblem('資料存檔失敗：database or disk is full (code 13 SQLITE_FULL)');
  expect(full.full).toBe(true);
  expect(topCards({ storage: full })[0]).toMatchObject({ title: '位置存不進手機', detail: '手機空間不足',
    actions: [{ id: 'storage-settings', label: '檢查空間' }], closable: true });
  const other = storageProblem('attempt to write a readonly database');
  expect(topCards({ storage: other })[0]).toMatchObject({ detail: 'attempt to write a readonly database',
    actions: [{ id: 'storage-reason', label: '看原因' }] });
  expect(gearReasons({ storage: other, dismissed: { storage: true }, now: NOW })).toEqual(['storage']);
  expect(topCards({ storage: other, dismissed: { storage: true } })).toEqual([]);
});

// ---- 地圖載入失敗／地圖打不開 ------------------------------------------------------

test('map cards: 重試 and no ✕; 載入中… while retrying; 地圖打不開 says dogs are still received', () => {
  expect(topCards({ map: 'loading' })).toEqual([]);
  expect(topCards({ map: 'ok' })).toEqual([]);
  expect(topCards({ map: 'load-failed' })[0]).toMatchObject({ title: '地圖載入失敗', detail: '沒有網路或地圖服務連不上',
    closable: false, actions: [{ id: 'map-retry', label: '重試', busy: false }] });
  expect(topCards({ map: 'load-failed', retrying: true })[0].actions[0]).toEqual(
    { id: 'map-retry', label: '載入中…', busy: true });
  expect(topCards({ map: 'unavailable' })[0]).toMatchObject({ title: '地圖打不開',
    detail: '狗的位置還是會照常收、照常提醒', closable: false });
});

// ---- A6 ---------------------------------------------------------------------

test('A6 only with no receiver set up and no dog data, once everything is read', () => {
  const none = { enabled: false, deviceId: '' };
  expect(showsNoDogs({ receiverState: none, hasDogData: false, dataRead: true })).toBe(true);
  expect(showsNoDogs({ receiverState: undefined, hasDogData: false, dataRead: true })).toBe(false);
  expect(showsNoDogs({ receiverState: none, hasDogData: false, dataRead: false })).toBe(false);
  expect(showsNoDogs({ receiverState: none, hasDogData: true, dataRead: true })).toBe(false);
  // A receiver set up (connecting, or switched off by 中斷連線) hides it.
  expect(showsNoDogs({ receiverState: { enabled: true }, hasDogData: false, dataRead: true })).toBe(false);
  expect(showsNoDogs({ receiverState: { enabled: false, deviceId: 'AA' }, hasDogData: false, dataRead: true }))
    .toBe(false);
  expect(showsNoDogs({ receiverState: none, hasDogData: false, dataRead: true, dismissed: true })).toBe(false);
});

test('A6 card: 連接接收器, and 登入 Supabase only when signed out; its ✕ never lights the gear', () => {
  const [signedOut] = topCards({ noDogs: true });
  expect(signedOut).toMatchObject({ id: 'no-dogs', kind: 'info', title: '還沒有狗的資料',
    detail: '連上接收器或登入 Supabase，狗就會出現在地圖上；只用「我的路線」也可以', closable: true });
  expect(signedOut.actions.map(action => action.label)).toEqual(['連接接收器', '登入 Supabase']);
  expect(topCards({ noDogs: true, signedIn: true })[0].actions.map(action => action.label)).toEqual(['連接接收器']);
  expect(gearReasons({ dismissed: { noDogs: true }, now: NOW })).toEqual([]);
});

test('A6 dismissal is a stored preference', () => {
  expect(DEFAULT_TRACKING_PREFERENCES.noDataCardDismissed).toBe(false);
  expect(validateTrackingPreferences({ noDataCardDismissed: true }).noDataCardDismissed).toBe(true);
  expect(() => validateTrackingPreferences({ noDataCardDismissed: 'yes' })).toThrow();
});

test('stack order: 接收器斷線, 存不進手機, 地圖, A6', () => {
  const cards = topCards({ outage: receiverOutage(dropped(60000), NOW), storage: storageProblem('x'),
    map: 'load-failed', noDogs: true });
  expect(cards.map(card => card.id)).toEqual(['receiver', 'storage', 'map', 'no-dogs']);
});

// ---- gear red dot -------------------------------------------------------------

test('gear dot: cloud, permissions, receiver battery; TalkBack counts them', () => {
  expect(gearReasons({ cloudFailing: true, now: NOW })).toEqual(['cloud']);
  expect(gearReasons({ signInExpired: true, now: NOW })).toEqual(['cloud']);
  expect(gearReasons({ phone: { permission: 'approximate', services: true }, now: NOW })).toEqual(['phone-location']);
  expect(gearReasons({ phone: { permission: 'precise', services: false }, now: NOW })).toEqual(['phone-location']);
  expect(gearReasons({ phone: { permission: 'checking' }, now: NOW })).toEqual([]);
  expect(gearReasons({ phone: { permission: 'precise', services: true }, now: NOW })).toEqual([]);
  expect(gearReasons({ notificationsDenied: true, now: NOW })).toEqual(['notifications']);
  const battery = percentage => gearReasons({ receiverState: receiving,
    receiverBattery: { valid: true, percentage }, now: NOW });
  expect(battery(20)).toEqual(['receiver-battery']);
  expect(battery(21)).toEqual([]);
  expect(gearReasons({ receiverState: receiving, receiverBattery: { valid: false, percentage: 5 }, now: NOW }))
    .toEqual([]);
  expect(gearLabel([])).toBe('設定');
  expect(gearLabel(['cloud', 'phone-location'])).toBe('設定，有 2 件事要處理');
});

// ---- fixtures, through the real MapScreen ------------------------------------

async function renderMap(name) {
  const MapView = require('react-native-maps').default;
  const NativePlatform = require('../specs/NativeTrackingPlatform').default;
  const MapScreen = require('../src/screens/MapScreen').default;
  const { GOOGLE_MAP_PROVIDER } = require('../src/map/GoogleMapProvider');
  const { emptyLiveRoute } = require('../src/tracking/LiveRouteWindow');
  NativePlatform.isMapConfigured.mockReturnValue(true);
  const fixture = buildFixture(name);
  const live = {
    tracking: { mode: 'real', point: {}, route: emptyLiveRoute(), positionSamples: [], ready: { real: true },
      errors: {}, initialSnapshotReady: true, foreground: true,
      // The real phone's A6 was closed: a fixture does not inherit that.
      preferences: { ready: true, busy: false, value: { ...DEFAULT_TRACKING_PREFERENCES, noDataCardDismissed: true } },
      saveTrackingPreferences: jest.fn() },
    phone: { enabled: true }, cloudDogs: { rows: [] }, cloudSync: { ownerId: 'real' },
    history: { key: 'live', preferences: { source: 'local', dogAliases: {} }, save: jest.fn() },
    dogAvatars: { avatars: {}, save: jest.fn() },
  };
  const inputs = applyScreenFixture(fixture, live);
  const onAlertAction = jest.fn();
  let renderer;
  await act(async () => {
    renderer = Renderer.create(<MapScreen tracking={inputs.tracking} phone={inputs.phone} history={inputs.history}
      cloudDogs={inputs.cloudDogs} cloudOwner={inputs.cloudSync.ownerId} cloudSync={inputs.cloudSync}
      bottomInset={80} dogAvatars={inputs.dogAvatars} mapProvider={GOOGLE_MAP_PROVIDER} fixture={fixture}
      todayRoute={inputs.todayRoute} signedIn={!!inputs.cloudSync.ownerId} cloudProblem={inputs.cloudProblem}
      notificationsDenied={inputs.notificationsDenied} onAlertAction={onAlertAction} />);
  });
  const maps = renderer.root.findAllByType(MapView);
  if (maps.length) {
    await act(async () => maps[0].props.onMapReady());
    await act(async () => maps[0].props.onMapLoaded());
  }
  const host = id => renderer.root.findAll(node => node.props.testID === id && typeof node.type === 'string');
  const cards = () => renderer.root.findAll(node => typeof node.type === 'string'
    && /^top-card-(receiver|storage|map|no-dogs)$/.test(node.props.testID || '')).map(node => node.props.testID.slice(9));
  const gear = () => renderer.root.findAll(node => node.props.testID === 'map-settings'
    && typeof node.type === 'string')[0].props.accessibilityLabel;
  const text = () => JSON.stringify(renderer.toJSON());
  return { renderer, host, cards, gear, text, maps, onAlertAction, live };
}
const originalOS = Platform.OS;
beforeEach(() => { Platform.OS = 'android'; });
afterEach(() => { Platform.OS = originalOS; });

test.each([
  ['all-good', [], '設定'],
  ['receiver-disconnected', ['receiver'], '設定'],
  ['receiver-disconnected-dismissed', [], '設定，有 1 件事要處理'],
  ['storage-failed', ['storage'], '設定'],
  ['storage-failed-other', ['storage'], '設定'],
  ['map-load-failed', ['map'], '設定'],
  ['map-unavailable', ['map'], '設定'],
  ['cloud-failing', [], '設定，有 1 件事要處理'],
  ['receiver-battery-low', [], '設定，有 1 件事要處理'],
  ['no-data', ['no-dogs'], '設定'],
  ['no-data-signed-in', ['no-dogs'], '設定'],
])('%s: top cards %j, gear %s', async (name, expected, label) => {
  const view = await renderMap(name);
  expect(view.cards()).toEqual(expected);
  expect(view.gear()).toBe(label);
  expect(view.host('map-settings-dot')).toHaveLength(label === '設定' ? 0 : 1);
  await act(async () => view.renderer.unmount());
});

test('receiver-disconnected: 「接收器 7 斷線了」, no range ring; ✕ collapses it into the dot', async () => {
  const view = await renderMap('receiver-disconnected');
  expect(view.text()).toContain('接收器 7 斷線了');
  expect(view.text()).toContain(`${formatClock(FIXTURE_NOW - 5 * 60000)} 斷線・正在自動重連`);
  const { Polygon } = require('react-native-maps');
  expect(view.renderer.root.findAllByType(Polygon)).toHaveLength(0);
  await act(async () => view.renderer.root.findAll(node => node.props.testID === 'top-card-action-receiver-settings'
    && typeof node.props.onPress === 'function')[0].props.onPress());
  expect(view.onAlertAction).toHaveBeenCalledWith('receiver-settings');
  jest.useFakeTimers();
  await act(async () => view.renderer.root.findAll(node => node.props.testID === 'top-card-close-receiver'
    && typeof node.props.onPress === 'function')[0].props.onPress());
  await act(async () => { jest.advanceTimersByTime(400); });
  jest.useRealTimers();
  expect(view.cards()).toEqual([]);
  expect(view.gear()).toBe('設定，有 1 件事要處理');
  await act(async () => view.renderer.unmount());
});

test('the settings page shows the storage warning above everything (c282) and leads to its fix', async () => {
  const SettingsHome = require('../src/settings/SettingsHome').default;
  const { settingsHome } = require('../src/settings/SettingsModel');
  const onStorage = jest.fn();
  const page = storage => <SettingsHome onOpen={() => {}} onStorage={onStorage}
    home={settingsHome({ now: 0, receiverState: null, storage })} />;
  let renderer;
  await act(async () => { renderer = Renderer.create(page(storageProblem('database or disk is full'))); });
  expect(JSON.stringify(renderer.toJSON())).toContain('手機空間不足，位置存不進手機');
  await act(async () => renderer.root.findAll(node => node.props.testID === 'settings-storage-warning'
    && typeof node.props.onPress === 'function')[0].props.onPress());
  expect(onStorage).toHaveBeenCalled();
  await act(async () => renderer.update(page(null)));
  expect(renderer.root.findAll(node => node.props.testID === 'settings-storage-warning')).toHaveLength(0);
  await act(async () => renderer.unmount());
});

test('map-load-failed draws dogs and ring on a map without a base map; map-unavailable draws grey only', async () => {
  const failed = await renderMap('map-load-failed');
  expect(failed.maps[0].props.customMapStyle[0]).toEqual({ stylers: [{ visibility: 'off' }] });
  const { Marker, Polygon } = require('react-native-maps');
  expect(failed.renderer.root.findAllByType(Marker).length).toBeGreaterThan(0);
  expect(failed.renderer.root.findAllByType(Polygon)).toHaveLength(1);
  expect(failed.text()).toContain('地圖載入失敗');
  // 重試: 載入中… until the new map has loaded (still without tiles here).
  await act(async () => failed.renderer.root.findAll(node => node.props.testID === 'top-card-action-map-retry'
    && typeof node.props.onPress === 'function')[0].props.onPress());
  expect(failed.text()).toContain('載入中…');
  expect(failed.onAlertAction).not.toHaveBeenCalled();
  await act(async () => failed.renderer.unmount());
  const unavailable = await renderMap('map-unavailable');
  expect(unavailable.maps).toHaveLength(0);
  expect(unavailable.host('map-unavailable')).toHaveLength(1);
  expect(unavailable.text()).toContain('地圖打不開');
  expect(unavailable.text()).toContain('狗的位置還是會照常收、照常提醒');
  await act(async () => unavailable.renderer.unmount());
});

test('no-data: A6 buttons go to the hardware and cloud pages; ✕ stores that it never shows again', async () => {
  const view = await renderMap('no-data');
  expect(view.text()).toContain('還沒有狗的資料');
  const press = id => view.renderer.root.findAll(node => node.props.testID === id
    && typeof node.props.onPress === 'function')[0].props.onPress();
  await act(async () => press('top-card-action-connect-receiver'));
  await act(async () => press('top-card-action-sign-in'));
  expect(view.onAlertAction.mock.calls).toEqual([['connect-receiver'], ['sign-in']]);
  jest.useFakeTimers();
  await act(async () => press('top-card-close-no-dogs'));
  await act(async () => { jest.advanceTimersByTime(400); });
  jest.useRealTimers();
  expect(view.cards()).toEqual([]);
  expect(view.gear()).toBe('設定');
  // A fixture never writes this phone's preferences.
  expect(view.live.tracking.saveTrackingPreferences).not.toHaveBeenCalled();
  await act(async () => view.renderer.unmount());
});
