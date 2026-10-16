import { t } from '../i18n';
// What a dog's summary card (design v3 A3/A3b/A7b, DESIGN.md「摘要卡片」「卡片
// 的狀態列」) says, as plain values: always three rows — 位置 or 接收範圍
// (with the direction and distance from the phone), 電量 and 活動量. Pure: no
// React, no clock of its own; the card only draws this.
//
// The card has no 接收器 row (判定表「接收器斷線時狗的卡片」): the receiver's
// state is in the top alerts and settings.
import { isIndoorHold, lastTimeText, staleText } from '../tracking/DogFreshness';
import { RANGE_STATUS, rangeLabel, rangeView } from '../tracking/ReceiverRange';
import { LOW_BATTERY_PERCENT } from '../tracking/DogProblems';
import { PHONE_FIX_MAX_AGE_S } from './MapFraming';
import { bearingAndDistance, compassWord, formatDistance } from './DogReadout';
import { ACTIVITY_STATE, activityState, activityWords, minuteOf } from '../activity/ActivityMinutes';
import { CARD_ACTIVITY_LOOKBACK_MS } from '../activity/DogCardReadings';

// The phone's position is written as old (「手機位置 3 分鐘前」) after this.
export const PHONE_OLD_AFTER_MS = 30 * 1000;
// A battery or activity reading this much older than the position gets its
// time written after it (「62%（09:40）」).
export const READING_OLD_AFTER_MS = 10 * 60000;
const MINUTE = 60000;
const HOUR = 60 * MINUTE;

const pad = value => String(value).padStart(2, '0');
const clock = at => {
  const date = new Date(at);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/**
 * The phone's newest fix and how old it is, or null when the phone has no
 * position (not recording, none yet, or older than 10 minutes).
 * @param livePhone useLiveLocation's snapshot: { running, position: {latitude,
 *   longitude, timestamp}, ageSeconds }
 */
export function phoneReading(livePhone, now) {
  const position = livePhone?.position;
  if (!livePhone?.running || !Number.isFinite(position?.latitude) || !Number.isFinite(position?.longitude)) return null;
  const ageMs = Number.isFinite(position.timestamp) ? Math.max(0, now - position.timestamp)
    : Number.isFinite(livePhone.ageSeconds) ? livePhone.ageSeconds * 1000 : null;
  if (ageMs == null || ageMs > PHONE_FIX_MAX_AGE_S * 1000) return null;
  return { coordinate: { latitude: position.latitude, longitude: position.longitude }, ageMs };
}

/**
 * The map's own blue dot (MapView onUserLocationChange, `receivedAt` = when it
 * came), for when the recording service has no fix: 位置記錄 off still leaves
 * the phone located, and the card must not say 手機沒有定位 under a blue dot.
 */
export function nativePhoneReading(nativePhone, now) {
  if (!Number.isFinite(nativePhone?.latitude) || !Number.isFinite(nativePhone?.longitude)
    || !Number.isFinite(nativePhone?.receivedAt)) return null;
  const ageMs = Math.max(0, now - nativePhone.receivedAt);
  if (ageMs > PHONE_FIX_MAX_AGE_S * 1000) return null;
  return { coordinate: { latitude: nativePhone.latitude, longitude: nativePhone.longitude }, ageMs };
}

/**
 * The direction and distance from the phone at the first row's right end
 * (「↗ 850 m」), or 「手機沒有定位」.
 * @returns {{ kind: 'distance', distance, bearing, compass, phoneAge } |
 *   { kind: 'no-phone', text: '手機沒有定位' } | { kind: 'no-dog' }}
 *   `bearing` is true north; the card turns the arrow by the map's heading.
 */
export function cardHeadline({ dog, phone }) {
  if (!phone) return { kind: 'no-phone', text: t("c726") };
  if (!dog?.coordinate) return { kind: 'no-dog' };
  const { metres, bearing } = bearingAndDistance(phone.coordinate, dog.coordinate);
  // The phone's own fix is old: said under the distance (「手機位置 3 分鐘前」).
  const phoneAge = phone.ageMs > PHONE_OLD_AFTER_MS
    ? t("c728", { value: Math.max(1, Math.floor(phone.ageMs / MINUTE)) }) : null;
  return { kind: 'distance', distance: formatDistance(metres), bearing, compass: compassWord(bearing), phoneAge };
}

/**
 * The 活動量 row's words for the dog's activity minutes.
 * @param activity { minutes: ActivityMinutes.activityMinutes(), newestAt }
 * @param options.reference the clock the dog is judged by (now, or the cloud
 *   clock for a cloud dog); options.positionAt its position (or packet) time;
 *   options.stale no new position: always 「—」; options.charging the dog's
 *   newest packet says the collar is on USB power (the 電量 row's 充電中):
 *   「充電中」, never 休息 (2026-10-16: a collar on its charger reports a
 *   valid 0 and read as 「休息中・超過 6 小時」)
 */
export function activityRow(activity, { reference, positionAt, stale, charging = false }) {
  const minutes = activity?.minutes || [];
  if (stale) return { ...activityWords(null), at: null };
  if (charging) return { ...activityWords({ state: ACTIVITY_STATE.CHARGING }), at: null };
  if (!minutes.length || !Number.isFinite(reference)) return { ...activityWords(null), at: null };
  const newestAt = Number.isFinite(activity.newestAt) ? activity.newestAt : minutes[minutes.length - 1].minute;
  // Readings older than the position by 10 minutes or more: say what they
  // said then, with their time, rather than 「—」 or a guess about now.
  const old = Number.isFinite(positionAt) && positionAt - newestAt >= READING_OLD_AFTER_MS;
  // Readings a few minutes behind (the downloaded archive the card reads
  // trails the latest positions, most of all while a cold start catches up):
  // judged up to their newest minute, not up to now, or the minutes still to
  // come make the window look empty (「—」, 沒有資料).
  const end = old ? minuteOf(newestAt) : Math.min(minuteOf(reference) - MINUTE, minuteOf(newestAt));
  // A rest is followed back to where it began (useDogCardReadings reads
  // older rows while it reaches the edge): 「已 8 小時 12 分」. Still reaching
  // the edge — the older rows are being read (`extending`: 「休息中」 alone,
  // not a number about to change), or it reaches past the limit — it is
  // 「超過 24 小時」, in whole hours of what was read, so it never slides
  // minute by minute with the read window (2026-10-15).
  const state = activityState(minutes, { end, from: activity.from });
  const reach = Number.isFinite(activity.from) ? reference - activity.from : CARD_ACTIVITY_LOOKBACK_MS;
  const words = activityWords(state, { lookbackMinutes: Math.max(1, Math.floor(reach / HOUR)) * 60 });
  if (state.over && activity.extending && words.tone === 'rest') {
    return { ...words, detail: null, speechDetail: null, at: old ? newestAt : null };
  }
  return { ...words, at: old && words.tone ? newestAt : null };
}

/**
 * Everything the card shows.
 * @param dog a merged dog (DogMerge) with `coordinate`
 * @param options.freshness DogFreshness.dogFreshness of the dog
 * @param options.range its receiver-range judgement (ReceiverRange), or null
 * @param options.battery the newest valid battery reading { percentage,
 *   charging, at } (null: the dog's own newest packet is used)
 * @param options.activity { minutes, newestAt } (see activityRow)
 * @param options.phone phoneReading()
 * @param options.reference the clock activity is judged by
 * @param options.name the dog's name (「小黑」, 「狗 4」)
 * @param options.address the held place's address (A7b second line), or null
 */
export function dogCard(dog, { freshness, range = null, battery = null, activity = null, phone = null, now,
  reference = now, name, address = null }) {
  const indoor = isIndoorHold(dog);
  const stale = !!freshness?.stale;
  const positionAt = indoor ? (Number.isFinite(dog.packetAt) ? dog.packetAt : dog.fixAt) : dog.fixAt;
  const view = rangeView(range, { held: indoor });
  const out = view?.status === RANGE_STATUS.OUT;
  // Always three rows (2026-10-14, the row of dogs): one about where the dog
  // is, 電量, 活動量. The first says the most pressing of: held indoors (or
  // indoors and silent), no new position, the receiver's range, and — when
  // this phone's receiver has not judged the dog (a dog only from the cloud,
  // or the receiver away) — when its position is from. Out of range with
  // indoors or no new position: the row's last line says 不在接收範圍 too.
  const alert = out ? rangeLabel(view, clock) : null;
  let place;
  if (indoor) {
    // Two lines (56dp) held indoors: 「室內」 and the address under it (A7b).
    // No minutes (2026-10-16, the user's decision: the card does not time
    // the stay; the history does). Still asking: no second line and no
    // spinner, the row keeps its two lines so nothing jumps. None found,
    // offline or timed out: useAddress gives the place's coordinates instead
    // (2026-10-14), read out the same. Silent too: 「09:05 之後沒有新資料」
    // over the same address.
    place = { key: 'position', label: t('c073'),
      value: stale ? staleText(freshness, now) : t('c114'),
      tone: stale ? 'crit' : null, detail: address, twoLine: true, alert };
  } else if (stale) {
    place = { key: 'position', label: t('c073'), value: staleText(freshness, now), tone: 'crit', detail: null,
      twoLine: !!alert, alert };
  } else if (view) {
    place = { key: 'range', label: t('c066'), value: rangeLabel(view, clock),
      tone: view.problem ? 'crit' : view.warning ? 'warn' : null, alert: null };
  } else {
    // Not judged here: 「09:30 更新」, the time of its newest position.
    place = { key: 'position', label: t('c073'),
      value: Number.isFinite(dog.fixAt) ? t('c1416', { time: lastTimeText(dog.fixAt, now) }) : '—',
      tone: null, detail: null, alert: null };
  }
  const rows = [place, batteryRow(dog, battery, positionAt, now)];
  const words = activityRow(activity, { reference, positionAt, stale, charging: !!dog.charging });
  rows.push({ key: 'activity', label: t('c068'), value: words.word, detail: words.detail,
    speechDetail: words.speechDetail ?? null, at: words.at, tone: null, activityTone: words.tone, pressable: true });
  for (const row of rows) row.speech = rowSpeech(row);
  // The first row carries the direction and distance from the phone at its
  // right end (at a large font, under its words), and TalkBack reads it there.
  const headline = cardHeadline({ dog, phone });
  const distance = distanceSpeech(headline);
  if (distance) place.speech = `${place.speech}，${distance}`;
  return {
    slaveId: dog.slaveId,
    name,
    sourceLabel: t('c052', { number: dog.slaveId }),
    stale,
    indoor,
    headline,
    rows,
  };
}

function batteryRow(dog, battery, positionAt, now) {
  // The newer of the card's own read (the newest believed reading) and the
  // dog's (DogMerge: its newest packet's, or the last believed one when that
  // packet's could not be believed); equal times take the dog's.
  const packet = Number.isFinite(dog.batteryPercentage)
    ? { percentage: dog.batteryPercentage, at: Number.isFinite(dog.batteryAt) ? dog.batteryAt : dog.packetAt } : null;
  const read = Number.isFinite(battery?.percentage) ? battery : null;
  const reading = !read ? packet : !packet ? read
    : (Number(read.at) > Number(packet.at) ? read : packet);
  if (!reading) return { key: 'battery', label: t('c065'), value: '—', tone: null };
  // Charging is what the newest packet says now (USB, or the environment's
  // USB rule), not what an older reading said.
  const charging = !!dog.charging;
  const percent = `${Math.round(reading.percentage)}%`;
  const low = reading.percentage <= LOW_BATTERY_PERCENT && !charging;
  const old = Number.isFinite(reading.at) && Number.isFinite(positionAt)
    && positionAt - reading.at >= READING_OLD_AFTER_MS;
  const value = ((charging) ? t("c719", { percent: percent, value: old ? `（${lastTimeText(reading.at, now)}）` : '' }) : (!(charging) && (low) ? t("c720", { percent: percent, value: old ? `（${lastTimeText(reading.at, now)}）` : '' }) : t("c721", { percent: percent, value: old ? `（${lastTimeText(reading.at, now)}）` : '' })));
  return { key: 'battery', label: t('c065'), value, tone: low ? 'crit' : null };
}

/** TalkBack for one row (copy deck c377, c393). */
export function rowSpeech(row) {
  const value = row.value === '—' ? t('c089') : row.value.replace(/・/g, '，');
  const at = row.at ? `，${clock(row.at)}` : '';
  // 活動量: the minutes are how long the collar's motion has been low (or
  // vigorous), said as such so they are not taken for the 室內 minutes.
  const spoken = row.key === 'activity' && row.speechDetail ? row.speechDetail : row.detail;
  const detail = spoken ? `，${spoken}` : '';
  // 「電量 15%，偏低」 reads without a pause after the label.
  if (row.key === 'battery') return t('c179', { percentage: value });
  const alert = row.alert ? `，${row.alert.replace(/・/g, '，')}` : '';
  return `${row.label}，${value}${detail}${at}${alert}`;
}

/** TalkBack for the distance: 「東北方 850 公尺，離手機」, or 「手機沒有定位」. */
function distanceSpeech(headline) {
  if (headline.kind === 'no-phone') return headline.text;
  if (headline.kind !== 'distance') return null;
  const value = headline.distance.replace(' km', t("c729")).replace(' m', t("c730"));
  const said = t('c1352', { compass: headline.compass, value });
  return headline.phoneAge ? `${said}，${headline.phoneAge}` : said;
}

