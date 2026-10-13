import { t } from '../i18n';
// What a dog's summary card (design v3 A3/A3b/A7b, DESIGN.md「摘要卡片」「卡片
// 的狀態列」) says, as plain values: the direction and distance from the phone,
// then one row each for 位置 (only when the dog has no new position or is held
// indoors), 電量, 接收範圍 (only when this phone's receiver judged it) and
// 活動量. Pure: no React, no clock of its own; the card only draws this.
//
// The card has no 接收器 row (判定表「接收器斷線時狗的卡片」): the receiver's
// state is in the top alerts and settings.
import { isIndoorHold, lastTimeText, staleText } from '../tracking/DogFreshness';
import { rangeLabel, rangeView } from '../tracking/ReceiverRange';
import { LOW_BATTERY_PERCENT } from '../tracking/DogProblems';
import { PHONE_FIX_MAX_AGE_S } from './MapFraming';
import { bearingAndDistance, compassWord, formatDistance } from './DogReadout';
import { activityState, activityWords, minuteOf } from '../activity/ActivityMinutes';
import { listDuration } from '../history/HistoryText';

// The phone's position is written as old (「手機位置 3 分鐘前」) after this.
export const PHONE_OLD_AFTER_MS = 30 * 1000;
// A battery or activity reading this much older than the position gets its
// time written after it (「62%（09:40）」).
export const READING_OLD_AFTER_MS = 10 * 60000;
const MINUTE = 60000;

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
 * The headline: 「↗ 850 m 離手機」 and its variants, or 「手機沒有定位」.
 * @returns {{ kind: 'distance', distance, bearing, compass, suffix } |
 *   { kind: 'no-phone', text: '手機沒有定位' } | { kind: 'no-dog' }}
 *   `bearing` is true north; the card turns the arrow by the map's heading.
 */
export function cardHeadline({ dog, phone, indoor, stale }) {
  if (!phone) return { kind: 'no-phone', text: t("c726") };
  if (!dog?.coordinate) return { kind: 'no-dog' };
  const { metres, bearing } = bearingAndDistance(phone.coordinate, dog.coordinate);
  const parts = [t('c064')];
  if (indoor) parts.push(t('c114'));
  if (stale) parts.push(indoor ? t("c725") : t("c727"));
  if (phone.ageMs > PHONE_OLD_AFTER_MS) {
    parts.push(t("c728", { value: Math.max(1, Math.floor(phone.ageMs / MINUTE)) }));
  }
  return { kind: 'distance', distance: formatDistance(metres), bearing, compass: compassWord(bearing),
    suffix: parts.join('・') };
}

/**
 * How long the dog has been held indoors, as the history's time line says it
 * (「室內・26 分」, HistoryTimelinePresentation): from the first row the
 * hold covers (`heldFrom`, HoldStore) to its newest packet, in whole clock
 * minutes. null when the times are not known.
 */
export function indoorDurationMs(dog, stay = null) {
  return indoorDuration(dog, stay)?.ms ?? null;
}

/**
 * The same, for a live hold whose rows begin inside it (`heldFromClipped`: a
 * cold start replays half an hour): from where the history's stay begins
 * (CardIndoorStay, `stay`), the whole stay over midnight too. `over`: the
 * start is still not known (no history rows hold it there, or the stay is
 * older than the card looks back), so the minutes are a lower bound
 * (「室內・超過 24 時」). null while the history is being asked, or when the
 * times are not known.
 * @returns {{ ms, over } | null}
 */
export function indoorDuration(dog, stay = null) {
  const live = Number.isFinite(dog?.heldFrom) ? dog.heldFrom : dog?.heldSince;
  const until = Number.isFinite(dog?.packetAt) ? dog.packetAt : dog?.lastPacketAt;
  if (!Number.isFinite(live) || !Number.isFinite(until)) return null;
  const since = from => Math.max(0, Math.floor(until / MINUTE) - Math.floor(from / MINUTE)) * MINUTE;
  if (!dog.heldFromClipped || !stay) return { ms: since(live), over: !!dog.heldFromClipped };
  if (stay.state === 'pending') return null;
  if (stay.state === 'found' && Number.isFinite(stay.from)) {
    return { ms: since(Math.min(stay.from, live)), over: !!stay.clipped };
  }
  return { ms: since(live), over: true };
}

const HOUR = 60 * MINUTE;
// 「26 分」, 「1 時 13 分」; a lower bound in whole hours past one: 「超過 24 時」.
function indoorText(duration) {
  if (!duration) return t('c114');
  if (!duration.over) return t('c344', { duration: listDuration(duration.ms) });
  const bound = duration.ms >= HOUR ? Math.floor(duration.ms / HOUR) * HOUR : duration.ms;
  return t('c344', { duration: t('c1282', { duration: listDuration(bound) }) });
}

/**
 * The 活動量 row's words for the dog's activity minutes.
 * @param activity { minutes: ActivityMinutes.activityMinutes(), newestAt }
 * @param options.reference the clock the dog is judged by (now, or the cloud
 *   clock for a cloud dog); options.positionAt its position (or packet) time;
 *   options.stale no new position: always 「—」
 */
export function activityRow(activity, { reference, positionAt, stale }) {
  const minutes = activity?.minutes || [];
  if (stale || !minutes.length || !Number.isFinite(reference)) return { ...activityWords(null), at: null };
  const newestAt = Number.isFinite(activity.newestAt) ? activity.newestAt : minutes[minutes.length - 1].minute;
  // Readings older than the position by 10 minutes or more: say what they
  // said then, with their time, rather than 「—」 or a guess about now.
  const old = Number.isFinite(positionAt) && positionAt - newestAt >= READING_OLD_AFTER_MS;
  const end = old ? minuteOf(newestAt) : minuteOf(reference) - MINUTE;
  const words = activityWords(activityState(minutes, { end }));
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
 * @param options.indoorStay useCardIndoorStay() for a hold begun before the
 *   live rows, or null
 */
export function dogCard(dog, { freshness, range = null, battery = null, activity = null, phone = null, now,
  reference = now, name, address = null, indoorStay = null }) {
  const indoor = isIndoorHold(dog);
  const stale = !!freshness?.stale;
  const positionAt = indoor ? (Number.isFinite(dog.packetAt) ? dog.packetAt : dog.fixAt) : dog.fixAt;
  const rows = [];
  // 位置: only when there is something to say about where the dog is.
  if (stale) {
    rows.push({ key: 'position', label: t('c073'), value: staleText(freshness, now), tone: 'crit',
      detail: indoor ? address : null, twoLine: indoor });
  } else if (indoor) {
    // Two lines (64dp) held indoors: 「室內・26 分」 and the address under it
    // (A7b). The minutes are the history's for the same hold (GPS: since the
    // hold began), not the 活動量 row's rest (the collar's motion).
    // No address yet, none found or offline: no second line and no spinner
    // (edges「沒網路時查地址」), the row keeps its 64dp so nothing jumps.
    // A stay begun before the live rows (a cold start) is timed from where
    // the history's stay begins (`indoorStay`, CardIndoorStay).
    rows.push({ key: 'position', label: t('c073'), value: indoorText(indoorDuration(dog, indoorStay)),
      tone: null, detail: address, twoLine: true });
  }
  rows.push(batteryRow(dog, battery, positionAt, now));
  const view = rangeView(range, { held: indoor });
  if (view) {
    rows.push({ key: 'range', label: t('c066'), value: rangeLabel(view, clock),
      tone: view.problem ? 'crit' : view.warning ? 'warn' : null });
  }
  const words = activityRow(activity, { reference, positionAt, stale });
  rows.push({ key: 'activity', label: t('c068'), value: words.word, detail: words.detail,
    speechDetail: words.speechDetail ?? null, at: words.at, tone: null, activityTone: words.tone, pressable: true });
  for (const row of rows) row.speech = rowSpeech(row);
  const headline = cardHeadline({ dog, phone, indoor, stale });
  return {
    slaveId: dog.slaveId,
    name,
    sourceLabel: t('c052', { number: dog.slaveId }),
    stale,
    indoor,
    headline,
    headlineSpeech: headlineSpeech(name, headline),
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
  return `${row.label}，${value}${detail}${at}`;
}

function headlineSpeech(name, headline) {
  if (headline.kind === 'no-phone') return `${name}，${headline.text}`;
  if (headline.kind !== 'distance') return name;
  return t("c722", { name: name, compass: headline.compass, value: headline.distance.replace(' km', t("c729")).replace(' m', t("c730")), value2: headline.suffix.replace(/・/g, '，') });
}

