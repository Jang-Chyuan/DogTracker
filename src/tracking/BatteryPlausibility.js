// Whether a collar's battery reading can be believed, shared by everything
// that shows or alerts on it: the map marker and card (DogMerge, via
// HoldStore's per-dog state), the card's own read (DogCardReadings), the
// problems and alerts (DogProblems, AlertEvents) and the background check
// (android .../alerts/BatteryPlausibility.kt, kept equal by
// __tests__/BatteryPlausibilityParity.test.js). Pure.
//
// The receiver's `bp` / `battery_pct` comes through as it is, gated only by
// `battery_valid`; a single packet with bp=0 used to put 「0%・偏低」 on the
// card, a red 「!」 on the map and a low-battery alert. The stored rows keep
// the raw value (uploads too); only what is shown and alerted is judged here.
//
// A reading is believed when:
// - its percentage is within 0..BATTERY_MAX_PERCENT;
// - 0% comes with a voltage that says empty (0 < battery_mv ≤
//   BATTERY_EMPTY_MAX_MV); 0% with no voltage, 0 mV or more is a bad packet;
// - it is not a drop of more than BATTERY_DROP_POINTS from the last believed
//   reading, unless BATTERY_DROP_PACKETS packets in a row agree on it (within
//   BATTERY_AGREE_POINTS of each other). Until then the last believed reading
//   stays (the card shows its time once it is old, as before).
// Readings that are not believed are skipped: they neither count as a
// confirming packet nor break a run of them.

// All of these await the collar firmware's confirmation (what bp=0 and the
// voltage mean, how fast a pack can really drop); they are a first guess.
// The largest percentage the collar reports (firmware confirmation pending).
export const BATTERY_MAX_PERCENT = 100;
// 0% is believed only with a voltage at or below this (an empty cell); above
// it the cell is clearly not empty (firmware confirmation pending).
export const BATTERY_EMPTY_MAX_MV = 3500;
// A drop of more than this many percentage points from the last believed
// reading needs confirming (firmware confirmation pending).
export const BATTERY_DROP_POINTS = 30;
// How many packets in a row must agree on such a drop (firmware confirmation
// pending).
export const BATTERY_DROP_PACKETS = 2;
// Packets agree when they are within this many points of each other
// (firmware confirmation pending).
export const BATTERY_AGREE_POINTS = 5;

const number = value => (value == null || value === '' ? NaN : Number(value));

/** Whether a percentage is one the collar can report at all (0..BATTERY_MAX_PERCENT). */
export function batteryInRange(percentage) {
  const value = number(percentage);
  return Number.isFinite(value) && value >= 0 && value <= BATTERY_MAX_PERCENT;
}

/** Whether one reading on its own can be believed (range and the 0% voltage rule). */
export function plausibleBattery(percentage, millivolts) {
  if (!batteryInRange(percentage)) return false;
  if (number(percentage) !== 0) return true;
  const mv = number(millivolts);
  return Number.isFinite(mv) && mv > 0 && mv <= BATTERY_EMPTY_MAX_MV;
}

/**
 * The same single-reading rule as an SQL condition over a table's
 * battery_percentage and battery_mv columns (DogCardReadings).
 */
export const PLAUSIBLE_BATTERY_SQL = `battery_percentage >= 0 AND battery_percentage <= ${BATTERY_MAX_PERCENT}
  AND (battery_percentage <> 0 OR (battery_mv > 0 AND battery_mv <= ${BATTERY_EMPTY_MAX_MV}))`;

/**
 * A stored or received row's battery reading, or null when it has none
 * (battery_valid 0/false, no percentage, no time).
 * @param row { battery_percentage, battery_mv, battery_valid } (snake case)
 * @param at the row's time
 */
export function batteryReading(row, at) {
  const valid = row?.battery_valid;
  const percentage = number(row?.battery_percentage);
  if (valid === 0 || valid === false || !Number.isFinite(percentage) || !Number.isFinite(at)) return null;
  const millivolts = number(row?.battery_mv);
  return { percentage, millivolts: Number.isFinite(millivolts) ? millivolts : null, at };
}

/**
 * One more reading (oldest first) for a dog.
 * @param state the previous result, or null for none yet
 * @param reading { percentage, millivolts, at } (batteryReading), or null
 * @returns {{ accepted: { percentage, at } | null,
 *   pending: { percentage, at, count } | null, judgedAt: number | null }}
 *   `accepted` is the reading to show and alert on; `pending` a big drop
 *   waiting for agreeing packets; `judgedAt` the newest reading looked at
 *   (an older or equal one is the same packet again and changes nothing).
 */
export function advanceBattery(state, reading) {
  const previous = state || { accepted: null, pending: null, judgedAt: null };
  const at = number(reading?.at);
  if (!reading || !Number.isFinite(at)) return previous;
  if (Number.isFinite(previous.judgedAt) && at <= previous.judgedAt) return previous;
  const percentage = number(reading.percentage);
  if (!plausibleBattery(percentage, reading.millivolts)) return { ...previous, judgedAt: at };
  const accepted = previous.accepted;
  if (!accepted || accepted.percentage - percentage <= BATTERY_DROP_POINTS) {
    return { accepted: { percentage, at }, pending: null, judgedAt: at };
  }
  const agrees = previous.pending && Math.abs(previous.pending.percentage - percentage) <= BATTERY_AGREE_POINTS;
  const pending = { percentage, at, count: agrees ? previous.pending.count + 1 : 1 };
  if (pending.count >= BATTERY_DROP_PACKETS) return { accepted: { percentage, at }, pending: null, judgedAt: at };
  return { accepted, pending, judgedAt: at };
}

/** advanceBattery over readings in time order, from nothing. */
export function judgeBatteries(readings = [], state = null) {
  return readings.reduce(advanceBattery, state);
}
