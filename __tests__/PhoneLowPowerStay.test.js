import { historyTimeline } from '../src/history/HistoryTimeline';
import { phoneHistoryRow } from '../src/history/HistoryRows';
import { todayRouteDistance } from '../src/tracking/TodayDistance';

// 2026-10-21 (user): after 3 minutes of a confirmed stop the recorder asks
// for low-power fixes (StationaryPowerMode, BALANCED about every 30 s) and
// saves each one that stays at the stop as a held row: the locked coordinate
// in latitude/longitude, the Wi-Fi fix's own raw position, accuracy and speed,
// motion_state stationary, provider play-fused-low. Movement switches back to
// high accuracy 1 s; the first fixes come a little after the real departure.
// These rows must give the same stay, departure and distance as the same day
// recorded at full rate, and no coarse fix may add distance or a move.
// Fictional rows near Taoyuan Station: no real place, route, time or dog.
const SECOND = 1000, MINUTE = 60 * SECOND;
const dayStart = new Date(2026, 0, 12).getTime();
const dayEnd = new Date(2026, 0, 13).getTime();
const ORIGIN = { latitude: 24.9893, longitude: 121.3135 };
const NORTH = 1 / 111195, EAST = 1 / 100777;
const SESSION = 'fiction-low-power-1';
// A walk away from a held stay starts from the last held row's own raw fix
// (HistoryMovement takes the raw fix of the last stationary row when it lies
// nearer): up to its 12 m offset more per departure, never from the stay itself.
const DEPARTURE_SLACK_M = 2 * 12 + 1;

let seed = 11;
const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

function row(time, north, east, extra = {}) {
  const latitude = ORIGIN.latitude + north * NORTH, longitude = ORIGIN.longitude + east * EAST;
  return { id: 0, time, latitude, longitude, raw_latitude: latitude, raw_longitude: longitude, accuracy: 4,
    speed_kmh: 0, raw_speed_kmh: 0, speed_accuracy_mps: 0.1, motion_state: 'stationary', session_id: SESSION,
    odometer_m: null, ...extra };
}

/**
 * A morning: at home `homeMin` minutes, walk 10 min north, stay `stayMin`
 * minutes, walk 10 min east. `low`: each stay after 3 min 20 s is held rows
 * about every 30 s, and each walk away is recorded from `delayS` after the
 * real departure. Returns the rows and the (second) stay's real start and end.
 */
function day({ low = false, homeMin = 60, stayMin = 90, delayS = 20, speed = true } = {}) {
  seed = 11;
  const out = [];
  let time = dayStart + 7 * 3600000, north = 0, east = 0, held = false;
  const walk = (seconds, dn, de) => {
    const skipS = held ? delayS : 0;
    for (let k = 0; k < seconds; k += 5, time += 5 * SECOND) {
      north += dn * 5; east += de * 5;
      if (k < skipS) continue;
      out.push(row(time, north, east, { speed_kmh: 4.7, raw_speed_kmh: 4.7, speed_accuracy_mps: 0.4,
        motion_state: 'moving' }));
    }
  };
  const stay = minutes => {
    const end = time + minutes * MINUTE, lowFrom = time + 200 * SECOND;
    let nextHeld = lowFrom;
    held = low && minutes * MINUTE > 200 * SECOND;
    for (; time < end; time += 5 * SECOND) {
      // Full rate: fine GPS rows a metre or two about the stop.
      if (!low || time < lowFrom) {
        out.push(row(time, north, east, { raw_latitude: ORIGIN.latitude + (north + (rand() - 0.5) * 3) * NORTH,
          raw_longitude: ORIGIN.longitude + (east + (rand() - 0.5) * 3) * EAST }));
        continue;
      }
      if (time < nextHeld) continue;
      // About every 30 s (25–35 s apart): a Wi-Fi fix of 15–28 m, up to 12 m
      // off. Fused Wi-Fi fixes on the user's phone measure 0 km/h ± 0.1–1.1
      // m/s (10/09); `speed: false` is the worst case, a fix without a speed.
      nextHeld = time + 25 * SECOND + 10 * SECOND * rand();
      const accuracy = 15 + 13 * rand(), angle = 2 * Math.PI * rand(), off = 12 * rand();
      const fix = row(time, north, east, { accuracy, provider: 'play-fused-low',
        ...(speed ? { raw_speed_kmh: 0, speed_kmh: 0, speed_accuracy_mps: 0.1 + rand() }
          : { raw_speed_kmh: null, speed_kmh: null, speed_accuracy_mps: null }) });
      fix.raw_latitude = ORIGIN.latitude + (north + off * Math.cos(angle)) * NORTH;
      fix.raw_longitude = ORIGIN.longitude + (east + off * Math.sin(angle)) * EAST;
      out.push(fix);
    }
  };
  stay(homeMin);
  walk(10 * 60, 1.3, 0);
  const stayStart = time;
  stay(stayMin);
  const stayEnd = time;
  walk(10 * 60, 0, 1.3);
  return { rows: out.map((r, i) => ({ ...r, id: i + 1 })), stayStart, stayEnd };
}

const timeline = rows => historyTimeline(rows.map(phoneHistoryRow), { subject: 'phone', dayStart, dayEnd });
const stops = model => model.nodes.filter(n => n.type === 'stop');

describe('a stay recorded in low-power mode (2026-10-21)', () => {
  test.each([
    ['significant motion: back to 1 s about 20 s after leaving', 20],
    ['no motion sensor: the next Wi-Fi fix outside the stop, about 90 s', 90],
  ])('%s: same stay and distance as at full rate', (_, delayS) => {
    const full = day();
    const low = day({ low: true, delayS });
    expect(low.rows.length).toBeLessThan(full.rows.length / 2);
    const before = timeline(full.rows), after = timeline(low.rows);
    expect(stops(after)).toHaveLength(stops(before).length);
    expect(stops(after)).toHaveLength(2);
    const [, a] = stops(after), [, b] = stops(before);
    expect(Math.abs(a.start - b.start)).toBeLessThanOrEqual(5 * SECOND);
    // The stay ends at the last held row: at most 30 s early.
    expect(b.end - a.end).toBeGreaterThanOrEqual(0);
    expect(b.end - a.end).toBeLessThanOrEqual(30 * SECOND);
    expect(after.nodes.filter(n => n.type === 'gap')).toHaveLength(0);
    // No metre from the coarse fixes inside the stay; the walks away keep
    // their length (the straight step across the delay and the start at the
    // last held fix are the only differences).
    expect(after.distanceM).toBeLessThanOrEqual(before.distanceM + DEPARTURE_SLACK_M);
    expect(after.distanceM).toBeGreaterThan(before.distanceM - 1.3 * (delayS + 30));
  });

  test.each([[10 * 60], [18 * 60]])('a %i-minute stay: held rows add no distance or move, and the pill agrees', stayMin => {
    // 18 h is longer than samePlaceGapMaxMs (16 h): held rows keep it one stay.
    const full = day({ stayMin }), low = day({ low: true, stayMin });
    const dayEndOf = rows => rows[rows.length - 1].time + 1;
    const model = historyTimeline(low.rows.map(phoneHistoryRow), { subject: 'phone', dayStart, dayEnd: dayEndOf(low.rows) });
    const base = historyTimeline(full.rows.map(phoneHistoryRow), { subject: 'phone', dayStart, dayEnd: dayEndOf(full.rows) });
    const [, stay] = stops(model);
    expect(stops(model)).toHaveLength(2);
    expect(stay.durationMs).toBeGreaterThan(stops(base)[1].durationMs - MINUTE);
    expect(model.nodes.filter(n => n.type === 'gap')).toHaveLength(0);
    expect(model.distanceM).toBeLessThanOrEqual(base.distanceM + DEPARTURE_SLACK_M);
    const held = low.rows.filter(r => r.provider === 'play-fused-low');
    expect(held.length).toBeGreaterThan(stayMin);
    // The held rows alone: nothing at all.
    expect(historyTimeline(held.map(phoneHistoryRow), { subject: 'phone', dayStart, dayEnd: dayEndOf(held) }).distanceM).toBe(0);
    const pill = rows => todayRouteDistance(rows, { now: rows[rows.length - 1].time, dayStart: rows[0].time - 1,
      recording: false }).metres;
    expect(Math.abs(pill(low.rows) - pill(full.rows))).toBeLessThanOrEqual(DEPARTURE_SLACK_M);
    expect(pill(held)).toBe(0);
  });

  test('worst case, fixes without a speed: the same stays, no distance from them', () => {
    const full = day(), low = day({ low: true, speed: false, delayS: 20 });
    const before = timeline(full.rows), after = timeline(low.rows);
    expect(stops(after)).toHaveLength(2);
    expect(after.distanceM).toBeLessThanOrEqual(before.distanceM + DEPARTURE_SLACK_M);
    // The stay may end up to about a minute and a half early, never later.
    const [, a] = stops(after), [, b] = stops(before);
    expect(b.end - a.end).toBeGreaterThanOrEqual(0);
    expect(b.end - a.end).toBeLessThanOrEqual(90 * SECOND);
  });
});
