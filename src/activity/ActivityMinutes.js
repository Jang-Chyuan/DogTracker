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
//   or a receiver both heard) counts once: readings are deduplicated by a key,
//   and the local copy wins.
// - A minute's value is the mean of its readings. The minute still running is
//   left out (it would judge on a few seconds).
// - 休息: of the last 10 minutes at least 8 have data, and every one of them is
//   at most 0.05. 劇烈: the last 2 minutes both have data and both are at least
//   0.8. Once either holds, it holds from the first minute of the first window
//   that qualified (rest fills back 10 minutes, vigorous 2) until a window no
//   longer qualifies.
// - Otherwise 一般 when the last 10 minutes have enough data (8 of 10), and
//   nothing ("—") when they do not.
// The thresholds are provisional (design: 暫定 0.05／10 分鐘、0.8／2 分鐘,
// pending field data).

export const ACTIVITY = Object.freeze({
  restMax: 0.05,
  restMinutes: 10,
  vigorousMin: 0.8,
  vigorousMinutes: 2,
  // Share of a window's minutes that must have data.
  coverage: 0.8,
});

export const ACTIVITY_STATE = Object.freeze({ REST: 'rest', NORMAL: 'normal', VIGOROUS: 'vigorous' });

const MINUTE = 60000;
export const minuteOf = time => Math.floor(time / MINUTE) * MINUTE;

const valid = value => Number.isFinite(value) && value >= 0 && value <= 1;

/**
 * Readings from stored rows (dog_status or supabase_dog_status shape):
 * `{ time, activity, activity_valid, activity_time, master_id, slave_id }`,
 * where `time` is received_at (local) or track_at (cloud). Rows without a
 * valid activity are dropped.
 * @param source 'ble' | 'cloud'
 * @returns [{ time, value, key, source }]
 */
export function activityReadings(rows = [], source) {
  const result = [];
  for (const row of rows) {
    const time = row?.time == null ? NaN : Number(row.time);
    const value = row?.activity == null ? NaN : Number(row.activity);
    const flag = row?.activity_valid;
    if (!Number.isFinite(time) || !valid(value) || flag === 0 || flag === false) continue;
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

/**
 * One value per finished minute that has data, oldest first.
 * @param readings activityReadings() of both sources
 * @param options.now readings in now's minute (still running) are left out
 * @returns [{ minute, value, count }] `minute` is the minute's start (ms)
 */
export function activityMinutes(readings = [], { now = Date.now() } = {}) {
  const current = minuteOf(now);
  const unique = new Map();
  for (const reading of readings) {
    const old = unique.get(reading.key);
    // The local copy wins over the cloud copy of the same reading.
    if (!old || (old.source !== 'ble' && reading.source === 'ble')) unique.set(reading.key, reading);
  }
  const buckets = new Map();
  for (const reading of unique.values()) {
    const minute = minuteOf(reading.time);
    if (minute >= current) continue;
    const bucket = buckets.get(minute) || { minute, sum: 0, count: 0 };
    bucket.sum += reading.value;
    bucket.count += 1;
    buckets.set(minute, bucket);
  }
  return [...buckets.values()]
    .sort((left, right) => left.minute - right.minute)
    .map(({ minute, sum, count }) => ({ minute, value: sum / count, count }));
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
// at `end` (a run never starts before there was data).
function runStart(values, end, length, minData, test, earliest) {
  let last = end;
  while (last - MINUTE >= earliest && windowHolds(values, last - MINUTE, length, minData, test)) last -= MINUTE;
  let start = last - (length - 1) * MINUTE;
  while (start < last && !values.has(start)) start += MINUTE;
  return start;
}

/**
 * What the minutes say at the end of minute `end` (the newest finished minute
 * the caller judges at).
 * @param minutes activityMinutes()
 * @param options.end start of the minute to judge at
 * @returns {{ state: 'rest'|'vigorous'|'normal'|null, since: number|null,
 *   durationMinutes: number|null }}
 *   `since` is when a rest or vigorous run started, `durationMinutes` how long
 *   it has lasted at the end of `end`. null state: not enough data (「—」).
 */
export function activityState(minutes = [], { end, config = ACTIVITY } = {}) {
  const none = { state: null, since: null, durationMinutes: null };
  if (!Number.isFinite(end) || !minutes.length) return none;
  const values = new Map(minutes.map(item => [item.minute, item.value]));
  const earliest = minutes[0].minute;
  const vigorous = value => value >= config.vigorousMin;
  const rest = value => value <= config.restMax;
  // 劇烈 needs every one of its (few) minutes; 休息 tolerates gaps.
  const vigorousNeeds = config.vigorousMinutes;
  const restNeeds = Math.ceil(config.restMinutes * config.coverage - 1e-9);
  const run = (length, needs, test, state) => {
    const since = runStart(values, end, length, needs, test, earliest);
    return { state, since, durationMinutes: Math.round((end + MINUTE - since) / MINUTE) };
  };
  if (windowHolds(values, end, config.vigorousMinutes, vigorousNeeds, vigorous)) {
    return run(config.vigorousMinutes, vigorousNeeds, vigorous, ACTIVITY_STATE.VIGOROUS);
  }
  if (windowHolds(values, end, config.restMinutes, restNeeds, rest)) {
    return run(config.restMinutes, restNeeds, rest, ACTIVITY_STATE.REST);
  }
  if (windowHolds(values, end, config.restMinutes, restNeeds, () => true)) {
    return { state: ACTIVITY_STATE.NORMAL, since: null, durationMinutes: null };
  }
  return none;
}

/** 「18 分鐘」, 「1 小時 20 分」 (the A4 totals' style past an hour). */
export function durationText(minutes) {
  if (!Number.isFinite(minutes)) return '';
  const whole = Math.max(0, Math.round(minutes));
  if (whole < 60) return `${whole} 分鐘`;
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  return rest ? `${hours} 小時 ${rest} 分` : `${hours} 小時`;
}

/**
 * The card's 活動量 row: { word, detail, tone } — 「休息中」+「已 18 分鐘」
 * (tone 'rest'), 「劇烈活動」+「已 3 分鐘」 ('vigorous'), 「一般」 ('normal'),
 * 「—」 (null) when there is not enough data or the dog has no new position.
 */
export function activityWords(result) {
  switch (result?.state) {
    case ACTIVITY_STATE.REST:
      return { word: '休息中', detail: `已 ${durationText(result.durationMinutes)}`, tone: 'rest' };
    case ACTIVITY_STATE.VIGOROUS:
      return { word: '劇烈活動', detail: `已 ${durationText(result.durationMinutes)}`, tone: 'vigorous' };
    case ACTIVITY_STATE.NORMAL:
      return { word: '一般', detail: null, tone: 'normal' };
    default:
      return { word: '—', detail: null, tone: null };
  }
}
