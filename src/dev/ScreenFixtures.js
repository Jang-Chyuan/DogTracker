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
import { HISTORY_DAY_CONTEXT_MS } from '../mapHistory/HistoryDatabase';
import { dogHistoryRow, phoneHistoryRow } from '../history/HistoryRows';
import { fixtureAddressLookup } from './fixtureGeocoder';
import { fixtureExporter } from './fixtureExporter';
import { dayKey } from '../history/screen/HistoryScreenDates';

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
// per receiver, rows the cloud refused (`blocked`), the last success. Its
// actions write nothing.
function uploading(now, { phone = [7], wifi = [], pending = {}, blocked = 0, last = now - 8 * SECOND,
  error = '' } = {}) {
  const waiting = Object.values(pending).reduce((sum, value) => sum + value, 0);
  return {
    owner: FIXTURE_OWNER, supported: true, settingsReady: true, phoneId: 'fixture-phone',
    masters: [...phone, ...wifi],
    settings: [...phone.map(master => ({ master_id: master, mode: 'phone' })),
      ...wifi.map(master => ({ master_id: master, mode: 'wifi' }))],
    counts: [{ status: 'pending', count: waiting }, ...(blocked ? [{ status: 'blocked', count: blocked }] : [])],
    pendingByMaster: pending, last, error,
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
    if (leg.gap != null) { time = until; continue; }
    const speed = leg.walk != null || leg.drive != null ? leg.speed ?? (leg.drive != null ? 12 : 1.1) : 0;
    const angle = ((leg.bearing ?? 45) * Math.PI) / 180;
    for (; time < until && time <= now - 5 * SECOND; time += every, index += 1) {
      if (leg.inside != null) { out.push({ time, fix: null }); continue; }
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
  const today = path.filter(row => row.fix).map(row => ({ ...row.fix, time: row.time, accuracy: 6 }));
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
// it can be added). `view`: the protagonist, the source, an open sheet, the
// cursor `cursorAgo` before now.
function multiFixture(now, { dogs = [], protagonist = null, source = null, sheet = null, fiveToday = true,
  cursorAgo = null, exportView = null }) {
  const base = FIXTURES['all-good'](now);
  const cloud = afuMorning(now);
  return {
    ...base, openRoute: 'history',
    // 狗 5 on the live map (heard a minute ago), so 「＋ 加入」 lists it.
    ble: [...base.ble, ...series(bleRow, now, { slave: 5, from: 4 * MINUTE, to: 60 * SECOND, start: [-12, 30] })],
    history: historyPage(now, { slave: 6, ble: [...dogMorning(now), ...doudouMorning(now), ...dog5Walk(now, fiveToday)],
      cloudRows: cloud }),
    historyView: { dogs, protagonist, source, sheet, cursorAgo, export: exportView },
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
  // name tags merge into 「3 隻・室內」. Dog 5 walks outside on its own.
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
  // that view: one hint with three faces (阿福 first, red frame: no new
  // position for 40 minutes) and 「+2」. Dog 9 is 2.5 km east: its own hint
  // on the right.
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
        ...west(5, 5, -240),
        ...west(3, 35, -280),
        ...west(2, -25, -300),
        ...west(9, 10, 250),
      ],
    };
  },
  // 豆豆 and dog 5 on receiver 7 near the handler; 阿福's last position came
  // from the cloud 26 hours ago, about 10 km south-west. The first view frames
  // the local dogs and the phone only (阿福 shows as an edge hint); 框住全部
  // frames 阿福 too.
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
  // minutes: 位置 has no row, 接收範圍 「在範圍內」, 活動量 「休息中 已 18 分鐘」.
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
  // ---- a dog's page (047, design A5/A5a/A5c) ------------------------------
  // card-ok with the pencil pressed: 豆豆's own page (A5) over its card.
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
  // minutes): no new position, battery 15%, out of range — every problem row
  // at once, and 活動量 「—」.
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
  // A7b: 小黑 held indoors (clear fixes, then packets without a fix for 12
  // minutes), collar on USB at 62%, resting for 40 minutes. 位置 「室內」 with
  // the held place's address under it (053a), no 接收範圍 row.
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
  // 小黑 held indoors with no network: no address is asked, the 位置 row is
  // 「室內」 alone (still 64dp), no spinner (edges「沒網路時查地址」).
  'dog-indoor-no-address': now => ({ ...FIXTURES['card-indoor'](now), geocoder: { offline: true } }),
  // card-indoor named by this phone's own Geocoder (network + Play services;
  // the place is by Taoyuan station). Nothing is written to its cache.
  'card-indoor-geocoder': now => ({ ...FIXTURES['card-indoor'](now), geocoder: 'real' }),
  // 小黑 only from the cloud (receiver 9's upload): no 接收範圍 row at all;
  // running hard for the last few minutes (劇烈活動).
  'card-cloud-dog': now => ({
    receiver: receiving(now), cloud: synced(now), phone: walkingPhone(now), openDog: 6,
    ble: dog4Ble(now),
    cloudRows: [
      ...series(cloudRow, now, { slave: 6, from: 20 * MINUTE, to: 15 * SECOND, every: 15 * SECOND,
        start: [-18, 24], step: [0.03, -0.05], activity: time => (time >= now - 3 * MINUTE ? 0.92 : 0.3) }),
      ...dog8Cloud(now),
    ],
  }),
  // The phone's newest fix is 15 minutes old: the headline says 「手機沒有
  // 定位」 instead of a direction and distance; 我的位置 turns grey.
  'card-phone-no-fix': now => ({
    receiver: receiving(now), cloud: synced(now), phone: stalePhone(now, 15 * MINUTE), openDog: 4,
    ble: dog4Ble(now), cloudRows: [...dog6Cloud(now), ...dog8Cloud(now)],
  }),
  // 豆豆's position is current but its collar stopped sending battery and
  // activity readings at 09:11: both rows say what they last said, with the
  // time — 「62%（09:11）」, 「休息中 已 12 分鐘（09:11）」.
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
  'cloud-ok': now => ({ ...FIXTURES['all-good'](now), openRoute: 'cloud' }),
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
  'upload-switch-confirm': now => ({ ...FIXTURES['all-good'](now), openRoute: 'cloud',
    upload: uploading(now, { phone: [], wifi: [7], pending: { 7: 120 }, last: now - 50 * MINUTE }),
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
  // far (7 strong, 3 weak).
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
  // Some switched off: 不在接收範圍 and 接收器電量低 off, 聲音 on; the 狗
  // group open on its three switches (「部分開」). S1 says 「震動、聲音」 and
  // 「部分開」.
  'alerts-some-off': now => ({ ...FIXTURES['all-good'](now), openRoute: 'alerts', alertsOpen: true,
    alerts: { dogOutOfRange: false, receiverBattery: false, sound: true } }),
  // Notifications not allowed: S6 「通知權限 未允許 開系統設定 ›」; S1's 提醒
  // (and 手機) row only the red 「!」; the gear's red dot on the map.
  'notifications-denied': now => ({ ...FIXTURES['all-good'](now), openRoute: 'alerts',
    permissions: { notificationsDenied: true } }),
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
      // 120 m away, one with no answer (coordinates, 「查不到地址」).
      geocoder: { names: [{ line: '330台灣桃園市桃園區大興西路二段105號' },
        { line: '330台灣桃園市桃園區同德六街76號', awayM: 120 }, null,
        { line: '330台灣桃園市桃園區中山路552號' }] } };
  },
  // Still at home (a few metres of wander since 06:30): 還沒出發, the range is
  // the whole day.
  'history-no-departure': now => {
    const phone = routePhone(legsPath(now, 180 * MINUTE, at(-40, -60), [{ stay: 120 }, { walk: 1, speed: 0.3 },
      { stay: 60 }]), now);
    return { ...FIXTURES['all-good'](now), phone, openRoute: 'history', history: historyPage(now) };
  },
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
  // H1 狗的歷史 (看軌跡 on 小黑's card): stays, a ride (坐車), moving now.
  'history-dog': now => ({ ...FIXTURES['all-good'](now), openRoute: 'history',
    history: historyPage(now, { slave: 6, ble: dogMorning(now) }), geocoder: { names: HISTORY_NAMES } }),
  // H2b: my route with the range bar open; the start dragged to the walk after
  // the first stay (出發（手動）), the end following now.
  'history-range-open': now => ({ ...FIXTURES['history-my-route'](now),
    historyView: { rangeOpen: true, manual: { start: now - 100 * MINUTE, end: null, following: true } } }),
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
  // without a fix): the house node 「室內・N 分」, unnumbered, no distance.
  'history-indoor': now => {
    const path = legsPath(now, 80 * MINUTE, at(10, 8), [{ walk: 22, bearing: 60, speed: 1.3 }, { stay: 13 },
      { inside: 25 }, { walk: 20, bearing: 200, speed: 1.3 }]);
    const ble = path.map(row => bleRow({ slave: 4, time: row.time, fix: row.fix,
      ...(row.fix ? {} : { rssi: -96, snr: -4 }) }));
    return { ...FIXTURES['all-good'](now), openRoute: 'history', history: historyPage(now, { slave: 4, ble }) };
  },
  // ---- history (055b): several dogs (H7) and 資料來源 ------------------
  // H7: 看軌跡 on 小黑's card, then 豆豆 and 阿福 added; 豆豆 leads (its
  // list, numbers and 「豆豆・移動 x km」), the others thin, faces at the cursor.
  'history-multi-dog': now => multiFixture(now, { dogs: [4, 8], protagonist: 4 }),
  // Four dogs: 「＋ 加入」 faded (最多同時 4 隻), the chips scroll sideways.
  'history-multi-four': now => multiFixture(now, { dogs: [4, 8, 5], protagonist: 4 }),
  // 小黑 and 狗 5, which has no record today: its chip at 40%, nothing drawn
  // for it, never the protagonist.
  'history-multi-no-data': now => multiFixture(now, { dogs: [5], fiveToday: false }),
  // The cursor at 08:40, inside 阿福's break: 阿福 waits at its last fix
  // before it (grey dashed ring), the others are where they were then.
  'history-multi-cursor': now => multiFixture(now, { dogs: [4, 8], protagonist: 6, cursorAgo: 50 * MINUTE }),
  // 「＋ 加入」's list open over 小黑's day (狗 5 has no record today).
  'history-multi-add': now => multiFixture(now, { dogs: [], fiveToday: false, sheet: 'add' }),
  // 資料來源's choices open (全部 chosen).
  'history-source-picker': now => multiFixture(now, { dogs: [4], protagonist: 4, sheet: 'source' }),
  // 資料來源：雲端 while 小黑 and 豆豆 only have this phone's rows: 「這天沒有
  // 小黑的紀錄」 with the row still at the foot.
  'history-source-empty': now => multiFixture(now, { dogs: [4], source: 'cloud' }),
  // 資料來源：這支手機收到的: 阿福's rows are the cloud's only, so it fades and
  // 豆豆 (this phone's) stays.
  'history-source-local': now => multiFixture(now, { dogs: [4, 8], protagonist: 8, source: 'local' }),
  // ---- history (056): the export (H9/H10) ---------------------------------
  // H9: my route like the mockup, the export window open (PNG used last).
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
  'map', 'history']);
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
export function buildFixture(name, now = FIXTURE_NOW, page = null) {
  const make = FIXTURES[name];
  if (!make) return null;
  nextId = 1;
  const { receiver, cloud, phone, ble = [], cloudRows = [], openDog = null, openPage = null, avatars = {},
    dismissed = {}, storageError = null, mapFailure = null, openRoute = null, permissions = {},
    upload = cloud?.ownerId ? uploading(now) : null, expired = false, dialog = null, alerts = null,
    alertsOpen = false, readFailure = null, deletion = null, launch = null, restoring = false,
    permissionsGuide = null, pairing = null, history = null, geocoder = null, historyView = null, historyCloud = null,
    historyExport = null,
    wifi = { ssids: ['家裡', '辦公室'], activeSsid: '家裡' } } = make(now);
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
    raw: { ble, cloud: cloudRows, history: history ? [...(history.ble || []), ...(history.cloudRows || [])] : [],
      today: phone?.today || [] },
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
    } : { running: false, status: '未記錄' },
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
    // 「今天 x km」: today's recorded route (myLocationTracker rows), summed
    // by the same code as the live one (useTodayRoute).
    todayRoute: (() => {
      const { count, metres, status } = todayRouteDistance(phone?.today || [], { now,
        recording: phone?.recording !== false });
      return { count, metres, status };
    })(),
    ride: rides.ride(now),
    dogAliases: ALIASES,
    // card-* states open this dog's card; dog-edit its page (A5) too.
    openDog,
    openPage,
    // Faces by collar number (useDogAvatars' avatars); the default otherwise.
    avatars,
    // CloudDatabase.dogCardRows over the fixture's rows (DogCardReadings).
    readCardRows: async (slaveId, since) => cardRows(ble, cloud?.ownerId ? cloudRows : [], slaveId, since),
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
    history: history && historyFixture(history, [...(history.phoneDays || []), ...(phone?.today || [])]),
    // The history screen opened as it was left (H2b: the range bar open, a
    // range already dragged; 054b: the calendar open, another day chosen).
    historyView,
    // The history's stand-in cloud (054b): { cloud, online, seed } or null.
    historyCloud,
    // The export (056): 'hang' (產生中 never ends), 'fail', 'fail-once'; else
    // the real exporter (files in this phone's cache, Android's share sheet).
    exporter: historyExport ? fixtureExporter(historyExport) : null,
    // Its places' names (053a): made-up answers, none, or this phone's
    // Geocoder; never this phone's address cache.
    addressLookup: fixtureAddressLookup(geocoder),
  };
}

// What the history screen reads for a history fixture: the query and
// historyDayRows / historyDays over the fixture's rows.
function historyFixture({ preferences, ble = [], cloudRows = [] }, today) {
  // myLocationTracker's columns as the CSV export reads them (made up).
  const phoneRows = today.map((point, index) => ({ id: index + 1, time: point.time, latitude: point.latitude,
    longitude: point.longitude, accuracy: point.accuracy ?? 6, location_at: point.time - 400,
    accuracy_meters: point.accuracy ?? 6, altitude_meters: 112, speed_kmh: 3.6, heading_degrees: 40,
    raw_latitude: point.latitude, raw_longitude: point.longitude, session_id: 'fixture-walk', raw_speed_kmh: 3.8,
    speed_accuracy_mps: 0.4, motion_state: 'moving', display_source: 'pipeline', display_location_at: point.time - 400 }));
  const readDay = async ({ subject, slaveId, start, end, source = 'all', owner = null, after = {} }) => {
    if (after.fixture) return { rows: [], seed: [], after };
    const since = start - HISTORY_DAY_CONTEXT_MS;
    const within = time => time >= since && time < end;
    if (subject === 'phone') {
      return { rows: phoneRows.filter(row => within(row.time)).map(phoneHistoryRow), seed: [], after: { fixture: true } };
    }
    const local = source === 'cloud' ? [] : ble.filter(row => row.slave_id === slaveId && within(row.received_at))
      .map(row => dogHistoryRow(row, 'local'));
    const cloud = source === 'local' || !owner ? [] : cloudRows
      .filter(row => row.slave_id === slaveId && within(timeOf(row))).map(row => dogHistoryRow(row, 'cloud'));
    return { rows: [...local, ...cloud], seed: [], after: { fixture: true } };
  };
  // The days holding rows (HistoryDatabase.historyDays): the date row's ‹ ›.
  const keyOf = time => {
    const date = new Date(time);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  const readDays = async ({ subject, slaveId, source = 'all', owner = null }) => {
    const times = subject === 'phone' ? phoneRows.map(row => row.time) : [
      ...(source === 'cloud' ? [] : ble.filter(row => row.slave_id === slaveId).map(row => row.received_at)),
      ...(source === 'local' || !owner ? [] : cloudRows.filter(row => row.slave_id === slaveId).map(timeOf)),
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
function cardRows(ble, cloud, slaveId, since) {
  const mine = (rows, time) => rows.filter(row => row.slave_id === slaveId)
    .map(row => ({ ...row, time: time(row) }));
  const activity = rows => rows.filter(row => row.time >= since && row.activity_valid === 1)
    .sort((left, right) => left.time - right.time)
    .map(row => ({ time: row.time, activity: row.activity, activity_valid: 1, activity_time: row.activity_time ?? null,
      master_id: row.master_id, slave_id: row.slave_id }));
  const newestBattery = (rows, source) => rows.filter(row => row.battery_valid === 1)
    .sort((left, right) => right.time - left.time).slice(0, 1)
    .map(row => ({ time: row.time, battery_percentage: row.battery_percentage, usb_present: row.usb_present, source }));
  const local = mine(ble, row => row.received_at);
  const remote = mine(cloud, timeOf);
  return { local: activity(local), cloud: activity(remote),
    battery: [...newestBattery(local, 'ble'), ...newestBattery(remote, 'cloud')] };
}

// The map's own preferences are the user's; a fixture shows every dog, none
// followed, so its screenshot does not depend on what this phone saved.
const FIXTURE_PREFERENCES = Object.freeze({ showMasterMarker: true, showSlaveMarker: true,
  noDataCardDismissed: false });

const ignoreWrite = () => Promise.resolve();

/**
 * Swaps a fixture's inputs into the live ones App hands the map. With no
 * fixture the live inputs come back untouched. The SQLite session itself keeps
 * running underneath; nothing a fixture shows can write to it.
 */
export function applyScreenFixture(fixture, live, edits = null) {
  if (!fixture) return live;
  const { tracking, phone, cloudSync, history } = live;
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
      historyLoaded: true,
      initialSnapshotReady: true,
      ready: { ...tracking.ready, real: true },
      errors: { ...tracking.errors, real: null },
      realWriteError: fixture.storageError,
      preferences: { ...tracking.preferences, ready: true, busy: false, error: null,
        value: { ...tracking.preferences.value, ...FIXTURE_PREFERENCES,
          alerts: edits?.alerts ?? fixture.alerts } },
      // A tap on a fixture's eye or follow button must not save the fixture's
      // dog ids into this phone's real preferences; a switch on S6 changes
      // the fixture's alerts in memory only (useFixtureEdits).
      saveTrackingPreferences: patch => {
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
    cloudSync: { ...cloudSync, ...fixture.cloudSync },
    // A history fixture asks its own stand-in cloud (054b), never Supabase.
    historyCloud: fixture.history ? fixture.historyCloud : live.historyCloud,
    history: history && {
      ...history, preferences: { ...history.preferences, ...fixture.history?.preferences, dogAliases: aliases },
      // A history fixture (054a) draws its own day, never this phone's.
      ...(fixture.history ? { readDay: fixture.history.readDay,
        readDays: fixture.history.readDays, loaded: true,
        busy: false, error: '', key: `fixture:${fixture.name}`, devices: [] } : {}),
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
