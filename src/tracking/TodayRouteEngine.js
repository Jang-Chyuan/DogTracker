// 「今天 x km」 without going over the whole day again (068).
//
// todayRouteDistance (TodayDistance.js) runs the history logic over every row
// of today. The live map asks every 15 s (S4 every 2 s) and a day of 1 s
// fixes is up to 80,000 rows, so the JavaScript thread did nothing else
// (lane A perf run: 44% of an idle map was this sum). The engine keeps what
// the history logic built from the rows already read — the fixes, the
// fix-to-fix edges, the vehicles found so far, the departure once it cannot
// change, the distance up to the last place it can no longer change — and
// only works through the rows that arrived since. The answer is the same as
// todayRouteDistance's on the same rows (__tests__/TodayRouteEngine.test.js
// compares them on whole simulated days, row batch by row batch).
//
// Phone rows only (my route): no holds, no dog-only jump rules.
import { PhoneMotion, phoneMotionPoint } from '../locationTracker/PhoneMotion';
import { configFor, coordinateValid, distanceMeters, above } from '../history/HistoryConfig';
import { normalizeHistoryRows } from '../history/HistorySources';
import { phoneHistoryRow } from '../history/HistoryRows';
import {
  countEdge, finishVehicles, historyEdge, stepVehicles, vehicleScan, vehiclesSettledAt,
} from '../history/HistoryMovement';
import { historyDeparture } from '../history/HistoryDeparture';
import { endOfDay } from './TodayDistance';

// A departure candidate looks up to 8.5 minutes ahead (判定表「出發偵測」):
// one that far behind the settled part of the day has its final answer.
const SETTLED_MARGIN_MS = 10 * 60 * 1000;
const valid = row => Number.isFinite(row?.latitude) && Number.isFinite(row?.longitude)
  && Math.abs(row.latitude) <= 90 && Math.abs(row.longitude) <= 180
  && !(row.latitude === 0 && row.longitude === 0) && Number.isFinite(row?.time);

// First index in `edges` whose start is at or after `time`.
function firstEdgeFrom(edges, time) {
  let lo = 0, hi = edges.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (edges[mid].start < time) lo = mid + 1; else hi = mid;
  }
  return lo;
}

// How many of `times` (ascending) are at or before `time`.
function countUpTo(times, time) {
  let lo = 0, hi = times.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (times[mid] <= time) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/**
 * Today's route of this phone, fed as it is recorded. `add(rows)` takes the
 * rows read since the last call (in recorded order, as phoneRouteSince reads
 * them); it returns false when a row is older than one already taken, and the
 * caller starts a new engine. `sum(now)` is todayRouteDistance's
 * { count, metres, status } for the rows added that are not later than `now`
 * (todayRouteDistance leaves out rows ahead of the clock).
 */
export function createTodayRouteEngine({ dayStart }) {
  const config = configFor('phone');
  // useTodayRoute starts a new engine at midnight; a row of the next day is
  // not today's.
  const dayEnd = endOfDay(dayStart);
  let lastTime = -Infinity;
  // Today's rows as they were recorded, and how many of them the route has
  // taken in. A row ahead of the clock (its time is later than `now`) is no
  // part of todayRouteDistance's answer, so it waits here until a later
  // `sum` reaches it; a clock that goes backwards takes rows out again.
  const recorded = [];
  let taken = 0;
  // The times of the rows whose time an earlier row already had: only the
  // first of them is a fix of the route, but each one is a row of today
  // (`count` counts rows, as todayRouteDistance's does).
  const repeats = [];
  let phoneMotion = new PhoneMotion();
  const points = [];
  const edges = [];
  // Vehicles: the scan as it stood after `settled` (the last edge nothing can
  // change any more), and the vehicles found up to there.
  let settled = -1;
  let settledScan = vehicleScan();
  // Departure: candidates before `fromTime` have failed for good; `final`
  // once the confirmed one cannot change.
  const departure = { fromTime: -Infinity, final: null };
  // Distance: summed up to `index` for the range starting at `rangeStart`,
  // with the counting state (countState) the next edge carries on from.
  let counted = { rangeStart: null, index: -1, sum: 0, anchor: null, budget: 0 };

  function take(point) {
    // filterHistoryPoints (phone): fixes over 50 m accuracy are dropped,
    // then a jump faster than maxSpeed from the last kept fix.
    if (!coordinateValid(point) || point.accuracy > config.accuracyM) return;
    const previous = points[points.length - 1];
    if (previous) {
      const dt = (point.time - previous.time) / 1000;
      if (dt <= 0) return;
      const observed = { latitude: previous.phoneObservedLatitude ?? previous.latitude,
        longitude: previous.phoneObservedLongitude ?? previous.longitude };
      if (above(distanceMeters(observed, point) / dt, config.maxSpeed)) return;
      point = phoneMotionPoint(point, phoneMotion);
      if (point.phoneDepartureSince != null) {
        for (let i = points.length - 1; i >= 0; i -= 1) {
          const prior = points[i];
          if (prior.time < point.phoneDepartureSince) break;
          prior.latitude = prior.raw_latitude; prior.longitude = prior.raw_longitude;
          prior.phoneStationary = false; prior.phoneConfirmedMovement = true;
          prior.phoneMotionState = 'moving';
        }
        for (let i = Math.max(0, firstEdgeFrom(edges, point.phoneDepartureSince) - 1); i < edges.length; i += 1) {
          if (edges[i].end >= point.phoneDepartureSince) edges[i] = historyEdge(points[i], points[i + 1], 'phone', config);
        }
        settled = -1; settledScan = vehicleScan();
        departure.fromTime = -Infinity; departure.final = null;
        counted = { rangeStart: null, index: -1, sum: 0, anchor: null, budget: 0 };
      }
      edges.push(historyEdge(previous, point, 'phone', config));
    }
    if (!previous) point = phoneMotionPoint(point, phoneMotion);
    points.push(point);
  }

  return {
    add(rows) {
      const fresh = [];
      for (const row of rows || []) {
        const time = Number(row?.time ?? row?.recorded_at);
        if (Number.isFinite(time) && time < lastTime) return false;
        if (!valid({ ...row, time }) || time < dayStart || time >= dayEnd) continue;
        // historySourceStream: one fix per time, the first one read.
        if (time === lastTime) { repeats.push(time); continue; }
        lastTime = time;
        fresh.push(phoneHistoryRow(row));
      }
      for (const point of normalizeHistoryRows(fresh)) recorded.push(point);
      return true;
    },

    sum(now) {
      // The clock went backwards (a time change): the rows after it are not
      // today's route any more, and everything built from them goes. `take`
      // reads the rows left to right, so dropping the fixes after `now` is
      // what the engine would hold had those rows never arrived.
      while (taken && recorded[taken - 1].time > now) taken -= 1;
      let keep = points.length;
      while (keep && points[keep - 1].time > now) keep -= 1;
      if (keep < points.length) {
        phoneMotion = new PhoneMotion();
        points.length = 0;
        edges.length = 0;
        settled = -1;
        settledScan = vehicleScan();
        departure.fromTime = -Infinity;
        departure.final = null;
        counted = { rangeStart: null, index: -1, sum: 0, anchor: null, budget: 0 };
        // Replaying only the reached raw rows revokes any future-confirmed
        // departure backfill when the clock moves backwards.
        for (const point of recorded.slice(0, taken)) take(point);
      }
      // The rows the clock has reached since the last call.
      while (taken < recorded.length && recorded[taken].time <= now) { take(recorded[taken]); taken += 1; }
      const count = taken + countUpTo(repeats, now);
      if (!count) return { count: 0, metres: 0, status: 'not-departed' };
      // Vehicles from the settled edge on.
      const scan = { ...settledScan, vehicles: settledScan.vehicles.slice() };
      let nextSettled = settled, nextScan = settledScan;
      for (let i = settled + 1; i < edges.length; i += 1) {
        stepVehicles(scan, edges, i, config);
        // A confirmed car can retain its scan and counted prefix while its
        // current edge is still fast. An exit may only backfill from the
        // first low/foot/parking edge, all of which stay after this checkpoint.
        // Keep active's original index: finishVehicles closes only the local
        // scan copy, so a terminal stop can later resume the same car.
        const confirmedFast = scan.active != null && scan.low == null;
        if (confirmedFast || vehiclesSettledAt(scan, edges, i, config)) {
          nextSettled = i;
          nextScan = { ...scan, vehicles: scan.vehicles.slice() };
        }
      }
      const vehicles = finishVehicles(scan, edges, config);
      // Edge modes as historyMovement gives them, for the edges not settled.
      let v = 0;
      for (let i = settled + 1; i < edges.length; i += 1) {
        const edge = edges[i];
        edge.mode = edge.to.heldReason ? 'indoor' : 'walking';
        if (edge.mode !== 'indoor') {
          while (v < vehicles.length && vehicles[v].end < edge.end) v += 1;
          const vehicle = vehicles[v];
          if (vehicle && edge.start >= vehicle.start && edge.end <= vehicle.end) edge.mode = 'driving';
        }
        if (edge.gap) edge.mode = 'gap';
      }
      settled = nextSettled;
      settledScan = nextScan;
      const settledTime = settled >= 0 ? edges[settled].end : -Infinity;

      let found = departure.final;
      if (!found) {
        found = historyDeparture(points, { subject: 'phone', config, today: true, now,
          movement: { edges, vehicles }, fromTime: departure.fromTime });
        const done = settledTime - SETTLED_MARGIN_MS;
        const candidate = found.candidateTime;
        departure.fromTime = Math.max(departure.fromTime, candidate == null ? done : Math.min(candidate, done));
        if (found.status === 'confirmed' && found.decisionTime + SETTLED_MARGIN_MS < settledTime) departure.final = found;
      }

      // The distance of the range, as historyMovement over its fixes: the
      // edges after the checkpoint, counted on from the state it saved.
      const rangeStart = found.range.start ?? -Infinity;
      if (counted.rangeStart !== rangeStart) {
        counted = { rangeStart, index: firstEdgeFrom(edges, rangeStart) - 1, sum: 0, anchor: null, budget: 0 };
      }
      // The checkpoint moves to the last settled edge, whatever its mode: a
      // day of walking and standing still never reaches a non-foot edge, so
      // the anchor and the speed budget of the run carry it across instead
      // (otherwise every poll added the whole day up again).
      const state = { anchor: counted.anchor, budget: counted.budget };
      const checkpoint = Math.min(settled, edges.length - 1);
      let metres = counted.sum;
      for (let i = counted.index + 1; i < edges.length; i += 1) {
        countEdge(state, edges[i], config);
        metres += edges[i].countedDistanceM;
        if (i === checkpoint) {
          counted = { rangeStart, index: i, sum: metres, anchor: state.anchor, budget: state.budget };
        }
      }
      return { count, metres, status: found.status };
    },
  };
}
