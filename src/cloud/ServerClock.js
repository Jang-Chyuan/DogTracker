import { logger } from '../logger';

// Three clocks meet on the live map (F5, 2026-10-15): this phone's (BLE rows,
// the map clock), the server's (a Wi-Fi upload's received_at) and other
// phones' (a relayed upload's phone_received_at). A phone whose clock is a few
// minutes off would otherwise drop the newest Wi-Fi rows (the download cutoff
// is compared with received_at), judge cloud positions too fresh or too old,
// let a teammate's skewed fix beat a newer BLE fix, and keep the receiver
// range from judging this phone's own packets (ReceiverRange cloudOnly).
//
// The server's offset is estimated from the HTTP Date header of every cloud
// response (whole seconds, written between the request and the response).
// Cloud rows are then moved onto this phone's clock where they meet BLE rows
// (cloudRowOnPhoneClock): the map merge, the hold/range trackers, freshness.

// Offsets within this are ignored (0): normal NTP drift and the Date header's
// one-second resolution, so a healthy phone never shifts a row. Beyond it the
// offset is applied in STEP_MS steps, so it only changes when the estimate
// really moves (the hold trackers dedupe rows by time).
export const SKEW_TOLERANCE_MS = 60000;
// A relayed row stamped this much later than the server received it is not
// believed (cloudRowOnPhoneClock): the uploading phone's clock runs ahead.
export const FUTURE_TOLERANCE_MS = 2 * 60000;
// A position this much newer than the clock it is judged against is not
// believed either (DogFreshness): beyond what the two tolerances above leave.
export const SUSPECT_AHEAD_MS = FUTURE_TOLERANCE_MS + SKEW_TOLERANCE_MS;
const STEP_MS = 5000;
const SAMPLES = 7;
// A slow response says little about when the header was written.
const MAX_ROUND_TRIP_MS = 10000;

const finite = value => (Number.isFinite(value) ? value : null);
const median = values => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

export function createServerClock({ log = logger } = {}) {
  let samples = [];
  let applied = 0;
  return {
    /**
     * One response: its Date header, and this phone's clock when the request
     * left and when the response came back.
     */
    observe(dateHeader, sentAt, receivedAt) {
      const server = typeof dateHeader === 'string' ? Date.parse(dateHeader) : NaN;
      if (!Number.isFinite(server) || !Number.isFinite(sentAt) || !Number.isFinite(receivedAt)
        || receivedAt < sentAt || receivedAt - sentAt > MAX_ROUND_TRIP_MS) return;
      // The header truncates to the second: on average half a second later.
      samples = [...samples, server + 500 - (sentAt + receivedAt) / 2].slice(-SAMPLES);
      const estimate = median(samples);
      let next = applied;
      // A little hysteresis at the edge, so an estimate around the tolerance
      // does not switch the correction on and off.
      const within = Math.abs(estimate) <= SKEW_TOLERANCE_MS - (applied === 0 ? 0 : STEP_MS);
      if (within) next = 0;
      else if (Math.abs(estimate - applied) >= STEP_MS) next = Math.round(estimate / STEP_MS) * STEP_MS;
      if (next !== applied) {
        applied = next;
        log?.info?.('[Cloud clock] server offset', applied);
      }
    },
    /** Server time − this phone's time, in ms; 0 when within tolerance or unknown. */
    offset: () => applied,
    /** The raw median estimate (null before any response), for diagnostics. */
    estimate: () => (samples.length ? median(samples) : null),
    reset() {
      samples = [];
      applied = 0;
    },
  };
}

/** The app's one server clock, fed by every Supabase response (CloudClient). */
export const serverClock = createServerClock();

/**
 * A fetch that feeds `clock` from each response's Date header and otherwise
 * passes everything through untouched.
 */
export function serverClockFetch(fetchImpl, clock = serverClock, now = Date.now) {
  return function (...args) {
    const sentAt = now();
    return Promise.resolve(fetchImpl.apply(this, args)).then(response => {
      try {
        const date = response?.headers?.get?.('date');
        if (date) clock.observe(date, sentAt, now());
      } catch { /* Never let the clock touch the response. */ }
      return response;
    });
  };
}

/**
 * A downloaded row's time on this phone's clock (its `track_at`), so it can be
 * compared with BLE rows and with the map clock:
 * - a Wi-Fi upload is stamped by the server: its time minus the offset;
 * - a relayed upload is stamped by the uploading phone. That clock is not
 *   known, but the row cannot have been received after it reached the server:
 *   a stamp later than that (beyond FUTURE_TOLERANCE_MS) is not believed, and
 *   the server's arrival time stands in (a teammate's clock running ahead
 *   then neither keeps the dog fresh nor beats a newer BLE fix).
 * BLE rows and rows without times are returned as they are; so is a row
 * whose time does not change (the same object).
 */
export function cloudRowOnPhoneClock(row, offset = serverClock.offset()) {
  if (!row || row.source === 'ble') return row;
  const base = finite(row.track_at) ?? finite(row.received_at);
  if (base == null) return row;
  const server = finite(row.received_at);
  const arrived = server == null ? null : server - offset;
  let time;
  if (row.upload_source === 'phone' && finite(row.phone_received_at) != null) {
    time = arrived != null && row.phone_received_at > arrived + FUTURE_TOLERANCE_MS ? arrived : row.phone_received_at;
  } else {
    time = base - offset;
  }
  return time === row.track_at ? row : { ...row, track_at: time };
}

/** cloudRowOnPhoneClock over a list, keeping the list when nothing moves. */
export function cloudRowsOnPhoneClock(rows, offset = serverClock.offset()) {
  if (!Array.isArray(rows)) return rows;
  let changed = false;
  const result = rows.map(row => {
    const next = cloudRowOnPhoneClock(row, offset);
    if (next !== row) changed = true;
    return next;
  });
  return changed ? result : rows;
}
