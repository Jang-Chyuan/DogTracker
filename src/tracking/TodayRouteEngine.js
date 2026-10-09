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
import { configFor, coordinateValid, distanceMeters, above } from '../history/HistoryConfig';
import { normalizeHistoryRows } from '../history/HistorySources';
import { phoneHistoryRow } from '../history/HistoryRows';
import {
  countDistances, finishVehicles, historyEdge, stepVehicles, vehicleScan, vehiclesSettledAt,
} from '../history/HistoryMovement';
import { historyDeparture } from '../history/HistoryDeparture';
import { endOfDay } from './TodayDistance';

// A departure candidate looks up to 8.5 minutes ahead (判定表「出發偵測」):
// one that far behind the settled part of the day has its final answer.
const SETTLED_MARGIN_MS = 10 * 60 * 1000;
const isFoot = mode => mode === 'walking' || mode === 'moving';
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

/**
 * Today's route of this phone, fed as it is recorded. `add(rows)` takes the
 * rows read since the last call (in recorded order, as phoneRouteSince reads
 * them); it returns false when a row is older than one already taken, and the
 * caller starts a new engine. `sum(now)` is todayRouteDistance's
 * { count, metres, status } for all the rows added.
 */
export function createTodayRouteEngine({ dayStart }) {
  const config = configFor('phone');
  // useTodayRoute starts a new engine at midnight; a row of the next day is
  // not today's.
  const dayEnd = endOfDay(dayStart);
  let count = 0;
  let lastTime = -Infinity;
  const points = [];
  const edges = [];
  // Vehicles: the scan as it stood after `settled` (the last edge nothing can
  // change any more), and the vehicles found up to there.
  let settled = -1;
  let settledScan = vehicleScan();
  // Departure: candidates before `fromTime` have failed for good; `final`
  // once the confirmed one cannot change.
  const departure = { fromTime: -Infinity, final: null };
  // Distance: summed up to `index` (an edge that ends a run, so the next run
  // starts afresh) for the range starting at `rangeStart`.
  let counted = { rangeStart: null, index: -1, sum: 0 };

  function take(point) {
    // filterHistoryPoints (phone): fixes over 50 m accuracy are dropped,
    // then a jump faster than maxSpeed from the last kept fix.
    if (!coordinateValid(point) || point.accuracy > config.accuracyM) return;
    const previous = points[points.length - 1];
    if (previous) {
      const dt = (point.time - previous.time) / 1000;
      if (dt <= 0) return;
      if (above(distanceMeters(previous, point) / dt, config.maxSpeed)) return;
      edges.push(historyEdge(previous, point, 'phone', config));
    }
    points.push(point);
  }

  return {
    add(rows) {
      const fresh = [];
      for (const row of rows || []) {
        const time = Number(row?.time ?? row?.recorded_at);
        if (Number.isFinite(time) && time < lastTime) return false;
        if (!valid({ ...row, time }) || time < dayStart || time >= dayEnd) continue;
        count += 1;
        // historySourceStream: one fix per time, the first one read.
        if (time === lastTime) continue;
        lastTime = time;
        fresh.push(phoneHistoryRow(row));
      }
      for (const point of normalizeHistoryRows(fresh)) take(point);
      return true;
    },

    sum(now) {
      if (!count) return { count: 0, metres: 0, status: 'not-departed' };
      // Vehicles from the settled edge on.
      const scan = { ...settledScan, vehicles: settledScan.vehicles.slice() };
      let nextSettled = settled, nextScan = settledScan;
      for (let i = settled + 1; i < edges.length; i += 1) {
        stepVehicles(scan, edges, i, config);
        if (vehiclesSettledAt(scan, edges, i, config)) {
          nextSettled = i;
          nextScan = { ...scan, vehicles: scan.vehicles.slice() };
        }
      }
      const vehicles = finishVehicles(scan, edges);
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

      // The distance of the range, as historyMovement over its fixes.
      const rangeStart = found.range.start ?? -Infinity;
      if (counted.rangeStart !== rangeStart) {
        counted = { rangeStart, index: firstEdgeFrom(edges, rangeStart) - 1, sum: 0 };
      }
      const rest = edges.slice(counted.index + 1);
      countDistances(rest, config);
      let metres = counted.sum;
      for (const edge of rest) metres += edge.countedDistanceM;
      // Settle the sum up to the last edge that ends a run among the settled ones.
      for (let i = Math.min(settled, edges.length - 1); i > counted.index; i -= 1) {
        if (isFoot(edges[i].mode)) continue;
        for (let k = counted.index + 1; k <= i; k += 1) counted.sum += edges[k].countedDistanceM;
        counted.index = i;
        break;
      }
      return { count, metres, status: found.status };
    },
  };
}
