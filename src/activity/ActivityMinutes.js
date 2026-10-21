import { t } from '../i18n';
import { isCharging } from '../models/UsbPresent';
// A dog's activity as one value per minute, and what those minutes say: 休息
// (resting), 劇烈 (vigorous) or 一般. Shared by the dog's card (活動量 row,
// PR 046) and the activity detail page (A4, PR 057). Pure: no React, no SQLite.
//
// The rules (design v3 判定表「每分鐘活動量值」「低／高活動」「活動量缺資料」,
// 「A4 怎麼算」, 「卡片：活動量一列的文字」):
//
// - Readings go into whole-minute buckets by the reading's own time (the
//   position time: dog_status.received_at, supabase_dog_status.track_at — the
//   collar's activity_time unit is not confirmed yet, docs/trackerdoc-h0).
// - The same reading downloaded back from the cloud (this phone's own upload,
//   or a receiver both heard) counts once: a downloaded reading with a local
//   reading's key within 2 minutes of it is its copy, and the local copy wins
//   (uniqueReadings).
// - A minute's value is the mean of its readings. The minute still running is
//   left out (it would judge on a few seconds).
// - Gap fill (2026-10-19): collars send sparsely to save battery (30–110 s
//   apart, now and then 3–4 minutes). A minute without a reading between two
//   minutes with readings at most 4 minutes apart (FILL_MAX_GAP_MINUTES: at
//   most 3 empty minutes in a row) carries the previous minute's value; it is
//   not 沒有資料. Longer gaps are. Between two charging minutes the limit is
//   30 minutes (CHARGING_FILL_MAX_GAP_MINUTES, 2026-10-21: on its charger the
//   collar sends only every 4–9 minutes). Charging and not charging never fill
//   into each other (fillActivityGaps). Counted on whole minutes, not on the
//   readings' own times, because week, month and year only have per-minute
//   sums: a reading at 10:00:00 and the next at 10:04:59 fill 10:01–10:03.
// - 休息: every one of the last 10 minutes has a value (a reading, or filled:
//   no gap over 4 minutes) and every one is at most 0.10. 劇烈: the last 2
//   minutes both have a value at least 0.8, and the newer one is a reading of
//   its own (a filled minute never makes the pair: one packet is not 2 minutes
//   of 劇烈). Once either holds, it holds from the first minute of the first window
//   that qualified (rest fills back 10 minutes, vigorous 2) until a window no
//   longer qualifies. Going back, a rest is broken by a minute above 0.10, or
//   by more than REST_MAX_MISSING_MINUTES in a row without data; shorter
//   stretches without data do not end it, so a few lost packets do not
//   restart 「已 N 分鐘」. Its first minute is the first one with data after
//   whichever broke it.
// - Otherwise 一般 when the judged minute has a value, as on A4 (2026-10-19:
//   no longer 8 of the last 10 minutes), and nothing ("—") when it has none.
// - A minute in which the collar reported USB power (usb_present=1, 充電中;
//   2026-10-16: a collar on its charger reports a valid 0 and read as 休息)
//   is neither 休息, 一般 nor 劇烈: its readings do not count, and going back
//   it ends a rest or a vigorous run like an active minute does, so a rest
//   that began when the charger came off starts there. Judged at a charging
//   minute the state is 充電中 (`charging`).
// The thresholds are provisional (design: 暫定 0.10／10 分鐘、0.8／2 分鐘,
// pending field data; 2026-10-19 the user raised 0.05 to 0.10 and the gap
// fill from 3 to 4 minutes after replaying a sparse collar's day).

// The longest stretch of minutes without any data that a rest is carried
// across when counting back to its start; a longer one (collar off, out of
// range) ends it there. A first guess: revisit against real Supabase data.
export const REST_MAX_MISSING_MINUTES = 30;

// The longest gap between two minutes with readings whose minutes in between
// carry the earlier value (4: at most 3 empty minutes in a row; the user's
// decision of 2026-10-19 for battery-saving collars, whose packets are now and
// then 210–250 s apart).
export const FILL_MAX_GAP_MINUTES = 4;

// The same between two charging minutes: on its charger the collar sends only
// every 4–9 minutes (2026-10-21, the user's decision: 30).
export const CHARGING_FILL_MAX_GAP_MINUTES = 30;

export const ACTIVITY = Object.freeze({
  restMax: 0.1,
  restMinutes: 10,
  vigorousMin: 0.8,
  vigorousMinutes: 2,
  restMaxMissingMinutes: REST_MAX_MISSING_MINUTES,
  fillMaxGapMinutes: FILL_MAX_GAP_MINUTES,
  chargingFillMaxGapMinutes: CHARGING_FILL_MAX_GAP_MINUTES,
});

export const ACTIVITY_STATE = Object.freeze({ REST: 'rest', NORMAL: 'normal', VIGOROUS: 'vigorous',
  CHARGING: 'charging' });

const MINUTE = 60000;
export const minuteOf = time => Math.floor(time / MINUTE) * MINUTE;

const valid = value => Number.isFinite(value) && value >= 0 && value <= 1;

/**
 * Readings from stored rows (dog_status or supabase_dog_status shape):
 * `{ time, activity, activity_valid, activity_time, master_id, slave_id,
 * usb_present }`, where `time` is received_at (local) or track_at (cloud).
 * Rows without a valid activity are dropped, unless the collar was on USB
 * power: those are kept as `charging` (their value does not count).
 * @param source 'ble' | 'cloud'
 * @returns [{ time, value, key, source, charging? }]
 */
export function activityReadings(rows = [], source) {
  const result = [];
  for (const row of rows) {
    const time = row?.time == null ? NaN : Number(row.time);
    const value = row?.activity == null ? NaN : Number(row.activity);
    const flag = row?.activity_valid;
    if (!Number.isFinite(time)) continue;
    if (isCharging(row)) {
      result.push({ time, value: NaN, key: readingKey(row, time), source, charging: true });
      continue;
    }
    if (!valid(value) || flag === 0 || flag === false) continue;
    result.push({ time, value, key: readingKey(row, time), source });
  }
  return result;
}

/**
 * The key that makes the BLE copy and the cloud copy of one reading the same:
 * the dog, and the collar's own activity timestamp with the receiver when the
 * row has one (identical in both copies); otherwise the dog and the time to
 * the millisecond (this phone's uploads keep the phone's receive time as
 * track_at).
 */
export function readingKey(row, time = Number(row?.time)) {
  const stamp = row?.activity_time;
  if (stamp != null && stamp !== '') return `${row.slave_id}|a${stamp}|m${row.master_id ?? ''}`;
  return `${row?.slave_id}|t${time}`;
}

// A downloaded reading is a copy of a local one with the same key only this
// close in time (ActivityData's per-minute SQL looks for copies the same way).
export const COPY_WINDOW_MS = 2 * MINUTE;

/**
 * The readings with each copy of a reading counted once: a downloaded reading
 * with the key of a local one (readingKey) within COPY_WINDOW_MS of it is that
 * reading's copy, and the local one counts. Readings of the same table are
 * never copies of each other: the collar repeats its activity stamp over
 * several packets (2026-10-21: on the charger, 218 packets carried 132
 * stamps), and each packet is a minute of its own. As the per-minute SQL of
 * week, month and year (ActivityData.readActivityPeriod) counts them.
 */
export function uniqueReadings(readings = []) {
  const local = new Map();
  for (const reading of readings) {
    if (reading.source !== 'ble') continue;
    const times = local.get(reading.key);
    if (times) times.push(reading.time);
    else local.set(reading.key, [reading.time]);
  }
  return readings.filter(reading => {
    if (reading.source === 'ble') return true;
    const times = local.get(reading.key);
    return !times || !times.some(time => Math.abs(time - reading.time) <= COPY_WINDOW_MS);
  });
}

/**
 * One value per finished minute that has data, oldest first.
 * @param readings activityReadings() of both sources
 * @param options.now readings in now's minute (still running) are left out
 * @returns [{ minute, value, count, charging? }] `minute` is the minute's
 *   start (ms); a minute with a charging reading is `charging` (its value
 *   NaN when it has no other reading, and never judged)
 */
export function activityMinutes(readings = [], { now = Date.now() } = {}) {
  const current = minuteOf(now);
  const buckets = new Map();
  for (const reading of uniqueReadings(readings)) {
    const minute = minuteOf(reading.time);
    if (minute >= current) continue;
    const bucket = buckets.get(minute) || { minute, sum: 0, count: 0, charging: false };
    if (reading.charging) bucket.charging = true;
    else {
      bucket.sum += reading.value;
      bucket.count += 1;
    }
    buckets.set(minute, bucket);
  }
  return [...buckets.values()]
    .sort((left, right) => left.minute - right.minute)
    .map(({ minute, sum, count, charging }) => (charging
      ? { minute, value: count ? sum / count : NaN, count, charging: true }
      : { minute, value: sum / count, count }));
}

/**
 * The minutes with the gaps of at most `fillMaxGapMinutes` (between two
 * charging minutes `chargingFillMaxGapMinutes`) filled in (see the rules
 * above), in one pass. A minute between two minutes with readings that are
 * both charging or both not is filled: `{ minute, value, count: 0, filled:
 * true }` with the earlier minute's value, or `{ minute, value: NaN, count: 0,
 * charging: true, filled: true }` between two charging minutes. Between a
 * charging minute and one that is not nothing is filled.
 * @param minutes activityMinutes() or ActivityData.mergeMinutes() (oldest
 *   first, one entry per minute)
 * @param options.before minutes from here on are left out before filling (the
 *   minute still running; the card's judged minute + 1), so a later reading
 *   never fills a minute judged without it
 */
export function fillActivityGaps(minutes = [], { config = ACTIVITY, before = Infinity } = {}) {
  const most = (config.fillMaxGapMinutes ?? FILL_MAX_GAP_MINUTES) * MINUTE;
  const mostCharging = (config.chargingFillMaxGapMinutes ?? CHARGING_FILL_MAX_GAP_MINUTES) * MINUTE;
  const result = [];
  let previous = null;
  for (let index = 0; index < minutes.length; index += 1) {
    const item = minutes[index];
    if (!(item.minute < before)) continue;
    const gap = previous ? item.minute - previous.minute : 0;
    if (gap > MINUTE && !previous.charging === !item.charging
      && gap <= (previous.charging ? mostCharging : most)) {
      for (let minute = previous.minute + MINUTE; minute < item.minute; minute += MINUTE) {
        result.push(previous.charging ? { minute, value: NaN, count: 0, charging: true, filled: true }
          : { minute, value: previous.value, count: 0, filled: true });
      }
    }
    result.push(item);
    previous = item;
  }
  return result;
}

// Does the window of `length` minutes ending at minute `end` qualify?
function windowHolds(values, end, length, minData, test) {
  let data = 0;
  for (let index = 0; index < length; index += 1) {
    const value = values.get(end - index * MINUTE);
    if (value === undefined) continue;
    if (!test(value)) return false;
    data += 1;
  }
  return data >= minData;
}

// From which minute the run that is going on at `end` started: the first
// minute with data in the first of the consecutive qualifying windows ending
// at `end` (a run never starts before there was data). `extendNeeds` is how
// many minutes with data an earlier window needs to carry the run back (0 for
// a rest: only a minute failing `test` breaks it, missing data does not).
// `maxMissing`: more minutes than this in a row without data break it too
// (the run starts at the first minute with data after them).
function runStart(values, end, length, extendNeeds, test, earliest, maxMissing = Infinity, charging = null) {
  let last = end;
  // Minutes without data at the window's far end, already in a row.
  let missing = 0;
  for (let minute = end - (length - 1) * MINUTE; minute <= end && !values.has(minute); minute += MINUTE) missing += 1;
  while (last - MINUTE >= earliest && windowHolds(values, last - MINUTE, length, extendNeeds, test)) {
    // A minute on the charger ends the run: it starts after it.
    if (charging?.has(last - length * MINUTE)) break;
    // The minute the window now takes in at its far end.
    missing = values.has(last - length * MINUTE) ? 0 : missing + 1;
    if (missing > maxMissing) break;
    last -= MINUTE;
  }
  let start = last - (length - 1) * MINUTE;
  while (start < end && !values.has(start)) start += MINUTE;
  return start;
}

/**
 * What the minutes say at the end of minute `end` (the newest finished minute
 * the caller judges at).
 * @param minutes activityMinutes()
 * @param options.end start of the minute to judge at
 * @param options.from where the readings were read from (the card's
 *   lookback edge), if known
 * @returns {{ state: 'rest'|'vigorous'|'normal'|'charging'|null, since: number|null,
 *   durationMinutes: number|null, over?: true }}
 *   `since` is when a rest or vigorous run started, `durationMinutes` how long
 *   it has lasted at the end of `end`. null state: not enough data (「—」).
 *   `over`: a rest that runs back to the first reading, which is within one
 *   rest window (restMinutes) of `from`: nothing read ends it, so it began
 *   before the readings do and lasts longer than they reach back (the card's
 *   cue to read further back, useDogCardReadings; past its limit
 *   「休息中・超過 24 小時」, not a count that slides with the lookback).
 */
export function activityState(minutes = [], { end, from = null, config = ACTIVITY } = {}) {
  const none = { state: null, since: null, durationMinutes: null };
  if (!Number.isFinite(end) || !minutes.length) return none;
  // Judged on what was read up to `end`: a later reading fills nothing here.
  const filled = fillActivityGaps(minutes, { config, before: end + MINUTE });
  // Charging minutes are not data; going back they end a run (runStart).
  const charging = new Set(filled.filter(item => item.charging).map(item => item.minute));
  if (charging.has(end)) return { state: ACTIVITY_STATE.CHARGING, since: null, durationMinutes: null };
  const values = new Map(filled.filter(item => !item.charging).map(item => [item.minute, item.value]));
  // The newest minute is never filled (nothing after it is used), so `end`
  // with a value is a minute with a reading of its own.
  const earliest = minutes[0].minute;
  const vigorous = value => value >= config.vigorousMin;
  const rest = value => value <= config.restMax;
  // 劇烈 and 休息 need every one of their minutes (filled ones count).
  const vigorousNeeds = config.vigorousMinutes;
  const restNeeds = config.restMinutes;
  const run = (length, needs, test, state, maxMissing) => {
    const since = runStart(values, end, length, needs, test, earliest, maxMissing, charging);
    return { state, since, durationMinutes: Math.round((end + MINUTE - since) / MINUTE) };
  };
  if (windowHolds(values, end, config.vigorousMinutes, vigorousNeeds, vigorous)) {
    return run(config.vigorousMinutes, vigorousNeeds, vigorous, ACTIVITY_STATE.VIGOROUS);
  }
  if (windowHolds(values, end, config.restMinutes, restNeeds, rest)) {
    // Now needs all 10 minutes; going back, only an active minute ends it.
    const result = run(config.restMinutes, 0, rest, ACTIVITY_STATE.REST,
      config.restMaxMissingMinutes ?? REST_MAX_MISSING_MINUTES);
    const edge = Number.isFinite(from) && result.since === earliest
      && earliest - minuteOf(from) < config.restMinutes * MINUTE;
    return edge ? { ...result, over: true } : result;
  }
  // 一般: the judged minute has a value (a reading of its own), as on A4.
  if (values.has(end)) return { state: ACTIVITY_STATE.NORMAL, since: null, durationMinutes: null };
  return none;
}

/** 「18 分鐘」, 「1 小時 20 分」 (the A4 totals' style past an hour). */
export function durationText(minutes) {
  if (!Number.isFinite(minutes)) return '';
  const whole = Math.max(0, Math.round(minutes));
  if (whole < 60) return t("c435", { whole: whole });
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  return rest ? t("c436", { hours: hours, rest: rest }) : t("c437", { hours: hours });
}

/**
 * The card's 活動量 row: { word, detail, speechDetail, tone } —
 * 「休息中」+「已 18 分鐘」 (tone 'rest'; a rest `over` the lookback
 * 「超過 24 小時」, `lookbackMinutes`), 「劇烈活動」+「已 3 分鐘」
 * ('vigorous'), 「一般」 ('normal'), 「充電中」 ('charging': the collar is on
 * its charger, its readings are not the dog's), 「—」 (null) when there is not enough data
 * or the dog has no new position. `speechDetail` is what TalkBack says for the
 * minutes (「活動量低已 18 分鐘」): they are the collar's motion, not the
 * 室內 minutes of the 位置 row.
 */
export function activityWords(result, { lookbackMinutes = null } = {}) {
  switch (result?.state) {
    case ACTIVITY_STATE.REST: {
      if (result.over && Number.isFinite(lookbackMinutes)) {
        const duration = durationText(lookbackMinutes);
        return { word: t('c069'), detail: t('c1282', { duration }), speechDetail: t('c1370', { duration }),
          tone: 'rest' };
      }
      const duration = durationText(result.durationMinutes);
      return { word: t('c069'), detail: t('c070', { duration }), speechDetail: t('c1280', { duration }), tone: 'rest' };
    }
    case ACTIVITY_STATE.VIGOROUS: {
      const duration = durationText(result.durationMinutes);
      return { word: t('c350'), detail: t('c070', { duration }), speechDetail: t('c1281', { duration }), tone: 'vigorous' };
    }
    case ACTIVITY_STATE.NORMAL:
      return { word: t("c434"), detail: null, tone: 'normal' };
    case ACTIVITY_STATE.CHARGING:
      return { word: t('c731'), detail: null, tone: 'charging' };
    default:
      return { word: '—', detail: null, tone: null };
  }
}
