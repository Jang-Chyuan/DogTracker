import { phoneHistoryRow } from '../src/history/HistoryRows';
import { historyTimeline } from '../src/history/HistoryTimeline';
import { timelinePresentation } from '../src/history/HistoryTimelinePresentation';
import { historyMapPresentation } from '../src/history/screen/HistoryMapModel';
import { endOfDay, startOfToday } from '../src/tracking/TodayDistance';
import { timelineMismatches } from '../test-support/TimelineClocks';

// 2026-10-15 (audit): the user's real days, replayed locally only as if they
// were being recorded and the history open (a checkpoint every 10 minutes),
// found two shapes whose times did not add up that no whole-day test sees.
// This sweep runs the list's rules at every 10 minutes of fictional days
// instead: the rows tile and cover the range, moments span no time, the
// rows' metres are the summary, the numbers run from 1 and the map draws
// the same ones. Fictional fixes near an invented point by Taoyuan Station;
// no real place, time or person.

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
 * A recorded day as myLocationTracker holds it: standing still, the
 * pipeline's coordinates stay on the anchor while the raw fix wanders (now
 * and then a burst of coarse fast fixes: a lift); walks; drives with red
 * lights; breaks in the recording, some across a new session, one of them
 * over half an hour that ends 20 s before a checkpoint (恢復記錄 then the
 * live end).
 */
function recordedDay(seed) {
  const r = random(seed);
  const rows = [];
  let time = DAY + 7 * 60 * MINUTE, north = 0, east = 0, session = 1;
  const push = (raw, pipeline, accuracy, kmh, spread, state) => rows.push({ time, ...pipeline,
    accuracy, raw_latitude: raw.latitude, raw_longitude: raw.longitude, raw_speed_kmh: kmh, speed_kmh: kmh,
    speed_accuracy_mps: spread, motion_state: state, session_id: `fiction-${seed}-${session}` });
  const still = seconds => {
    const anchor = place(north, east);
    for (let s = 0; s < seconds; s += 5, time += 5 * SECOND) {
      const burst = r() < 0.02, drift = burst ? 20 + r() * 20 : 2 + r() * 10, angle = r() * 2 * Math.PI;
      push(place(north + drift * Math.cos(angle), east + drift * Math.sin(angle)), anchor,
        burst ? 25 + r() * 20 : 5 + r() * 12, burst ? 6 + r() * 20 : r(), burst ? 1.5 : 0.4, burst ? 'moving' : 'stationary');
    }
  };
  const travel = (seconds, speed, red = false) => {
    const heading = r() * 2 * Math.PI;
    for (let s = 0; s < seconds; s += 5, time += 5 * SECOND) {
      const stopped = red && s % 120 >= 90;
      const step = stopped ? 0 : speed * (0.8 + r() * 0.4) * 5;
      north += step * Math.cos(heading); east += step * Math.sin(heading);
      const fix = place(north + (r() - 0.5) * 3, east + (r() - 0.5) * 3);
      push(fix, fix, 3 + r() * 6, (step / 5) * 3.6, 0.3, stopped ? 'stationary' : 'moving');
    }
  };
  const pause = (minutes, newSession) => { time += minutes * MINUTE; if (newSession) session += 1; };
  for (let leg = 0; leg < 14; leg += 1) {
    const kind = r();
    still(Math.round((4 + r() * 30) * 60));
    if (kind < 0.55) travel(Math.round((2 + r() * 15) * 60), 1 + r() * 0.6);
    else if (kind < 0.8) travel(Math.round((5 + r() * 15) * 60), 8 + r() * 6, true);
    else pause(1 + r() * 20, r() < 0.5);
  }
  // Away for 45 minutes; back 20 s before the next 10-minute mark.
  const mark = Math.ceil((time + 45 * MINUTE) / (10 * MINUTE)) * 10 * MINUTE;
  time = mark - 20 * SECOND;
  session += 1;
  still(10 * 60);
  return rows.map((row, index) => phoneHistoryRow({ id: index + 1, ...row }));
}

const foot = row => row.type === 'movement' && (row.mode === 'walking' || row.mode === 'moving');

describe('the list adds up at every 10 minutes of a recorded day', () => {
  test.each([1, 2, 3, 4])('fictional day %i', seed => {
    const rows = recordedDay(seed);
    const dayEnd = endOfDay(DAY);
    const problems = [];
    let checked = 0;
    for (let t = DAY + 7 * 60 * MINUTE; t <= rows.at(-1).time + 10 * MINUTE; t += 10 * MINUTE) {
      const shown = rows.filter(row => row.time <= t);
      if (shown.length < 2) continue;
      const model = historyTimeline(shown, { subject: 'phone', dayStart: DAY, dayEnd, today: true, now: t });
      const listed = timelinePresentation(model.nodes);
      const at = new Date(t).toTimeString().slice(0, 5);
      for (const mismatch of timelineMismatches(model)) problems.push(`${at} ${mismatch.kind} ${mismatch.type ?? ''}`);
      const metres = listed.filter(foot).reduce((sum, row) => sum + row.countedDistanceM, 0);
      if (Math.abs(metres - model.distanceM) > 1e-6) problems.push(`${at} rows ${metres} m, summary ${model.distanceM} m`);
      const numbers = listed.filter(row => row.number != null).map(row => row.number);
      if (numbers.some((number, i) => number !== i + 1)) problems.push(`${at} numbers ${numbers}`);
      const map = historyMapPresentation(model, { color: '#1A73E8', subject: 'phone' });
      const drawn = map.places.filter(p => p.kind === 'number').flatMap(p => (p.group || [p]).map(q => q.number))
        .sort((a, b) => a - b);
      if (drawn.join() !== [...numbers].sort((a, b) => a - b).join()) problems.push(`${at} map [${drawn}] list [${numbers}]`);
      checked += 1;
    }
    expect(problems).toEqual([]);
    expect(checked).toBeGreaterThan(40);
  });
});
