import { historyMovement } from '../src/history/HistoryMovement';
import { historyTimeline, phoneStepCarry } from '../src/history/HistoryTimeline';
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
