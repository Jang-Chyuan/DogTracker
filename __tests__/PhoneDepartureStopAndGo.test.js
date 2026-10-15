import { phoneHistoryRow } from '../src/history/HistoryRows';
import { historyTimeline } from '../src/history/HistoryTimeline';
import { endOfDay, startOfToday } from '../src/tracking/TodayDistance';

// 2026-10-15 (#200 出發偵測): the departure of my route on two kinds of day
// the user reported. A dog walk is stop-and-go (the dog sniffs for a minute,
// walks on, stops again): the walk's minute-three and minute-eight checks
// fell on a stop, where the phone measures itself standing still, and a
// walk from home was found late or not at all (10/11). A lift ride at home
// (coarse, fast Wi-Fi fixes 20–60 m from the flat for two minutes, then
// still again 35 m off) passed the minute-three check and showed a
// confirming departure for five minutes (10/14 13:38). All fixes are
// invented, near a made-up point by Taoyuan Station; no real place, time or
// person.

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const DAY = startOfToday(new Date(2026, 9, 15, 12, 0).getTime());
const DAY_END = endOfDay(DAY);
const ORIGIN = { latitude: 24.989, longitude: 121.313 };
const place = (north, east) => ({ latitude: ORIGIN.latitude + north / 111195,
  longitude: ORIGIN.longitude + east / (111195 * Math.cos(ORIGIN.latitude * Math.PI / 180)) });

function recorder(start) {
  const rows = [];
  let time = start, north = 0, east = 0;
  const push = (fix, { accuracy, kmh, spread, state, pinned = null }) => rows.push({ time,
    ...(pinned ?? fix), accuracy, raw_latitude: fix.latitude, raw_longitude: fix.longitude,
    raw_speed_kmh: kmh, speed_kmh: kmh, speed_accuracy_mps: spread, motion_state: state,
    session_id: 'fiction-departure' });
  return {
    rows,
    get time() { return time; },
    // Standing still: the raw fix wobbles a little, the speed says 0.
    still(seconds, accuracy = 8) {
      const anchor = place(north, east);
      for (let s = 0; s < seconds; s += 5, time += 5 * SECOND) {
        const wobble = ((s / 5) % 3) - 1;
        push(place(north + wobble * 0.3, east - wobble * 0.2), { accuracy, kmh: 0.2, spread: 0.3, state: 'stationary', pinned: anchor });
      }
    },
    // On foot along `heading` (degrees from north) at `speed` m/s.
    walk(seconds, speed = 1.2, heading = 0, accuracy = 5) {
      const rad = heading * Math.PI / 180;
      for (let s = 0; s < seconds; s += 5, time += 5 * SECOND) {
        north += speed * 5 * Math.cos(rad); east += speed * 5 * Math.sin(rad);
        push(place(north, east), { accuracy, kmh: speed * 3.6, spread: 0.4, state: 'moving' });
      }
    },
    // A lift: coarse fixes about the building, `seconds` apart, never
    // walking: [seconds, north, east, accuracy, km/h, speed accuracy, state].
    lift(fixes) {
      for (const [seconds, n, e, accuracy, kmh, spread, state] of fixes) {
        time += seconds * SECOND;
        push(place(north + n, east + e), { accuracy, kmh, spread, state });
      }
    },
    move(n, e) { north += n; east += e; },
  };
}

const model = (rows, extra = {}) => historyTimeline(rows.map((row, i) => phoneHistoryRow({ id: i + 1, ...row })),
  { subject: 'phone', dayStart: DAY, dayEnd: DAY_END, ...extra });

describe('a stop-and-go dog walk from home departs where the walk began', () => {
  const LEAVE = DAY + 8 * 60 * MINUTE;
  // At home until 08:00, then 25 minutes of a dog walk: short walks, and
  // stops of one to two minutes where the dog sniffs (seconds, in turn).
  const SNIFFING = [[45, 95], [30, 80], [50, 100], [35, 110], [60, 70], [40, 90]];
  const walkDay = ({ pattern = SNIFFING, accuracy = 5 } = {}) => {
    const day = recorder(DAY + 7 * 60 * MINUTE);
    day.still(60 * 60);
    let heading = 20;
    for (let i = 0; day.time < LEAVE + 25 * MINUTE; i += 1) {
      const [walkSeconds, sniffSeconds] = pattern[i % pattern.length];
      day.walk(walkSeconds, 1.2, heading, accuracy);
      day.still(sniffSeconds, accuracy);
      heading += 25;
    }
    day.still(10 * 60, accuracy);
    return day.rows;
  };

  test('the whole day: the range starts when the walk left home', () => {
    const departure = model(walkDay()).departure;
    expect(departure.status).toBe('confirmed');
    expect(departure.automaticRange.start).toBeGreaterThanOrEqual(LEAVE - 60 * SECOND);
    expect(departure.automaticRange.start).toBeLessThanOrEqual(LEAVE + 5 * SECOND);
  });

  // Forty invented dogs: walks of 20–60 s, sniffing 60–150 s. Before, six of
  // them departed 2–3 minutes after the walk left home (its first steps lost).
  test('any rhythm of walking and sniffing departs within a minute of leaving', () => {
    const late = [];
    for (let seed = 1; seed < 40; seed += 1) {
      let x = seed;
      const r = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
      const pattern = Array.from({ length: 12 }, () => [Math.round(20 + r() * 40), Math.round(60 + r() * 90)]);
      const { status, automaticRange: { start } } = model(walkDay({ pattern })).departure;
      if (status !== 'confirmed' || start < LEAVE - 60 * SECOND || start > LEAVE + 5 * SECOND) {
        late.push(`${seed}: ${status} ${(start - LEAVE) / SECOND} s`);
      }
    }
    expect(late).toEqual([]);
  });

  test('today: confirming from three and a half minutes on, confirmed at eight', () => {
    const rows = walkDay();
    const at = minutes => {
      const now = LEAVE + minutes * MINUTE;
      return model(rows.filter(row => row.time <= now), { today: true, now }).departure;
    };
    expect(at(-0.5).status).toBe('not-departed');
    expect(at(4).status).toBe('confirming');
    expect(at(4).automaticRange.start).toBeGreaterThanOrEqual(LEAVE - 90 * SECOND);
    expect(at(4).automaticRange.start).toBeLessThanOrEqual(LEAVE + 5 * SECOND);
    const confirmed = at(9);
    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.automaticRange.start).toBeLessThanOrEqual(LEAVE + 5 * SECOND);
  });

  test('a walk in poor GPS (25 m fixes) still departs', () => {
    const departure = model(walkDay({ pattern: [[60, 40], [50, 60]], accuracy: 25 })).departure;
    expect(departure.status).toBe('confirmed');
    expect(departure.automaticRange.start).toBeLessThanOrEqual(LEAVE + 5 * SECOND);
  });

  test('standing near home for minutes is no departure', () => {
    const day = recorder(DAY + 7 * 60 * MINUTE);
    day.still(60 * 60);
    day.walk(30, 1.2, 90);
    day.still(15 * 60);
    expect(model(day.rows).departure.status).toBe('undetermined');
  });
});

describe('a lift ride at home is no departure, not even for a moment', () => {
  const LIFT = DAY + 13 * 60 * MINUTE;
  const liftDay = () => {
    const day = recorder(DAY + 12 * 60 * MINUTE);
    day.still(60 * 60);
    // Fast coarse fixes 20–60 m away, then none for 100 s (in the shaft),
    // then a few slow ones on the way back to the flat: the minute-three fix
    // of the first is about 65 m from it, each within 25–30 m.
    day.lift([[5, 25, 5, 27, 15, 2.3, 'moving'], [1, 28, 6, 28, 12, 2.6, 'moving'], [5, 20, 10, 29, 11, 2, 'moving'],
      [37, 55, 20, 30, 5, 1.3, 'unknown'], [5, 53, 19, 26, 4, 1.1, 'unknown'], [6, 51, 18, 26, 5, 1.2, 'unknown'],
      [5, 49, 17, 27, 6, 1.5, 'unknown'], [6, 45, 15, 29, 5, 1.4, 'unknown'],
      [7, 38, 12, 37, 26, 2, 'moving'], [2, 30, 10, 42, 28, 2.5, 'moving'], [6, 40, 25, 47, 35, 3.3, 'moving'],
      [2, 50, 30, 40, 29, 3.7, 'moving'], [7, 25, 15, 23, 5, 1.2, 'unknown'], [6, 15, 10, 28, 18, 2.8, 'moving'],
      [6, 8, 6, 23, 8, 2, 'unknown'], [6, 5, 4, 30, 4, 1.5, 'unknown'],
      [101, -10, 35, 28, 4.5, 1.3, 'unknown'], [6, -12, 33, 28, 2.6, 0.8, 'moving'], [5, -14, 31, 24, 2.7, 0.7, 'moving'],
      [5, -15, 30, 23, 3.1, 0.8, 'moving']]);
    day.move(-16, 30);
    day.still(30 * 60, 14);
    return day.rows;
  };

  test('today, every 15 s through it: never departing, the range stays the whole day', () => {
    const rows = liftDay();
    const seen = [];
    for (let now = LIFT; now <= LIFT + 20 * MINUTE; now += 15 * SECOND) {
      const departure = model(rows.filter(row => row.time <= now), { today: true, now }).departure;
      if (departure.status !== 'not-departed') seen.push(`${(now - LIFT) / SECOND}s ${departure.status}`);
    }
    expect(seen).toEqual([]);
  });

  test('the whole day stays undetermined', () => {
    expect(model(liftDay()).departure.status).toBe('undetermined');
  });
});
