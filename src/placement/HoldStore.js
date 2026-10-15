import { createHoldTracker, distanceMeters, fixQuality, hasFix, holdFillStart, HOLD_CONFIG } from './IndoorHold';
import { advanceRange, emptyRange } from '../tracking/ReceiverRange';
import { advanceBattery, batteryReading } from '../tracking/BatteryPlausibility';
import { configFor, samePlaceGap } from '../history/HistoryConfig';

// How far back a cold start replays rows; older history only contributes its
// last good fixes (the seeds), which is all a hold needs to know where it is.
export const HOLD_LOOKBACK_MS = 30 * 60000;
// While a dog is held, the replay keeps the whole hold (up to this long), so a
// late row does not reset where it stands or the time it went inside.
const HELD_LOOKBACK_MS = 6 * 60 * 60000;
const MAX_SEEDS = 200;
// One packet, whichever way it came: the same time, Master and coordinate.
// The phone's own upload comes back from the cloud with the BLE row's time
// (another source and event, the same packet), so this is not the event id.
const rowKey = row => `${row.time}|${row.master_id}|${Number(row.latitude)}|${Number(row.longitude)}`;

// The receiver-range judgement of a row, given whether the dog is held at it.
const rangeRow = (row, held) => ({
  time: row.time, source: row.source, latitude: Number(row.latitude), longitude: Number(row.longitude),
  receiverLatitude: Number(row.master_latitude), receiverLongitude: Number(row.master_longitude), held,
});

const HISTORY_DOG = configFor('dog');

/**
 * One row through a dog's tracker, in time order (`rows[index]`), and what
 * the same rows say beside the hold: the receiver range, the battery
 * (BatteryPlausibility) and from which row the history would draw the hold.
 *
 * That row is where the card's 「室內・N 分」 starts, so it says what the
 * history's 「室內・N 分」 says (HistoryStops.historyIndoorNodes): not the
 * hold's `since` (the last good fix, a row the history does not draw held,
 * possibly long before the collar spoke again) but the first row the hold
 * covers (IndoorHold.holdFillStart), restarted after a break in the packets
 * that the history would not bridge (samePlaceGap).
 */
function step(state, rows, index) {
  const row = rows[index];
  const { tracker, heldRows } = state;
  if (state.firstAt == null) { state.firstAt = row.time; state.early = []; }
  noteEarly(state, row);
  const event = tracker.push(row);
  if (event?.type === 'end' && event.departureSince != null) {
    // As createHistoryHolds: the walk out is not part of the hold.
    for (let back = index - 1; back >= 0 && rows[back].time >= event.departureSince; back -= 1) heldRows.delete(rows[back]);
  }
  if (event?.type === 'start') {
    const from = holdFillStart(rows, index, event, state.config, earlier => heldRows.has(earlier));
    for (let fill = from; fill < index; fill += 1) heldRows.add(rows[fill]);
    // `clipped`: the hold's last good fix (`since`) is older than any row
    // this tracker was fed (a cold start's seeds), so the hold may well have
    // begun before the rows it can see: `from` is only where they begin.
    state.timing = { since: event.since, from: rows[from].time, last: null,
      clipped: mayBeginEarlier(state, event.since, rows[from].time, event.anchor) };
  }
  const current = tracker.current(row.time);
  if (current) {
    heldRows.add(row);
    const place = { time: row.time, latitude: current.coordinate.latitude, longitude: current.coordinate.longitude };
    if (!state.timing || state.timing.since !== current.since) {
      state.timing = { since: current.since, from: row.time, last: null,
        clipped: mayBeginEarlier(state, current.since, row.time, current.coordinate) };
    } else if (state.timing.last && row.time - state.timing.last.time > HISTORY_DOG.gapMs
      && !samePlaceGap(state.timing.last, place, HISTORY_DOG)) {
      state.timing.from = row.time;
      state.timing.clipped = false;
    }
    state.timing.last = place;
  } else {
    state.timing = null;
  }
  state.range = advanceRange(state.range, rangeRow(row, !!current));
  state.battery = advanceBattery(state.battery, batteryReading(row, row.time));
}

// The fixes of the first HOLD_LOOKBACK_MS of rows a tracker is fed (a cold
// start's whole replay), for mayBeginEarlier; let go once no hold can start
// in them any more (a start reaches back at most retroMaxMs).
function noteEarly(state, row) {
  if (!state.early) return;
  if (row.time - state.firstAt > HOLD_LOOKBACK_MS + state.config.retroMaxMs) { state.early = null; return; }
  if (row.time - state.firstAt <= HOLD_LOOKBACK_MS && hasFix(row)) {
    state.early.push({ time: row.time, latitude: Number(row.latitude), longitude: Number(row.longitude) });
  }
}

/**
 * Whether a hold first held at `from` may have begun before the rows this
 * tracker was fed (HoldStore `fromClipped`). Its last good fix (`since`) is
 * older than all of them (a cold start's seeds); or it starts in the first
 * HOLD_LOOKBACK_MS of them and none of the fixes before it was anywhere else
 * (farther than farRadiusM from its anchor): a tracker that never saw the dog
 * arrive cannot tell that the history, replaying the whole day, has not held
 * it there since long before (2026-10-15: indoor drift with five satellites
 * and a poor HDOP leaves a cold start no good seeds, and its hold anchored on
 * the window's own weak fixes read 「室內・25 分」 for a stay of two and a
 * half hours). The card then asks the history (CardIndoorStay), which says
 * the same start when the dog did arrive at `from`.
 */
function mayBeginEarlier(state, since, from, anchor) {
  if (since < state.firstAt) return true;
  if (!state.early || !anchor || from - state.firstAt > HOLD_LOOKBACK_MS) return false;
  return state.early.every(fix => fix.time >= from || distanceMeters(fix, anchor) <= state.config.farRadiusM);
}

// Keeps the newest MAX_SEEDS seeds, and their keys with them.
function addSeeds(state, rows) {
  state.seeds = state.seeds.concat(rows);
  if (state.seeds.length > MAX_SEEDS) {
    state.seeds = state.seeds.slice(-MAX_SEEDS);
    state.seedKeys = new Set(state.seeds.map(rowKey));
  }
}

// Lets go of the keys of rows older than `before`: an hour behind the window
// (or behind its newest row), further back than a snapshot context replays.
// Keys are added in time order but for late rows, so this stops at the first
// newer one; a late key behind it goes when the keys before it do.
function forget(state, before) {
  for (const [key, time] of state.seen) {
    if (time >= before) break;
    state.seen.delete(key);
  }
}

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
      // `seen`: the key of every row fed (rowKey -> time), kept a while after
      // the row leaves the window, so a replayed one is known (forget);
      // `seedKeys`: the keys of `seeds`.
      dogs.set(slaveId, { tracker: createHoldTracker(config, options), rows: [], seeds: [], touched: 0,
        range: emptyRange(), config, heldRows: new WeakSet(), timing: null, battery: null, firstAt: null, early: null,
        seen: new Map(), seedKeys: new Set() });
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
        // The live map hands every snapshot's whole half-hour context (and its
        // seeds) in again, every 30 s (useCloudDogs). Rows and seeds already
        // fed are dropped here, so a silent dog's rows are not appended again
        // and again (audit F6: its newest row, equal to lastTime, used to pass
        // and pile up, never trimmed, scanned whole for every row).
        const freshSeeds = batch.seeds.filter(row => {
          const key = rowKey(row);
          if (state.seedKeys.has(key)) return false;
          state.seedKeys.add(key);
          return true;
        });
        if (freshSeeds.length) {
          addSeeds(state, freshSeeds);
          // The whole batch, as before: a new seed is trusted by its neighbours.
          state.tracker.seed(batch.seeds);
          state.touched = Math.max(state.touched, ...freshSeeds.map(row => row.time));
        }
        // The phone's own upload comes back from the cloud with the BLE row's
        // time: the same row again, not a late one.
        batch.rows = batch.rows.filter(row => {
          const key = rowKey(row);
          if (state.seen.has(key)) return false;
          state.seen.set(key, row.time);
          return true;
        });
        if (!batch.rows.length) continue;
        const lastTime = state.tracker.lastTime();
        const late = batch.rows[0].time < lastTime;
        state.rows = state.rows.concat(batch.rows).sort((left, right) => left.time - right.time);
        const newest = state.rows.length ? state.rows[state.rows.length - 1].time : 0;
        const heldSince = state.tracker.current(newest)?.since;
        const keepFrom = Number.isFinite(heldSince)
          ? Math.max(newest - HELD_LOOKBACK_MS, Math.min(newest - HOLD_LOOKBACK_MS, heldSince - HOLD_LOOKBACK_MS))
          : newest - HOLD_LOOKBACK_MS;
        // Good fixes leaving the window stay as seeds, so a replay still knows them.
        const leaving = state.rows.filter(row => row.time < keepFrom && fixQuality(row, config) === 'good'
          && !state.seedKeys.has(rowKey(row)));
        if (leaving.length) {
          leaving.forEach(row => state.seedKeys.add(rowKey(row)));
          addSeeds(state, leaving);
        }
        state.rows = state.rows.filter(row => row.time >= keepFrom);
        forget(state, Math.min(keepFrom, newest - HOLD_LOOKBACK_MS) - HOLD_LOOKBACK_MS);
        if (late) {
          // A Master uploading late, or a slow download: replay the window in
          // time order instead of dropping what came in behind.
          const from = state.rows[0]?.time ?? Infinity;
          const tracker = createHoldTracker(config, options);
          tracker.seed([...state.seeds, ...state.tracker.goodFixes()].filter(row => row.time < from));
          const before = state.timing;
          Object.assign(state, { tracker, heldRows: new WeakSet(), timing: null, battery: null, firstAt: null,
            early: null });
          for (let index = 0; index < state.rows.length; index += 1) step(state, state.rows, index);
          // The window may have let go of where a long hold began (it keeps at
          // most HELD_LOOKBACK_MS): a hold that now begins with the window is
          // the one held before the replay, and keeps the start it had.
          if (state.timing?.clipped && before && before.from < state.timing.from) {
            Object.assign(state.timing, { from: before.from, clipped: before.clipped });
          }
        } else {
          const position = new Map(state.rows.map((row, index) => [row, index]));
          for (const row of batch.rows) {
            const index = position.get(row);
            // A row the window already let go of (older than it keeps).
            if (index === undefined) step(state, [row], 0);
            else step(state, state.rows, index);
          }
        }
        state.touched = Math.max(state.touched, newest);
      }
    },
    holds(now) {
      const result = {};
      for (const [slaveId, state] of dogs) {
        const current = state.tracker.current(now);
        // `from`: where the history's 室內 node of this hold starts (step).
        // `fromClipped`: the rows it was fed begin inside the hold, so the
        // hold may have begun before `from` (DogMerge `heldFromClipped`).
        if (current) {
          result[slaveId] = state.timing?.since === current.since
            ? { ...current, from: state.timing.from, ...(state.timing.clipped ? { fromClipped: true } : {}) } : current;
        }
      }
      return result;
    },
    // Each dog's battery judgement (BatteryPlausibility.advanceBattery state)
    // over the same rows, for DogMerge.
    batteries() {
      const result = {};
      for (const [slaveId, state] of dogs) {
        if (state.battery) result[slaveId] = state.battery;
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
    // How much each dog keeps: window rows, seeds and remembered row keys
    // (diagnostics and tests: none of them may grow with a long session).
    sizes() {
      const result = {};
      for (const [slaveId, state] of dogs) {
        result[slaveId] = { rows: state.rows.length, seeds: state.seeds.length, keys: state.seen.size };
      }
      return result;
    },
    statuses() {
      const result = {};
      // `rowsFrom`/`newestAt`: the first and newest row this tracker was fed.
      // A dog not held whose last good fix is older than `rowsFrom` may be
      // inside a hold the rows begin in the middle of (useHistoryHolds).
      for (const [slaveId, state] of dogs) {
        const newestAt = state.tracker.lastTime();
        result[slaveId] = { ...state.tracker.status(), rowsFrom: state.firstAt,
          newestAt: Number.isFinite(newestAt) ? newestAt : null, indoorState: state.tracker.snapshot() };
      }
      return result;
    },
  };
}
