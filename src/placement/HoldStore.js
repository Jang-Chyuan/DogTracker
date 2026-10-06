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
  const trackers = new Map();
  const touched = new Map();
  function tracker(slaveId) {
    if (!trackers.has(slaveId)) trackers.set(slaveId, createHoldTracker(config, options));
    return trackers.get(slaveId);
  }
  return {
    ingest({ rows = [], seeds = [] }) {
      const bySlave = new Map();
      for (const row of seeds) {
        if (row.slave_id == null) continue;
        if (!bySlave.has(row.slave_id)) bySlave.set(row.slave_id, { seeds: [], rows: [] });
        bySlave.get(row.slave_id).seeds.push(row);
      }
      for (const row of rows) {
        if (row.slave_id == null || !Number.isFinite(Number(row.time))) continue;
        if (!bySlave.has(row.slave_id)) bySlave.set(row.slave_id, { seeds: [], rows: [] });
        bySlave.get(row.slave_id).rows.push({ ...row, time: Number(row.time) });
      }
      for (const [slaveId, batch] of bySlave) {
        const target = tracker(slaveId);
        if (batch.seeds.length) target.seed(batch.seeds.map(row => ({ ...row, time: Number(row.time) })));
        batch.rows.sort((left, right) => left.time - right.time);
        for (const row of batch.rows) target.push(row);
        if (batch.rows.length) touched.set(slaveId, batch.rows[batch.rows.length - 1].time);
      }
    },
    holds(now) {
      const result = {};
      for (const [slaveId, target] of trackers) {
        if (now - (touched.get(slaveId) ?? now) > FORGET_MS) {
          trackers.delete(slaveId);
          touched.delete(slaveId);
          continue;
        }
        const current = target.current(now);
        if (current) result[slaveId] = current;
      }
      return result;
    },
  };
}

/**
 * Moves each held dog into the house it stands in or next to, when the
 * building lookup already knows one; asks for the others in the background.
 */
export function snapHolds(holds, snapper) {
  const result = {};
  for (const [slaveId, hold] of Object.entries(holds)) {
    const building = snapper?.lookup(hold.coordinate);
    result[slaveId] = building ? { ...hold, coordinate: building.coordinate, anchor: hold.coordinate,
      buildingId: building.buildingId } : hold;
  }
  return result;
}
