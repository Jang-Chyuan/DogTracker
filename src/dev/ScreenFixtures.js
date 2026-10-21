import { dismissWaitingSources, waitingSourcesState } from '../map/WaitingSources';
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

import { normalizeAlertPreferences } from '../alerts/AlertPreferences';
import { emptyTrackingPoint, mapDogStatusRow } from '../models/TrackingPoint';
import { FIXTURE_PHOTO } from './fixturePhoto';
import { mergePositionSamples } from '../tracking/RouteSamples';
import { emptyLiveRoute } from '../tracking/LiveRouteWindow';
import { MAX_AGE_MS } from '../map/DogMerge';
import { createHoldStore, HOLD_LOOKBACK_MS } from '../placement/HoldStore';
import { HOLD_CONFIG } from '../placement/IndoorHold';
import { createRideDetector } from '../placement/RideAlong';
import { predictEnvironment, ENVIRONMENT_WINDOW_MS } from '../ml/Environment';
import { todayRouteDistance } from '../tracking/TodayDistance';
import { ONBOARDING_DONE, ONBOARDING_SIGN_IN } from '../app/Launch';
import { HISTORY_DAY_AFTER_MS, HISTORY_DAY_CONTEXT_MS } from '../mapHistory/HistoryDatabase';
import { dogHistoryRow, phoneHistoryRow } from '../history/HistoryRows';
import { fixtureAddressLookup } from './fixtureGeocoder';
import { fixtureExporter } from './fixtureExporter';
import { dayKey } from '../history/screen/HistoryScreenDates';
import { activityMinutes, activityReadings } from '../activity/ActivityMinutes';
import { ACTIVITY_CONTEXT_MS } from '../activity/ActivityData';
import { CARD_BATTERY_ROWS } from '../activity/DogCardReadings';
import { CATCH_UP_IDLE } from '../tracking/ResumeCatchUp';
import { plausibleBattery } from '../tracking/BatteryPlausibility';

// 2026-10-07 09:30 in Taiwan. Every fixture's rows are placed against this.
export const FIXTURE_NOW = Date.parse('2026-10-07T01:30:00Z');
// Taoyuan station: invented positions only, never the team's real area.
export const FIXTURE_ORIGIN = Object.freeze({ latitude: 24.9893, longitude: 121.3135 });
export const FIXTURE_OWNER = 'fixture-owner';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
// ~11 m per step in latitude, ~10 m in longitude here.
const STEP = 0.0001;

const at = (north, east) => ({
  latitude: FIXTURE_ORIGIN.latitude + north * STEP,
  longitude: FIXTURE_ORIGIN.longitude + east * STEP,
});

// Dog names the handler gave (history preferences' dogAliases). Dog 5 has
// none: it is 「狗 5」.
const ALIASES = Object.freeze({ 4: '豆豆', 6: '小黑', 8: '阿福' });

// ---- raw rows ------------------------------------------------------------

let nextId = 1;

// A dog_status row as BleForegroundService stores it. `fix` is a position
// ({latitude, longitude}) or null for a packet without a GPS fix (0,0).
// `activity` (and `batteryValid`) can be a function of the row's time, for a
// dog that went to rest at some point, or a collar whose battery reading
// stopped.
const valueAt = (value, time) => (typeof value === 'function' ? value(time) : value);

function bleRow({ slave, master = 7, time, fix, receiver = at(-6, -4), satellites = 9, hdop = 0.9,
  battery = 82, usb = 0, speed = 3, rssi = -72, snr = 8, activity = 0.3, batteryValid = 1, masterBattery = 64 }) {
  return {
    id: nextId++, received_at: time, master_id: master, slave_id: slave,
    slave_lat: fix ? fix.latitude : 0, slave_lon: fix ? fix.longitude : 0,
    master_lat: receiver?.latitude ?? null, master_lon: receiver?.longitude ?? null,
    distance_meters: fix ? 40 : null, speed_kmh: fix ? speed : 0,
    satellites: fix ? satellites : 0, hdop: fix ? hdop : 655.35,
    battery_percentage: battery, battery_valid: valueAt(batteryValid, time), usb_present: usb,
    master_battery_percentage: masterBattery, master_battery_valid: 1,
    activity: valueAt(activity, time), activity_valid: valueAt(activity, time) == null ? 0 : 1,
    rssi, snr, packet_type: 'status',
  };
}

// A supabase_dog_status row as the cloud download stores it.
function cloudRow({ slave, master = 9, time, fix, satellites = 9, hdop = 1.1, battery = 76, usb = 0,
  speed = 2, rssi = -80, snr = 6, activity = 0.3 }) {
  return {
    id: nextId++, owner_user_id: FIXTURE_OWNER, slave_id: slave, master_id: master,
    received_at: time, track_at: time,
    slave_lat: fix ? fix.latitude : 0, slave_lon: fix ? fix.longitude : 0,
    satellites: fix ? satellites : 0, hdop: fix ? hdop : 655.35,
    speed_kmh: fix ? speed : 0, battery_percentage: battery, battery_valid: 1, usb_present: usb, rssi, snr,
    activity: valueAt(activity, time), activity_valid: valueAt(activity, time) == null ? 0 : 1,
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

// A dog `metres` from the receiver towards `bearing` (degrees from north),
// wandering a few metres sideways from row to row so it reads as walking,
// never as parked.
const awayFrom = (where, metres, progress, bearing = 45) => {
  const side = Math.sin(progress * 12) * 6;
  const angle = (bearing * Math.PI) / 180;
  return offset(where, metres * Math.cos(angle) - side * Math.sin(angle),
    metres * Math.sin(angle) + side * Math.cos(angle));
};
const northEastOf = (where, metres, progress) => awayFrom(where, metres, progress, 45);

// ---- receiver, cloud and phone states -------------------------------------

// BleBackground.getState() of a receiver (QR Master 7) delivering packets.
const receiving = now => ({
  enabled: true, running: true, connected: true, receiving: true,
  deviceId: 'AA:BB:CC:00:00:07', sessionId: 'fixture-session',
  deviceName: 'DogGPS-Master7', expectedMasterId: 7, lastReceivedAt: now - 3 * SECOND,
  storageError: '', resumeError: '',
});
// The last live download started 5 s ago and succeeded (DogFreshness judges
// cloud dogs against it).
const synced = now => ({ ownerId: FIXTURE_OWNER, lastSuccess: now - 5 * SECOND,
  lastDownloadAt: now - 5 * SECOND, failingSince: null, error: null });

// useCloudUpload's answer (S3): receivers this account may upload for
// (`masters`), each one's route (`phone` / `wifi` lists), rows still waiting
// per receiver, rows the cloud refused (`blocked`), the last success — this
// phone's per receiver (`lastByMaster`) and the receiver's own Wi-Fi as the
// downloaded copy shows it (`wifiByMaster`). Its actions write nothing.
function uploading(now, { phone = [7], wifi = [], pending = {}, blocked = 0, last = now - 8 * SECOND,
  error = '', lastByMaster = null, wifiByMaster = {} } = {}) {
  const waiting = Object.values(pending).reduce((sum, value) => sum + value, 0);
  return {
    owner: FIXTURE_OWNER, supported: true, settingsReady: true, phoneId: 'fixture-phone',
    masters: [...phone, ...wifi],
    settings: [...phone.map(master => ({ master_id: master, mode: 'phone' })),
      ...wifi.map(master => ({ master_id: master, mode: 'wifi' }))],
    counts: [{ status: 'pending', count: waiting }, ...(blocked ? [{ status: 'blocked', count: blocked }] : [])],
    pendingByMaster: pending, last, error,
    lastByMaster: lastByMaster
      ?? (last == null ? {} : Object.fromEntries(phone.map(master => [master, last]))),
    wifiByMaster,
    setMode: async () => {}, switchMode: async () => {}, retry: async () => {},
  };
}

// No account: useCloudSync has no owner and nothing was downloaded for one.
const SIGNED_OUT = Object.freeze({ ownerId: null, lastSuccess: null, lastDownloadAt: null,
  failingSince: null, error: null });

// Today's recorded route before `end` (a myLocationTracker row each 10 s):
// `metres` walked in 10 m steps up to `end` at `endTime`, zig-zagging west
// and south of it in 200 m legs so it stays in the station's blocks.
function morningWalk(end, endTime, metres = 2700) {
  const steps = Math.round(metres / 10);
  const points = [];
  let here = { latitude: end.latitude, longitude: end.longitude };
  for (let index = 0; index <= steps; index += 1) {
    points.unshift({ ...here, time: endTime - index * 10 * SECOND, accuracy: 6 });
    const leg = Math.floor(index / 20) % 4;
    // Walking backwards from the end: west, south, west, north legs.
    here = offset(here, leg === 1 ? -10 : leg === 3 ? 10 : 0, leg === 0 || leg === 2 ? -10 : 0);
  }
  return points;
}

// The handler walking slowly north-east, phone location recording on; the
// morning's walk before it makes 「今天 2.7 km」 (as in the A1 mockup).
function walkingPhone(now) {
  const route = [];
  // One fix every 10 s for ten minutes, the newest a second old.
  for (let index = 0; index <= 60; index += 1) {
    const ago = SECOND + (60 - index) * 10 * SECOND;
    route.push({ ...at(-12 + index * 0.1, -10 + index * 0.08), timestamp: now - ago,
      accuracy: 6, speedKmh: 3, rawSpeedKmh: 3, motionState: 'moving' });
  }
  const today = [
    ...morningWalk(route[0], route[0].timestamp - 10 * SECOND, 2650),
    ...route.map(point => ({ latitude: point.latitude, longitude: point.longitude, time: point.timestamp,
      accuracy: point.accuracy })),
  ];
  return { route, position: route[route.length - 1], today };
}

// The same walk, but the newest fix is `age` old (the phone lost GPS).
function stalePhone(now, age) {
  const { route, today } = walkingPhone(now - age);
  return { route, position: route[route.length - 1], today };
}

// An activity reading that is calm (0.02, under the 0.05 rest line) for the
// last `minutes` before now and ordinary (0.3) before that.
const restingFor = (now, span) => time => (time >= now - span ? 0.02 : 0.3);

// ---- the dogs ------------------------------------------------------------

// Dog 4 (豆豆) heard by this phone's receiver 7 up to `until` ms ago.
// 豆豆's morning for the charging fixtures (2026-10-16): walking near home
// from four hours ago until `walkUntil` ago, then on the charger at home
// (activity 0 marked valid, usb_present 1) until `chargeUntil` ago, then
// lying still there (0.02, off the charger). One packet every 30 s.
function chargingDay(now, { walkUntil, chargeUntil = 0 }) {
  const home = (progress, where) => northEastOf(where, 420, 1);
  const rows = [
    ...track(bleRow, now, { slave: 4, from: 4 * HOUR, to: walkUntil + 30 * SECOND, every: 30 * SECOND, battery: 58,
      activity: 0.3, dog: (progress, where) => northEastOf(where, 420 + 200 * (1 - progress), progress) }),
    ...track(bleRow, now, { slave: 4, from: walkUntil, to: chargeUntil ? chargeUntil + 30 * SECOND : 5 * SECOND,
      every: 30 * SECOND, battery: 62, usb: 1, activity: 0, dog: home }),
  ];
  if (chargeUntil) {
    rows.push(...track(bleRow, now, { slave: 4, from: chargeUntil, to: 5 * SECOND, every: 30 * SECOND, battery: 62,
      activity: 0.02, dog: home }));
  }
  return rows;
}
const dog4Ble = (now, until = 5 * SECOND) =>
  series(bleRow, now, { slave: 4, from: 10 * MINUTE, to: until, start: [14, 9], step: [0.05, 0.08] });
// Dog 6 (小黑) and dog 8 (阿福) from another team's receiver 9, via the cloud.
const dog6Cloud = (now, until = 15 * SECOND) =>
  series(cloudRow, now, { slave: 6, from: 10 * MINUTE, to: until, every: 15 * SECOND, start: [-18, 24], step: [0.03, -0.05] });
const dog8Cloud = now =>
  series(cloudRow, now, { slave: 8, from: 10 * MINUTE, to: 20 * SECOND, every: 15 * SECOND, start: [22, -24], step: [-0.05, 0] });

// A dog on receiver 7 that went inside `inside` ms ago at `spot`: clear fixes
// in one place for 13 minutes, then packets without a fix. The real hold
// rules (HoldStore + the bundled environment model) hold it there.
const indoorBle = (now, slave, spot, { inside = 12 * MINUTE, until = 8 * SECOND, ...rest } = {}) => [
  ...series(bleRow, now, { slave, from: inside + 13 * MINUTE, to: inside + 10 * SECOND, start: spot, ...rest })
    .map((row, index) => ({ ...row, slave_lat: row.slave_lat + (index % 5) * 0.00001,
      slave_lon: row.slave_lon - (index % 5) * 0.00001 })),
  ...series(bleRow, now, { slave, from: inside, to: until, rssi: -96, snr: -4, ...rest }),
];



// Ten minutes of clear fixes at `spot`, then indoors from `inside` ago: a weak
// fix (5 satellites, HDOP 3–5) a few metres around it every minute and a packet
// without a fix in between (card-indoor-cold-drift).
const coldDrift = (now, slave, spot, inside) => [
  ...series(bleRow, now, { slave, from: inside + 10 * MINUTE, to: inside + 10 * SECOND, every: 30 * SECOND,
    start: spot, battery: 62, activity: 0.02 }),
  ...series(bleRow, now, { slave, from: inside - 30 * SECOND, to: 8 * SECOND, every: 30 * SECOND, start: spot,
    rssi: -96, snr: -4, battery: 62, activity: 0.02 }).map((row, index) => (index % 2
    ? { ...row, slave_lat: 0, slave_lon: 0, satellites: 0, hdop: 655.35, speed_kmh: 0, distance_meters: null }
    : { ...row, slave_lat: row.slave_lat + ((index * 37) % 11 - 5) * 0.00001,
      slave_lon: row.slave_lon - ((index * 37) % 11 - 5) * 0.00001, satellites: 5, hdop: 3 + (index % 3) })),
];

// A long, fictional address (the card's address line wraps to two lines).
const LONG_PLACE = { names: [{ line: '330台灣桃園市桃園區虛構里示範路一段一百二十八巷六十四弄三十二號' }] };
// 小黑 walking out of range to 1.6 km, then held indoors there (packets
// without a fix) from `inside` to `until` ago.
const heldFarAway = (now, inside, until) => [
  ...track(bleRow, now, { slave: 6, from: inside + 15 * MINUTE, to: inside + 10 * SECOND, battery: 62,
    dog: (progress, where) => awayFrom(where, 700 + 900 * Math.min(1, progress * 1.5), progress, 200) }),
  ...series(bleRow, now, { slave: 6, from: inside, to: until, rssi: -96, snr: -4, battery: 62 }),
];

// ---- history (054a): one day of one dog or my route ------------------------

// A day's path as legs from `fromAgo` ms before now, one fix every `every` ms:
// { walk: minutes, speed (m/s), bearing (degrees from north) }, { stay:
// minutes } (a few metres of jitter), { drive: minutes, speed, bearing },
// { gap: minutes } (nothing recorded), { inside: minutes } (packets without a
// fix). Returns [{ time, fix }] (fix null inside). Positions start at `from`.
function legsPath(now, fromAgo, from, legs, every = 10 * SECOND) {
  const out = [];
  let time = now - fromAgo, here = from, index = 0;
  for (const leg of legs) {
    const minutes = leg.walk ?? leg.stay ?? leg.drive ?? leg.gap ?? leg.inside;
    const until = time + minutes * MINUTE;
    // A break in the data while on the move (the dog walks on unseen, at the
    // leg's speed and bearing, at most 300 m): it resumes elsewhere, a real 「沒有資料」 —
    // a break that ends where it began is a stay (067). { gap, still: true }
    // keeps the place.
    if (leg.gap != null) {
      if (!leg.still) {
        // At most 300 m: far enough to be another place, near the station.
        const gone = Math.min(300, (leg.speed ?? 1.1) * leg.gap * 60);
        const turn = ((leg.bearing ?? 45) * Math.PI) / 180;
        here = offset(here, Math.cos(turn) * gone, Math.sin(turn) * gone);
      }
      time = until;
      continue;
    }
    const speed = leg.walk != null || leg.drive != null ? leg.speed ?? (leg.drive != null ? 12 : 1.1) : 0;
    const angle = ((leg.bearing ?? 45) * Math.PI) / 180;
    for (; time < until && time <= now - 5 * SECOND; time += every, index += 1) {
      if (leg.inside != null) {
        // { inside, move: true }: packets without a fix while the dog walks on
        // (at the leg's speed and bearing) — 「收不到 GPS」 mid-walk (067).
        if (leg.move) {
          const step = (leg.speed ?? 1.1) * (every / SECOND), turn = ((leg.bearing ?? 45) * Math.PI) / 180;
          here = offset(here, Math.cos(turn) * step, Math.sin(turn) * step);
        }
        out.push({ time, fix: null });
        continue;
      }
      if (speed) here = offset(here, Math.cos(angle) * speed * (every / SECOND), Math.sin(angle) * speed * (every / SECOND));
      const wobble = leg.stay != null ? ((index % 5) - 2) * 1.2 : 0;
      out.push({ time, fix: offset(here, wobble, -wobble / 2) });
    }
    time = until;
  }
  return out;
}

// The phone's inputs for a route of myLocationTracker rows (a fix every 10 s):
// recording, the newest fix `age` old; today = the whole path.
function routePhone(path, now) {
  const today = path.filter(row => row.fix).map(row => ({ ...row.fix, time: row.time, accuracy: row.fix.accuracy ?? 6 }));
  const route = today.slice(-60).map(point => ({ latitude: point.latitude, longitude: point.longitude,
    timestamp: point.time, accuracy: 6, speedKmh: 3, rawSpeedKmh: 3, motionState: 'moving' }));
  return { route, position: route[route.length - 1] ?? null, today };
}

// The history page opened for a dog (看軌跡) or my route (「今天 x km」),
// today: the query the old page keeps, plus the dog's rows.
function historyPage(now, { slave = null, ble = [], cloudRows = [], phoneDays = [] } = {}) {
  return {
    preferences: slave == null
      ? { phone: true, client: false, timeMode: 'recent', hours: 24, slaves: [4], masters: [7] }
      : { phone: false, client: true, source: 'ble', timeMode: 'recent', hours: 24, slaves: [slave], masters: [7] },
    // phoneDays: my route on other days ({ time, latitude, longitude }).
    ble, cloudRows, phoneDays,
  };
}

// ---- history (054b): the calendar and a day only the cloud holds ----------
const DAY_MS = 24 * 60 * MINUTE;
// 小黑's walk `daysAgo` days back: out at 08:00 that day (fixture now 09:30),
// a fix every 30 s, about two hours near the station.
const pastWalk = (now, daysAgo, make, bearing = 40) => legsPath(now - daysAgo * DAY_MS + 6 * 60 * MINUTE,
  7.5 * 60 * MINUTE, at(-20, -60), [{ stay: 10 }, { walk: 20, bearing, speed: 0.6 }, { stay: 15 },
    { walk: 25, bearing: bearing + 80, speed: 0.6 }, { stay: 8 }, { walk: 15, bearing: bearing + 190, speed: 0.6 }],
  30 * SECOND).map(row => make({ slave: 6, time: row.time, fix: row.fix }));
// This phone holds 小黑's 9/29, 9/30, 10/2 and today; the cloud holds 8/12
// (its earliest), 8/20, 9/5, 9/28, 9/29, 10/3 and today. 9/28 and 10/3 are
// the days only the cloud holds (H3b's dots, H3c).
const calendarLocal = now => [8, 7, 5].flatMap((ago, i) => pastWalk(now, ago, bleRow, 30 + i * 40));
const calendarServer = now => [
  ...[56, 48, 32, 9, 8, 4].flatMap((ago, i) => pastWalk(now, ago, cloudRow, 200 - i * 30)),
  ...series(cloudRow, now, { slave: 6, from: 60 * MINUTE, to: 50 * MINUTE, every: MINUTE, start: [0, -80] }),
];
const cloudOnlyDay = now => dayKey(new Date(now - 9 * DAY_MS));

// The history's stand-in cloud (HistoryCloud's adapter): answers from
// `server` (the account's dog_telemetry), downloads by copying a day's rows
// into `local` (this phone's supabase_dog_status). `query` / `download`:
// 'ok', 'hang' (never answers), 'fail', 'partial' (half the day, then fails).
function fixtureHistoryCloud({ server, local, query = 'ok', download = 'ok', online = true, seed = null }) {
  const timeOfRow = row => row.track_at ?? row.received_at;
  const stopped = signal => new Promise((_, reject) => signal?.addEventListener?.('abort',
    () => reject(new Error('已取消'))));
  const wait = (ms, signal) => Promise.race([new Promise(resolve => setTimeout(resolve, ms)), stopped(signal)]);
  const isDog = slaveId => row => (Array.isArray(slaveId) ? slaveId.includes(row.slave_id) : row.slave_id === slaveId);
  const times = slaveId => server.filter(isDog(slaveId)).map(timeOfRow).sort((a, b) => a - b);
  const ask = async (signal, answer) => {
    if (query === 'hang') await stopped(signal);
    await wait(250, signal);
    if (query === 'fail') throw new Error('雲端的紀錄查不到（逾時）');
    return answer();
  };
  return {
    online, seed,
    cloud: {
      owner: FIXTURE_OWNER,
      newestBefore: ({ slaveId, cutoff, since, signal }) => ask(signal,
        () => [...times(slaveId)].reverse().find(time => time >= since && time < cutoff) ?? null),
      earliest: ({ slaveId, signal }) => ask(signal, () => times(slaveId)[0] ?? null),
      async download({ slaveId, dayStart, dayEnd, signal }) {
        const rows = server.filter(row => isDog(slaveId)(row) && timeOfRow(row) >= dayStart
          && timeOfRow(row) < dayEnd);
        if (download === 'hang') await stopped(signal);
        await wait(download === 'ok' ? 3500 : 1500, signal);
        if (download === 'fail') throw new Error('下載失敗');
        if (download === 'partial') {
          local.push(...rows.slice(0, Math.floor(rows.length / 2)));
          throw new Error('下載失敗');
        }
        local.push(...rows);
        return rows.length;
      },
    },
  };
}

// 小黑's history today with the calendar's days; `view` how it opens.
function calendarFixture(now, { view = null, signedIn = true, ...cloud } = {}) {
  const local = [];
  const base = FIXTURES['all-good'](now);
  return {
    ...base, ...(signedIn ? {} : { cloud: SIGNED_OUT }), openRoute: 'history',
    history: historyPage(now, { slave: 6, ble: [...calendarLocal(now), ...dogMorning(now)], cloudRows: local }),
    historyCloud: signedIn ? fixtureHistoryCloud({ server: calendarServer(now), local, ...cloud }) : null,
    historyView: view, geocoder: { names: HISTORY_NAMES },
  };
}

// ---- history (055a): the history screen ----------------------------------
// Made-up addresses near the fixtures' place, in the order the list asks
// (出發, then each place down to the end); null = no answer.
const HISTORY_NAMES = [
  { line: '330台灣桃園市桃園區中正路50號' }, { line: '330台灣桃園市桃園區民生路120號' },
  { line: '330台灣桃園市桃園區三民路二段88號' }, { line: '330台灣桃園市桃園區復興路201號' },
  null, { line: '330台灣桃園市桃園區成功路三段16號' }, { line: '330台灣桃園市桃園區大興路32號' },
  { line: '330台灣桃園市桃園區莒光街7號' },
];
// My morning like H1 我的路線: home until about 06:57, two stays, a 10-minute
// drive, a stay, walking now (09:30).
const myRouteMorning = now => legsPath(now, 158 * MINUTE, at(-10, -100), [
  { stay: 12 }, { walk: 24, bearing: 35, speed: 0.6 }, { stay: 17 }, { walk: 25, bearing: 95, speed: 0.6 },
  { stay: 20 }, { drive: 6, speed: 6, bearing: 150 }, { walk: 20, bearing: 210, speed: 0.6 }, { stay: 11 },
  { walk: 23, bearing: 280, speed: 0.6 },
]);
// Out at about 07:50: a walk, a stay, a walk, then staying put until now.
const endsInStay = now => legsPath(now, 100 * MINUTE, at(-10, -100), [
  { stay: 10 }, { walk: 20, bearing: 35, speed: 0.6 }, { stay: 15 }, { walk: 20, bearing: 95, speed: 0.6 },
  { stay: 35 },
]);
// A recording of `fromAgo` ms before `now` with the recorder's own readings
// (2026-10-15): [['still', minutes], ['walk', minutes, bearing]], a fix every
// 5 s (still: 0.2 km/h ± 0.3 at one spot; walk: 4.3 km/h, 6 m a fix); the
// rest up to now saved nothing.
function recorderPath(now, fromAgo, legs) {
  const out = [];
  let time = now - fromAgo, here = at(-10, -100);
  const still = { raw_speed_kmh: 0.2, speed_kmh: 0.2, speed_accuracy_mps: 0.3, motion_state: 'stationary' };
  const walking = { raw_speed_kmh: 4.3, speed_kmh: 4.3, speed_accuracy_mps: 0.3, motion_state: 'moving' };
  for (const [kind, minutes, bearing = 0, metres = 0] of legs) {
    const turn = (bearing * Math.PI) / 180;
    // 'none': nothing saved for that long; the phone turns up `metres` away.
    if (kind === 'none') {
      time += minutes * MINUTE;
      here = offset(here, Math.cos(turn) * metres, Math.sin(turn) * metres);
      continue;
    }
    for (const until = time + minutes * MINUTE; time < until && time <= now - 5 * SECOND; time += 5 * SECOND) {
      if (kind === 'walk') here = offset(here, Math.cos(turn) * 6, Math.sin(turn) * 6);
      out.push({ time, fix: { ...here, accuracy: 5, recorder: kind === 'walk' ? walking : still } });
    }
  }
  return out;
}
// A day like 10/13 (2026-10-14): at home from 00:00 until 07:00, a walk, a
// short stay, the walk home, at home again until about 09:25.
const homeDay = now => legsPath(now, 570 * MINUTE, at(-10, -100), [
  { stay: 420 }, { walk: 20, bearing: 35, speed: 0.8 }, { stay: 15 }, { walk: 20, bearing: 215, speed: 0.8 },
  { stay: 110 },
]);
// 小黑's morning like H1 狗的歷史: out at about 07:00, stays, a ride, now.
const dogMorning = now => legsPath(now, 158 * MINUTE, at(0, -80), [
  { stay: 12 }, { walk: 24, bearing: 30, speed: 0.7 }, { stay: 17 }, { walk: 30, bearing: 100, speed: 0.7 },
  { stay: 25 }, { drive: 3, speed: 10, bearing: 160 }, { walk: 25, bearing: 230, speed: 0.7 }, { stay: 10 },
  { walk: 12, bearing: 300, speed: 0.7 },
]).map(row => bleRow({ slave: 6, time: row.time, fix: row.fix }));
// The handler's morning (H1 我的路線): at home from 06:50, out at about 07:05,
// two stays, walking until now (09:30).
const morningRoute = now => legsPath(now, 160 * MINUTE, at(-40, -150), [
  { stay: 15 }, { walk: 25, bearing: 40 }, { stay: 14 }, { walk: 30, bearing: 100 },
  { stay: 18 }, { walk: 20, bearing: 170 }, { walk: 38, bearing: 250 },
]);

// 小黑's day for the export (056): out at about 06:50, a stay, a ride, a
// 12-minute break, 25 minutes indoors, walking until now (09:30).
const exportDay = now => legsPath(now, 160 * MINUTE, at(20, -60), [
  { stay: 12 }, { walk: 18, bearing: 40, speed: 0.8 }, { stay: 16 }, { walk: 10, bearing: 110, speed: 0.8 },
  { drive: 4, speed: 11, bearing: 150 }, { walk: 14, bearing: 220, speed: 0.8 }, { gap: 12 },
  { walk: 12, bearing: 260, speed: 0.8 }, { stay: 3 }, { inside: 25 }, { walk: 20, bearing: 330, speed: 0.8 },
]).map(row => bleRow({ slave: 6, time: row.time, fix: row.fix, ...(row.fix ? {} : { rssi: -96, snr: -4 }) }));

// A busy day for the address lookups: 小黑 out at about 06:20 with 16 short
// stays about 200 m apart (each a place of its own), walking between them.
const busyDay = now => legsPath(now, 190 * MINUTE, at(0, -80), [
  { stay: 6 }, ...Array.from({ length: 16 }, (_, index) => [
    { walk: 5, bearing: (index * 67) % 360, speed: 0.7 }, { stay: 5 }]).flat(),
  { walk: 8, bearing: 20, speed: 0.7 },
]).map(row => bleRow({ slave: 6, time: row.time, fix: row.fix }));
// Made-up names for it (示範路 is no real road); two places have none.
const BUSY_NAMES = Array.from({ length: 24 }, (_, index) => ([5, 12].includes(index) ? null
  : { line: `330台灣桃園市桃園區示範路${index * 10 + 1}號` }));

// ---- history (055b): several dogs ----------------------------------------
// One dog's morning near the station from `start` (fixture now 09:30), a fix
// every 10 s: `legs` as legsPath's. `make` bleRow (this phone) or cloudRow.
const dogDay = (now, slave, fromAgo, start, legs, make = bleRow) => legsPath(now, fromAgo, start, legs)
  .map(row => make({ slave, time: row.time, fix: row.fix }));
// 豆豆 like H7: out at about 07:10, two stays, moving now; 阿福 from 08:05
// with a break; 狗 5 a short walk (or yesterday only). 阿福 is the cloud's.
const doudouMorning = now => dogDay(now, 4, 140 * MINUTE, at(30, -40), [
  { stay: 10 }, { walk: 30, bearing: 60, speed: 0.8 }, { stay: 22 }, { walk: 35, bearing: 150, speed: 0.8 },
  { stay: 18 }, { walk: 25, bearing: 240, speed: 0.8 }]);
const afuMorning = now => dogDay(now, 8, 85 * MINUTE, at(-40, 10), [
  { walk: 30, bearing: 20, speed: 0.7 }, { gap: 15 }, { walk: 40, bearing: 300, speed: 0.7 }], cloudRow);
const dog5Walk = (now, today = true) => dogDay(today ? now : now - 24 * 60 * MINUTE, 5, 60 * MINUTE, at(-10, 20),
  [{ walk: 25, bearing: 200, speed: 0.6 }, { stay: 10 }, { walk: 20, bearing: 320, speed: 0.6 }]);

// 小黑's history (看軌跡) with `dogs` added; 狗 5 is a live dog on the map (so
// it can be added). `view`: the protagonist, an open sheet, the
// cursor `cursorAgo` before now.
function multiFixture(now, { dogs = [], protagonist = null, sheet = null, fiveToday = true,
  cursorAgo = null, exportView = null } = {}) {
  const base = FIXTURES['all-good'](now);
  const cloud = afuMorning(now);
  return {
    ...base, openRoute: 'history',
    // 狗 5 on the live map (heard a minute ago), so 「＋ 加入」 lists it.
    ble: [...base.ble, ...series(bleRow, now, { slave: 5, from: 4 * MINUTE, to: 60 * SECOND, start: [-12, 30] })],
    history: historyPage(now, { slave: 6, ble: [...dogMorning(now), ...doudouMorning(now), ...dog5Walk(now, fiveToday)],
      cloudRows: cloud }),
    historyView: { dogs, protagonist, sheet, cursorAgo, export: exportView },
    geocoder: { names: HISTORY_NAMES },
  };
}

// A cold start as Launch.launchScreen reads it: the database open, the
// preferences read, the restore over, signed out and past the guide, unless
// `changes` say otherwise.
const startedWith = (changes = {}) => ({
  databaseReady: true, databaseError: null, preferencesSettled: true, onboarding: ONBOARDING_DONE,
  authSettled: true, signedIn: false, expiredAtStart: false, restoreTimedOut: false, ...changes,
});


// ---- the activity page (057, design A4) ---------------------------------
// 小黑's activity as a function of the local time of day: asleep at night,
// a walk with a run in the morning, a nap after lunch, play in the afternoon.
// Small daily differences so week, month and year bars are not identical.
const localDate = (year, month, day, hour = 0, minute = 0) => new Date(year, month - 1, day, hour, minute).getTime();
// Taiwan time without Date objects (a year is 400,000 minutes); no DST there.
const TAIPEI_OFFSET = 8 * 60 * MINUTE;
function dogActivity(time) {
  const local = time + TAIPEI_OFFSET;
  const day = Math.floor(local / DAY_MS);
  const hour = (local - day * DAY_MS) / (60 * MINUTE);
  const shift = ((day * 37) % 9) / 6 - 0.6;
  const wobble = 0.04 * Math.sin(time / (7 * MINUTE)) + 0.03 * Math.sin(time / (3 * MINUTE));
  if (hour < 6.5 + shift || hour >= 22.5 + shift / 2) return 0.02 + 0.004 * Math.sin(time / (25 * MINUTE));
  if (hour < 7.2 + shift) return 0.35 + wobble;
  if (hour < 7.45 + shift) return 0.9 + 0.05 * Math.sin(time / MINUTE);
  if (hour < 8.3 + shift) return 0.4 + wobble;
  if (hour < 12) return 0.18 + wobble;
  if (hour < 14 + shift / 2) return 0.025 + 0.004 * Math.sin(time / (20 * MINUTE));
  if (hour < 15.5) return 0.25 + wobble;
  if (hour < 15.5 + (12 + (day % 5) * 3) / 60) return 0.88 + 0.04 * Math.sin(time / MINUTE);
  if (hour < 18) return 0.3 + wobble;
  return 0.15 + wobble;
}
// What CloudDatabase.activityPeriod answers for 小黑 (6) when its readings
// run from `earliest` to the fixture's now, two a minute, without `gaps`
// ([start, end) pairs). `answer: 'hang' | 'fail'` for 載入中 and 讀取失敗.
// Whole 1/1024ths: sums are exact, so every reader's mean is the same number.
const reading = time => Math.round(Math.max(0, Math.min(1, dogActivity(time))) * 1024) / 1024;
function activityFixture({ earliest, gaps = [], charges = [], now, answer = null }) {
  const has = time => time >= earliest && !gaps.some(([start, end]) => time >= start && time < end);
  // [start, end) spans on the charger (usb_present 1, activity 0).
  const powered = time => charges.some(([start, end]) => time >= start && time < end);
  const read = async (slaveId, { start, end, detail }) => {
    if (answer === 'hang') return new Promise(() => {});
    if (answer === 'fail') throw new Error('fixture: 讀取失敗');
    const from = Math.max(Math.floor((start - 9 * MINUTE) / MINUTE) * MINUTE, earliest ?? Infinity);
    const to = Math.min(end + 9 * MINUTE, now + MINUTE);
    if (slaveId !== 6 || earliest == null) return detail === 'raw' ? { local: [], cloud: [] } : { minutes: [] };
    if (detail === 'raw') {
      const local = [];
      for (let minute = from; minute < to; minute += MINUTE) {
        if (!has(minute)) continue;
        for (const second of [10, 40]) {
          const time = minute + second * SECOND;
          if (time >= now) continue;
          // The minute still running reads high: A4 must leave it out.
          const value = minute === Math.floor(now / MINUTE) * MINUTE ? 0.95 : reading(time);
          local.push({ time, activity: powered(time) ? 0 : value, activity_valid: 1, activity_time: null,
            master_id: 7, slave_id: 6, ...(powered(time) && { usb_present: 1 }) });
        }
      }
      return { local, cloud: [] };
    }
    const minutes = [];
    for (let minute = from; minute < Math.min(to, Math.floor(now / MINUTE) * MINUTE); minute += MINUTE) {
      // The mean of the same two readings the raw answer gives.
      if (has(minute) && powered(minute)) minutes.push({ minute, count: 0, value: NaN, charging: true });
      else if (has(minute)) minutes.push({ minute, count: 2,
        value: (reading(minute + 10 * SECOND) + reading(minute + 40 * SECOND)) / 2 });
    }
    return { minutes };
  };
  return { readActivity: read, readActivityEarliest: async slaveId => (slaveId === 6 ? earliest ?? null : null) };
}
// 小黑's card open on the map, its activity page (A4) over it.
// 小黑's own rows (its card's 活動量 row) carry the same activity as A4 reads.
const activityPage = (now, view, data) => {
  const base = FIXTURES['card-ok'](now);
  return { ...base, openDog: 6, openPage: 'activity', activityView: view,
    ble: base.ble.map(row => (row.slave_id === 6 ? { ...row, activity: reading(row.received_at) } : row)),
    activity: activityFixture({ earliest: localDate(2026, 3, 16, 8, 0), now, ...data }) };
};
const day = (month, date, hour, minute = 0) => localDate(2026, month, date, hour, minute);

// dogs-offscreen-8way and dogs-offscreen-healthy: a cloud dog about 2 km off
// in each of the eight directions; `problems` gives five of them a problem.
function offscreenEightWays(now, problems) {
  const away = (slave, north, east, battery) => series(cloudRow, now, { slave, from: 10 * MINUTE,
    to: 20 * SECOND, every: 15 * SECOND, start: [north, east], step: [0.02, 0.02],
    ...(problems && battery ? { battery } : {}) });
  return {
    receiver: receiving(now), cloud: synced(now), phone: walkingPhone(now),
    ble: dog4Ble(now),
    cloudRows: [
      ...away(6, 185, 5),
      ...(problems
        ? series(cloudRow, now, { slave: 8, from: 50 * MINUTE, to: 40 * MINUTE, every: 15 * SECOND,
          start: [170, 185], step: [0.02, 0] })
        : away(8, 170, 185)),
      ...away(12, 100, 185),
      ...away(9, 5, 195),
      ...away(5, -170, 185, 15),
      ...away(3, -190, 0, 12),
      ...away(2, -170, -185),
      ...away(10, 0, -195, 18),
      ...away(11, 170, -185, 14),
      ...away(13, 160, -195, 16),
    ],
  };
}

const FIXTURES = {
  // Receiver connected, cloud synced, three fresh dogs, phone recording.
  'all-good': now => ({
    receiver: receiving(now), cloud: synced(now), phone: walkingPhone(now),
    ble: dog4Ble(now), cloudRows: [...dog6Cloud(now), ...dog8Cloud(now)],
  }),
  // A first start (A6): no receiver set up, not signed in, so no dog from
  // anywhere. The phone itself still has a position.
  'no-data': now => ({
    receiver: { enabled: false, running: false, connected: false, receiving: false,
      deviceName: 'DogGPS Master', expectedMasterId: 0, lastReceivedAt: 0 },
    cloud: SIGNED_OUT, phone: walkingPhone(now), ble: [], cloudRows: [],
  }),
  // The same, signed in to an empty account: A6 without 「登入 Supabase」.
  'no-data-signed-in': now => ({ ...FIXTURES['no-data'](now), cloud: synced(now) }),
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
  // The link was established in this service run and lost (disconnectedAt):
  // 「接收器 7 斷線了」「09:25 斷線・正在自動重連」 (A2).
  'receiver-disconnected': now => ({
    receiver: { ...receiving(now), connected: false, receiving: false, lastReceivedAt: now - 5 * MINUTE,
      disconnectedAt: now - 5 * MINUTE },
    cloud: synced(now), phone: walkingPhone(now),
    ble: dog4Ble(now, 5 * MINUTE), cloudRows: [...dog6Cloud(now), ...dog8Cloud(now)],
  }),
  // A2b: the same disconnection, its card closed with ✕: only the gear's red dot.
  'receiver-disconnected-dismissed': now => ({ ...FIXTURES['receiver-disconnected'](now),
    dismissed: { receiver: now - 5 * MINUTE } }),
  // ---- top cards and the gear's red dot (049) ----------------------------
  // Dog positions cannot be written: the phone is full (「檢查空間」).
  'storage-failed': now => ({ ...FIXTURES['all-good'](now),
    storageError: '資料存檔失敗：database or disk is full (code 13 SQLITE_FULL)' }),
  // Writing fails for another reason (「看原因」, the reason in the card).
  'storage-failed-other': now => ({ ...FIXTURES['all-good'](now),
    storageError: '資料存檔失敗：attempt to write a readonly database' }),
  // A2c: no base map (no network): dogs, phone and ring on grey, 「重試」.
  'map-load-failed': now => ({ ...FIXTURES['all-good'](now), mapFailure: 'tiles' }),
  // The map itself cannot open: grey only, 「地圖打不開」.
  'map-unavailable': now => ({ ...FIXTURES['all-good'](now), mapFailure: 'component' }),
  // Downloads have failed for six minutes: the gear's red dot only, no card.
  // On S3 (&page=cloud) as in the S3 mockup: 下載失敗 (連不上 Supabase・
  // 09:24 起), 12 rows still waiting, the last upload 16 minutes ago.
  'cloud-failing': now => ({ ...FIXTURES['all-good'](now),
    cloud: { ...synced(now), lastSuccess: now - 6 * MINUTE - 5 * SECOND, lastDownloadAt: now - 6 * MINUTE - 5 * SECOND,
      failingSince: now - 6 * MINUTE, error: 'Network request failed', offline: true },
    upload: uploading(now, { pending: { 7: 12 }, last: now - 16 * MINUTE }) }),
  // Receiver 7's own battery at 15%: the gear's red dot only.
  'receiver-battery-low': now => ({ ...FIXTURES['all-good'](now),
    ble: series(bleRow, now, { slave: 4, from: 10 * MINUTE, to: 5 * SECOND, start: [14, 9], step: [0.05, 0.08],
      masterBattery: 15 }) }),
  // 小黑 (dog 6, heard by receiver 7) went inside twelve minutes ago: clear
  // fixes in one spot, then packets without a fix. The real indoor-hold rules
  // (HoldStore + the bundled environment model) hold it there: 「小黑・遮蔽處」.
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
  // 豆豆 current; 小黑 last heard four minutes ago (still current: v3 goes
  // grey only after 10 minutes); 阿福 last heard forty minutes ago: grey face,
  // red "!", larger, still on the map.
  'dogs-aged': now => ({
    receiver: receiving(now), cloud: synced(now), phone: walkingPhone(now),
    ble: dog4Ble(now),
    cloudRows: [
      ...dog6Cloud(now, 4 * MINUTE + 10 * SECOND),
      ...series(cloudRow, now, { slave: 8, from: 50 * MINUTE, to: 40 * MINUTE, every: 15 * SECOND,
        start: [22, -24], step: [-0.05, 0] }),
    ],
  }),
  // 豆豆 (dog 4) walked north-north-east away from receiver 7: 700 m ten
  // minutes ago, 1.6 km now. Out of range: a red dashed line from the ring's edge to it. 小黑
  // (dog 6, also on receiver 7) stays well inside; 阿福 comes from the cloud.
  'range-out': now => ({
    receiver: receiving(now), cloud: synced(now), phone: walkingPhone(now),
    ble: inTimeOrder([
      ...track(bleRow, now, { slave: 6, from: 10 * MINUTE, to: 8 * SECOND,
        dog: (progress, where) => offset(where, -250 + progress * 20, -150) }),
      ...track(bleRow, now, { slave: 4, from: 10 * MINUTE,
        dog: (progress, where) => awayFrom(where, 700 + 900 * progress, progress, 15) }),
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
    // The receiver starts walking off (300 m south) right after 小黑's
    // last position, 170 s ago.
    const start = (10 * MINUTE - 170 * SECOND) / (10 * MINUTE - 5 * SECOND);
    const moving = progress => (progress <= start ? RECEIVER
      : offset(RECEIVER, -300 * (progress - start) / (1 - start), 0));
    return {
      receiver: receiving(now), cloud: synced(now), phone: walkingPhone(now),
      ble: inTimeOrder([
        ...track(bleRow, now, { slave: 6, from: 10 * MINUTE, to: 170 * SECOND,
          dog: progress => awayFrom(RECEIVER, 760 + 20 * progress, progress, 5) }),
        ...track(bleRow, now, { slave: 4, from: 10 * MINUTE, receiver: moving,
          dog: (progress, where) => offset(where, 60 + progress * 10, -120) }),
      ]),
      cloudRows: dog8Cloud(now),
    };
  },
  // 豆豆's collar is at 15% and not charging: red "!" and the larger face.
  // 小黑's is at 15% too but plugged in: not a problem, no badge (the card
  // says 充電中 15%). 阿福 is fine.
  'dog-low-battery': now => ({
    receiver: receiving(now), cloud: synced(now), phone: walkingPhone(now),
    ble: inTimeOrder([
      ...series(bleRow, now, { slave: 4, from: 10 * MINUTE, start: [14, 9], step: [0.05, 0.08], battery: 15 }),
      // Walking briskly (no hold: the fixes keep moving).
      ...series(bleRow, now, { slave: 6, from: 10 * MINUTE, to: 8 * SECOND, start: [-28, 4], step: [0.4, 0.5],
        battery: 15, usb: 1 }),
    ]),
    cloudRows: dog8Cloud(now),
  }),
  // 豆豆, 小黑 and 阿福 went into the same kennel twelve minutes ago (a few
  // metres apart, as GPS sees separate cages): all three held indoors, their
  // name tags merge into 「3 隻・遮蔽處」. Dog 5 walks outside on its own.
  'dogs-indoor-stacked': now => ({
    receiver: receiving(now), cloud: synced(now), phone: walkingPhone(now),
    ble: inTimeOrder([
      ...indoorBle(now, 4, [-18, 24]),
      ...indoorBle(now, 6, [-18.3, 24.4], { inside: 11 * MINUTE }),
      ...indoorBle(now, 8, [-17.7, 24.3], { inside: 13 * MINUTE }),
      ...series(bleRow, now, { slave: 5, from: 10 * MINUTE, start: [20, -30], step: [0.05, 0.08] }),
    ]),
    cloudRows: [],
  }),
  // 豆豆, 小黑 and 阿福 walking together, a few metres apart: their faces
  // overlap and the tags merge into one 「3 隻」, with a red dot because
  // 阿福's battery is low (its own face still has its "!").
  'dogs-overlap': now => ({
    receiver: receiving(now), cloud: synced(now), phone: walkingPhone(now),
    ble: inTimeOrder([
      ...series(bleRow, now, { slave: 4, from: 10 * MINUTE, start: [14, 9], step: [0.05, 0.08] }),
      ...series(bleRow, now, { slave: 6, from: 10 * MINUTE, to: 8 * SECOND, start: [14.4, 9.5], step: [0.05, 0.08] }),
      ...series(bleRow, now, { slave: 8, from: 10 * MINUTE, to: 11 * SECOND, start: [13.6, 9.6], step: [0.05, 0.08],
        battery: 12 }),
    ]),
    cloudRows: [],
  }),
  // A face on another dog's name (fictional places): 狗 18 walks just below
  // and right of 狗 16, held indoors, so its face sits on 「狗 16・遮蔽處」
  // while the two names do not touch; 狗 108 does the same to 「狗 104・遮蔽處」,
  // both held. Each pair merges into one 「2 隻」／「2 隻・遮蔽處」. 豆豆 far
  // away keeps the map zoomed out.
  'dogs-labels-touching': now => ({
    receiver: receiving(now), cloud: synced(now), phone: walkingPhone(now),
    ble: inTimeOrder([
      ...indoorBle(now, 16, [-20, 25]),
      ...series(bleRow, now, { slave: 18, from: 10 * MINUTE, start: [-36, 31.5], step: [0, 0.001] }),
      ...indoorBle(now, 104, [10, -30]),
      ...indoorBle(now, 108, [-6, -37], { inside: 14 * MINUTE }),
      ...series(bleRow, now, { slave: 4, from: 10 * MINUTE, start: [35, 40], step: [0.01, 0.01] }),
    ]),
    cloudRows: [],
  }),
  // Collar 9 talks to receiver 7 but has never had a fix: not drawn, no
  // marker (S2 lists it as 「還沒定位」). 豆豆 is drawn as usual.
  'dog-never-fixed': now => ({
    receiver: receiving(now), cloud: synced(now), phone: walkingPhone(now),
    ble: inTimeOrder([
      ...dog4Ble(now),
      ...series(bleRow, now, { slave: 9, from: 10 * MINUTE, to: 3 * SECOND }),
    ]),
    cloudRows: [],
  }),
  // 阿福 was last downloaded 26 hours ago: still on the map at that position,
  // grey with the red "!" (v3 §6: older than 24 hours is kept). 豆豆 current.
  'dog-stale-24h': now => ({
    receiver: receiving(now), cloud: synced(now), phone: walkingPhone(now),
    ble: dog4Ble(now),
    cloudRows: series(cloudRow, now, { slave: 8, from: 26 * 60 * MINUTE + 10 * MINUTE, to: 26 * 60 * MINUTE,
      every: 15 * SECOND, start: [-45, -50], step: [0.02, 0.03] }),
  }),
  // Signed in, no receiver set up: 小黑 and 阿福 come only from the cloud. No
  // receiver, so no range ring and no range judgement at all.
  'cloud-only': now => ({
    receiver: { enabled: false, running: false, connected: false, receiving: false,
      deviceName: 'DogGPS Master', expectedMasterId: 0, lastReceivedAt: 0 },
    cloud: synced(now), phone: walkingPhone(now),
    ble: [], cloudRows: [...dog6Cloud(now), ...dog8Cloud(now)],
  }),
  // Only 豆豆 is on receiver 7, walking near the handler: the first view
  // frames the two of them. Five cloud dogs are 2–3 km west, off the left of
  // that view; four of them have a problem (阿福 no new position for 40
  // minutes, dogs 5, 3 and 2 battery low): one hint on the left with three
  // faces (by signal-source number: 2, 3, 5) and 「+1」 for 阿福. 小黑 (west)
  // and dog 9 (2.5 km east) are healthy: no hint (§9.6).
  'dogs-offscreen': now => {
    const west = (slave, north, east, rest = {}) => series(cloudRow, now, { slave, from: 10 * MINUTE,
      to: 20 * SECOND, every: 15 * SECOND, start: [north, east], step: [0.02, 0.02], ...rest });
    return {
      receiver: receiving(now), cloud: synced(now), phone: walkingPhone(now),
      ble: dog4Ble(now),
      cloudRows: [
        ...west(6, 20, -220),
        ...series(cloudRow, now, { slave: 8, from: 50 * MINUTE, to: 40 * MINUTE, every: 15 * SECOND,
          start: [-15, -260], step: [0.02, 0] }),
        ...west(5, 5, -240, { battery: 15 }),
        ...west(3, 35, -280, { battery: 12 }),
        ...west(2, -25, -300, { battery: 18 }),
        ...west(9, 10, 250),
      ],
    };
  },
  // Like dogs-offscreen, but a cloud dog about 2 km off in each of the eight
  // directions (north at the top): 小黑 north, 阿福 north-east (no new
  // position for 40 minutes), dog 12 east-north-east (30° above east), dog 9
  // east, dog 5 south-east (battery 15%), dog 3 south (12%), dog 2 south-west,
  // dog 10 west (18%), dogs 11 (14%) and 13 (16%) north-west. 豆豆 walks
  // beside the phone, which the first view frames. Hints only for the dogs
  // with a problem: top left (11, 13), top right (阿福), left (10), bottom (3),
  // bottom right (5); none north, east or south-west.
  'dogs-offscreen-8way': now => offscreenEightWays(now, true),
  // The same eight dogs, all healthy (阿福 current, every battery fine): no
  // off-screen hint at all; 框住全部 shows them.
  'dogs-offscreen-healthy': now => offscreenEightWays(now, false),
  // 豆豆 and dog 5 on receiver 7 near the handler; 阿福's last position came
  // from the cloud 26 hours ago, about 10 km south-west. The first view frames
  // the local dogs and the phone only (阿福, no new position, shows as an
  // off-screen hint); 框住全部 frames 阿福 too.
  'cold-start-far-cloud': now => ({
    receiver: receiving(now), cloud: synced(now), phone: walkingPhone(now),
    ble: inTimeOrder([
      ...dog4Ble(now),
      ...series(bleRow, now, { slave: 5, from: 10 * MINUTE, to: 9 * SECOND, start: [-20, 20], step: [0.05, -0.03] }),
    ]),
    cloudRows: series(cloudRow, now, { slave: 8, from: 26 * 60 * MINUTE + 10 * MINUTE, to: 26 * 60 * MINUTE,
      every: 15 * SECOND, start: [-640, -720], step: [0.02, 0.03] }),
  }),
  // Signed out (v3: signing in is optional, 「稍後再說」): receiver 7 and its
  // two dogs only. Rows an earlier account downloaded (小黑, 阿福) are still in
  // the phone but belong to that account, so nothing of the cloud is drawn.
  'signed-out-map': now => ({
    receiver: receiving(now), cloud: SIGNED_OUT, phone: walkingPhone(now),
    ble: inTimeOrder([
      ...dog4Ble(now),
      ...series(bleRow, now, { slave: 5, from: 10 * MINUTE, to: 9 * SECOND, start: [-20, 20], step: [0.05, -0.03] }),
    ]),
    cloudRows: [...dog6Cloud(now), ...dog8Cloud(now)],
  }),
  // ---- a dog's card open (046, design A3/A3b/A7b) ------------------------
  // 豆豆 on receiver 7, in range, battery 62%, resting for the last 18
  // minutes: 位置 has no row, 接收範圍 「在範圍內」, 活動量 「休息中・已 18 分鐘」.
  'card-ok': now => ({
    receiver: receiving(now), cloud: synced(now), phone: walkingPhone(now), openDog: 4,
    ble: inTimeOrder([
      ...track(bleRow, now, { slave: 4, from: 30 * MINUTE, battery: 62, activity: restingFor(now, 18 * MINUTE),
        dog: (progress, where) => northEastOf(where, 420 + 30 * progress, progress) }),
      ...track(bleRow, now, { slave: 6, from: 10 * MINUTE, to: 8 * SECOND,
        dog: (progress, where) => offset(where, -250 + progress * 20, -150) }),
    ]),
    cloudRows: dog8Cloud(now),
  }),
  // 2026-10-16: a collar on its charger reports activity 0, marked valid
  // (newer firmware), and read as 「休息中・超過 6 小時」. 豆豆 walked until
  // 08:10, then has been on USB power at home (一筆 every 30 s, activity 0,
  // usb_present 1): 電量 「充電中 62%」 and 活動量 「充電中」, never 休息.
  'card-charging': now => ({
    receiver: receiving(now), cloud: synced(now), phone: walkingPhone(now), openDog: 4,
    ble: inTimeOrder([
      ...chargingDay(now, { walkUntil: 80 * MINUTE }),
      ...track(bleRow, now, { slave: 6, from: 10 * MINUTE, to: 8 * SECOND,
        dog: (progress, where) => offset(where, -250 + progress * 20, -150) }),
    ]),
    cloudRows: dog8Cloud(now),
  }),
  // 豆豆 came off the charger at 08:50 and has lain still since: the rest
  // starts where the charging ended, 「休息中・已 40 分鐘」 (not from 06:50,
  // when the charger's zeros began).
  'card-rest-after-charging': now => ({
    receiver: receiving(now), cloud: synced(now), phone: walkingPhone(now), openDog: 4,
    ble: inTimeOrder([
      ...chargingDay(now, { walkUntil: 160 * MINUTE, chargeUntil: 40 * MINUTE }),
      ...track(bleRow, now, { slave: 6, from: 10 * MINUTE, to: 8 * SECOND,
        dog: (progress, where) => offset(where, -250 + progress * 20, -150) }),
    ]),
    cloudRows: dog8Cloud(now),
  }),
  // A4 今天 for the same 豆豆: walking (一般), 充電中 06:50–08:50 in its own
  // neutral colour (not 休息, not 沒有資料), then 休息 from 08:50.
  'activity-charging': now => ({ ...FIXTURES['card-rest-after-charging'](now), openPage: 'activity',
    activityView: { mode: 'day', date: now } }),
  // card-ok, but 豆豆 has rested since 01:18 after an hour of moving about
  // (before the last half hour one packet a minute with its activity and no
  // fix, so nothing holds it indoors), longer than the card's six-hour read:
  // the card reads further back and says 「休息中・已 8 小時 12 分」
  // (2026-10-16; 2026-10-15 it said 「超過 6 小時」).
  'card-rest-long': now => ({
    receiver: receiving(now), cloud: synced(now), phone: walkingPhone(now), openDog: 4,
    ble: inTimeOrder([
      ...track(bleRow, now, { slave: 4, from: 9 * 60 * MINUTE + 12 * MINUTE, to: 8 * 60 * MINUTE + 13 * MINUTE,
        every: MINUTE, battery: 62, activity: 0.4, dog: () => null }),
      ...track(bleRow, now, { slave: 4, from: 8 * 60 * MINUTE + 12 * MINUTE, to: 31 * MINUTE, every: MINUTE,
        battery: 62, activity: 0.02, dog: () => null }),
      ...track(bleRow, now, { slave: 4, from: 30 * MINUTE, battery: 62, activity: 0.02,
        dog: (progress, where) => northEastOf(where, 420 + 30 * progress, progress) }),
      ...track(bleRow, now, { slave: 6, from: 10 * MINUTE, to: 8 * SECOND,
        dog: (progress, where) => offset(where, -250 + progress * 20, -150) }),
    ]),
    cloudRows: dog8Cloud(now),
  }),
  // 豆豆 at 43% whose newest packet says 0% with no voltage (a bad packet,
  // BatteryPlausibility): the card keeps 「43%」, no red 「!」, no alert.
  'card-battery-blip': now => {
    const rows = track(bleRow, now, { slave: 4, from: 30 * MINUTE, battery: 43, activity: 0.3,
      dog: (progress, where) => northEastOf(where, 420 + 30 * progress, progress) });
    rows[rows.length - 1] = { ...rows[rows.length - 1], battery_percentage: 0 };
    return {
      receiver: receiving(now), cloud: synced(now), phone: walkingPhone(now), openDog: 4,
      ble: inTimeOrder([...rows, ...track(bleRow, now, { slave: 6, from: 10 * MINUTE, to: 8 * SECOND,
        dog: (progress, where) => offset(where, -250 + progress * 20, -150) })]),
      cloudRows: dog8Cloud(now),
    };
  },
  // A3 itself: 豆豆 880 m from receiver 7 (快離開, amber), resting 18 minutes.
  'card-near-edge': now => ({
    receiver: receiving(now), cloud: synced(now), phone: walkingPhone(now), openDog: 4,
    ble: inTimeOrder([
      ...track(bleRow, now, { slave: 6, from: 10 * MINUTE, to: 8 * SECOND,
        dog: (progress, where) => offset(where, -250 + progress * 20, -150) }),
      ...track(bleRow, now, { slave: 4, from: 30 * MINUTE, battery: 62, activity: restingFor(now, 18 * MINUTE),
        dog: (progress, where) => northEastOf(where, 500 + 380 * Math.min(1, progress * 1.4), progress) }),
    ]),
    cloudRows: dog8Cloud(now),
  }),
  // ---- switching dogs from the card (2026-10-14, the row of dogs) ---------
  // Six dogs on receiver 7: 豆豆, 小黑 and 阿福 walking together (one 「3 隻」
  // tag, 阿福 at 12% so it has the red 「!」), 狗 5, 狗 9 and 狗 12 on their own.
  // 豆豆's card is open: its row of dogs goes by number only — 豆豆 (4), 5,
  // 小黑 (6), 阿福 (8, its problem does not move it), 9, 12 — and ends there
  // (no wrap-around; pulled past an end it springs back).
  'card-switch': now => ({
    receiver: receiving(now), cloud: synced(now), phone: walkingPhone(now), openDog: 4,
    ble: inTimeOrder([
      ...series(bleRow, now, { slave: 4, from: 10 * MINUTE, start: [14, 9], step: [0.05, 0.08], battery: 62 }),
      ...series(bleRow, now, { slave: 6, from: 10 * MINUTE, to: 8 * SECOND, start: [14.4, 9.5], step: [0.05, 0.08] }),
      ...series(bleRow, now, { slave: 8, from: 10 * MINUTE, to: 11 * SECOND, start: [13.6, 9.6], step: [0.05, 0.08],
        battery: 12 }),
      ...series(bleRow, now, { slave: 5, from: 10 * MINUTE, start: [-20, 30], step: [0.04, 0.02] }),
      ...series(bleRow, now, { slave: 9, from: 10 * MINUTE, to: 7 * SECOND, start: [30, -25], step: [0.02, 0.04] }),
      ...series(bleRow, now, { slave: 12, from: 10 * MINUTE, to: 9 * SECOND, start: [-30, -20], step: [0.03, -0.02] }),
    ]),
    cloudRows: [],
  }),
  // card-switch with six hours of rows per dog (one every 5 s, 4,321 each):
  // swiping the row of dogs must move on at once (2026-10-16), not wait for
  // the next dog's card to be worked out.
  'card-switch-heavy': now => {
    const rows = from => [4, 5, 6, 8, 9, 12].flatMap((slave, index) => series(bleRow, now, {
      slave, from, every: 5 * SECOND, start: [14 - 9 * index, 9 + 7 * index], step: [0.001, 0.0015],
      battery: 70 - index * 5, activity: time => (index % 2 === 0 && time > now - 3 * HOUR ? 0.02
        : Math.round((0.2 + 0.1 * Math.sin(time / 600000)) * 32) / 32) }));
    // The map gets the last ten minutes (as its own paged reads would); the
    // card reads the six hours. Activity in 1/32 steps: sums in any order
    // are exact, so the card reads the same as from SQLite.
    return { receiver: receiving(now), cloud: synced(now), phone: walkingPhone(now), openDog: 4,
      ble: inTimeOrder(rows(10 * MINUTE)), cardBle: inTimeOrder(rows(6 * HOUR)), cloudRows: [] };
  },
  // card-switch with 豆豆 renamed to a fictional 15-character name: the
  // title row 「‹（頭像✏️）名字 ›」 cuts it with 「…」 at the normal font and
  // wraps it at 200%.
  'card-long-name': now => ({ ...FIXTURES['card-switch'](now),
    aliases: { ...ALIASES, 4: '紅火蟻偵測隊第一小隊的豆豆隊長' } }),
  // ---- the activity page (057, design A4) ------------------------------
  // 小黑's card only (A3): tap 活動量 to open A4 on 今天 with the same reads.
  'activity-card': now => ({ ...activityPage(now, null, {}), openPage: null }),
  // 日 of 10/6（二）, a whole day with data: night rest, a morning run, a nap.
  'activity-day': now => activityPage(now, { mode: 'day', date: day(10, 6, 12) }, {}),
  // The same day with four gaps: three listed, 「另外 1 段」, the total.
  'activity-day-gap': now => activityPage(now, { mode: 'day', date: day(10, 6, 12) }, { gaps: [
    [day(10, 6, 8, 40), day(10, 6, 9, 10)], [day(10, 6, 11, 5), day(10, 6, 11, 20)],
    [day(10, 6, 13, 0), day(10, 6, 13, 12)], [day(10, 6, 16, 30), day(10, 6, 16, 45)]] }),
  // 今天 at 09:30:40: no data 08:40–09:10 (A4 mockup); the minute still running
  // (09:30, which reads 0.95) is not drawn or counted.
  'activity-today': now => ({ ...activityPage(now, { mode: 'day', date: now }, {
    now: now + 40 * SECOND, gaps: [[day(10, 7, 8, 40), day(10, 7, 9, 10)]] }), activityClock: now + 40 * SECOND }),
  // 2026-10-16 (A4 colours): 日 of 10/6 with all four states plus no data:
  // night and 12–14 時 休息, 一般 by day, 劇烈 at 07:15 and 15:30, 充電中
  // 10:00–11:30 (green), no data 08:40–09:10 and 16:30–17:15 (dashed line).
  'activity-all-states': now => activityPage(now, { mode: 'day', date: day(10, 6, 12) }, {
    gaps: [[day(10, 6, 8, 40), day(10, 6, 9, 10)], [day(10, 6, 16, 30), day(10, 6, 17, 15)]],
    charges: [[day(10, 6, 10, 0), day(10, 6, 11, 30)]] }),
  // The same week-long: 9/27–10/3 with 10/1 all no data, 9/30 partly on the charger.
  'activity-all-states-week': now => activityPage(now, { mode: 'week', date: day(9, 30, 12) }, {
    gaps: [[day(10, 1, 0), day(10, 2, 0)]],
    charges: [[day(9, 30, 10, 0), day(9, 30, 13, 0)], [day(9, 28, 9, 0), day(9, 28, 11, 0)]] }),
  // 週 9/27（日）– 10/3（六） with no data all of 10/1（四） (A4 mockup).
  'activity-week-gap': now => activityPage(now, { mode: 'week', date: day(9, 30, 12) }, {
    gaps: [[day(10, 1, 0), day(10, 2, 0)]] }),
  // 月 2026 年 9 月: 9/12 without data, 9/20 from 10:00 to 16:00 too.
  'activity-month': now => activityPage(now, { mode: 'month', date: day(9, 15, 12) }, {
    gaps: [[day(9, 12, 0), day(9, 13, 0)], [day(9, 20, 10), day(9, 20, 16)]] }),
  // 年 2026 (這一年): readings from 3/16; 11–12 月 not yet.
  'activity-year': now => activityPage(now, { mode: 'year', date: now }, {
    gaps: [[day(6, 2, 0), day(6, 9, 0)], [day(8, 20, 0), day(8, 21, 0)]] }),
  // A dog without any activity reading: 「沒有活動量資料」, ‹ › both off.
  'activity-none': now => activityPage(now, { mode: 'day', date: now }, { earliest: null }),
  // The page still reading (never answers) and a read that fails.
  'activity-loading': now => activityPage(now, { mode: 'week', date: now }, { answer: 'hang' }),
  'activity-error': now => activityPage(now, { mode: 'day', date: now }, { answer: 'fail' }),
  // ---- a dog's edit sheet (047, A5: name and face in one sheet) ----------
  // card-ok with the pencil pressed: 豆豆's edit sheet (A5) over its card.
  'dog-edit': now => ({ ...FIXTURES['card-ok'](now), openPage: 'edit' }),
  // 小黑 has a photo for a face: on the map and on its card (current, so in
  // colour); 豆豆 and 阿福 keep the default illustration.
  'dog-photo-avatar': now => ({ ...FIXTURES['card-ok'](now), openDog: 6,
    avatars: { 6: { kind: 'photo', uri: FIXTURE_PHOTO } } }),
  // dogs-aged with a photo for 阿福 (40 minutes without a new position): the
  // photo turns greyscale on the map and on its card; the white frame and the
  // red 「!」 keep their colour.
  'dog-photo-stale': now => ({ ...FIXTURES['dogs-aged'](now), openDog: 8,
    avatars: { 8: { kind: 'photo', uri: FIXTURE_PHOTO } } }),
  // A3b: 豆豆 walked out to 1.4 km and has been silent since 09:05 (25
  // minutes): no new position, battery 15%, out of range — every problem at
  // once (不在接收範圍 the 位置 row's second line), and 活動量 「—」.
  'card-problems': now => ({
    receiver: receiving(now), cloud: synced(now), phone: walkingPhone(now), openDog: 4,
    ble: inTimeOrder([
      ...track(bleRow, now, { slave: 6, from: 10 * MINUTE, to: 8 * SECOND,
        dog: (progress, where) => offset(where, -250 + progress * 20, -150) }),
      ...track(bleRow, now, { slave: 4, from: 40 * MINUTE, to: 25 * MINUTE, battery: 15,
        dog: (progress, where) => awayFrom(where, 700 + 700 * progress, progress, 30) }),
    ]),
    cloudRows: dog8Cloud(now),
  }),
  // The longest first row (2026-10-16, the distance always beside it): 豆豆
  // silent since yesterday 21:09, 1.8 km away and out of range, the phone's
  // own fix 3 minutes old — 「10/6 21:09 之後沒有新位置」 beside 「↗ 1.8 km」,
  // 「不在接收範圍」 under it (no phone age since 2026-10-21).
  'card-status-longest': now => ({
    receiver: receiving(now), cloud: synced(now), phone: stalePhone(now, 3 * MINUTE), openDog: 4,
    ble: inTimeOrder([
      ...track(bleRow, now, { slave: 6, from: 10 * MINUTE, to: 8 * SECOND,
        dog: (progress, where) => offset(where, -250 + progress * 20, -150) }),
      ...track(bleRow, now, { slave: 4, from: 12 * 60 * MINUTE + 40 * MINUTE, to: 12 * 60 * MINUTE + 21 * MINUTE,
        battery: 15, dog: (progress, where) => awayFrom(where, 700 + 1100 * progress, progress, 30) }),
    ]),
    cloudRows: dog8Cloud(now),
  }),
  // A7b: 小黑 held indoors (clear fixes, then packets without a fix for 12
  // minutes), collar on USB at 62% (活動量 「充電中」: its 0.02 readings for
  // 40 minutes are the charger's, not a rest). 位置 「室內」 with
  // the held place's address under it (053a) is the first row.
  'card-indoor': now => ({
    geocoder: { names: [{ line: '330台灣桃園市桃園區武陵里中正路1號' }] },
    receiver: receiving(now), cloud: synced(now), phone: walkingPhone(now), openDog: 6,
    ble: inTimeOrder([
      ...dog4Ble(now),
      ...series(bleRow, now, { slave: 6, from: 55 * MINUTE, to: 12 * MINUTE + 10 * SECOND, start: [-18, 24],
        battery: 62, activity: restingFor(now, 40 * MINUTE) }).map((row, index) => ({ ...row,
        slave_lat: row.slave_lat + (index % 5) * 0.00001, slave_lon: row.slave_lon - (index % 5) * 0.00001 })),
      ...series(bleRow, now, { slave: 6, from: 12 * MINUTE, to: 8 * SECOND, rssi: -96, snr: -4, battery: 62, usb: 1,
        activity: 0.02 }),
    ]),
    cloudRows: dog8Cloud(now),
  }),
  // card-indoor 40 s after 小黑 went inside: the history's first minute reads
  // 「室內・不到 1 分」, never 「室內・0 分」 (2026-10-15); the card 「室內」.
  'card-indoor-first-minute': now => ({ ...FIXTURES['card-indoor'](now),
    ble: inTimeOrder([
      ...dog4Ble(now),
      ...series(bleRow, now, { slave: 6, from: 55 * MINUTE, to: 40 * SECOND + 10 * SECOND, start: [-18, 24],
        battery: 62, activity: restingFor(now, 40 * MINUTE) }).map((row, index) => ({ ...row,
        slave_lat: row.slave_lat + (index % 5) * 0.00001, slave_lon: row.slave_lon - (index % 5) * 0.00001 })),
      ...series(bleRow, now, { slave: 6, from: 40 * SECOND, to: 8 * SECOND, rssi: -96, snr: -4, battery: 62, usb: 1,
        activity: 0.02 }),
    ]) }),
  // 小黑 indoors since 21:09 last night (clear fixes, then a packet without a
  // fix every 30 s), opened after a cold start: the live hold replays only
  // the last half hour; the card says 「室內」 and the address (no minutes
  // since 2026-10-16), the history's day starts at 00:00.
  'card-indoor-overnight': now => ({
    geocoder: { names: [{ line: '330台灣桃園市桃園區武陵里中正路1號' }] },
    receiver: receiving(now), cloud: synced(now), phone: walkingPhone(now), openDog: 6,
    ble: inTimeOrder([
      ...dog4Ble(now),
      ...indoorBle(now, 6, [-18, 24], { inside: 12 * 60 * MINUTE + 21 * MINUTE, every: 30 * SECOND,
        battery: 62, activity: 0.02 }),
    ]),
    cloudRows: dog8Cloud(now),
  }),
  // 2026-10-16: six dogs indoors at their own places for 3 to 8 hours (a
  // packet every 30 s), opened after a cold start: every live hold begins
  // inside its stay. Tapping ‹ › fast through them must switch at once.
  'card-switch-indoor': now => ({
    geocoder: { names: [{ line: '330台灣桃園市桃園區武陵里中正路1號' }] },
    receiver: receiving(now), cloud: synced(now), phone: walkingPhone(now), openDog: 4,
    ble: inTimeOrder([4, 5, 6, 8, 9, 12].flatMap((slave, index) => indoorBle(now, slave,
      [-18 + 9 * index, 24 - 7 * index], { inside: (3 + index) * 60 * MINUTE, every: 30 * SECOND,
        battery: 70 - 4 * index, activity: 0.02 }))),
    cloudRows: [],
  }),
  // 2026-10-15: 小黑 indoors since 07:01, its drift keeping five
  // satellites at a poor HDOP every minute, a packet without a fix between.
  // A cold start's seeds are then all weak: the live hold anchors on the half
  // hour's own weak fixes and never saw the dog arrive (the card says 「室內」).
  'card-indoor-cold-drift': now => ({
    geocoder: { names: [{ line: '330台灣桃園市桃園區武陵里中正路1號' }] },
    receiver: receiving(now), cloud: synced(now), phone: walkingPhone(now), openDog: 6,
    ble: inTimeOrder([
      ...dog4Ble(now),
      ...coldDrift(now, 6, [-18, 24], 149 * MINUTE),
    ]),
    cloudRows: dog8Cloud(now),
  }),
  // 小黑 held indoors with no network: no address is asked, the 位置 row is
  // 「室內」 over the held place's coordinates (2026-10-14), no spinner.
  'dog-indoor-no-address': now => ({ ...FIXTURES['card-indoor'](now), geocoder: { offline: true } }),
  // card-indoor named by this phone's own Geocoder (network + Play services;
  // the place is by Taoyuan station). Nothing is written to its cache.
  'card-indoor-geocoder': now => ({ ...FIXTURES['card-indoor'](now), geocoder: 'real' }),
  // ---- the first row's harder cases (2026-10-14, tried on a phone) --------
  // card-indoor with a long fictional address: under 「室內」 and the
  // distance, across the row's whole width, wrapping to two lines.
  'card-indoor-long-address': now => ({ ...FIXTURES['card-indoor'](now), geocoder: LONG_PLACE }),
  // 小黑 went indoors at 09:03 and has sent nothing since 09:05: 「09:05 之後
  // 沒有新資料」 in red over the address.
  'card-indoor-silent': now => ({
    geocoder: LONG_PLACE, receiver: receiving(now), cloud: synced(now), phone: walkingPhone(now), openDog: 6,
    ble: inTimeOrder([...dog4Ble(now),
      ...indoorBle(now, 6, [-18, 24], { inside: 27 * MINUTE, until: 25 * MINUTE, battery: 62 })]),
    cloudRows: dog8Cloud(now),
  }),
  // Four dogs, four kinds of first row, to see the card keep one height from
  // dog to dog: 豆豆 in range (one line), 狗 5 silent since 09:05 and out of
  // range (two lines), 小黑 indoors 1.6 km away with a long address (three
  // or four lines), 阿福 only from the cloud (one line).
  'card-switch-mixed': now => ({
    geocoder: LONG_PLACE, receiver: receiving(now), cloud: synced(now), phone: walkingPhone(now), openDog: 4,
    ble: inTimeOrder([
      ...series(bleRow, now, { slave: 4, from: 10 * MINUTE, start: [14, 9], step: [0.05, 0.08], battery: 62 }),
      ...track(bleRow, now, { slave: 5, from: 40 * MINUTE, to: 25 * MINUTE, battery: 15,
        dog: (progress, where) => awayFrom(where, 700 + 700 * progress, progress, 30) }),
      ...heldFarAway(now, 12 * MINUTE, 8 * SECOND),
    ]),
    cloudRows: dog8Cloud(now),
  }),
  // 小黑 walked out to 1.6 km (out of range) and went indoors there 12
  // minutes ago: 「室內」, the address, and 「不在接收範圍・最後確認 HH:MM」
  // in red — two things in one row, one red 「!」.
  'card-indoor-out': now => ({
    geocoder: LONG_PLACE, receiver: receiving(now), cloud: synced(now), phone: walkingPhone(now), openDog: 6,
    ble: inTimeOrder([...dog4Ble(now), ...heldFarAway(now, 12 * MINUTE, 8 * SECOND)]),
    cloudRows: dog8Cloud(now),
  }),
  // The same, silent since 09:05: 「09:05 之後沒有新資料」, the address and
  // 不在接收範圍 — three lines in the first row.
  'card-indoor-silent-out': now => ({
    geocoder: LONG_PLACE, receiver: receiving(now), cloud: synced(now), phone: walkingPhone(now), openDog: 6,
    ble: inTimeOrder([...dog4Ble(now), ...heldFarAway(now, 28 * MINUTE, 25 * MINUTE)]),
    cloudRows: dog8Cloud(now),
  }),
  // 小黑 only from the cloud (receiver 9's upload): no 接收範圍 to write, so
  // the first row is 位置 「HH:MM 更新」; running hard for the last few
  // minutes (劇烈活動).
  'card-cloud-dog': now => ({
    receiver: receiving(now), cloud: synced(now), phone: walkingPhone(now), openDog: 6,
    ble: dog4Ble(now),
    cloudRows: [
      ...series(cloudRow, now, { slave: 6, from: 20 * MINUTE, to: 15 * SECOND, every: 15 * SECOND,
        start: [-18, 24], step: [0.03, -0.05], activity: time => (time >= now - 3 * MINUTE ? 0.92 : 0.3) }),
      ...dog8Cloud(now),
    ],
  }),
  // The phone's newest fix is 15 minutes old: the first row's right end says
  // 「手機沒有定位」 instead of a direction and distance; 我的位置 turns grey.
  'card-phone-no-fix': now => ({
    receiver: receiving(now), cloud: synced(now), phone: stalePhone(now, 15 * MINUTE), openDog: 4,
    ble: dog4Ble(now), cloudRows: [...dog6Cloud(now), ...dog8Cloud(now)],
  }),
  // 豆豆's position is current but its collar stopped sending battery and
  // activity readings at 09:11: both rows say what they last said, with the
  // time — 「62%（09:11）」, 「休息中・已 12 分鐘（09:11）」.
  // 「今天 x km」 (A1): recording, today's route so far 2.7 km; the walker in
  // the phone colour.
  'phone-recording': now => ({ ...FIXTURES['all-good'](now) }),
  // Recording switched off at 09:05 after a 2.7 km walk: grey walker, the
  // same distance in grey.
  'phone-recording-off': now => {
    const stopped = now - 25 * MINUTE;
    const { route, position } = stalePhone(now, 25 * MINUTE);
    return { ...FIXTURES['all-good'](now),
      phone: { route, position, recording: false, today: morningWalk(position, stopped) } };
  },
  // Location permission taken away after a 2.7 km walk (A2): the grey walker
  // with a slash, the distance kept; recording cannot run.
  'phone-no-permission': now => {
    const stopped = now - 20 * MINUTE;
    const { route, position } = stalePhone(now, 20 * MINUTE);
    return { ...FIXTURES['all-good'](now),
      phone: { route, position, recording: false, permission: 'denied', services: true,
        today: morningWalk(position, stopped) } };
  },
  // Recording off and nothing recorded today (yesterday's walk only):
  // 「未記錄」 in grey.
  'phone-no-route': now => {
    const { route, position } = stalePhone(now, 14 * 60 * MINUTE);
    return { ...FIXTURES['all-good'](now),
      phone: { route, position, recording: false, today: morningWalk(position, now - 14 * 60 * MINUTE) } };
  },
  // ---- S3 Supabase 帳號 (051a): open on the account page ------------------
  // Signed out (「稍後再說」): S3 「未登入」 with 「登入」 (→ D1).
  'cloud-signed-out': now => ({ ...FIXTURES['signed-out-map'](now), openRoute: 'cloud' }),
  // Signed in, all well: last download 5 s ago, nothing waiting, receiver 7
  // uploads through this phone.
  'cloud-ok': now => ({ ...FIXTURES['all-good'](now), openRoute: 'cloud', upload: uploading(now) }),
  // Every receiver uses its own Wi-Fi: only upload route rows are shown.
  // Receiver 7 has a downloaded row of its own (最後上傳成功…（經 Wi-Fi）);
  // nothing has been downloaded from 8 yet, so it says it uploads on its own.
  'cloud-wifi-only': now => ({ ...FIXTURES['all-good'](now), openRoute: 'cloud',
    upload: uploading(now, { phone: [], wifi: [7, 8], wifiByMaster: { 7: now - 2 * MINUTE } }) }),
  // Uploads waiting: 12 rows not sent yet, 3 the cloud refused (需處理 +
  // 重試), the last success 16 minutes ago. Downloads are fine.
  'cloud-upload-pending': now => ({ ...FIXTURES['all-good'](now), openRoute: 'cloud',
    upload: uploading(now, { pending: { 7: 12 }, blocked: 3, last: now - 16 * MINUTE,
      error: '上傳失敗 (403)：forbidden' }) }),
  // Restoring the sign-in without a network: nothing reached Supabase since
  // the app started → 「暫時連不上，會自動重試」.
  'cloud-unreachable-retrying': now => ({ ...FIXTURES['all-good'](now), openRoute: 'cloud',
    cloud: { ...synced(now), lastSuccess: null, lastDownloadAt: null, failingSince: now - 3 * MINUTE,
      error: 'Network request failed', offline: true },
    upload: uploading(now, { pending: { 7: 4 }, last: now - 40 * MINUTE }) }),
  // 登入失效 while in use (a download was refused): signed out, S3 says
  // 「需要重新登入」 with 「登入」 (→ D1); the gear has its red dot.
  'cloud-expired': now => ({ ...FIXTURES['signed-out-map'](now), openRoute: 'cloud', expired: true }),
  // Receiver 7 uploads by its own Wi-Fi; 120 rows from before still wait in
  // this phone. 「接收器 7 的上傳方式」 pressed: the confirmation (c255).
  // 最後上傳成功 is from the phone period and stays visible on its Wi-Fi (070).
  'upload-switch-confirm': now => ({ ...FIXTURES['all-good'](now), openRoute: 'cloud',
    upload: uploading(now, { phone: [], wifi: [7], pending: { 7: 120 }, last: now - 50 * MINUTE,
      lastByMaster: { 7: now - 50 * MINUTE } }),
    dialog: { kind: 'switch', master: 7 } }),
  // The same without a network: it cannot switch yet (c256).
  'upload-switch-offline': now => ({ ...FIXTURES['upload-switch-confirm'](now),
    cloud: { ...synced(now), lastSuccess: now - 4 * MINUTE, lastDownloadAt: now - 4 * MINUTE,
      failingSince: now - 3 * MINUTE, error: 'Network request failed', offline: true } }),
  // ---- the start (052, design D0/D1; 判定表「啟動與恢復登入」) ---------------
  // `launch` is what Launch.launchScreen reads at a cold start (the database,
  // the saved guide step, the sign-in restore); the app opens on its answer.
  // First launch: nothing saved yet, not signed in → D1 with the guide's
  // progress bar (step 1 of 4) and 「稍後再說」.
  'onboarding-first-launch': now => ({ ...FIXTURES['no-data'](now),
    launch: startedWith({ onboarding: ONBOARDING_SIGN_IN }) }),
  // The sign-in restore ran past 10 s without reaching Supabase: the map
  // opens with this phone's own receiver (signed out for now); S3 says
  // 「暫時連不上，會自動重試」 (&page=cloud).
  'auth-restore-slow': now => ({ ...FIXTURES['signed-out-map'](now),
    launch: startedWith({ restoreTimedOut: true }), restoring: true }),
  // The restore found the sign-in refused (登入失效 at a cold start): D1 with
  // 「需要重新登入」; done, 「稍後再說」 and back all go to the map.
  'auth-expired': now => ({ ...FIXTURES['signed-out-map'](now),
    launch: startedWith({ expiredAtStart: true }), expired: true }),
  // The database on this phone cannot be opened: D0's failure screen
  // 「手機裡的資料打不開」 with 「重試」 and 「診斷」 (the reason on S8).
  'db-open-failed': now => ({ ...FIXTURES['no-data'](now),
    launch: { ...startedWith(), databaseReady: false,
      databaseError: 'SQLITE_CANTOPEN: unable to open database file (dogtracker.db)' } }),
  // ---- settings (050): S1, S2, S4 open on their page ---------------------
  // S1 with nothing to handle: receiver 7 connected (its battery 64%), phone
  // recording, signed in, notifications allowed.
  'settings-diagnostics-on': now => ({ ...FIXTURES['all-good'](now), openRoute: 'settings', diagnosticsEnabled: true }),

  'settings-all-ok': now => ({ ...FIXTURES['all-good'](now), openRoute: 'settings' }),
  // ---- 初次使用 D2–D4 (053): the guide's pages ------------------------------
  // D2c: 「全部允許」 ran; 附近的裝置 allowed, 精確位置 only 大概, 通知 refused
  // → red 「!」 with 「開系統設定 ›」 on both, the button 「下一步」.
  'onboard-permissions-partial': now => ({ ...FIXTURES['no-data'](now), openRoute: 'permissions',
    permissionsGuide: { asked: ['nearby', 'location', 'notifications'], grants: { nearby: 'granted', location: 'approximate', notifications: 'denied' } } }),
  // D2d: everything allowed: three ticks, 「下一步」.
  'onboard-permissions-done': now => ({ ...FIXTURES['no-data'](now), openRoute: 'permissions',
    permissionsGuide: { asked: ['nearby', 'location', 'notifications'], grants: { nearby: 'granted', location: 'granted', notifications: 'granted' } } }),
  // D3b: a QR code that is not a receiver's → 「這不是接收器的 QR Code」.
  'pair-wrong-qr': now => ({ ...FIXTURES['no-data'](now), openRoute: 'pair',
    pairing: { view: 'scan', camera: 'granted', dialog: { kind: 'wrongQr' } } }),
  // D3a without the camera: 「需要相機才能掃描」 with 「開系統設定 ›」 where the
  // frame was; 手動輸入 still there.
  'pair-camera-denied': now => ({ ...FIXTURES['no-data'](now), openRoute: 'pair',
    pairing: { view: 'scan', camera: 'denied' } }),
  // D3c: 「DogGPS-Master 7」 typed; still searching, two receivers found so
  // far (receiver 7: four bars, receiver 3: one bar).
  'pair-manual-nearby': now => ({ ...FIXTURES['no-data'](now), openRoute: 'pair',
    pairing: { view: 'manual', input: 'DogGPS-Master 7', searching: true,
      nearby: [{ id: 'AA:BB:CC:00:00:07', name: 'DogGPS-Master7', rssi: -58 },
        { id: 'AA:BB:CC:00:00:03', name: 'DogGPS-Master3', rssi: -86 }] } }),
  // D3d: connecting to DogGPS-Master7 (the QR code's), 取消.
  'pair-connecting': now => ({ ...FIXTURES['no-data'](now), openRoute: 'pair',
    pairing: { view: 'connecting', target: { name: 'DogGPS-Master7', number: 7, method: 'qr' } } }),
  // D3d after 30 s: 「連不上接收器 7」 with 手動輸入 / 重試.
  'pair-failed': now => ({ ...FIXTURES['no-data'](now), openRoute: 'pair',
    pairing: { view: 'stopped', target: { name: 'DogGPS-Master7', number: 7, method: 'qr' },
      dialog: { kind: 'failed', number: 7, method: 'qr' } } }),
  // The QR code said 7, receiver 3 answered: 「這不是要連的接收器」「要連 7，收到
  // 的是 3，已中斷連線」 with 稍後再說 / 重新掃描.
  'pair-mismatch': now => ({ ...FIXTURES['no-data'](now), openRoute: 'pair',
    pairing: { view: 'stopped', target: { name: 'DogGPS-Master7', number: 7, method: 'qr' },
      dialog: { kind: 'mismatch', expected: 7, got: 3, method: 'qr' } } }),
  // D4: receiver 7 connected and three sources heard — 4 and 7 located, 9
  // never — each only as 「訊號源 N」 after the default face.
  'pair-done-sources': now => ({ receiver: receiving(now), cloud: SIGNED_OUT, phone: walkingPhone(now),
    openRoute: 'paired',
    ble: inTimeOrder([
      ...series(bleRow, now, { slave: 4, from: 60 * SECOND, to: 5 * SECOND, start: [14, 9], step: [0.05, 0.08] }),
      ...series(bleRow, now, { slave: 7, from: 60 * SECOND, to: 15 * SECOND, start: [-20, 18], step: [0.04, -0.02] }),
      ...series(bleRow, now, { slave: 9, from: 50 * SECOND, to: 25 * SECOND }),
    ]) }),
  // D4 with receiver 7 not connected (lost 2 minutes ago) after three
  // sources were heard: 「接收器 7 斷線了」, never 「已連上」 (2026-10-15).
  'pair-done-disconnected': now => ({ ...FIXTURES['pair-done-sources'](now),
    receiver: { ...receiving(now), connected: false, receiving: false, lastReceivedAt: now - 2 * MINUTE } }),
  // D4b: receiver 7 connected, nothing heard yet.
  'pair-done-empty': now => ({ receiver: { ...receiving(now), receiving: false, lastReceivedAt: 0 },
    cloud: SIGNED_OUT, phone: walkingPhone(now), openRoute: 'paired', ble: [] }),
  // S1 with red 「!」 rows (as in the S1 mockup): location services off
  // (手機), downloads failing (Supabase 帳號), notifications not allowed
  // (手機 and 提醒). The receiver is fine.
  'settings-problems': now => ({ ...FIXTURES['cloud-failing'](now), openRoute: 'settings',
    phone: { ...walkingPhone(now), services: false },
    permissions: { notificationsDenied: true } }),
  // S2: receiver 7 connected, but nothing new for six minutes:
  // 「DogGPS-Master7・已連線・6 分鐘沒有新資料」.
  'receiver-quiet': now => ({
    receiver: { ...receiving(now), receiving: false, lastReceivedAt: now - 6 * MINUTE },
    cloud: synced(now), phone: walkingPhone(now), openRoute: 'receiver',
    ble: dog4Ble(now, 6 * MINUTE), cloudRows: [...dog6Cloud(now), ...dog8Cloud(now)],
  }),
  // S2 收到的訊號源: 豆豆 (4) and dog 5 (never named: 「狗 5」) located;
  // collar 9 talks to receiver 7 but never had a fix: only 「訊號源 9」 with
  // 「還沒定位」.
  'waiting-sources': now => ({ receiver: receiving(now), phone: walkingPhone(now), cloud: synced(now),
    ble: [4, 6, 8].map(slave => bleRow({ slave, time: now - 20 * SECOND })), cloudRows: [] }),
  'waiting-sources-grace': now => ({ ...FIXTURES['waiting-sources'](now),
    ble: [4, 6, 8].map(slave => bleRow({ slave, time: now - 9 * SECOND })) }),
  'waiting-sources-partial': now => ({ ...FIXTURES['waiting-sources'](now),
    ble: [bleRow({ slave: 4, time: now - 20 * SECOND, fix: at(10, 10) }),
      ...[6, 8].map(slave => bleRow({ slave, time: now - 20 * SECOND }))] }),
  'waiting-sources-dismissed': now => ({ ...FIXTURES['waiting-sources'](now), waitingDismissed: true }),
  'waiting-sources-new': now => ({ ...FIXTURES['waiting-sources'](now), waitingDismissed: true, waitingNew: true,
    ble: [4, 6, 8, 9].map(slave => bleRow({ slave, time: now - 20 * SECOND })) }),
  'waiting-sources-disconnected': now => ({ ...FIXTURES['waiting-sources'](now),
    receiver: { ...receiving(now), connected: false, receiving: false, disconnectedAt: now - MINUTE } }),
  'waiting-sources-cloud-only': now => ({ ...FIXTURES['waiting-sources'](now), ble: [],
    cloudRows: [4, 6, 8].map(slave => cloudRow({ slave, time: now - 20 * SECOND })) }),
  'receiver-sources-unfixed': now => ({
    receiver: receiving(now), cloud: synced(now), phone: walkingPhone(now), openRoute: 'receiver',
    ble: inTimeOrder([
      ...dog4Ble(now),
      ...series(bleRow, now, { slave: 5, from: 8 * MINUTE, to: 70 * SECOND, start: [-20, 18], step: [0.04, -0.02] }),
      ...series(bleRow, now, { slave: 9, from: 10 * MINUTE, to: 20 * SECOND }),
    ]),
    cloudRows: [],
  }),
  // S2 after 「中斷連線」: receiver 7 is still the one set up, switched off
  // twenty minutes ago — 「已中斷連線」 and 「重新連線」.
  'receiver-disconnected-by-user': now => ({
    receiver: { ...receiving(now), enabled: false, running: false, connected: false, receiving: false,
      lastReceivedAt: now - 20 * MINUTE, lastStatus: '背景接收已停止' },
    cloud: synced(now), phone: walkingPhone(now), openRoute: 'receiver',
    ble: series(bleRow, now, { slave: 4, from: 30 * MINUTE, to: 20 * MINUTE, start: [14, 9], step: [0.05, 0.08] }),
    cloudRows: [...dog6Cloud(now), ...dog8Cloud(now)],
  }),
  // S4 with what is missing (as in the S4 mockup): no location permission,
  // notifications not allowed, location services off; 位置記錄 still
  // switched on, with this morning's records.
  'phone-permissions-missing': now => {
    const { route, position } = stalePhone(now, 20 * MINUTE);
    return { ...FIXTURES['all-good'](now), openRoute: 'phone',
      phone: { route, position, recording: false, recordingSwitch: true, permission: 'denied', services: false,
        today: morningWalk(position, now - 20 * MINUTE, 4200) },
      permissions: { notificationsDenied: true } };
  },
  // ---- S6 提醒 (051b): open on the alert settings -------------------------
  // Everything as it comes: every alert on, 震動 on, 聲音 off, notifications
  // allowed.
  'alerts-default': now => ({ ...FIXTURES['all-good'](now), openRoute: 'alerts' }),
  // Some switched off: 不在接收範圍, 接收器電量低 and disconnect/storage off, 聲音 on; the 狗
  // group open on its three switches (「部分開」). S1 says 「震動、聲音」 and
  // 「部分開」.
  'alerts-some-off': now => ({ ...FIXTURES['all-good'](now), openRoute: 'alerts', alertsOpen: true,
    alerts: { dogOutOfRange: false, receiverBattery: false, receiverDisconnectedStorage: false, sound: true } }),
  // ---- alerts (058a): the engine on the fixture's fake clock --------------
  // N1: 豆豆 walked out of receiver 7's range (不在接收範圍, the strong
  // vibration at once) and 狗 5 has had no position for 10 minutes: one
  // notification 「DogTracker・2 隻狗要注意」. &page=alertPreview shows it.
  'alerts-two-dogs': now => {
    const base = FIXTURES['range-out'](now);
    return { ...base, ble: inTimeOrder([...base.ble,
      ...series(bleRow, now, { slave: 5, from: 25 * MINUTE, to: 10 * MINUTE + 30 * SECOND, start: [-30, 40],
        step: [0.04, -0.02] })]) };
  },
  // N2 / A2: receiver 7 (豆豆, 小黑 and 狗 5 on it) dropped five minutes ago:
  // the top card on the map; one notification 「接收器 7 斷線了（3 隻狗收不到）」.
  'alerts-receiver-down': now => ({
    receiver: { ...receiving(now), connected: false, receiving: false, lastReceivedAt: now - 5 * MINUTE,
      disconnectedAt: now - 5 * MINUTE },
    cloud: synced(now), phone: walkingPhone(now),
    ble: inTimeOrder([
      ...dog4Ble(now, 5 * MINUTE),
      ...series(bleRow, now, { slave: 6, from: 12 * MINUTE, to: 5 * MINUTE, start: [-18, 24], step: [0.03, -0.05] }),
      ...series(bleRow, now, { slave: 5, from: 12 * MINUTE, to: 5 * MINUTE, start: [-30, 40], step: [0.04, -0.02] }),
    ]),
    cloudRows: dog8Cloud(now),
  }),
  // 暫停提醒 30 分 pressed ten minutes ago with alerts-two-dogs' problems:
  // S6 「已暫停提醒到 09:50」＋「恢復」, S1 「暫停到 09:50」.
  'alerts-paused': now => ({ ...FIXTURES['alerts-two-dogs'](now), openRoute: 'alerts',
    alertPause: { since: 10 * MINUTE, until: 20 * MINUTE } }),
  // Every alert, 震動 and 聲音 off, with alerts-receiver-down's problems: S1
  // 「全部關閉」; the map still shows the top card, the gear and the dogs'
  // red 「!」 (switches control notifications only); no notification.
  'alerts-all-off': now => ({ ...FIXTURES['alerts-receiver-down'](now), openRoute: 'alerts', alertsOpen: true,
    alerts: { dogStale: false, dogOutOfRange: false, dogBattery: false, receiverBattery: false,
      receiverDisconnectedStorage: false, vibrate: false, sound: false } }),
  // Notifications not allowed: S6 「通知權限 未允許 開系統設定 ›」; S1's 提醒
  // (and 手機) row only the red 「!」; the gear's red dot on the map.
  'notifications-denied': now => ({ ...FIXTURES['all-good'](now), openRoute: 'alerts',
    permissions: { notificationsDenied: true } }),
  // ---- alerts off the live map (058c): N3, 「⚠ N」, back to the snapshot ----
  // My route today (as the N3 mockup) while 豆豆 walks out of receiver 7's
  // range: the N3 card 「豆豆 不在接收範圍」 slides down for 5 s, then 「⚠ 1」
  // left of the export icon; either opens 豆豆's card on the live map, back
  // returns here.
  'alerts-in-history': now => ({ ...FIXTURES['range-out'](now), phone: routePhone(myRouteMorning(now), now),
    openRoute: 'history', history: historyPage(now), geocoder: { names: HISTORY_NAMES } }),
  // 小黑's history with 豆豆 added (H7) while 豆豆 is out of range and 狗 5 has
  // had no position for 10 minutes: N3 for 豆豆 (the most severe), then 「⚠ 2」.
  // Move the cursor, add or change dogs, drag the range: back from the card
  // (or the page) keeps them.
  'alerts-in-dog-history': now => {
    const alerts = FIXTURES['alerts-two-dogs'](now);
    return { ...multiFixture(now, { dogs: [4], protagonist: 6 }), receiver: alerts.receiver, cloud: alerts.cloud,
      phone: alerts.phone, ble: alerts.ble, cloudRows: alerts.cloudRows };
  },
  // The same with S6's 不在接收範圍 switched off (the 2026-10-09 rule): no N3
  // card for 豆豆; 「⚠ 2」 still counts it (state, not an alert).
  'alerts-in-history-off': now => ({ ...FIXTURES['alerts-in-dog-history'](now),
    alerts: { dogOutOfRange: false, dogStale: false } }),
  // My route today while receiver 7 has been down for 15 minutes: 豆豆, 小黑
  // and 狗 5 (all on it) went quiet with it. 「⚠ 1」: the disconnection only,
  // not one more per quiet dog (user 2026-10-09).
  'alerts-history-receiver-down': now => ({
    ...FIXTURES['alerts-in-history'](now),
    receiver: { ...receiving(now), connected: false, receiving: false, lastReceivedAt: now - 15 * MINUTE,
      disconnectedAt: now - 15 * MINUTE },
    ble: inTimeOrder([
      ...series(bleRow, now, { slave: 4, from: 25 * MINUTE, to: 15 * MINUTE, start: [14, 9], step: [0.05, 0.08] }),
      ...series(bleRow, now, { slave: 6, from: 25 * MINUTE, to: 15 * MINUTE, start: [-18, 24], step: [0.03, -0.05] }),
      ...series(bleRow, now, { slave: 5, from: 25 * MINUTE, to: 15 * MINUTE, start: [-30, 40], step: [0.04, -0.02] }),
    ]),
    cloudRows: dog8Cloud(now),
  }),
  // S6 open while receiver 7 drops (alerts-receiver-down): N3 「接收器 7 斷線了
  // （3 隻狗收不到）」 under the title row for 5 s, then no badge (D17).
  // Tap the card to open S2 接收器; back returns to the same S6 snapshot.
  'alerts-in-settings': now => ({ ...FIXTURES['alerts-receiver-down'](now), openRoute: 'alerts' }),
  // ---- S7 進階, S8 診斷 (051c) ---------------------------------------------
  // S8 with everything readable: 豆豆 (4) from receiver 7 walking (速度緩衝
  // 移動中), 小黑 and 阿福 from the cloud; each dog's environment model result.
  'diagnostics-ok': now => ({ ...FIXTURES['all-good'](now), openRoute: 'diagnostics' }),
  // S8 on a first start: no receiver, signed out, no dog, no phone record —
  // every data page shows its empty state.
  'diagnostics-empty': now => ({ ...FIXTURES['no-data'](now), openRoute: 'diagnostics',
    phone: { ...walkingPhone(now), recording: false, today: [] } }),
  // Dog positions cannot be written (another reason than a full phone): S8
  // starts with the reason, where 「看原因」 leads.
  'diagnostics-error': now => ({ ...FIXTURES['storage-failed-other'](now), openRoute: 'diagnostics' }),
  // The phone's own data cannot be read: each data page shows 「讀取失敗」
  // with 「重試」.
  'diagnostics-read-failed': now => ({ ...FIXTURES['all-good'](now), openRoute: 'diagnostics',
    readFailure: 'database disk image is malformed' }),
  // S7 with 刪除全部狗資料 pressed while 120 rows still wait to be uploaded:
  // 「還有 120 筆沒上傳：先上傳／一起刪除」 (c296). Here 「先上傳」 finds no
  // network (判定表) and 「一起刪除」 deletes nothing real.
  'advanced-delete-confirm': now => ({ ...FIXTURES['all-good'](now), openRoute: 'advanced',
    deletion: { unsent: 120, open: true } }),
  'card-readings-old': now => {
    const until = now - 18 * MINUTE - 30 * SECOND;
    return {
      receiver: receiving(now), cloud: synced(now), phone: walkingPhone(now), openDog: 4,
      ble: inTimeOrder([
        ...series(bleRow, now, { slave: 4, from: 30 * MINUTE, start: [14, 9], step: [0.02, 0.03], battery: 62,
          batteryValid: time => (time <= until ? 1 : 0),
          activity: time => (time > until ? null : 0.02) }),
      ]),
      cloudRows: dog8Cloud(now),
    };
  },
  // ---- history (054a): the time-line list on the old history page --------
  // My route today (H1/H2): out at about 07:05, stays 1 and 2, walking now;
  // 「今天 x km」 on the map (&page=map) is the summary's distance.
  'history-today': now => {
    const phone = routePhone(morningRoute(now), now);
    return { ...FIXTURES['all-good'](now), phone, openRoute: 'history', history: historyPage(now),
      // 出發, stays 1 and 2, 現在 (H2): an address next to the place, one
      // 120 m away, one with no answer (coordinates above the pill).
      geocoder: { names: [{ line: '330台灣桃園市桃園區大興西路二段105號' },
        { line: '330台灣桃園市桃園區同德六街76號', awayM: 120 }, null,
        { line: '330台灣桃園市桃園區中山路552號' }] } };
  },
  // Still at home (a few metres of wander since 06:30): the summary shows the time range of
  // the whole day.
  'history-no-departure': now => {
    const phone = routePhone(legsPath(now, 180 * MINUTE, at(-40, -60), [{ stay: 120 }, { walk: 1, speed: 0.3 },
      { stay: 60 }]), now);
    return { ...FIXTURES['all-good'](now), phone, openRoute: 'history', history: historyPage(now) };
  },
  // 2026-10-15 (#200): at home from 08:30, then from 09:00 a dog walk that
  // keeps stopping to sniff (walk 25–55 s, stand 1–2.5 min); the range starts
  // where the walk left home (09:00), not minutes into it.
  'history-stop-and-go': now => {
    const path = [];
    const home = at(-40, -60);
    let time = now - 60 * MINUTE, here = home, k = 0;
    const still = { raw_speed_kmh: 0.2, speed_kmh: 0.2, speed_accuracy_mps: 0.3, motion_state: 'stationary' };
    const walking = { raw_speed_kmh: 4.3, speed_kmh: 4.3, speed_accuracy_mps: 0.4, motion_state: 'moving' };
    const stand = seconds => {
      for (let s = 0; s < seconds && time <= now - 5 * SECOND; s += 5, time += 5 * SECOND, k += 1) {
        const wobble = ((k % 3) - 1) * 0.3;
        path.push({ time, fix: { ...offset(here, wobble, -wobble), recorder: still } });
      }
    };
    const walk = (seconds, bearing) => {
      const turn = (bearing * Math.PI) / 180;
      for (let s = 0; s < seconds && time <= now - 5 * SECOND; s += 5, time += 5 * SECOND) {
        here = offset(here, Math.cos(turn) * 6, Math.sin(turn) * 6);
        path.push({ time, fix: { ...here, recorder: walking } });
      }
    };
    stand(30 * 60);
    const rhythm = [[25, 135], [30, 60], [25, 100], [45, 95], [55, 145]];
    for (let i = 0; time < now - 6 * MINUTE; i += 1) {
      walk(rhythm[i % rhythm.length][0], 20 + i * 25);
      stand(rhythm[i % rhythm.length][1]);
    }
    walk(6 * 60, 200);
    return { ...FIXTURES['all-good'](now), phone: routePhone(path, now), openRoute: 'history',
      history: historyPage(now) };
  },
  // 2026-10-15 (#200 速度不確定性): at home since 08:00; the recording
  // pauses 08:40–08:50 (battery saving) and comes back on Wi-Fi fixes 45 m
  // off reading 0 km/h ± 2 m/s (no speed at all), then still: the same
  // place, one stay — not two stays.
  'history-uncertain-speed': now => {
    const path = [];
    const home = at(-40, -60);
    const still = { raw_speed_kmh: 0.2, speed_kmh: 0.2, speed_accuracy_mps: 0.3, motion_state: 'stationary' };
    let k = 0, time = now - 90 * MINUTE;
    const stay = (place, minutes, recorder = still, accuracy = 6) => {
      for (const until = time + minutes * MINUTE; time < until && time <= now - 5 * SECOND; time += 5 * SECOND, k += 1) {
        const wobble = ((k % 3) - 1) * 0.3;
        path.push({ time, fix: { ...offset(place, wobble, -wobble), accuracy, recorder } });
      }
    };
    stay(home, 40);
    time += 10 * MINUTE;
    stay(offset(home, 45, 0), 1, { raw_speed_kmh: 0, speed_kmh: 0, speed_accuracy_mps: 2, motion_state: 'unknown' }, 14);
    stay(offset(home, 45, 0), 40);
    return { ...FIXTURES['all-good'](now), phone: routePhone(path, now), openRoute: 'history',
      history: historyPage(now) };
  },
  // 2026-10-15 (#200, user option D + C): a walk to a small park, 20 minutes
  // round it with the dog (20 s on foot, 40 s sniffing), a stop with a few
  // steps in it, walking on: 「在附近走動 N 分・M m」 and 「停 N 分・M m」 rows,
  // the walks keeping their own metres.
  'history-wandering': now => {
    const path = [];
    let time = now - 60 * MINUTE, here = at(-40, -60), k = 0;
    const still = { raw_speed_kmh: 0.2, speed_kmh: 0.2, speed_accuracy_mps: 0.3, motion_state: 'stationary' };
    const walking = { raw_speed_kmh: 4.3, speed_kmh: 4.3, speed_accuracy_mps: 0.3, motion_state: 'moving' };
    const stand = seconds => {
      for (let s = 0; s < seconds && time <= now - 5 * SECOND; s += 5, time += 5 * SECOND) {
        path.push({ time, fix: { ...here, accuracy: 4, recorder: still } });
      }
    };
    const walk = (seconds, bearing) => {
      const turn = (bearing * Math.PI) / 180;
      for (let s = 0; s < seconds && time <= now - 5 * SECOND; s += 5) {
        time += 5 * SECOND;
        here = offset(here, Math.cos(turn) * 6, Math.sin(turn) * 6);
        path.push({ time, fix: { ...here, accuracy: 4, recorder: walking } });
      }
    };
    const round = (laps, pause) => {
      for (let lap = 0; lap < laps; lap += 1) {
        for (let q = 1; q <= 4; q += 1, k += 1) {
          time += 5 * SECOND;
          const angle = (k + 1) * Math.PI / 2;
          path.push({ time, fix: { ...offset(here, 6 * Math.sin(angle), 6 * Math.cos(angle) - 6), accuracy: 4,
            recorder: walking } });
        }
        stand(pause);
      }
    };
    walk(5 * 60, 30);
    const park = here;
    stand(60);
    round(20, 40);
    stand(5 * 60);
    walk(4 * 60, 120);
    const corner = here;
    stand(4 * 60);
    round(2, 30);
    stand(4 * 60);
    walk(6 * 60, 200);
    // Made-up addresses (示範路 is no real road), by place: the park's long
    // enough to wrap to two lines, the corner's one line, the others short
    // (layout A: a one-line and a two-line stay, whatever order they load).
    return { ...FIXTURES['all-good'](now), phone: routePhone(path, now), openRoute: 'history',
      history: historyPage(now), geocoder: { places: [
        { ...park, name: LONG_PLACE.names[0] },
        { ...corner, name: { line: '330台灣桃園市桃園區民生路120號' } }],
      names: [{ line: '330台灣桃園市桃園區中正路50號' }, { line: '330台灣桃園市桃園區成功路三段16號' }] } };
  },
  // A candidate after staying home: show its tentative start, without status copy.
  'history-confirming': now => ({ ...FIXTURES['all-good'](now),
    phone: routePhone(legsPath(now, 20 * MINUTE, at(-40, -60),
      [{ stay: 15 }, { walk: 5, speed: 1, bearing: 90 }]), now),
    openRoute: 'history', history: historyPage(now) }),
  // My route: walk, drive 12 minutes, walk — a numbered switch point where
  // each mode starts (H2 開車換走路的地方多一個點).
  'history-mode-switch': now => {
    const phone = routePhone(legsPath(now, 70 * MINUTE, at(-100, -150), [{ walk: 18, bearing: 20 },
      { drive: 4, speed: 8, bearing: 90 }, { drive: 4, speed: 8, bearing: 20 }, { walk: 25, bearing: 200 },
      { stay: 19 }]), now);
    return { ...FIXTURES['all-good'](now), phone, openRoute: 'history', history: historyPage(now) };
  },
  // ---- history (055a): the history screen --------------------------------
  // H1 我的路線 (「今天 x km」): two stays, a drive (a numbered switch point),
  // a stay, walking now.
  'history-my-route': now => ({ ...FIXTURES['all-good'](now), phone: routePhone(myRouteMorning(now), now),
    openRoute: 'history', history: historyPage(now), geocoder: { names: HISTORY_NAMES } }),
  // 067: 小黑's day with every kind of break. At home after midnight, the
  // collar silent for 5 h 40 min and back at the same spot (one stay, no
  // 「沒有資料」); a walk; a stay that goes on without GPS for 40 minutes
  // (folded into it: 室內); a walk that goes on without GPS for 8 minutes
  // (「收不到 GPS」); 10 minutes with no packet at all, resuming elsewhere
  // (「沒收到訊號」); walking now.
  'history-dog-breaks': now => ({ ...FIXTURES['all-good'](now), openRoute: 'history',
    history: historyPage(now, { slave: 6, ble: legsPath(now, 533 * MINUTE, at(-30, -60), [
      { stay: 20 }, { gap: 340, still: true }, { stay: 20 }, { walk: 20, bearing: 40, speed: 0.8 }, { stay: 15 },
      { inside: 40 }, { stay: 10 }, { walk: 15, bearing: 120, speed: 0.8 },
      { inside: 8, move: true, bearing: 120, speed: 0.8 }, { walk: 15, bearing: 120, speed: 0.8 },
      { gap: 10, bearing: 200, speed: 0.5 }, { walk: 20, bearing: 260, speed: 0.8 },
    ]).map(row => bleRow({ slave: 6, time: row.time, fix: row.fix, ...(row.fix ? {} : { rssi: -96, snr: -4 }) })) }),
    // The whole day in range, so the night at home shows.
    historyView: { manual: { start: now - 533 * MINUTE, end: null, following: true } },
    geocoder: { names: HISTORY_NAMES } }),
  // A long day of my route (067): out since 00:30, a fix every 2 s — about
  // 16,000 points of walks and stays around the station. Tapping the line and
  // dragging the cursor must stay quick.
  'history-long-day': now => ({ ...FIXTURES['all-good'](now),
    phone: routePhone(legsPath(now, 9 * 60 * MINUTE, at(-10, -100), Array.from({ length: 18 }, (_, i) => (
      i % 2 ? { stay: 12 } : { walk: 18, bearing: (i * 47) % 360, speed: 0.9 })), 2 * SECOND), now),
    openRoute: 'history', history: historyPage(now), geocoder: { names: HISTORY_NAMES } }),
  // H1 狗的歷史 (看軌跡 on 小黑's card): stays, a ride (坐車), moving now.
  'history-dog': now => ({ ...FIXTURES['all-good'](now), openRoute: 'history',
    history: historyPage(now, { slave: 6, ble: dogMorning(now) }), geocoder: { names: HISTORY_NAMES } }),
  // The day ends where the last stay is (still there now, or the range let go
  // inside it): one end row carrying the stay, not a numbered stay plus a
  // second row at the same place.
  'history-ends-in-stay': now => ({ ...FIXTURES['all-good'](now),
    phone: routePhone(endsInStay(now), now), openRoute: 'history', history: historyPage(now),
    geocoder: { names: HISTORY_NAMES } }),
  // 2026-10-14: a range that begins with a stay has no 出發 — the whole day
  // from 00:00: 停留 1 (home since midnight), a walk, 停留 2, the walk home,
  // and 「結束 · 停 N 分」 (home again). Without the dragged range (-auto) the
  // range starts at the detected departure: 出發 then the walk.
  'history-starts-with-stay': now => ({ ...FIXTURES['all-good'](now),
    phone: routePhone(homeDay(now), now), openRoute: 'history', history: historyPage(now),
    historyView: { manual: { start: now - 570 * MINUTE, end: now - 5 * MINUTE, following: false }, cursorAgo: 135 * MINUTE },
    geocoder: { names: HISTORY_NAMES } }),
  // 2026-10-14 (the map and the list by row): my route walk → drive → stay →
  // walk, out at about 08:02; tap the car row to see its segment framed and
  // emphasised, drag the cursor to see the list follow.
  'history-walk-drive-stay': now => ({ ...FIXTURES['all-good'](now),
    phone: routePhone(legsPath(now, 95 * MINUTE, at(-60, -120), [{ stay: 8 }, { walk: 18, bearing: 30, speed: 0.8 },
      { drive: 3, speed: 8, bearing: 100 }, { drive: 3, speed: 8, bearing: 340 }, { stay: 22 },
      { walk: 20, bearing: 220, speed: 0.8 }, { stay: 6 }]), now),
    openRoute: 'history', history: historyPage(now), geocoder: { names: HISTORY_NAMES } }),
  'history-starts-with-stay-auto': now => ({ ...FIXTURES['history-starts-with-stay'](now), historyView: {} }),
  // H1 我的路線 with the cursor an hour back: the map's end time marker (solid,
  // 2026-10-14) is not under the cursor.
  'history-end-marker': now => ({ ...FIXTURES['history-my-route'](now), historyView: { cursorAgo: 60 * MINUTE } }),
  'history-dog-ends-in-stay': now => ({ ...FIXTURES['all-good'](now), openRoute: 'history',
    history: historyPage(now, { slave: 6, ble: endsInStay(now).map(row => bleRow({ slave: 6, time: row.time, fix: row.fix })) }),
    geocoder: { names: HISTORY_NAMES } }),
  'history-ends-in-stay-finished': now => ({ ...FIXTURES['history-ends-in-stay'](now),
    historyView: { manual: { start: now - 100 * MINUTE, end: now - MINUTE, following: false } } }),
  'history-dog-ends-in-stay-finished': now => ({ ...FIXTURES['history-dog-ends-in-stay'](now),
    historyView: { manual: { start: now - 100 * MINUTE, end: now - MINUTE, following: false } } }),
  // 2026-10-15: the range dragged to end 15 seconds into the last stay (in
  // the minute it began), the cursor at its end: the list's last row 「停 不到
  // 1 分」 and the cursor 「停留 不到 1 分」 (it read 「停留 0 分」).
  'history-stay-first-minute': now => ({ ...FIXTURES['history-ends-in-stay'](now),
    historyView: { manual: { start: now - 100 * MINUTE, end: now - 35 * MINUTE - 5 * SECOND, following: false } } }),
  // H2b: my route with the range bar open; the start dragged to the walk after
  // the first stay (出發), the end following now.
  'history-range-open': now => ({ ...FIXTURES['history-my-route'](now),
    historyView: { rangeOpen: true, manual: { start: now - 100 * MINUTE, end: null, following: true } } }),
  // 2026-10-16: the range bar open with the start handle at the far left (the
  // day's first fix, 00:05) and the end following now at the far right: both
  // times stay inside the range box (小黑's day, fictional).
  'history-range-edges': now => ({ ...FIXTURES['all-good'](now), openRoute: 'history',
    history: historyPage(now, { slave: 6, ble: legsPath(now, 565 * MINUTE, at(-30, -60), [
      { stay: 60 }, { walk: 30, bearing: 40, speed: 0.8 }, { stay: 200 }, { walk: 30, bearing: 120, speed: 0.8 },
      { stay: 205 }, { walk: 40, bearing: 200, speed: 0.8 }]).map(row => bleRow({ slave: 6, time: row.time, fix: row.fix })) }),
    geocoder: { names: HISTORY_NAMES },
    historyView: { rangeOpen: true, manual: { start: now - 565 * MINUTE, end: null, following: true } } }),
  // 豆豆 has one fix today: one point, no distance, no range bar (只有一筆).
  'history-single-point': now => ({ ...FIXTURES['all-good'](now), openRoute: 'history',
    history: historyPage(now, { slave: 4, ble: [bleRow({ slave: 4, time: now - 20 * MINUTE, fix: at(4, 6) })] }) }),
  // H8: my route without a fix today (yesterday has one): 今天還沒有路線, the
  // export icon faded, ‹ goes to yesterday.
  'history-empty-day': now => ({ ...FIXTURES['all-good'](now), phone: { ...walkingPhone(now), today: [] },
    openRoute: 'history', history: historyPage(now, {
      phoneDays: legsPath(now - 20 * 60 * MINUTE, 60 * MINUTE, at(-30, -60), [{ walk: 50, bearing: 70 }])
        .map(row => ({ time: row.time, ...row.fix })) }) }),
  // 豆豆's day with two breaks: 12 minutes (沒有資料) and 40 minutes (沒有資料
  // then 恢復記錄).
  'history-gap': now => {
    const ble = legsPath(now, 120 * MINUTE, at(10, -30), [{ walk: 25, bearing: 30, speed: 1.1 }, { gap: 12 },
      { walk: 18, bearing: 120, speed: 1.1 }, { gap: 40 }, { walk: 25, bearing: 220, speed: 1.1 }])
      .map(row => bleRow({ slave: 4, time: row.time, fix: row.fix }));
    return { ...FIXTURES['all-good'](now), openRoute: 'history', history: historyPage(now, { slave: 4, ble }) };
  },
  // 豆豆 goes inside for 25 minutes after a walk (clear fixes, then packets
  // without a fix): the pavilion node 「在遮蔽處 N 分」, unnumbered, no distance.
  'history-indoor': now => {
    const path = legsPath(now, 80 * MINUTE, at(10, 8), [{ walk: 22, bearing: 60, speed: 1.3 }, { stay: 13 },
      { inside: 25 }, { walk: 20, bearing: 200, speed: 1.3 }]);
    const ble = path.map(row => bleRow({ slave: 4, time: row.time, fix: row.fix,
      ...(row.fix ? {} : { rssi: -96, snr: -4 }) }));
    return { ...FIXTURES['all-good'](now), openRoute: 'history', history: historyPage(now, { slave: 4, ble }) };
  },
  // 2026-10-19: both kinds of hold in one list beside a coral stay — 豆豆
  // walks, stays (停 13 分), 25 minutes without a fix: 「在遮蔽處 N 分」 with
  // the pavilion; walks home, is on its charger (usb 1, no fix) for 20
  // minutes: 「充電中 N 分」 with the bolt; then walks out again.
  'history-shelter-charging': now => {
    const path = legsPath(now, 110 * MINUTE, at(10, 8), [{ walk: 22, bearing: 60, speed: 1.3 }, { stay: 13 },
      { inside: 25 }, { walk: 20, bearing: 200, speed: 1.3 }, { inside: 20 }, { walk: 10, bearing: 280, speed: 1.3 }]);
    const charging = time => time >= now - 30 * MINUTE && time < now - 10 * MINUTE;
    const ble = path.map(row => bleRow({ slave: 4, time: row.time, fix: row.fix,
      ...(charging(row.time) ? { usb: 1 } : {}), ...(row.fix ? {} : { rssi: -96, snr: -4 }) }));
    return { ...FIXTURES['all-good'](now), openRoute: 'history', history: historyPage(now, { slave: 4, ble }) };
  },
  // ---- the list's last node (057a): every way a day's list can end -------
  // 小黑 today, its last fix at 09:13 (17 minutes ago), the end following now:
  // 「09:13 之後沒有位置」 (2026-10-15: no 「最後」).
  'history-dog-stale': now => ({ ...FIXTURES['all-good'](now), openRoute: 'history',
    history: historyPage(now, { slave: 6, ble: dogMorning(now).filter(row => row.received_at <= now - 17 * MINUTE) }),
    geocoder: { names: HISTORY_NAMES } }),
  // 小黑's 10/2 (a past day this phone holds): 「結束」 with its time.
  'history-past-day': now => calendarFixture(now, { view: { goTo: dayKey(new Date(now - 5 * DAY_MS)) } }),
  // My route today with only the end dragged back to 08:50 (fixed): 「結束
  // 08:50」; the start stays the automatic departure (07:02:20), 「出發」.
  'history-manual-end': now => ({ ...FIXTURES['history-my-route'](now),
    historyView: { manual: { start: now - 8860 * SECOND, end: now - 40 * MINUTE, following: false } } }),
  // 2026-10-15 (user, no 「最後」): today following now, three ways the fixes
  // stop. My route with the recorder's own readings: standing still (0.2 km/h)
  // or walking (4.3 km/h), 5 s apart.
  // Still at the café since 08:25; from 08:50 the phone saved nothing (the
  // system stopped GPS), recording on: the stay goes on to now, 「現在」.
  'history-recording-still': now => ({ ...FIXTURES['all-good'](now), openRoute: 'history', history: historyPage(now),
    phone: routePhone(recorderPath(now, 90 * MINUTE, [['still', 10], ['walk', 15, 40], ['still', 25]]), now),
    geocoder: { names: HISTORY_NAMES } }),
  // On foot until 09:17, then nothing (a tunnel, an underpass), recording on:
  // 「09:17 之後沒有位置」.
  'history-recording-no-fix': now => ({ ...FIXTURES['all-good'](now), openRoute: 'history', history: historyPage(now),
    phone: routePhone(recorderPath(now, 60 * MINUTE, [['still', 10], ['walk', 38, 60]]), now),
    geocoder: { names: HISTORY_NAMES } }),
  // A walk, 40 minutes with nothing saved, the walk on: one row
  // 「沒有位置 40 分」 (it was 「沒有資料 08:15–08:55」 or 「GPS 訊號弱」).
  'history-recording-break': now => ({ ...FIXTURES['all-good'](now), openRoute: 'history', history: historyPage(now),
    phone: routePhone(recorderPath(now, 90 * MINUTE, [['still', 10], ['walk', 15, 40], ['none', 40, 80, 1200],
      ['walk', 15, 120]]), now), geocoder: { names: HISTORY_NAMES } }),
  // The recording switch on, but its service not running since 09:05 (the
  // system stopped it): 「記錄中斷・09:05」 and the hint to open the app.
  'history-recording-interrupted': now => {
    const path = myRouteMorning(now).filter(row => row.time <= now - 25 * MINUTE);
    return { ...FIXTURES['all-good'](now), openRoute: 'history', history: historyPage(now),
      phone: { ...routePhone(path, now), recording: false, interrupted: true }, geocoder: { names: HISTORY_NAMES } };
  },
  // My route with last fix at 09:05 and recording stopped at 09:30: 「記錄已關閉 09:05」.
  'history-recording-off': now => {
    const path = myRouteMorning(now).filter(row => row.time <= now - 25 * MINUTE);
    const phone = routePhone(path, now);
    return { ...FIXTURES['all-good'](now), openRoute: 'history', history: historyPage(now),
      phone: { ...phone, recording: false, stoppedAt: now }, geocoder: { names: HISTORY_NAMES } };
  },
  // 小黑 walking from 10/5 23:10 into 10/6 00:50, opened on 10/5: the last
  // node continues into the next day (no capsule since 2026-10-13).
  'history-cross-midnight': now => {
    const midnight = new Date(now - 24 * 60 * MINUTE).setHours(0, 0, 0, 0);
    const late = legsPath(midnight, 50 * MINUTE, at(-20, -40), [{ walk: 25, bearing: 70, speed: 0.5 }, { stay: 15 },
      { walk: 60, bearing: 120, speed: 0.5 }]).map(row => bleRow({ slave: 6, time: row.time, fix: row.fix }));
    // legsPath stops 5 s before its "now": run it past midnight on its own.
    const after = legsPath(midnight + 50 * MINUTE, 50 * MINUTE, late.length ? { latitude: late.at(-1).slave_lat,
      longitude: late.at(-1).slave_lon } : at(0, 0), [{ walk: 50, bearing: 20, speed: 0.5 }])
      .map(row => bleRow({ slave: 6, time: row.time, fix: row.fix }));
    return { ...FIXTURES['all-good'](now), openRoute: 'history',
      history: historyPage(now, { slave: 6, ble: [...late, ...after, ...dogMorning(now)] }),
      historyView: { goTo: dayKey(new Date(midnight - 60 * MINUTE)) }, geocoder: { names: HISTORY_NAMES } };
  },
  // 豆豆 walks, stays, then goes inside for the last 30 minutes (packets
  // without a fix until now): the list ends on the pavilion node 「在遮蔽處 N 分」.
  'history-indoor-end': now => {
    const path = legsPath(now, 85 * MINUTE, at(10, 8), [{ walk: 25, bearing: 60, speed: 1.3 }, { stay: 15 },
      { walk: 2, bearing: 90, speed: 0.4 }, { stay: 13 }, { inside: 30 }]);
    const ble = path.map(row => bleRow({ slave: 4, time: row.time, fix: row.fix,
      ...(row.fix ? {} : { rssi: -96, snr: -4 }) }));
    return { ...FIXTURES['all-good'](now), openRoute: 'history', history: historyPage(now, { slave: 4, ble }),
      geocoder: { names: HISTORY_NAMES } };
  },
  // ---- history (055b): several dogs (H7) ---------------------------------
  // H7 capsule and immediate chooser states.
  'history-multi-dog': now => multiFixture(now, { dogs: [4, 8], protagonist: 4 }),
  'history-multi-four': now => multiFixture(now, { dogs: [4, 8, 5], protagonist: 4 }),
  'history-multi-no-data': now => multiFixture(now, { dogs: [5], fiveToday: false }),
  'history-multi-cursor': now => multiFixture(now, { dogs: [4, 8], protagonist: 6, cursorAgo: 50 * MINUTE }),
  'history-multi-add': now => multiFixture(now, { dogs: [], fiveToday: false, sheet: 'dogs' }),
  'history-dogs-one-addable': now => multiFixture(now),
  'history-dogs-one-alone': now => ({ ...multiFixture(now), ble: [], cloudRows: dog6Cloud(now) }),
  'history-dogs-three': now => multiFixture(now, { dogs: [4, 8], protagonist: 6 }),
  'history-dogs-four': now => multiFixture(now, { dogs: [4, 8, 5], protagonist: 4 }),
  'history-dogs-sheet-three': now => multiFixture(now, { dogs: [4, 8], protagonist: 6, sheet: 'dogs' }),
  'history-dogs-sheet-four': now => multiFixture(now, { dogs: [4, 8, 5], protagonist: 4, sheet: 'dogs' }),
  'history-dogs-sheet-no-record': now => multiFixture(now, { dogs: [4, 8], protagonist: 6, fiveToday: false, sheet: 'dogs' }),
  // ---- history (056): the export (H9/H10) ---------------------------------
  // H9 / D16: export window in fixed PNG / GPX / CSV order; shared sheet copy:
  // 地圖＋時間軸清單 / 軌跡檔，可匯入地圖 App / 每一筆位置 (also TalkBack).
  'history-export': now => ({ ...FIXTURES['history-my-route'](now), historyView: { export: { phase: 'choose' } } }),
  // 產生中 that never ends (the export icon a spinner; 取消 or the back key stops it).
  'history-export-generating': now => ({ ...FIXTURES['history-my-route'](now), historyExport: 'hang',
    historyView: { export: { phase: 'generating', format: 'png' } } }),
  // The window open, every export hanging: choose a format to watch 產生中 begin.
  'history-export-hang': now => ({ ...FIXTURES['history-my-route'](now), historyExport: 'hang',
    historyView: { export: { phase: 'choose' } } }),
  // 匯出失敗　重試 (重試 then works: a real export of the same day).
  'history-export-failed': now => ({ ...FIXTURES['history-my-route'](now),
    historyView: { export: { phase: 'failed', format: 'png' } } }),
  // The first export fails, 重試 makes it from the same snapshot.
  'history-export-fail-once': now => ({ ...FIXTURES['history-my-route'](now), historyExport: 'fail-once',
    historyView: { export: { phase: 'choose' } } }),
  // H10b: four dogs (小黑, 豆豆, 阿福 from the cloud, 狗 5) for the many-dogs PNG.
  'history-export-multi': now => multiFixture(now, { dogs: [4, 8, 5], protagonist: 6,
    exportView: { phase: 'choose' } }),
  // H10a: 小黑's day with a stay, a ride, a break (沒有資料), indoors and on again.
  'history-export-day': now => ({ ...FIXTURES['all-good'](now), openRoute: 'history',
    history: historyPage(now, { slave: 6, ble: exportDay(now) }), geocoder: { names: HISTORY_NAMES },
    historyView: { export: { phase: 'choose' } } }),
  // H10a for 狗 5, which has no name: its files are 「DogTracker_狗 5_…」,
  // never 「狗 5-5」 (2026-10-15).
  'history-export-unnamed': now => ({ ...FIXTURES['history-export-day'](now),
    history: historyPage(now, { slave: 5, ble: exportDay(now).map(row => ({ ...row, slave_id: 5 })) }) }),
  // A busy day (16 stays): each address takes the made-up geocoder 1.5 s
  // (the emulator's own Geocoder took 1.4–17 s), so the last rows wait about
  // 25 s; two places have none (coordinates).
  'history-busy-day': now => ({ ...FIXTURES['all-good'](now), openRoute: 'history',
    history: historyPage(now, { slave: 6, ble: busyDay(now) }), geocoder: { names: BUSY_NAMES, delayMs: 1500 } }),
  // The same with this phone's own Geocoder (network + Play services).
  'history-busy-day-geocoder': now => ({ ...FIXTURES['history-busy-day'](now), geocoder: 'real' }),
  // Both with the export window open.
  'history-busy-day-export': now => ({ ...FIXTURES['history-busy-day'](now),
    historyView: { export: { phase: 'choose' } } }),
  'history-busy-day-geocoder-export': now => ({ ...FIXTURES['history-busy-day-geocoder'](now),
    historyView: { export: { phase: 'choose' } } }),
  // ---- history (054b): the calendar and a day only the cloud holds -------
  // H3b: 小黑's calendar on October; dots on this phone's days and the cloud's
  // (9/28 and 10/3 only in the cloud); a day only the cloud holds downloads
  // for 3.5 s when tapped (H3c, then the day).
  'history-calendar': now => calendarFixture(now, { view: { calendar: 'month' } }),
  // H3b while the cloud is asked: 查詢中…; days not known yet wait in normal colour.
  'history-calendar-querying': now => calendarFixture(now, { view: { calendar: 'month' }, query: 'hang' }),
  // The cloud cannot be asked: 雲端的紀錄查不到　重試; unknown days can be tapped.
  'history-calendar-failed': now => calendarFixture(now, { view: { calendar: 'month' }, query: 'fail' }),
  // H3e: 選月份 for 2026 (August, September, October have records).
  'history-month-picker': now => calendarFixture(now, { view: { calendar: 'months' } }),
  // H3d: no network; tapping 9/28 (only in the cloud) keeps the calendar
  // and the day, with 「沒有網路，9/28 的紀錄還沒下載，連上網路再試」.
  'history-cloud-offline': now => calendarFixture(now, { view: { calendar: 'month' }, online: false }),
  // Signed out: only this phone's days have dots; the cloud is never asked.
  'history-calendar-signed-out': now => calendarFixture(now, { view: { calendar: 'month' }, signedIn: false }),
  // H3c: 9/28 (only in the cloud) chosen, downloading (never ends; 取消 or
  // 返回鍵 → 這天的紀錄還沒下載完　重試).
  'history-cloud-downloading': now => calendarFixture(now, { view: { goTo: cloudOnlyDay(now) }, download: 'hang',
    seed: { cloud: [cloudOnlyDay(now)] } }),
  // The download of 9/28 failed with nothing on this phone: 這天的紀錄還沒下載完　重試.
  'history-cloud-failed': now => calendarFixture(now, { view: { goTo: cloudOnlyDay(now) }, download: 'fail',
    seed: { cloud: [cloudOnlyDay(now)] } }),
  // The download of 9/28 stopped half-way: that half, 資料不完整　重試.
  'history-cloud-incomplete': now => calendarFixture(now, { view: { goTo: cloudOnlyDay(now) },
    download: 'partial', seed: { cloud: [cloudOnlyDay(now)] } }),
};

export const FIXTURE_NAMES = Object.freeze(Object.keys(FIXTURES));

// A settings page a fixture can be opened on (&page=…), whatever its own.
export const FIXTURE_PAGES = Object.freeze(['settings', 'receiver', 'phone', 'cloud', 'alerts', 'advanced',
  'diagnostics', 'wifi', 'liveData', 'cloudData', 'locationRecords', 'permissions', 'pair', 'paired',
  // The live map (a history fixture's 「今天 x km」) or the history page.
  'map', 'history',
  // The alert engine's debug preview (058a).
  'alertPreview']);
const FIXTURE_URL = /^dogtracker:\/\/dev\/fixture\?name=([a-z0-9-]+)(?:&page=([a-zA-Z]+))?$/;

// dogtracker://dev/fixture?name=dogs-aged → 'dogs-aged'; ?name=off → 'off'.
export function fixtureNameFromUrl(url) {
  const match = FIXTURE_URL.exec(url || '');
  if (!match) return null;
  return match[1] === 'off' || FIXTURES[match[1]] ? match[1] : null;
}

// ?name=receiver-connecting&page=receiver → 'receiver' (S2 of that state).
export function fixturePageFromUrl(url) {
  const page = FIXTURE_URL.exec(url || '')?.[2] ?? null;
  return FIXTURE_PAGES.includes(page) ? page : null;
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
  // Read since LATEST_SINCE (all stored rows), like latestStatusRows.
  const latest = Math.max(...pair.map(timeOf).filter(time => time < completedBefore));
  if (!Number.isFinite(latest)) return { ...row, environment: null };
  const start = Math.floor(latest / ENVIRONMENT_WINDOW_MS) * ENVIRONMENT_WINDOW_MS;
  const window = pair.filter(other => timeOf(other) >= start && timeOf(other) < start + ENVIRONMENT_WINDOW_MS)
    .map(other => ({ ...other, track_at: timeOf(other) }));
  return { ...row, environment: predictEnvironment(window) };
}

const packet = (row, source) => ({
  slave_id: row.slave_id, master_id: row.master_id, track_at: timeOf(row), received_at: row.received_at,
  slave_lat: row.slave_lat, slave_lon: row.slave_lon, speed_kmh: row.speed_kmh,
  battery_percentage: row.battery_percentage, battery_valid: row.battery_valid, battery_mv: row.battery_mv ?? null,
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
    battery_percentage: row.battery_percentage, battery_valid: row.battery_valid, battery_mv: row.battery_mv ?? null,
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
export function buildFixture(name, now = FIXTURE_NOW, page = null) {
  const make = FIXTURES[name];
  if (!make) return null;
  nextId = 1;
  const { receiver, cloud, phone, ble = [], cloudRows = [], openDog = null, openPage = null, avatars = {},
    aliases = ALIASES,
    dismissed = {}, storageError = null, mapFailure = null, openRoute = null, permissions = {},
    upload = cloud?.ownerId ? uploading(now) : null, expired = false, dialog = null, alerts = null,
    alertsOpen = false, diagnosticsEnabled = false, readFailure = null, deletion = null, launch = null, restoring = false,
    permissionsGuide = null, pairing = null, history = null, geocoder = null, historyView = null, historyCloud = null,
    historyExport = null, activityView = null, activity = null, activityClock = null, alertPause = null,
    waitingDismissed = false, waitingNew = false, cardBle = null,
    wifi = { ssids: ['家裡', '辦公室'], activeSsid: '家裡' } } = make(now);
  const fixtureHistory = history || historyPage(now, { ble, cloudRows });
  const genericActivity = {
    readActivity: async (slaveId, { start, end, detail }) => {
      const rows = cardRows(ble, cloud?.ownerId ? cloudRows : [], slaveId, start - ACTIVITY_CONTEXT_MS);
      const within = items => items.filter(row => row.time < end + ACTIVITY_CONTEXT_MS);
      const local = within(rows.local), remote = within(rows.cloud);
      return detail === 'raw' ? { local, cloud: remote } : { minutes: activityMinutes([
        ...activityReadings(local, 'ble'), ...activityReadings(remote, 'cloud'),
      ], { now }) };
    },
    readActivityEarliest: async slaveId => {
      const rows = cardRows(ble, cloud?.ownerId ? cloudRows : [], slaveId, -Infinity);
      const times = [...rows.local, ...rows.cloud].map(row => row.time);
      return times.length ? Math.min(...times) : null;
    },
  };
  const fixtureActivity = activity ? {
    readActivity: (slaveId, query) => (slaveId === 6 ? activity : genericActivity).readActivity(slaveId, query),
    readActivityEarliest: slaveId => (slaveId === 6 ? activity : genericActivity).readActivityEarliest(slaveId),
  } : genericActivity;
  // The live feed (TrackingFeed → trackingSourceReducer) reads dog_status:
  // the newest row is the point, plus the last valid position per endpoint.
  const points = ble.map(mapDogStatusRow);
  const point = points.reduce((newest, row) => (!newest || row.id > newest.id ? row : newest), null);
  // useCloudDogs: the newest downloaded fix per dog, the newest packet of
  // each source with its environment, and the indoor holds.
  const holds = createHoldStore();
  // Signed out, useCloudDogs reads no cloud rows: holds come from BLE only.
  holds.ingest(holdBatch(ble, cloud?.ownerId ? cloudRows : [], now));
  // useCloudDogs reads every dog's newest rows, however old (LATEST_SINCE).
  const recent = () => true;
  const recentFix = row => hasFix(row);
  const packets = [
    ...newestBy(ble, recent).map(row => withEnvironment({ ...packet(row, 'ble'),
      first_received_at: Math.min(...ble.filter(other => other.slave_id === row.slave_id && other.master_id === row.master_id).map(other => other.received_at)) }, ble, now)),
    ...newestBy(ble, recentFix).map(row => withEnvironment(packet(row, 'ble'), ble, now)),
    ...newestBy(cloudRows, recent).map(row => withEnvironment(packet(row, 'cloud'), cloudRows, now)),
  ];
  // RideAlong: the handler's phone speeds over the last half minute.
  const rides = createRideDetector();
  for (const position of phone?.route || []) rides.add(position, now);
  const waitingSeed = waitingSourcesState(null, receiver, packets, now);
  const waitingLocationSources = waitingDismissed ? dismissWaitingSources({ ...waitingSeed,
    sources: Object.fromEntries(Object.entries(waitingSeed.sources).filter(([id]) => !waitingNew || id !== '9')) }) : null;
  return {
    name,
    now,
    waitingLocationSources,
    receiverState: receiver,
    readReceiverState: { getState: async () => receiver },
    cloudSync: cloud,
    raw: { ble, cardBle, cloud: cloudRows, history: history ? [...(history.ble || []), ...(history.cloudRows || [])] : [],
      today: phone?.today || [] },
    tracking: {
      point: point ?? emptyTrackingPoint,
      positionSamples: point ? mergePositionSamples([], points, point) : [],
      route: emptyLiveRoute(),
    },
    cloudDogs: {
      // Fixtures are complete DB reads of their fixed successful snapshot.
      cloudCommit: cloud?.lastSuccess ?? null,
      rows: cloud?.ownerId ? newestBy(cloudRows, recentFix).map(row => ({ ...row, source: 'cloud' })) : [],
      packets: cloud?.ownerId ? packets : packets.filter(row => row.source === 'ble'),
      track: [],
      holds: holds.holds(now),
      statuses: holds.statuses(),
      ranges: holds.ranges(),
      batteries: holds.batteries(),
      error: '',
      loaded: true,
    },
    // Top cards closed with ✕ before the screenshot (A2b).
    dismissed,
    // A failed write of dog positions (useTrackingSession's realWriteError).
    storageError,
    // 'tiles' (no base map) or 'component' (the map cannot open).
    mapFailure,
    livePhone: phone?.position && phone.recording !== false ? {
      running: true, status: '記錄中',
      position: phone.position,
      ageSeconds: Math.max(0, Math.round((now - phone.position.timestamp) / SECOND)),
      enabled: true,
    } : { running: false, stoppedAt: phone?.stoppedAt ?? null, status: '未記錄',
      // The 位置記錄 switch: still on when the service stopped on its own.
      enabled: !!phone?.interrupted },
    phoneRoute: phone?.recording === false ? [] : phone?.route || [],
    // usePhoneLocation's answer: precise and on unless the state says not.
    phonePermission: { permission: phone?.permission ?? 'precise', services: phone?.services ?? true },
    // usePhonePermissions' answer: everything allowed unless the state says.
    permissions: { notificationsDenied: false, nearbyDenied: false, batteryIgnored: true, ...permissions },
    // The 位置記錄 switch (S4): on unless recording was switched off.
    recording: { enabled: phone?.recordingSwitch ?? phone?.recording !== false,
      running: !!phone?.position && phone.recording !== false, busy: false, error: null, toggle: () => {} },
    // Signed in as the fixture account (S1 Supabase 帳號) unless signed out.
    account: { signedIn: !!cloud?.ownerId, email: cloud?.ownerId ? 'tim@example.com' : '' },
    // The settings page it opens on (S1, S2, S3, S4), if any.
    openRoute: page ?? openRoute,
    // useCloudUpload's answer (S3; null signed out), 登入失效, and a dialog
    // open on S3 ({ kind: 'switch', master } | { kind: 'signout' }).
    upload,
    expired,
    dialog,
    // 設定 → 提醒 (S6): the saved AlertPreferences (defaults when null), and
    // whether the 狗 group shows its three switches.
    alerts: normalizeAlertPreferences(alerts),
    alertsOpen,
    // A 暫停提醒 in force when the fixture opens: { since, until } ms
    // before / after its now (alerts-paused).
    alertPause,
    diagnosticsEnabled,
    // 「今天 x km」: today's recorded route (myLocationTracker rows), summed
    // by the same code as the live one (useTodayRoute).
    todayRoute: (() => {
      // The same made-up recorder columns as the history's rows (phoneRouteSince
      // reads them too): one route, one distance.
      const { count, metres, status } = todayRouteDistance((phone?.today || [])
        .map(({ recorder, ...row }) => ({ ...FIXTURE_RECORDER, ...row, ...(recorder || {}) })), { now,
        recording: phone?.recording !== false });
      return { count, metres, status };
    })(),
    ride: rides.ride(now),
    dogAliases: aliases,
    // card-* states open this dog's card; dog-edit its edit sheet (A5) too.
    openDog,
    openPage,
    // Faces by collar number (useDogAvatars' avatars); the default otherwise.
    avatars,
    // CloudDatabase.dogCardRows over the fixture's rows (DogCardReadings).
    readCardRows: async (slaveId, since, until = null) =>
      cardRows(cardBle ?? ble, cloud?.ownerId ? cloudRows : [], slaveId, since, until),
    // 診斷 (S8): the same rows as the data pages would read them.
    diagnostics: diagnosticsSources({ ble, cloudRows, owner: cloud?.ownerId ?? null,
      today: phone?.today || [], readFailure }),
    // 接收器 Wi-Fi (S7): the receiver's saved networks, changed in memory only.
    wifiService: fakeWifi(wifi),
    // 刪除全部狗資料 (S7): rows still to upload, the dialog open at once.
    deletion: { unsent: deletion?.unsent ?? 0, open: !!deletion?.open },
    // The cold start it shows (Launch.launchScreen's input), if any, and
    // whether the sign-in restore still waits for Supabase.
    launch,
    restoring,
    // D2's rows ({ grants, asked }) and D3's state (usePairing's fixture:
    // view, camera, dialog, target, nearby…): drawn, nothing asked or scanned.
    permissionsGuide,
    pairing,
    // The history page (054a): its query, the map's tracks and the day reader
    // of the time-line list, all from the fixture's rows.
    history: historyFixture(fixtureHistory, [...(fixtureHistory.phoneDays || []), ...(phone?.today || [])]),
    // The history screen opened as it was left (H2b: the range bar open, a
    // range already dragged; 054b: the calendar open, another day chosen).
    historyView,
    // The activity page (A4): the tab and day it opens on, and its reads
    // (CloudDatabase.activityPeriod / activityEarliest over the fixture's 小黑).
    activityView,
    // activity-today's page runs 40 s into a minute (the running one is left out).
    activityNow: activityClock,
    readActivity: fixtureActivity.readActivity,
    readActivityEarliest: fixtureActivity.readActivityEarliest,
    // The history's stand-in cloud (054b): { cloud, online, seed } or null.
    historyCloud,
    // The export (056): 'hang' (產生中 never ends), 'fail', 'fail-once'; else
    // the real exporter (files in this phone's cache, Android's share sheet).
    exporter: historyExport ? fixtureExporter(historyExport) : null,
    // Its places' names (053a): made-up answers, none, or this phone's
    // Geocoder; never this phone's address cache.
    addressLookup: fixtureAddressLookup(geocoder, geocoder?.delayMs != null ? { delayMs: geocoder.delayMs } : undefined),
  };
}

// The recorder's columns of a fixture's myLocationTracker rows that both the
// history (historyDayRows) and 「今天 x km」 (phoneRouteSince) read (made up).
const FIXTURE_RECORDER = Object.freeze({ session_id: 'fixture-walk', raw_speed_kmh: 3.8, speed_accuracy_mps: 0.4 });

// What the history screen reads for a history fixture: the query and
// historyDayRows / historyDays over the fixture's rows.
function historyFixture({ preferences, ble = [], cloudRows = [] }, today) {
  // myLocationTracker's columns as the CSV export reads them (made up).
  const phoneRows = today.map((point, index) => ({ id: index + 1, time: point.time, latitude: point.latitude,
    longitude: point.longitude, accuracy: point.accuracy ?? 6, location_at: point.time - 400,
    accuracy_meters: point.accuracy ?? 6, altitude_meters: 112, speed_kmh: 3.6, heading_degrees: 40,
    raw_latitude: point.latitude, raw_longitude: point.longitude, ...FIXTURE_RECORDER,
    motion_state: 'moving', display_source: 'pipeline', display_location_at: point.time - 400,
    // A fixture may give a fix its own recorder readings (history-stop-and-go).
    ...(point.recorder || {}) }));
  const readDay = async ({ subject, slaveId, start, end, owner = null, after = {} }) => {
    if (after.fixture) return { rows: [], seed: [], after };
    // As HistoryDatabase.historyDayRows: half an hour before, and 3 minutes
    // past midnight (do the last stay, hold or walk go on next day?).
    const since = start - HISTORY_DAY_CONTEXT_MS;
    const until = end + HISTORY_DAY_AFTER_MS;
    const within = time => time >= since && time < until;
    if (subject === 'phone') {
      return { rows: phoneRows.filter(row => within(row.time)).map(phoneHistoryRow), seed: [], after: { fixture: true } };
    }
    const local = ble.filter(row => row.slave_id === slaveId && within(row.received_at))
      .map(row => dogHistoryRow(row, 'local'));
    const cloud = !owner ? [] : cloudRows
      .filter(row => row.slave_id === slaveId && within(timeOf(row))).map(row => dogHistoryRow(row, 'cloud'));
    return { rows: [...local, ...cloud], seed: [], after: { fixture: true } };
  };
  // The days holding rows (HistoryDatabase.historyDays): the date row's ‹ ›.
  const keyOf = time => {
    const date = new Date(time);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  const readDays = async ({ subject, slaveId, owner = null }) => {
    const times = subject === 'phone' ? phoneRows.map(row => row.time) : [
      ...(ble.filter(row => row.slave_id === slaveId).map(row => row.received_at)),
      ...(!owner ? [] : cloudRows.filter(row => row.slave_id === slaveId).map(timeOf)),
    ];
    return [...new Set(times.map(keyOf))].sort();
  };
  return { preferences, readDay, readDays };
}

const rejectRead = reason => async () => { throw new Error(reason); };

// What the 診斷 data pages read, from the fixture's rows: dog_status newest
// first (即時資料), the account's downloaded rows with their raw JSON (本機／
// 雲端資料, signed in only), the phone's records newest first (記錄清單).
function diagnosticsSources({ ble, cloudRows, owner, today, readFailure }) {
  const newest = rows => [...rows].sort((left, right) => timeOf(right) - timeOf(left) || right.id - left.id);
  const cloudList = newest(cloudRows).map(row => ({ ...row, raw_payload: JSON.stringify({
    event_id: `fixture-${row.id}`, master_id: row.master_id, slave_id: row.slave_id,
    received_at: new Date(timeOf(row)).toISOString(),
    payload: { lat: Math.round(row.slave_lat * 1e6), lon: Math.round(row.slave_lon * 1e6), sat: row.satellites,
      bat: row.battery_percentage },
  }) }));
  // myLocationTracker rows, one per recorded point, ids in time order.
  const records = today.map((point, index) => ({
    id: index + 1, session_id: 'fixture-walk', location_at: point.time, recorded_at: point.time + 400,
    latitude: point.latitude, longitude: point.longitude, accuracy_meters: point.accuracy ?? 6,
    speed_kmh: 3.6, altitude_meters: 112, heading_degrees: 40, motion_state: 'moving',
    raw_speed_kmh: 3.8, speed_accuracy_mps: 0.4,
  })).reverse();
  const PAGE = 50;
  return {
    listHistory: readFailure ? rejectRead(readFailure)
      : async (limit = 100) => newest(ble).slice(0, limit),
    cloudDatabase: {
      initialize: async () => {},
      listHistory: readFailure ? rejectRead(readFailure)
        : async (account, from = 0) => (account === owner ? cloudList.slice(from, from + PAGE) : []),
      count: async account => (account === owner ? cloudList.length : 0),
      usage: async () => ({ rows: cloudList.length, bytes: cloudList.length * 560 }),
    },
    // CloudDataScreen follows the shared client's session: the fixture's.
    cloudClient: () => ({ auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session: owner ? { user: { id: owner, email: 'tim@example.com' } } : null },
        error: null }),
    } }),
    readLocationPage: readFailure ? rejectRead(readFailure) : async (before = 0) => {
      const from = records.filter(row => !before || row.id < before);
      return { rows: from.slice(0, PAGE), hasMore: from.length > PAGE, total: records.length,
        running: false };
    },
  };
}

// BleService's Wi-Fi commands on a receiver that keeps `ssids`.
function fakeWifi({ ssids = [], activeSsid = '' } = {}) {
  let saved = [...ssids];
  return {
    getWifiList: async () => ({ ssids: [...saved], activeSsid: saved.includes(activeSsid) ? activeSsid : '' }),
    configureWifi: async ssid => { if (!saved.includes(ssid)) saved = [...saved, ssid]; },
    removeWifi: async ssid => { saved = saved.filter(item => item !== ssid); },
  };
}

// What readDogCardRows would read from the two tables for one dog.
function cardRows(ble, cloud, slaveId, since, until = null) {
  const mine = (rows, time) => rows.filter(row => row.slave_id === slaveId)
    .map(row => ({ ...row, time: time(row) }));
  // The activity readings and the rows on USB power (充電中), as dogCardRows reads them.
  const activity = rows => rows.filter(row => row.time >= since && (until == null || row.time < until)
    && (row.activity_valid === 1 || row.usb_present === 1))
    .sort((left, right) => left.time - right.time)
    .map(row => ({ time: row.time, activity: row.activity, activity_valid: row.activity_valid,
      activity_time: row.activity_time ?? null, master_id: row.master_id, slave_id: row.slave_id,
      usb_present: row.usb_present ?? null }));
  const newestBattery = (rows, source) => rows.filter(row => row.battery_valid === 1
    && plausibleBattery(row.battery_percentage, row.battery_mv))
    .sort((left, right) => right.time - left.time).slice(0, CARD_BATTERY_ROWS)
    .map(row => ({ time: row.time, battery_percentage: row.battery_percentage, battery_mv: row.battery_mv ?? null,
      usb_present: row.usb_present, source }));
  const local = mine(ble, row => row.received_at);
  const remote = mine(cloud, timeOf);
  if (until != null) return { local: activity(local), cloud: activity(remote), battery: [], since, until };
  return { local: activity(local), cloud: activity(remote),
    battery: [...newestBattery(local, 'ble'), ...newestBattery(remote, 'cloud')], since };
}

// The map's own preferences are the user's; a fixture shows every dog, none
// followed, so its screenshot does not depend on what this phone saved.
const FIXTURE_PREFERENCES = Object.freeze({ showMasterMarker: true, showSlaveMarker: true,
  noDataCardDismissed: false });

const ignoreWrite = () => Promise.resolve();

// What a fixture's cloud sync is before the fixture's own fields: idle, as
// the engine starts (IndependentCloudSync's initial state), with nothing of the live
// one. Spreading the live state let its latest-first publication, revisions,
// mode, offline and auth flags reach the fixture's map, cards, S3 and
// 本機／雲端資料 (audit L9).
const FIXTURE_CLOUD_SYNC = Object.freeze({
  ownerId: null, latestFirst: false, snapshotPending: false, archivePending: false, archiveRevision: 0,
  archiveError: '', contextPending: false, busy: false, mode: null, error: '', lastSuccess: null,
  lastDownloadAt: null, failingSince: null, authFailed: false, offline: false, revision: 0,
  mapSuccessRevision: undefined, mapPending: false, dataRevision: null, publishedRevision: 0,
  publishedPending: false, catchUp: CATCH_UP_IDLE, getMapPublication: undefined, getHistoryPublication: undefined,
  retry: () => {}, runManual: () => Promise.reject(new Error('A screen fixture never runs the cloud sync')),
});

// A fixture without a history of its own reads none, never this phone's.
const noHistoryRows = async ({ after = {} } = {}) => ({ rows: [], seed: [], after });
const noHistoryDays = async () => [];

/**
 * Swaps a fixture's inputs into the live ones App hands the map. With no
 * fixture the live inputs come back untouched. The SQLite session itself keeps
 * running underneath; nothing a fixture shows can write to it.
 */
export function applyScreenFixture(fixture, live, edits = null) {
  if (!fixture) return live;
  const { tracking, phone, history } = live;
  // A name or face changed on a fixture's dog page (A5) lives in memory only
  // (useFixtureEdits), so the page can be tried without touching this phone's
  // real names and faces.
  const aliases = edits?.aliases ?? fixture.dogAliases;
  const avatars = edits?.avatars ?? fixture.avatars ?? {};
  return {
    tracking: {
      ...tracking,
      ...fixture.tracking,
      caughtUp: true,
      catchUp: CATCH_UP_IDLE,
      historyLoaded: true,
      initialSnapshotReady: true,
      ready: { ...tracking.ready, real: true },
      errors: { ...tracking.errors, real: null },
      realWriteError: fixture.storageError,
      preferences: { ...tracking.preferences, ready: true, busy: false, error: null,
        value: { ...tracking.preferences.value, ...FIXTURE_PREFERENCES,
          waitingLocationSources: fixture.waitingLocationSources,
          alerts: edits?.alerts ?? fixture.alerts,
          diagnosticsEnabled: edits?.diagnosticsEnabled ?? fixture.diagnosticsEnabled } },
      // A tap on a fixture's eye or follow button must not save the fixture's
      // dog ids into this phone's real preferences; a switch on S6 changes
      // the fixture's alerts in memory only (useFixtureEdits).
      saveTrackingPreferences: patch => {
        if (typeof patch?.diagnosticsEnabled === 'boolean') edits?.setDiagnosticsEnabled?.(patch.diagnosticsEnabled);
        if (patch?.alerts) edits?.setAlerts?.(patch.alerts);
        return Promise.resolve(true);
      },
      retryTrackingPreferences: ignoreWrite,
      resetTrackingPreferences: ignoreWrite,
      saveRealStatus: ignoreWrite,
    },
    phone: { ...phone, ...fixture.phonePermission, busy: false, error: null,
      enabled: !!fixture.livePhone.running && fixture.phonePermission.permission === 'precise'
        && fixture.phonePermission.services },
    todayRoute: fixture.todayRoute,
    cloudDogs: fixture.cloudDogs,
    addressLookup: fixture.addressLookup,
    // The upload as the fixture says (S3); its error is the gear's red dot.
    upload: fixture.upload ?? { settings: [], counts: [], masters: [], supported: true, settingsReady: false,
      switchMode: async () => {}, retry: async () => {} },
    cloudProblem: !!fixture.cloudSync?.ownerId && !!fixture.upload?.error,
    signInExpired: !!fixture.expired,
    restoring: !!fixture.restoring,
    permissions: fixture.permissions,
    recording: fixture.recording,
    account: fixture.account,
    // On a signed-in phone nothing of the live cloud sync may leak into a
    // fixture: its latest-first state kept the fixture's dogs off the map,
    // its changing revision restarted the card's readings so 活動量 stayed
    // 「—」, and its offline/mode/failure fields changed S3 and the alerts.
    cloudSync: { ...FIXTURE_CLOUD_SYNC, ...fixture.cloudSync },
    // A fixture asks its own stand-in cloud (054b) or none, never Supabase:
    // the live one would download real rows into this phone's database.
    historyCloud: fixture.historyCloud ?? null,
    history: history && {
      ...history, preferences: { ...history.preferences, ...fixture.history?.preferences, dogAliases: aliases },
      // A history fixture (054a) draws its own day, never this phone's;
      // one without a history draws an empty one.
      readDay: fixture.history?.readDay ?? noHistoryRows,
      readDays: fixture.history?.readDays ?? noHistoryDays,
      loaded: true, busy: false, error: '', key: `fixture:${fixture.name}`, devices: [],
      // The card's 看軌跡 and the dog page's name must not store a fixture's
      // dog in this phone's real history query or names.
      save: async preferences => {
        if (preferences?.dogAliases && preferences.dogAliases !== aliases) edits?.setAliases?.(preferences.dogAliases);
        return true;
      },
    },
    dogAvatars: {
      avatars, error: '',
      save: async (slaveId, avatar) => {
        edits?.setAvatars?.(current => {
          const next = { ...(current ?? avatars) };
          if (avatar) next[slaveId] = avatar; else delete next[slaveId];
          return next;
        });
        return true;
      },
    },
  };
}
