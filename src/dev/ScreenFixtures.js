// Debug builds only: named screen states the emulator cannot reach on demand
// (a receiver that dropped, a dog held indoors, cloud data), so each can be
// opened with dogtracker://dev/fixture?name=<name> and screenshotted.
//
// A fixture replaces only the inputs the real screens already take; the
// screens drawn are the real ones. The inputs are written as raw data — the
// receiver's getState() answer, dog_status rows, supabase_dog_status rows, the
// cloud sync state, the phone's position — and run through the same code the
// app runs on stored data (mapDogStatusRow, mergePositionSamples, HoldStore,
// predictEnvironment, RideAlong). See src/dev/README.md for adding one.
//
// Every place is invented, around Taoyuan station; every time is relative to
// one fixed clock, so a screenshot taken today and next month look the same.

import { emptyTrackingPoint, mapDogStatusRow } from '../models/TrackingPoint';
import { mergePositionSamples } from '../tracking/RouteSamples';
import { emptyLiveRoute } from '../tracking/LiveRouteWindow';
import { MAX_AGE_MS } from '../map/DogMerge';
import { createHoldStore, HOLD_LOOKBACK_MS } from '../placement/HoldStore';
import { HOLD_CONFIG } from '../placement/IndoorHold';
import { createRideDetector } from '../placement/RideAlong';
import { predictEnvironment, ENVIRONMENT_WINDOW_MS } from '../ml/Environment';

// 2026-10-07 09:30 in Taiwan. Every fixture's rows are placed against this.
export const FIXTURE_NOW = Date.parse('2026-10-07T01:30:00Z');
// Taoyuan station: invented positions only, never the team's real area.
export const FIXTURE_ORIGIN = Object.freeze({ latitude: 24.9893, longitude: 121.3135 });
export const FIXTURE_OWNER = 'fixture-owner';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
// ~11 m per step in latitude, ~10 m in longitude here.
const STEP = 0.0001;

const at = (north, east) => ({
  latitude: FIXTURE_ORIGIN.latitude + north * STEP,
  longitude: FIXTURE_ORIGIN.longitude + east * STEP,
});

// Dog names the handler gave (history preferences' dogAliases).
const ALIASES = Object.freeze({ 4: '豆豆', 6: '小黑', 8: '阿福' });

// ---- raw rows ------------------------------------------------------------

let nextId = 1;

// A dog_status row as BleForegroundService stores it. `fix` is a position
// ({latitude, longitude}) or null for a packet without a GPS fix (0,0).
function bleRow({ slave, master = 7, time, fix, receiver = at(-6, -4), satellites = 9, hdop = 0.9,
  battery = 82, usb = 0, speed = 3, rssi = -72, snr = 8 }) {
  return {
    id: nextId++, received_at: time, master_id: master, slave_id: slave,
    slave_lat: fix ? fix.latitude : 0, slave_lon: fix ? fix.longitude : 0,
    master_lat: receiver?.latitude ?? null, master_lon: receiver?.longitude ?? null,
    distance_meters: fix ? 40 : null, speed_kmh: fix ? speed : 0,
    satellites: fix ? satellites : 0, hdop: fix ? hdop : 655.35,
    battery_percentage: battery, battery_valid: 1, usb_present: usb,
    master_battery_percentage: 64, master_battery_valid: 1,
    rssi, snr, packet_type: 'status',
  };
}

// A supabase_dog_status row as the cloud download stores it.
function cloudRow({ slave, master = 9, time, fix, satellites = 9, hdop = 1.1, battery = 76, usb = 0,
  speed = 2, rssi = -80, snr = 6 }) {
  return {
    id: nextId++, owner_user_id: FIXTURE_OWNER, slave_id: slave, master_id: master,
    received_at: time, track_at: time,
    slave_lat: fix ? fix.latitude : 0, slave_lon: fix ? fix.longitude : 0,
    satellites: fix ? satellites : 0, hdop: fix ? hdop : 655.35,
    speed_kmh: fix ? speed : 0, battery_percentage: battery, battery_valid: 1, usb_present: usb, rssi, snr,
  };
}

// One row every `every` ms from `from` to `to` (both relative to now, ms ago),
// the position walking from `start` by `step` (in STEP units) per row.
function series(make, now, { from, to = 5 * SECOND, every = 10 * SECOND, start, step = [0, 0], ...rest }) {
  const rows = [];
  for (let ago = from, index = 0; ago >= to; ago -= every, index += 1) {
    const fix = start && at(start[0] + step[0] * index, start[1] + step[1] * index);
    rows.push(make({ ...rest, time: now - ago, fix }));
  }
  return rows;
}

// A position `north` and `east` metres from `base`.
const METRES_PER_DEGREE = 111195;
const offset = (base, north, east) => ({
  latitude: base.latitude + north / METRES_PER_DEGREE,
  longitude: base.longitude + east / (METRES_PER_DEGREE * Math.cos((base.latitude * Math.PI) / 180)),
});
// Receiver 7's resting place in every fixture (bleRow's default).
const RECEIVER = at(-6, -4);

// Like series, but the dog's and the receiver's positions are functions of the
// row's progress (0 at `from`, 1 at `to`): a dog walking away from or back to
// the receiver, a receiver that moves on its own.
function track(make, now, { from, to = 5 * SECOND, every = 10 * SECOND, dog, receiver = () => RECEIVER, ...rest }) {
  const rows = [];
  for (let ago = from; ago >= to; ago -= every) {
    const progress = from === to ? 1 : (from - ago) / (from - to);
    const where = receiver(progress);
    rows.push(make({ ...rest, time: now - ago, receiver: where, fix: dog(progress, where) }));
  }
  return rows;
}

// dog_status ids follow the order the service wrote the rows (time order), and
// the live feed's newest row is the one with the highest id.
function inTimeOrder(rows) {
  const ids = rows.map(row => row.id).sort((left, right) => left - right);
  return [...rows].sort((left, right) => left.received_at - right.received_at || left.id - right.id)
    .map((row, index) => ({ ...row, id: ids[index] }));
}

// A dog `metres` from the receiver towards north-east, wandering a few metres
// sideways from row to row so it reads as walking, never as parked.
const northEastOf = (where, metres, progress) => {
  const side = Math.sin(progress * 12) * 6;
  return offset(where, metres / Math.SQRT2 + side, metres / Math.SQRT2 - side);
};

// ---- receiver, cloud and phone states -------------------------------------

// BleBackground.getState() of a receiver (QR Master 7) delivering packets.
const receiving = now => ({
  enabled: true, running: true, connected: true, receiving: true,
  deviceName: 'DogGPS-Master7', expectedMasterId: 7, lastReceivedAt: now - 3 * SECOND,
  storageError: '', resumeError: '',
});
const synced = now => ({ ownerId: FIXTURE_OWNER, lastSuccess: now - 5 * SECOND, error: null });

// The handler walking slowly north-east, phone location recording on.
function walkingPhone(now) {
  const route = [];
  // One fix every 10 s for ten minutes, the newest a second old.
  for (let index = 0; index <= 60; index += 1) {
    const ago = SECOND + (60 - index) * 10 * SECOND;
    route.push({ ...at(-12 + index * 0.1, -10 + index * 0.08), timestamp: now - ago,
      accuracy: 6, speedKmh: 3, rawSpeedKmh: 3, motionState: 'moving' });
  }
  return { route, position: route[route.length - 1] };
}

// ---- the dogs ------------------------------------------------------------

// Dog 4 (豆豆) heard by this phone's receiver 7 up to `until` ms ago.
const dog4Ble = (now, until = 5 * SECOND) =>
  series(bleRow, now, { slave: 4, from: 10 * MINUTE, to: until, start: [14, 9], step: [0.05, 0.08] });
// Dog 6 (小黑) and dog 8 (阿福) from another team's receiver 9, via the cloud.
const dog6Cloud = (now, until = 15 * SECOND) =>
  series(cloudRow, now, { slave: 6, from: 10 * MINUTE, to: until, every: 15 * SECOND, start: [-18, 24], step: [0.03, -0.05] });
const dog8Cloud = now =>
  series(cloudRow, now, { slave: 8, from: 10 * MINUTE, to: 20 * SECOND, every: 15 * SECOND, start: [22, -24], step: [-0.05, 0] });

const FIXTURES = {
  // Receiver connected, cloud synced, three fresh dogs, phone recording.
  'all-good': now => ({
    receiver: receiving(now), cloud: synced(now), phone: walkingPhone(now),
    ble: dog4Ble(now), cloudRows: [...dog6Cloud(now), ...dog8Cloud(now)],
  }),
  // A first start: no receiver set up and nothing downloaded (signed in, empty
  // account). The phone itself still has a position.
  'no-data': now => ({
    receiver: { enabled: false, running: false, connected: false, receiving: false,
      deviceName: 'DogGPS Master', expectedMasterId: 0, lastReceivedAt: 0 },
    cloud: synced(now), phone: walkingPhone(now), ble: [], cloudRows: [],
  }),
  // Receiver 7 was chosen a minute ago and has not sent anything yet. The
  // newest stored packet is from receiver 3, used until then: dog 4's position
  // in it is real, but receiver 3's position must not be drawn as receiver 7's.
  'receiver-connecting': now => ({
    receiver: { ...receiving(now), connected: false, receiving: false, lastReceivedAt: 0 },
    cloud: synced(now), phone: walkingPhone(now),
    ble: series(bleRow, now, { slave: 4, master: 3, from: 10 * MINUTE, to: MINUTE,
      start: [14, 9], step: [0.05, 0.08], receiver: at(30, 28) }),
    cloudRows: [...dog6Cloud(now), ...dog8Cloud(now)],
  }),
  // Receiver 7 delivered until five minutes ago, then the link dropped; the
  // service keeps reconnecting. Its dog 4 has had no packet since.
  'receiver-disconnected': now => ({
    receiver: { ...receiving(now), connected: false, receiving: false, lastReceivedAt: now - 5 * MINUTE },
    cloud: synced(now), phone: walkingPhone(now),
    ble: dog4Ble(now, 5 * MINUTE), cloudRows: [...dog6Cloud(now), ...dog8Cloud(now)],
  }),
  // 小黑 (dog 6, heard by receiver 7) went inside twelve minutes ago: clear
  // fixes in one spot, then packets without a fix. The real indoor-hold rules
  // (HoldStore + the bundled environment model) hold it there as 室內.
  'dog-indoor': now => ({
    receiver: receiving(now), cloud: synced(now), phone: walkingPhone(now),
    ble: [
      ...dog4Ble(now),
      ...series(bleRow, now, { slave: 6, from: 25 * MINUTE, to: 12 * MINUTE + 10 * SECOND,
        start: [-18, 24] }).map((row, index) => ({ ...row,
        slave_lat: row.slave_lat + (index % 5) * 0.00001, slave_lon: row.slave_lon - (index % 5) * 0.00001 })),
      ...series(bleRow, now, { slave: 6, from: 12 * MINUTE, to: 8 * SECOND, rssi: -96, snr: -4 }),
    ],
    cloudRows: dog8Cloud(now),
  }),
  // Dog 4 current; dog 6 last heard four minutes ago (just past the 3-minute
  // live window); dog 8 last heard forty minutes ago (kept up to 24 hours).
  'dogs-aged': now => ({
    receiver: receiving(now), cloud: synced(now), phone: walkingPhone(now),
    ble: dog4Ble(now),
    cloudRows: [
      ...dog6Cloud(now, 4 * MINUTE + 10 * SECOND),
      ...series(cloudRow, now, { slave: 8, from: 50 * MINUTE, to: 40 * MINUTE, every: 15 * SECOND,
        start: [22, -24], step: [-0.05, 0] }),
    ],
  }),
  // 豆豆 (dog 4) walked away from receiver 7: 600 m ten minutes ago, 1.3 km
  // now. Out of range: a red dashed line from the ring's edge to it. 小黑
  // (dog 6, also on receiver 7) stays well inside; 阿福 comes from the cloud.
  'range-out': now => ({
    receiver: receiving(now), cloud: synced(now), phone: walkingPhone(now),
    ble: inTimeOrder([
      ...track(bleRow, now, { slave: 6, from: 10 * MINUTE, to: 8 * SECOND,
        dog: (progress, where) => offset(where, -250 + progress * 20, -150) }),
      ...track(bleRow, now, { slave: 4, from: 10 * MINUTE,
        dog: (progress, where) => northEastOf(where, 600 + 700 * progress, progress) }),
    ]),
    cloudRows: dog8Cloud(now),
  }),
  // 豆豆 is 880 m from receiver 7 (快離開 band, 800 m–1 km): inside the ring,
  // no line, its marker unchanged; only its card turns amber (PR 046).
  'range-near-edge': now => ({
    receiver: receiving(now), cloud: synced(now), phone: walkingPhone(now),
    ble: inTimeOrder([
      ...track(bleRow, now, { slave: 6, from: 10 * MINUTE, to: 8 * SECOND,
        dog: (progress, where) => offset(where, -250 + progress * 20, -150) }),
      ...track(bleRow, now, { slave: 4, from: 10 * MINUTE,
        dog: (progress, where) => northEastOf(where, 500 + 380 * Math.min(1, progress * 1.4), progress) }),
    ]),
    cloudRows: dog8Cloud(now),
  }),
  // 豆豆 went out to 1.3 km and is walking back, 950 m now: back inside the
  // ring but not cleared (needs 2 positions within 900 m over 2 minutes), so it
  // is still out of range — but drawn inside the ring, hence no line.
  'range-returning': now => ({
    receiver: receiving(now), cloud: synced(now), phone: walkingPhone(now),
    ble: inTimeOrder([
      ...track(bleRow, now, { slave: 6, from: 10 * MINUTE, to: 8 * SECOND,
        dog: (progress, where) => offset(where, -250 + progress * 20, -150) }),
      ...track(bleRow, now, { slave: 4, from: 10 * MINUTE,
        dog: (progress, where) => northEastOf(where, 1300 - 350 * progress, progress) }),
    ]),
    cloudRows: dog8Cloud(now),
  }),
  // 小黑 (dog 6) has had no new position for almost three minutes. At its last
  // position it was 780 m from receiver 7: in range. The handler has since
  // walked 300 m the other way with the receiver, so that position is now
  // outside the ring — but the judgement stays where it was made: still in
  // range, no line. 豆豆 walks along with the receiver.
  'range-stale-inside': now => {
    // The receiver starts walking off (300 m south-west) right after 小黑's
    // last position, 170 s ago.
    const start = (10 * MINUTE - 170 * SECOND) / (10 * MINUTE - 5 * SECOND);
    const moving = progress => (progress <= start ? RECEIVER
      : offset(RECEIVER, -212 * (progress - start) / (1 - start), -212 * (progress - start) / (1 - start)));
    return {
      receiver: receiving(now), cloud: synced(now), phone: walkingPhone(now),
      ble: inTimeOrder([
        ...track(bleRow, now, { slave: 6, from: 10 * MINUTE, to: 170 * SECOND,
          dog: progress => northEastOf(RECEIVER, 760 + 20 * progress, progress) }),
        ...track(bleRow, now, { slave: 4, from: 10 * MINUTE, receiver: moving,
          dog: (progress, where) => offset(where, 60 + progress * 10, -120) }),
      ]),
      cloudRows: dog8Cloud(now),
    };
  },
  // Signed in, no receiver set up: 小黑 and 阿福 come only from the cloud. No
  // receiver, so no range ring and no range judgement at all.
  'cloud-only': now => ({
    receiver: { enabled: false, running: false, connected: false, receiving: false,
      deviceName: 'DogGPS Master', expectedMasterId: 0, lastReceivedAt: 0 },
    cloud: synced(now), phone: walkingPhone(now),
    ble: [], cloudRows: [...dog6Cloud(now), ...dog8Cloud(now)],
  }),
};

export const FIXTURE_NAMES = Object.freeze(Object.keys(FIXTURES));

// dogtracker://dev/fixture?name=dogs-aged → 'dogs-aged'; ?name=off → 'off'.
export function fixtureNameFromUrl(url) {
  const match = /^dogtracker:\/\/dev\/fixture\?name=([a-z0-9-]+)$/.exec(url || '');
  if (!match) return null;
  return match[1] === 'off' || FIXTURES[match[1]] ? match[1] : null;
}

// ---- what the app's own readers would make of those rows ------------------

const hasFix = row => Number.isFinite(row.slave_lat) && Number.isFinite(row.slave_lon)
  && !(row.slave_lat === 0 && row.slave_lon === 0);
const timeOf = row => row.track_at ?? row.received_at;
const newestBy = (rows, test = () => true) => {
  const result = new Map();
  for (const row of rows) {
    if (!test(row)) continue;
    const old = result.get(row.slave_id);
    if (!old || timeOf(row) > timeOf(old) || (timeOf(row) === timeOf(old) && row.id > old.id)) {
      result.set(row.slave_id, row);
    }
  }
  return [...result.values()].sort((left, right) => left.slave_id - right.slave_id);
};

// CloudDatabase.latestStatusRows: the environment of the last completed
// two-minute window of the same Master and dog.
function withEnvironment(row, table, now) {
  const completedBefore = Math.floor(now / ENVIRONMENT_WINDOW_MS) * ENVIRONMENT_WINDOW_MS;
  const pair = table.filter(other => other.master_id === row.master_id && other.slave_id === row.slave_id);
  const latest = Math.max(...pair.map(timeOf).filter(time => time < completedBefore && now - time <= MAX_AGE_MS));
  if (!Number.isFinite(latest)) return { ...row, environment: null };
  const start = Math.floor(latest / ENVIRONMENT_WINDOW_MS) * ENVIRONMENT_WINDOW_MS;
  const window = pair.filter(other => timeOf(other) >= start && timeOf(other) < start + ENVIRONMENT_WINDOW_MS)
    .map(other => ({ ...other, track_at: timeOf(other) }));
  return { ...row, environment: predictEnvironment(window) };
}

const packet = (row, source) => ({
  slave_id: row.slave_id, master_id: row.master_id, track_at: timeOf(row), received_at: row.received_at,
  slave_lat: row.slave_lat, slave_lon: row.slave_lon, speed_kmh: row.speed_kmh,
  battery_percentage: row.battery_percentage, battery_valid: row.battery_valid,
  usb_present: row.usb_present, ...(source === 'ble' ? { distance_meters: row.distance_meters } : {}), source,
});

// CloudDatabase.holdRows on a cold start (no cursors): each table's rows of
// the last HOLD_LOOKBACK_MS; a dog silent for longer (heard within the 24
// hours before that) replays its own last HOLD_LOOKBACK_MS; and, for every
// dog of either kind, its last 40 good fixes before that window as seeds,
// however old.
function holdBatch(ble, cloud, now) {
  const since = now - HOLD_LOOKBACK_MS;
  const toHold = source => row => ({
    id: row.id, master_id: row.master_id, slave_id: row.slave_id,
    latitude: row.slave_lat, longitude: row.slave_lon, satellites: row.satellites, hdop: row.hdop,
    rssi: row.rssi, snr: row.snr, usb_present: row.usb_present, time: timeOf(row), source,
    // Only dog_status knows where this phone's receiver was.
    ...(source === 'ble' ? { master_latitude: row.master_lat, master_longitude: row.master_lon } : {}),
  });
  const rows = [], seeds = [];
  for (const [table, source] of [[ble, 'ble'], [cloud, 'cloud']]) {
    const fresh = table.filter(row => timeOf(row) >= since);
    const heard = new Set(fresh.map(row => row.slave_id));
    const windows = new Map();
    for (const row of table) {
      const time = timeOf(row);
      if (heard.has(row.slave_id) || time >= since || time < since - MAX_AGE_MS) continue;
      windows.set(row.slave_id, Math.max(windows.get(row.slave_id) ?? -Infinity, time));
    }
    const older = [];
    for (const [slave, newest] of windows) {
      const from = newest - HOLD_LOOKBACK_MS;
      windows.set(slave, from);
      older.push(...table.filter(row => row.slave_id === slave && timeOf(row) >= from && timeOf(row) < since)
        .sort((left, right) => timeOf(left) - timeOf(right) || left.id - right.id));
    }
    for (const slave of [...heard, ...windows.keys()]) {
      const until = windows.get(slave) ?? since;
      seeds.push(...table.filter(row => row.slave_id === slave && timeOf(row) < until && hasFix(row)
        && row.satellites >= HOLD_CONFIG.goodMinSatellites)
        .sort((left, right) => timeOf(right) - timeOf(left)).slice(0, 40).map(toHold(source)));
    }
    rows.push(...older.map(toHold(source)),
      ...fresh.sort((left, right) => left.id - right.id).map(toHold(source)));
  }
  return { rows, seeds };
}

/**
 * The inputs a named fixture gives the screens, or null for an unknown name.
 * `now` is the fixed clock the screens read instead of the real one.
 */
export function buildFixture(name, now = FIXTURE_NOW) {
  const make = FIXTURES[name];
  if (!make) return null;
  nextId = 1;
  const { receiver, cloud, phone, ble = [], cloudRows = [] } = make(now);
  // The live feed (TrackingFeed → trackingSourceReducer) reads dog_status:
  // the newest row is the point, plus the last valid position per endpoint.
  const points = ble.map(mapDogStatusRow);
  const point = points.reduce((newest, row) => (!newest || row.id > newest.id ? row : newest), null);
  // useCloudDogs: the newest downloaded fix per dog, the newest packet of
  // each source with its environment, and the indoor holds.
  const holds = createHoldStore();
  holds.ingest(holdBatch(ble, cloudRows, now));
  // useCloudDogs reads everything since now - MAX_AGE_MS.
  const recent = row => now - timeOf(row) <= MAX_AGE_MS;
  const recentFix = row => recent(row) && hasFix(row);
  const packets = [
    ...newestBy(ble, recent).map(row => withEnvironment(packet(row, 'ble'), ble, now)),
    ...newestBy(ble, recentFix).map(row => withEnvironment(packet(row, 'ble'), ble, now)),
    ...newestBy(cloudRows, recent).map(row => withEnvironment(packet(row, 'cloud'), cloudRows, now)),
  ];
  // RideAlong: the handler's phone speeds over the last half minute.
  const rides = createRideDetector();
  for (const position of phone?.route || []) rides.add(position, now);
  return {
    name,
    now,
    receiverState: receiver,
    readReceiverState: { getState: async () => receiver },
    cloudSync: cloud,
    raw: { ble, cloud: cloudRows },
    tracking: {
      point: point ?? emptyTrackingPoint,
      positionSamples: point ? mergePositionSamples([], points, point) : [],
      route: emptyLiveRoute(),
    },
    cloudDogs: {
      rows: cloud?.ownerId ? newestBy(cloudRows, recentFix).map(row => ({ ...row, source: 'cloud' })) : [],
      packets: cloud?.ownerId ? packets : packets.filter(row => row.source === 'ble'),
      track: [],
      holds: holds.holds(now),
      statuses: holds.statuses(),
      ranges: holds.ranges(),
      error: '',
    },
    livePhone: phone?.position ? {
      running: true, status: '記錄中',
      position: phone.position,
      ageSeconds: Math.max(0, Math.round((now - phone.position.timestamp) / SECOND)),
    } : { running: false, status: '未記錄' },
    phoneRoute: phone?.route || [],
    ride: rides.ride(now),
    dogAliases: ALIASES,
  };
}

// The map's own preferences are the user's; a fixture shows every dog, none
// followed, so its screenshot does not depend on what this phone saved.
const FIXTURE_PREFERENCES = Object.freeze({
  showMasterMarker: true, showSlaveMarker: true, focusSlaveId: null, hiddenSlaveIds: [],
});

const ignoreWrite = () => Promise.resolve();

/**
 * Swaps a fixture's inputs into the live ones App hands the map. With no
 * fixture the live inputs come back untouched. The SQLite session itself keeps
 * running underneath; nothing a fixture shows can write to it.
 */
export function applyScreenFixture(fixture, live) {
  if (!fixture) return live;
  const { tracking, phone, cloudSync, history } = live;
  return {
    tracking: {
      ...tracking,
      ...fixture.tracking,
      caughtUp: true,
      historyLoaded: true,
      initialSnapshotReady: true,
      ready: { ...tracking.ready, real: true },
      errors: { ...tracking.errors, real: null },
      realWriteError: null,
      preferences: { ...tracking.preferences, ready: true, busy: false, error: null,
        value: { ...tracking.preferences.value, ...FIXTURE_PREFERENCES } },
      // A tap on a fixture's eye or follow button must not save the fixture's
      // dog ids into this phone's real preferences.
      saveTrackingPreferences: ignoreWrite,
      retryTrackingPreferences: ignoreWrite,
      resetTrackingPreferences: ignoreWrite,
      saveRealStatus: ignoreWrite,
    },
    phone: { ...phone, permission: 'precise', services: true, busy: false, error: null,
      enabled: !!fixture.livePhone.running },
    cloudDogs: fixture.cloudDogs,
    cloudSync: { ...cloudSync, ...fixture.cloudSync },
    history: history && {
      ...history, preferences: { ...history.preferences, dogAliases: fixture.dogAliases },
    },
  };
}
