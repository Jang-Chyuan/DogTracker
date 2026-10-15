import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createHistoryDatabase, PHONE_MODEL_COLUMNS } from '../src/mapHistory/HistoryDatabase';
import { createTodayRouteEngine } from '../src/tracking/TodayRouteEngine';
import { historyTimeline } from '../src/history/HistoryTimeline';
import { endOfDay, startOfToday } from '../src/tracking/TodayDistance';

// 2026-10-15 (audit of the user's real days, read locally only): 「今天 x km」
// and the history summary disagreed at a fifth of the 10-minute checkpoints,
// by up to 100 m. phoneRouteSince did not read raw_latitude / raw_longitude,
// so the pill's PhoneMotion ran on the pipeline's coordinates, which the
// recorder holds on the anchor while the phone stands still, and the history
// ran it on the raw fixes. Both now read PHONE_MODEL_COLUMNS. A fictional day
// near an invented point by Taoyuan Station; no real place, time or person.

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const DAY = startOfToday(new Date(2026, 9, 15, 12, 0).getTime());
const ORIGIN = { latitude: 24.989, longitude: 121.313 };
const place = (north, east) => ({ latitude: ORIGIN.latitude + north / 111195,
  longitude: ORIGIN.longitude + east / (111195 * Math.cos(ORIGIN.latitude * Math.PI / 180)) });

function random(seed) {
  let x = seed % 2 ** 32;
  return () => {
    x = (x * 1664525 + 1013904223) % 2 ** 32;
    return x / 2 ** 32;
  };
}

/**
 * myLocationTracker rows as the Android recorder writes them: standing
 * still, `latitude`/`longitude` stay on the anchor while the raw fix wanders
 * a few to 30 m on Wi-Fi-like accuracy (and now and then a burst of coarse
 * fixes with a walking speed, a lift or the stairs); walking, the two agree.
 */
function recordedDay(seed) {
  const r = random(seed);
  const rows = [];
  let time = DAY + 6 * 60 * MINUTE, north = 0, east = 0, odometer = 0, id = 0;
  const push = (raw, pipeline, { accuracy, kmh, spread, state }) => {
    rows.push({ id: ++id, recorded_at: time, location_at: time, ...pipeline, accuracy_meters: accuracy,
      speed_kmh: kmh, raw_latitude: raw.latitude, raw_longitude: raw.longitude, raw_speed_kmh: kmh,
      speed_accuracy_mps: spread, motion_state: state, session_id: 'fiction-day', odometer_m: odometer });
  };
  for (let leg = 0; leg < 24; leg += 1) {
    const still = leg % 2 === 0;
    const seconds = Math.round((still ? 6 + r() * 30 : 3 + r() * 12) * 60);
    const anchor = place(north, east);
    const heading = r() * 2 * Math.PI;
    for (let s = 0; s < seconds; s += 5) {
      if (still) {
        const burst = r() < 0.03;
        const drift = burst ? 20 + r() * 25 : 2 + r() * 12;
        const angle = r() * 2 * Math.PI;
        const raw = place(north + drift * Math.cos(angle), east + drift * Math.sin(angle));
        push(raw, anchor, { accuracy: burst ? 25 + r() * 20 : 6 + r() * 14, kmh: burst ? 4 + r() * 20 : r() * 1.2,
          spread: burst ? 1.5 : 0.3 + r() * 0.4, state: burst ? 'moving' : 'stationary' });
      } else {
        const step = (0.9 + r() * 0.6) * 5;
        north += step * Math.cos(heading); east += step * Math.sin(heading);
        odometer += step;
        const fix = place(north + (r() - 0.5) * 3, east + (r() - 0.5) * 3);
        push(fix, fix, { accuracy: 3 + r() * 6, kmh: (step / 5) * 3.6, spread: 0.2 + r() * 0.3, state: 'moving' });
      }
      time += 5 * SECOND;
    }
  }
  return rows;
}

function recorder(rows) {
  const connection = createMemoryConnection();
  connection.sqlite.exec(`CREATE TABLE myLocationTracker(id INTEGER PRIMARY KEY AUTOINCREMENT,
    recorded_at INTEGER NOT NULL, location_at INTEGER NOT NULL, latitude REAL NOT NULL, longitude REAL NOT NULL,
    accuracy_meters REAL, altitude_meters REAL, speed_kmh REAL, heading_degrees REAL, raw_latitude REAL,
    raw_longitude REAL, session_id TEXT, raw_speed_kmh REAL, speed_accuracy_mps REAL, motion_state TEXT,
    display_latitude REAL, display_longitude REAL, display_source TEXT, display_location_at INTEGER,
    provider TEXT, odometer_m REAL)`);
  const insert = connection.sqlite.prepare(`INSERT INTO myLocationTracker(id, recorded_at, location_at, latitude,
    longitude, accuracy_meters, speed_kmh, raw_latitude, raw_longitude, raw_speed_kmh, speed_accuracy_mps,
    motion_state, session_id, odometer_m) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const row of rows) insert.run(row.id, row.recorded_at, row.location_at, row.latitude, row.longitude,
    row.accuracy_meters, row.speed_kmh, row.raw_latitude, row.raw_longitude, row.raw_speed_kmh,
    row.speed_accuracy_mps, row.motion_state, row.session_id, row.odometer_m);
  return { connection, database: createHistoryDatabase(connection) };
}

describe('「今天 x km」 reads the same columns as the history (PHONE_MODEL_COLUMNS)', () => {
  test('phoneRouteSince and historyDayRows hand the model the same columns', async () => {
    const { connection, database } = recorder(recordedDay(1).slice(0, 3));
    const [route] = await database.phoneRouteSince(DAY);
    const { rows: [day] } = await database.historyDayRows({ subject: 'phone', start: DAY, end: endOfDay(DAY) });
    for (const name of PHONE_MODEL_COLUMNS) {
      expect(route).toHaveProperty(name);
      expect(route[name]).toEqual(day[name]);
    }
    // The raw fix differs from the pipeline's held one: that is the point.
    expect(route.raw_latitude).not.toBe(route.latitude);
    connection.close();
  });

  test.each([1, 2, 3])('at every 10 minutes the pill is the summary (fictional day %i)', async seed => {
    const { connection, database } = recorder(recordedDay(seed));
    // As useTodayRoute reads it: pages after the (time, id) cursor.
    const route = [];
    for (let cursor = null; ;) {
      const page = await database.phoneRouteSince(DAY, cursor, 500);
      route.push(...page);
      if (page.length < 500) break;
      cursor = { time: page.at(-1).time, id: page.at(-1).id };
    }
    const { rows } = await database.historyDayRows({ subject: 'phone', start: DAY, end: endOfDay(DAY) });
    connection.close();
    expect(route).toHaveLength(rows.length);
    const engine = createTodayRouteEngine({ dayStart: DAY });
    let fed = 0, checked = 0, moved = 0;
    const last = route.at(-1).time;
    for (let t = DAY + 6 * 60 * MINUTE; t <= last + 15 * SECOND; t += 15 * SECOND) {
      const batch = [];
      while (fed < route.length && route[fed].time <= t) batch.push(route[fed++]);
      if (batch.length) expect(engine.add(batch)).toBe(true);
      if ((t - DAY) % (10 * MINUTE)) continue;
      const shown = rows.filter(row => row.time <= t);
      if (shown.length < 2) continue;
      const history = historyTimeline(shown, { subject: 'phone', dayStart: DAY, dayEnd: endOfDay(DAY), today: true, now: t });
      expect(engine.sum(t).metres).toBeCloseTo(history.distanceM, 6);
      checked += 1;
      moved = history.distanceM;
    }
    expect(checked).toBeGreaterThan(30);
    expect(moved).toBeGreaterThan(500);
  });
});
