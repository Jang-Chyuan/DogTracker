import { createHoldTracker, HOLD_CONFIG } from './IndoorHold';

// How far back a cold start replays rows; older history only contributes its
// last good fixes (the seeds), which is all a hold needs to know where it is.
export const HOLD_LOOKBACK_MS = 30 * 60000;
// A dog not heard from for this long is forgotten; DogMerge drops it anyway.
const FORGET_MS = 24 * 60 * 60000;

/**
 * One tracker per dog for the live map. Rows arrive in batches from the BLE
 * table and the downloaded cloud copy; each dog's rows are merged and fed in
 * time order, so a dog reported by both sources has one hold, not two.
 */
export function createHoldStore(config = HOLD_CONFIG, options) {
  // Per dog: its tracker, the rows of the last HOLD_LOOKBACK_MS (to replay
  // when an older row turns up late) and the seeds it started from.
  const dogs = new Map();
  function dog(slaveId) {
    if (!dogs.has(slaveId)) {
      dogs.set(slaveId, { tracker: createHoldTracker(config, options), rows: [], seeds: [], touched: 0 });
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
          state.seeds = state.seeds.concat(batch.seeds);
          state.tracker.seed(batch.seeds);
        }
        const late = batch.rows.length && batch.rows[0].time < state.tracker.lastTime();
        state.rows = state.rows.concat(batch.rows).sort((left, right) => left.time - right.time);
        const newest = state.rows.length ? state.rows[state.rows.length - 1].time : 0;
        state.rows = state.rows.filter(row => newest - row.time <= HOLD_LOOKBACK_MS);
        if (late) {
          // A Master uploading late, or a slow download: replay the window in
          // time order instead of dropping what came in behind.
          const from = state.rows[0]?.time ?? Infinity;
          const tracker = createHoldTracker(config, options);
          tracker.seed([...state.seeds, ...state.tracker.goodFixes()].filter(row => row.time < from));
          for (const row of state.rows) tracker.push(row);
          state.tracker = tracker;
        } else {
          for (const row of batch.rows) state.tracker.push(row);
        }
        if (batch.rows.length) state.touched = Math.max(state.touched, newest);
      }
    },
    holds(now) {
      const result = {};
      for (const [slaveId, state] of dogs) {
        if (now - (state.touched || now) > FORGET_MS) {
          dogs.delete(slaveId);
          continue;
        }
        const current = state.tracker.current(now);
        if (current) result[slaveId] = current;
      }
      return result;
    },
    statuses() {
      const result = {};
      for (const [slaveId, state] of dogs) result[slaveId] = state.tracker.status();
      return result;
    },
  };
}

/**
 * Moves each held dog into the house it stands in or next to, when the
 * building lookup already knows one; asks for the others in the background.
 */
// Only these reasons say the dog is inside; a "window" or a weak fix next to a
// house must not pull a dog working outside it into the house.
const SNAP_REASONS = new Set(['室內', '充電中']);
// Names the place of each hold in words (Android geocoder), from the measured
// anchor rather than a building centre.
export function nameHolds(holds, lookup) {
  const result = {};
  for (const [slaveId, hold] of Object.entries(holds)) {
    const address = lookup?.lookup(hold.anchor ?? hold.coordinate);
    result[slaveId] = address ? { ...hold, address } : hold;
  }
  return result;
}

export function snapHolds(holds, snapper) {
  const result = {};
  for (const [slaveId, hold] of Object.entries(holds)) {
    const building = SNAP_REASONS.has(hold.reason) ? snapper?.lookup(hold.coordinate) : null;
    result[slaveId] = building ? { ...hold, coordinate: building.coordinate, anchor: hold.coordinate,
      buildingId: building.buildingId } : hold;
  }
  return result;
}
