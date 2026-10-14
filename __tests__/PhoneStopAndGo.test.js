import { historyMovement } from '../src/history/HistoryMovement';
import { historyTimeline, phoneStepCarry } from '../src/history/HistoryTimeline';
import { historyStops } from '../src/history/HistoryStops';
import { timelinePresentation } from '../src/history/HistoryTimelinePresentation';
import { createTodayRouteEngine } from '../src/tracking/TodayRouteEngine';
import { todayRouteDistance } from '../src/tracking/TodayDistance';
import { configFor } from '../src/history/HistoryConfig';

// 2026-10-14: stop-and-go traffic is one drive; a stay between two pieces of
// one trip (shorter than vehicleMergeMs, no walk in between) is part of it.
// Every route here is invented: a straight line north from a made-up point
// in Taoyuan, positions generated from speed × time (5 s fixes), no recorded
// route sampled, shifted or rotated. Phases are [metres per second, seconds].
const route = (phases, { start = Date.UTC(2026, 0, 5, 1) } = {}) => {
  let time = start, metres = 0;
  const make = speed => ({ time, latitude: 24.989 + metres / 111195, longitude: 121.313,
    raw_latitude: 24.989 + metres / 111195, raw_longitude: 121.313,
    accuracy: 8, raw_speed_kmh: Math.abs(speed) * 3.6, speed_accuracy_mps: 0.1,
    phoneMotionState: speed ? 'moving' : 'stationary', phoneStationary: !speed,
    phoneConfirmedMovement: !!speed, session_id: 'invented-stop-and-go' });
  const points = [make(phases[0][0])];
  for (const [speed, seconds] of phases) for (let t = 0; t < seconds; t += 5) {
    time += 5000; metres += speed * 5; points.push(make(speed));
  }
  return points;
};
const movement = points => historyMovement(points, { subject: 'phone' });
const timeline = points => historyTimeline(points, { subject: 'phone', today: false,
  range: { start: points[0].time, end: points.at(-1).time } });
const stays = model => model.nodes.filter(n => n.type === 'stop');
const allDriving = model => model.edges.every(e => e.mode === 'driving');

// Shapes from real days (only their timing; no coordinates).
const scooterInTown = [[8, 15], [0, 60], [8, 20], [0, 90], [8, 15], [0, 240], [8, 25], [0, 45], [8, 20]];
const jamCreep = [[8, 60], [0, 60], [1.2, 40], [0, 120], [8, 60]];
const crawlThenStop = [[8, 60], [1.1, 40], [0, 210], [8, 60]];
const errandOnFoot = [[8, 60], [0, 30], [1.3, 120], [0, 300], [-1.3, 120], [0, 20], [8, 60]];
const longStopBetweenDrives = [[8, 60], [0, 60], [1.2, 50], [0, 600], [1.2, 30], [8, 60]];
const longCrawl = [[8, 60], [0.9, 240], [8, 60]];

test('a scooter in town (bursts shorter than enterMs between lights) is one drive with no stay', () => {
  const model = timeline(route(scooterInTown));
  expect(model.edges.filter(e => e.mode === 'driving').length).toBeGreaterThan(model.edges.length - 2);
  expect(stays(model)).toHaveLength(0);
  expect(model.distanceM).toBe(0);
  const drives = timelinePresentation(model.nodes).filter(n => n.type === 'movement');
  expect(drives).toHaveLength(1);
  expect(drives[0].mode).toBe('driving');
});

test('a creep in a jam that ended the drive is undone when the drive goes on', () => {
  const model = movement(route(jamCreep));
  expect(model.vehicles).toHaveLength(1);
  expect(allDriving(model)).toBe(true);
  expect(model.distanceM).toBe(0);
  expect(stays(timeline(route(jamCreep)))).toHaveLength(0);
});

test('a crawl and then a 3.5-minute stop between two drives is no stay', () => {
  const model = timeline(route(crawlThenStop));
  expect(allDriving(model)).toBe(true);
  expect(stays(model)).toHaveLength(0);
  expect(model.distanceM).toBe(0);
});

test('an errand on foot between two drives keeps both drives and the walk', () => {
  const model = movement(route(errandOnFoot));
  expect(model.vehicles).toHaveLength(2);
  expect(model.distanceM).toBeGreaterThan(200);
});

test('a stop of over vehicleMergeMs between two drives (10/01 errand shape) keeps two drives', () => {
  const model = movement(route(longStopBetweenDrives));
  expect(model.vehicles).toHaveLength(2);
  expect(model.edges.some(e => e.mode === 'walking')).toBe(true);
});

test('a long steady crawl at walking pace still reads as a walk (no way to tell)', () => {
  const model = movement(route(longCrawl));
  expect(model.vehicles).toHaveLength(2);
  expect(model.distanceM).toBeGreaterThan(150);
});

test('bursts adding up to less than enterMs are no vehicle', () => {
  const model = movement(route([[0, 30], [8, 10], [0, 120], [8, 10], [0, 30]]));
  expect(model.vehicles).toHaveLength(0);
});

test('bursts before a vehicle start it at the first burst', () => {
  const points = route([[0, 30], [8, 15], [0, 120], [8, 15], [0, 60], [8, 60]]);
  const model = movement(points);
  expect(model.vehicles).toHaveLength(1);
  expect(model.vehicles[0].start).toBeLessThanOrEqual(points[6].time);
  expect(model.distanceM).toBe(0);
});

test('a walk between two bursts breaks the chain', () => {
  const model = movement(route([[8, 15], [0, 20], [1.3, 120], [0, 20], [8, 15]]));
  expect(model.vehicles).toHaveLength(0);
  expect(model.distanceM).toBeGreaterThan(100);
});

test("the phone's own speed keeps one fix's geometric dip from cutting a run", () => {
  const points = route([[8, 15], [4.5, 5], [8, 15]]);
  points[4].raw_speed_kmh = 30;
  expect(movement(points).vehicles).toHaveLength(1);
  // Speed noise of a phone that does not move is no vehicle.
  const still = route([[0, 60]]);
  for (const p of still) { p.raw_speed_kmh = 30; p.phoneStationary = false; }
  expect(movement(still).vehicles).toHaveLength(0);
});

test('a dog keeps the original vehicle rules', () => {
  const dog = route([[10, 60], [0, 60], [1.2, 40], [0, 120], [10, 60]])
    .map(({ time, latitude, longitude, accuracy }) => ({ time, latitude, longitude, accuracy }));
  expect(configFor('dog').vehicleMergeMs).toBeUndefined();
  expect(historyMovement(dog, { subject: 'dog' }).vehicles).toHaveLength(2);
});

test('today distance (row by row) agrees with the whole-day answer on stop-and-go days', () => {
  const cases = [scooterInTown, jamCreep, crawlThenStop, errandOnFoot, longStopBetweenDrives, longCrawl,
    [[0, 30], [8, 15], [0, 120], [8, 15], [0, 60], [8, 60]], [[8, 15], [0, 20], [1.3, 120], [0, 20], [8, 15]]];
  for (const phases of cases) {
    const rows = route(phases);
    const dayStart = rows[0].time - 60000;
    for (const step of [1, 7, 25]) {
      const engine = createTodayRouteEngine({ dayStart });
      for (let i = 0; i < rows.length; i += step) {
        const prefix = rows.slice(0, Math.min(i + step, rows.length));
        engine.add(prefix.slice(i));
        const now = prefix.at(-1).time;
        expect(engine.sum(now).metres).toBeCloseTo(todayRouteDistance(prefix, { now, dayStart }).metres, 6);
      }
    }
  }
});

test('two legs of one drive split by a short weak fix are one list row', () => {
  const t = Date.UTC(2026, 0, 5, 1);
  const drive = (start, end) => ({ type: 'movement', mode: 'driving', start: t + start, end: t + end,
    durationMs: end - start, distanceM: 100, countedDistanceM: 0 });
  const listed = timelinePresentation([drive(0, 300000),
    { type: 'gap', mode: 'gap', reason: 'uncertain', sameSession: true, start: t + 300000, end: t + 305000,
      durationMs: 5000, distanceM: 0, countedDistanceM: 0 },
    drive(305000, 600000)]).filter(n => n.type !== 'departure' && n.type !== 'end');
  expect(listed).toHaveLength(1);
  expect(listed[0]).toMatchObject({ mode: 'driving', start: t, end: t + 600000, distanceM: 200 });
});

describe('metres counted inside a stay are not left on the seconds between two stays', () => {
  const t = Date.UTC(2026, 0, 5, 1);
  const stay = (start, end) => ({ type: 'stop', start: t + start, end: t + end, durationMs: end - start });
  const walk = (start, end, counted, carried = 0) => ({ type: 'movement', mode: 'walking', start: t + start,
    end: t + end, durationMs: end - start, distanceM: counted, countedDistanceM: counted,
    ...(carried ? { carriedM: carried } : {}) });
  test('they go on to the next walk of a minute or more; the step goes empty', () => {
    const nodes = [walk(0, 120000, 150), stay(120000, 400000), walk(400000, 405000, 112, 112),
      stay(405000, 900000), walk(900000, 1080000, 200)];
    phoneStepCarry(nodes);
    expect(nodes[2].countedDistanceM).toBe(0);
    expect(nodes[4].countedDistanceM).toBe(312);
    expect(nodes.reduce((sum, n) => sum + (n.countedDistanceM || 0), 0)).toBe(462);
  });
  test('the step keeps its own metres; with no later walk the earlier one takes them', () => {
    const nodes = [walk(0, 120000, 150), stay(120000, 400000), walk(400000, 405000, 118, 112), stay(405000, 900000)];
    phoneStepCarry(nodes);
    expect(nodes[2].countedDistanceM).toBeCloseTo(6, 6);
    expect(nodes[0].countedDistanceM).toBe(262);
  });
  test('with no other walk the step stays as it was', () => {
    const nodes = [stay(0, 400000), walk(400000, 405000, 112, 112), stay(405000, 900000)];
    phoneStepCarry(nodes);
    expect(nodes[1].countedDistanceM).toBe(112);
  });
  test('a walk of a minute or more keeps what it was given', () => {
    const nodes = [stay(0, 400000), walk(400000, 480000, 112, 112), stay(480000, 900000), walk(900000, 1080000, 200)];
    phoneStepCarry(nodes);
    expect(nodes[1].countedDistanceM).toBe(112);
  });
});

// 2026-10-14 (user): the phone has no 「≥ 一般的 3 倍」 baseline; the dog keeps it.
describe('phone stays without the 3× baseline', () => {
  // Three long visits and a 4-minute stop on a walk between them.
  const day = [[0, 3600], [1.3, 120], [0, 240], [1.3, 120], [0, 3600], [1.3, 120], [0, 3600], [1.3, 60]];
  const numbered = model => stays(model).filter(n => !n.presentationOnly);
  test('a 4-minute stop among hour-long stays is numbered', () => {
    const model = timeline(route(day));
    const short = numbered(model).filter(n => n.durationMs < 10 * 60000);
    expect(short).toHaveLength(1);
    expect(short[0].durationMs).toBeGreaterThanOrEqual(configFor('phone').stayMs);
  });
  test('with the baseline (the dog rule) the same stop is not numbered', () => {
    // Places 200 m apart, one step of a minute between them (no walk to make
    // short visits): seven of 40 minutes and one of 4 — the baseline is 40.
    const start = Date.UTC(2026, 0, 5, 1);
    const points = [];
    let time = start;
    [40, 40, 4, 40, 40, 40, 40, 40].forEach((minutes, place) => {
      if (place) time += 60000;
      for (let t = 0; t <= minutes * 60; t += 30, time += 30000) points.push({ time,
        latitude: 24.989 + place * 200 / 111195, longitude: 121.313, accuracy: 8 });
    });
    const stopsWith = config => historyStops(points, { subject: 'phone', config }).stops;
    const short = list => list.filter(n => n.durationMs < 10 * 60000);
    expect(short(stopsWith(configFor('phone')))).toHaveLength(1);
    expect(short(stopsWith({ ...configFor('phone'), stayRatio: 3 }))).toHaveLength(0);
    expect(configFor('dog').stayRatio).toBe(3);
    expect(configFor('phone').stayRatio).toBeNull();
  });
  test('a range wholly inside one stay is still 還在原地 (no numbered stay)', () => {
    const model = timeline(route([[0, 600]]));
    expect(numbered(model)).toHaveLength(0);
  });
});

// Every minute belongs to a row: closeHoles fills holes shorter than gapMs,
// and still runs of stayMs or more are stays, so stayMs must not exceed gapMs
// (with stayMs 5 min, a 3.3-minute pause before a drive was in no row).
test.each([174, 186, 216, 270])('a %s-second pause between a walk and a drive is in a row', seconds => {
  const config = configFor('phone');
  expect(config.stayMs).toBeLessThanOrEqual(config.gapMs);
  const points = route([[1.2, 300], [0, seconds], [8, 60]]);
  const listed = timelinePresentation(timeline(points).nodes).filter(n => n.end > n.start);
  for (let i = 1; i < listed.length; i += 1) expect(listed[i].start - listed[i - 1].end).toBeLessThan(60000);
  expect(listed[0].start).toBe(points[0].time);
  expect(listed.at(-1).end).toBe(points.at(-1).time);
});
