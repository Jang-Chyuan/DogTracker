import { phoneHistoryRow } from '../src/history/HistoryRows';
import { historyTimeline } from '../src/history/HistoryTimeline';
import { timelinePresentation } from '../src/history/HistoryTimelinePresentation';
import { nodePill, placeSpeech } from '../src/history/HistoryText';
import { cursorLabel } from '../src/history/screen/HistoryScreenCursor';
import { buildExportSnapshot, exportTimelineRows } from '../src/mapHistory/ExportSnapshot';
import { buildGPX } from '../src/mapHistory/ExportGPX';
import { todayRouteDistance } from '../src/tracking/TodayDistance';
import { listedMetres, timelineClockMismatches } from '../test-support/TimelineClocks';

// 2026-10-15 (user, #200 停留中真的移動的距離, option D + C): a stay's own
// moves are on its own row — 「停 N 分・45 m」 — never on a walk minutes or
// hours later; a long stay with much real movement in it (a dog walked round
// one small place, stopping and going: 10/11 16:21–18:10, 210 m over 16
// minutes of 109) is 「在附近走動 1 時 49 分・210 m」. A walk row counts its
// own stretch. Invented rows near a made-up point by Taoyuan Station.
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const dayStart = new Date(2026, 0, 20).getTime();
const dayEnd = new Date(2026, 0, 21).getTime();
const ORIGIN = { latitude: 24.9893, longitude: 121.3135 };
const at = (north, east) => ({ latitude: ORIGIN.latitude + north / 111195,
  longitude: ORIGIN.longitude + east / (111195 * Math.cos(ORIGIN.latitude * Math.PI / 180)) });

/**
 * [kind, seconds, extra]: still — standing (pinned, 0.2 km/h); walk — on
 * foot east at 4 km/h on 4 m fixes (`step` m each 5 s); round — `laps`
 * times: on foot round a 10 m circle for 20 s, then still for `pause` s.
 */
function day(script) {
  const out = [];
  let time = dayStart + 8 * 60 * MINUTE, north = 0, east = 0;
  const push = (n, e, kmh, state) => out.push({ id: out.length + 1, time, ...at(n, e),
    raw_latitude: at(n, e).latitude, raw_longitude: at(n, e).longitude, accuracy: 4,
    raw_speed_kmh: kmh, speed_kmh: kmh, speed_accuracy_mps: 0.3, motion_state: state, session_id: 'fiction-wander' });
  const still = seconds => { for (let s = 0; s < seconds; s += 5, time += 5 * SECOND) push(north, east, 0.2, 'stationary'); };
  for (const [kind, seconds, extra = {}] of script) {
    if (kind === 'still') still(seconds);
    if (kind === 'walk') {
      for (let s = 0; s < seconds; s += 5) { time += 5 * SECOND; east += extra.step ?? 6; push(north, east, 4.3, 'moving'); }
    }
    if (kind === 'round') {
      for (let lap = 0; lap < extra.laps; lap += 1) {
        for (let k = 1; k <= 4; k += 1) {
          time += 5 * SECOND;
          const angle = (lap * 4 + k) * Math.PI / 2;
          push(north + 6 * Math.sin(angle), east + 6 * Math.cos(angle) - 6, 4.3, 'moving');
        }
        still(extra.pause ?? 40);
      }
    }
  }
  return out.map(phoneHistoryRow);
}
const timeline = rows => historyTimeline(rows, { subject: 'phone', dayStart, dayEnd,
  range: { start: rows[0].time, end: rows.at(-1).time } });
const stayRows = model => timelinePresentation(model.nodes).map(n => n.terminalStay ?? n.departureStay ?? n)
  .filter(n => n.type === 'stop');
const foot = n => n.type === 'movement' && n.mode === 'walking';

describe('a walk round one place', () => {
  // Walk 5 min there, 20 min round a small park (20 s on foot, 40 s still,
  // 20 times), stand 10 min, walk 5 min away.
  const rows = day([['walk', 300], ['still', 120], ['round', 0, { laps: 20 }], ['still', 600], ['walk', 300]]);
  const model = timeline(rows);
  const wander = stayRows(model).find(n => n.wandering);

  test('is 「在附近走動」 with its own metres on its row', () => {
    expect(wander).toBeDefined();
    expect(wander.countedDistanceM).toBeGreaterThanOrEqual(100);
    expect(nodePill(wander).text).toMatch(/^在附近走動 .+・\d+ m$/u);
    // The walks beside it keep their own stretch (5 min at 4 km/h ≈ 360 m).
    const walks = timelinePresentation(model.nodes).filter(foot);
    expect(walks.every(w => w.countedDistanceM < 400)).toBe(true);
  });

  test('the rows add up to the summary and 「今天 x km」; the clocks add up', () => {
    expect(listedMetres(model.nodes)).toBeCloseTo(model.distanceM, 6);
    const now = rows.at(-1).time + SECOND;
    expect(todayRouteDistance(rows, { now, dayStart }).metres).toBeCloseTo(
      historyTimeline(rows, { subject: 'phone', dayStart, dayEnd, today: true, now }).distanceM, 6);
    expect(timelineClockMismatches(model.nodes)).toEqual([]);
  });

  test('the cursor, TalkBack, the PNG list and GPX say the same', () => {
    const inside = rows.find(r => r.time > wander.start + 5 * MINUTE).time;
    expect(cursorLabel(model, inside, 'phone')[1]).toMatch(/^在附近走動/u);
    expect(placeSpeech(wander, '某地')).toMatch(/^在附近走動/u);
    expect(placeSpeech(wander, '某地')).toMatch(/公尺/u);
    const png = exportTimelineRows(model.nodes, () => null);
    expect(png.some(row => row.pill?.text?.startsWith('在附近走動'))).toBe(true);
    const snapshot = buildExportSnapshot({ day: { subjects: [{ id: 'phone', model }] },
      range: { start: rows[0].time, end: rows.at(-1).time }, subject: 'phone' });
    expect(buildGPX(snapshot)).toMatch(/<name>在附近走動/u);
  });
});

describe('a few moves inside an ordinary stay', () => {
  // Walk there, a stay of an hour with two short walks round the room 20
  // minutes in, then walk away.
  const rows = day([['walk', 300], ['still', 1200], ['round', 0, { laps: 2, pause: 30 }], ['still', 2400],
    ['walk', 300]]);
  const model = timeline(rows);

  test('stay a stay, the metres on it: 「停 N 分・M m」, not on the walk an hour later', () => {
    const [stay] = stayRows(model).filter(n => n.countedDistanceM > 0);
    expect(stay.wandering).toBeFalsy();
    expect(nodePill(stay).text).toMatch(/^停 .+・\d+ m$/u);
    const walks = timelinePresentation(model.nodes).filter(foot);
    expect(walks.at(-1).countedDistanceM).toBeLessThan(400);
    expect(listedMetres(model.nodes)).toBeCloseTo(model.distanceM, 6);
  });

  test('a stay that did not move reads as ever', () => {
    const plain = timeline(day([['walk', 300], ['still', 1200], ['walk', 300]]));
    for (const stay of stayRows(plain)) expect(nodePill(stay).text).not.toMatch(/・/u);
  });
});
