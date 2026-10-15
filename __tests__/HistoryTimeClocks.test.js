// 2026-10-14 (#163, the user asked for it): the list's times add up. For
// every row: its start clock + its shown minutes (+ a stay's 「不含中斷 N
// 分」) = the next row's start clock, which is also the small departure time
// beside a stay's leave chevron. Same HH:mm rounding as the list. Fixtures
// and invented days only (the real days were checked by hand, read-only).
import { buildFixture, FIXTURE_NAMES } from '../src/dev/ScreenFixtures';
import { historyTargetOf } from '../src/mapHistory/useHistoryScreen';
import { historyTimeline } from '../src/history/HistoryTimeline';
import { timelinePresentation, presentationDurationMs } from '../src/history/HistoryTimelinePresentation';
import { departureClocks, timelineClockMismatches, timelineMismatches } from '../test-support/TimelineClocks';

const MINUTE = 60000;
const startOfDay = time => { const d = new Date(time); d.setHours(0, 0, 0, 0); return d.getTime(); };

// Every history fixture (my route and the dogs), today's range and the whole day.
const historyFixtures = FIXTURE_NAMES.filter(name => name.startsWith('history-'));
test.each(historyFixtures)('%s: every row\'s clock + minutes is the next row\'s clock', async name => {
  const fixture = buildFixture(name);
  if (!fixture.history?.readDay || !fixture.history.preferences) return;
  const target = historyTargetOf(fixture.history.preferences);
  const today = startOfDay(fixture.now);
  const answer = await fixture.history.readDay({ subject: target.subject, slaveId: target.slaveId, start: today,
    end: today + 86400000 - 1, source: 'all', owner: fixture.cloudSync?.ownerId });
  const rows = answer?.rows || [];
  if (!rows.length) return;
  for (const manual of [false, true]) {
    const inDay = rows.filter(r => r.time >= today && r.time < today + 86400000);
    const model = historyTimeline(rows, { subject: target.subject, dayStart: today, dayEnd: today + 86400000,
      today: true, now: fixture.now, ...(manual && inDay.length ? { manualRange: { start: inDay[0].time, end: inDay.at(-1).time } } : {}) });
    expect(timelineMismatches(model)).toEqual([]);
    for (const clocks of departureClocks(model.nodes)) expect(clocks.stay).toBe(clocks.next);
  }
});

// The rounding the rows use: a stay interrupted inside (「不含中斷 N 分」)
// shows its clocks less the interruption it notes, never one minute off.
test.each([
  [59000, 20 * MINUTE, 5 * MINUTE + 29000],
  [30000, 20 * MINUTE + 10000, 5 * MINUTE + 40000],
  [0, 61 * MINUTE + 59000, 30 * MINUTE + 30000],
])('an interrupted stay %s–%s (break %s) adds up', (start, end, breakMs) => {
  const stay = { type: 'stop', number: 1, start, end, durationMs: end - start - breakMs, interruptionMs: breakMs,
    gaps: [{ start: start + 1000, end: start + 1000 + breakMs }], latitude: 24.9892, longitude: 121.3138 };
  const walk = { type: 'movement', mode: 'walking', start: end, end: end + 5 * MINUTE, durationMs: 5 * MINUTE,
    distanceM: 300, countedDistanceM: 300 };
  expect(timelineClockMismatches([stay, walk])).toEqual([]);
  const [shown] = timelinePresentation([stay, walk]);
  // Shown minutes stay the observed time within the clocks' rounding (never the gap's).
  expect(Math.abs(presentationDurationMs(shown) - stay.durationMs)).toBeLessThan(2 * MINUTE);
});

// An invented 10/13-like phone day with every shape the list folds: a long
// home stay, a short same-session break inside a stay, a short break between
// rows, a walk out and back to one place (an excursion), a drive with a jam.
function day(script, from) {
  const rows = [];
  let s = 0, east = 0;
  const fix = extra => rows.push({ time: from + s * 1000, latitude: 24.9892, longitude: 121.3138 + east / 101000,
    accuracy: 4, raw_speed_kmh: 0, speed_kmh: 0, speed_accuracy_mps: 0.4, motion_state: 'stationary',
    session_id: 'fiction-session', ...extra });
  for (const [kind, seconds, step = 7] of script) {
    for (let k = 0; k < seconds; k += 5, s += 5) {
      if (kind === 'none') continue;
      if (kind === 'walk' || kind === 'back') {
        east += kind === 'walk' ? step : -step;
        fix({ raw_speed_kmh: 5.04, speed_kmh: 5.04, motion_state: 'moving' });
      } else if (kind === 'drive') {
        east += 70;
        fix({ raw_speed_kmh: 50.4, speed_kmh: 50.4, motion_state: 'moving' });
      } else if (kind === 'jam') fix({ raw_speed_kmh: 3, speed_kmh: 3, motion_state: 'moving' });
      else fix({});
    }
  }
  return rows;
}
test.each([
  ['10/13-like', [['still', 7 * 3600], ['walk', 900], ['still', 600], ['back', 900], ['still', 3600]]],
  ['breaks', [['still', 1500], ['none', 600], ['still', 1200], ['walk', 600], ['none', 300], ['walk', 600], ['still', 900]]],
  ['excursion', [['still', 1800], ['walk', 40, 5], ['back', 40, 5], ['still', 1800], ['walk', 600]]],
  ['drive jam', [['still', 900], ['walk', 120], ['drive', 300], ['jam', 240], ['drive', 300], ['walk', 120], ['still', 900]]],
])('an invented day (%s) adds up, whole day and detected range', (_, script) => {
  const dayStart = new Date(2026, 9, 13).getTime();
  for (const offset of [0, 37000]) {
    const rows = day(script, dayStart + offset);
    for (const manual of [true, false]) {
      const model = historyTimeline(rows, { subject: 'phone', dayStart, dayEnd: dayStart + 86400000,
        ...(manual ? { manualRange: { start: rows[0].time, end: rows.at(-1).time } } : {}) });
      expect(timelineMismatches(model)).toEqual([]);
      for (const clocks of departureClocks(model.nodes)) expect(clocks.stay).toBe(clocks.next);
    }
  }
});

// 2026-10-15: the checker itself — a moment row tiles too, spans no time,
// and the rows cover the range from its first fix to its last.
describe('timelineMismatches', () => {
  const at = { latitude: 24.9892, longitude: 121.3138 };
  const stay = (start, end) => ({ type: 'stop', number: 1, ...at, start, end, durationMs: end - start, interruptionMs: 0, gaps: [] });
  test('a hole after a moment row is not tiled', () => {
    const nodes = [{ type: 'gap', mode: 'gap', start: 0, end: 40 * MINUTE }, { type: 'resume', ...at, start: 40 * MINUTE, end: 40 * MINUTE },
      { type: 'movement', mode: 'driving', start: 45 * MINUTE, end: 50 * MINUTE, durationMs: 5 * MINUTE, distanceM: 4000, countedDistanceM: 0 }];
    expect(timelineClockMismatches(nodes)).toEqual([expect.objectContaining({ kind: 'not-tiled', type: 'resume' })]);
  });
  test('a 出發 spanning minutes is a moment-span', () => {
    const nodes = [{ type: 'departure', ...at, start: 0, end: 5 * MINUTE },
      { type: 'gap', mode: 'gap', start: 5 * MINUTE, end: 40 * MINUTE }];
    expect(timelineClockMismatches(nodes)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'moment-span' })]));
  });
  test('rows that stop short of the last fix are not-covered', () => {
    const model = { nodes: [stay(0, 10 * MINUTE)], points: [{ time: 0 }, { time: 12 * MINUTE }] };
    expect(timelineMismatches(model)).toEqual([expect.objectContaining({ kind: 'not-covered' })]);
    expect(timelineMismatches({ ...model, points: [{ time: 0 }, { time: 10 * MINUTE }] })).toEqual([]);
  });
});
