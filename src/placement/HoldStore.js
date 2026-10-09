import { createHoldTracker, fixQuality, HOLD_CONFIG } from './IndoorHold';
import { advanceRange, emptyRange } from '../tracking/ReceiverRange';

// How far back a cold start replays rows; older history only contributes its
// last good fixes (the seeds), which is all a hold needs to know where it is.
export const HOLD_LOOKBACK_MS = 30 * 60000;
// While a dog is held, the replay keeps the whole hold (up to this long), so a
// late row does not reset where it stands or the time it went inside.
const HELD_LOOKBACK_MS = 6 * 60 * 60000;
const MAX_SEEDS = 200;
const sameRow = (left, right) => left.time === right.time && left.master_id === right.master_id
  && Number(left.latitude) === Number(right.latitude) && Number(left.longitude) === Number(right.longitude);

// The receiver-range judgement of a row, given whether the dog is held at it.
const rangeRow = (row, held) => ({
  time: row.time, source: row.source, latitude: Number(row.latitude), longitude: Number(row.longitude),
  receiverLatitude: Number(row.master_latitude), receiverLongitude: Number(row.master_longitude), held,
});

/**
 * One tracker per dog for the live map. Rows arrive in batches from the BLE
 * table and the downloaded cloud copy; each dog's rows are merged and fed in
 * time order, so a dog reported by both sources has one hold, not two.
 *
 * The same rows, in the same order, also feed each dog's receiver-range
 * judgement (src/tracking/ReceiverRange.js): it needs to know whether the dog
 * was held at each row, which only this loop knows. Rows that arrive late are
 * replayed for the hold but not for the range, which only ever moves forward
 * (a late row is a cloud copy, and cloud rows never judge).
 */
export function createHoldStore(config = HOLD_CONFIG, options) {
  // Per dog: its tracker, the rows of the last HOLD_LOOKBACK_MS (to replay
  // when an older row turns up late) and the seeds it started from.
  const dogs = new Map();
  function dog(slaveId) {
    if (!dogs.has(slaveId)) {
      dogs.set(slaveId, { tracker: createHoldTracker(config, options), rows: [], seeds: [], touched: 0,
        range: emptyRange() });
    }
    return dogs.get(slaveId);
  }
  return {
    ingest({ rows = [], seeds = [] }) {
      const bySlave = new Map();
      const entry = slaveId => {
        if (!bySlave.has(slaveId)) bySlave.set(slaveId, { seeds: [], rows: [] });
        return bySlave.get(slaveId);
      };
      for (const row of seeds) {
        if (row.slave_id != null) entry(row.slave_id).seeds.push({ ...row, time: Number(row.time) });
      }
      for (const row of rows) {
        if (row.slave_id == null || !Number.isFinite(Number(row.time))) continue;
        entry(row.slave_id).rows.push({ ...row, time: Number(row.time) });
      }
      for (const [slaveId, batch] of bySlave) {
        const state = dog(slaveId);
        batch.rows.sort((left, right) => left.time - right.time);
        if (batch.seeds.length) {
          state.seeds = state.seeds.concat(batch.seeds).slice(-MAX_SEEDS);
          state.tracker.seed(batch.seeds);
          state.touched = Math.max(state.touched, ...batch.seeds.map(row => row.time));
        }
        // The phone's own upload comes back from the cloud with the BLE row's
        // time: the same row again, not a late one.
        const lastTime = state.tracker.lastTime();
        batch.rows = batch.rows.filter(row => row.time >= lastTime
          || !state.rows.some(seen => sameRow(seen, row)));
        const late = batch.rows.length && batch.rows[0].time < lastTime;
        state.rows = state.rows.concat(batch.rows).sort((left, right) => left.time - right.time);
        const newest = state.rows.length ? state.rows[state.rows.length - 1].time : 0;
        const heldSince = state.tracker.current(newest)?.since;
        const keepFrom = Number.isFinite(heldSince)
          ? Math.max(newest - HELD_LOOKBACK_MS, Math.min(newest - HOLD_LOOKBACK_MS, heldSince - HOLD_LOOKBACK_MS))
          : newest - HOLD_LOOKBACK_MS;
        // Good fixes leaving the window stay as seeds, so a replay still knows them.
        const leaving = state.rows.filter(row => row.time < keepFrom && fixQuality(row, config) === 'good');
        if (leaving.length) state.seeds = state.seeds.concat(leaving).slice(-MAX_SEEDS);
        state.rows = state.rows.filter(row => row.time >= keepFrom);
        if (late) {
          // A Master uploading late, or a slow download: replay the window in
          // time order instead of dropping what came in behind.
          const from = state.rows[0]?.time ?? Infinity;
          const tracker = createHoldTracker(config, options);
          tracker.seed([...state.seeds, ...state.tracker.goodFixes()].filter(row => row.time < from));
          for (const row of state.rows) {
            tracker.push(row);
            state.range = advanceRange(state.range, rangeRow(row, !!tracker.current(row.time)));
          }
          state.tracker = tracker;
        } else {
          for (const row of batch.rows) {
            state.tracker.push(row);
            state.range = advanceRange(state.range, rangeRow(row, !!state.tracker.current(row.time)));
          }
        }
        if (batch.rows.length) state.touched = Math.max(state.touched, newest);
      }
    },
    holds(now) {
      const result = {};
      for (const [slaveId, state] of dogs) {
        const current = state.tracker.current(now);
        if (current) result[slaveId] = current;
      }
      return result;
    },
    // Carries range judgements over from a store being replaced (a long pause
    // or a time repair replays the rows from scratch, but only the last 30
    // minutes of them: an out-of-range dog must stay out until it clears).
    // Rows the carried state has already seen are ignored by advanceRange.
    seedRanges(ranges = {}) {
      for (const [slaveId, range] of Object.entries(ranges)) {
        const state = dog(Number(slaveId));
        state.range = range;
        state.touched = Math.max(state.touched, range.lastTime ?? 0);
      }
    },
    // Each dog's receiver-range judgement (ReceiverRange.advanceRange state).
    ranges() {
      const result = {};
      for (const [slaveId, state] of dogs) {
        if (state.range.status != null) result[slaveId] = state.range;
      }
      return result;
    },
    statuses() {
      const result = {};
      for (const [slaveId, state] of dogs) result[slaveId] = { ...state.tracker.status(), indoorState: state.tracker.snapshot() };
      return result;
    },
  };
}
