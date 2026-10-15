import { t } from '../i18n';
import { SUSPECT_AHEAD_MS } from '../cloud/ServerClock';
// Has a dog had a new position lately? One judgement ("未更新" in the design,
// written 「沒有新位置」 in the app) shared by the live map (grey face, red
// "!"), the dog's card (位置 row) and the alerts. Pure: no React, no SQLite.
//
// The rules (design v3 §6 and 判定表「未更新…」「從來沒定位過」「停在原處時用
// 哪個位置和時間」「停在原處時的來源」「中斷連線時的狀態」「未更新怎麼解除」
// 「雲端狗未更新的更新時機」「雲端狗還沒有成功的即時同步」):
//
// - What is timed is the dog's newest valid position from any source; a packet
//   without a fix never makes an old position current. While the dog is held
//   indoors (#50) its packets are timed instead (indoors there are no good
//   fixes, and the held point is not a new position).
// - A position (or packet) this phone's receiver delivered: now − its time.
// - One from the cloud: last successful live download − its time, so the
//   answer only changes when a download succeeds (a slow or background
//   download does not turn every cloud dog grey). Before the first successful
//   live download of this run, once downloads have failed for more than
//   10 minutes in a row, or once the last successful download is more than
//   10 minutes old (back from a long background) and downloads have failed
//   for more than a minute, now − its time.
// - Stale after more than 10 minutes. It clears only when the same formula,
//   run on the newer data, comes out at 10 minutes or less: a late upload of
//   old rows does not clear it.
// - While the user has disconnected the receiver (中斷連線), its dogs do not go
//   stale; after reconnecting, a dog that was fine before gets
//   now − max(its time, reconnect time). A dog already stale before stays
//   stale under the plain formula. Several pauses chain: a dog still inside
//   the grace of one pause is fine when the next one starts.
// - A dog that never had a position is not on the map at all (drawn: false).
// - There is no upper age limit: a position older than 24 hours stays on the
//   map, grey.
// - Downloaded times are on this phone's clock (ServerClock). A time more
//   than SUSPECT_AHEAD_MS (3 min) ahead of the clock it is judged against is not
//   believed: the dog counts as stale (`suspect`), not as fresh for as long
//   as the skew lasts.

export const STALE_AFTER_MS = 10 * 60000;
// Cloud downloads failing for longer than this: judge cloud dogs by now.
export const CLOUD_FAILING_FALLBACK_MS = 10 * 60000;
// The last successful download older than this (the app was away, or the
// downloads have hung): once a download has failed, judge by now too ...
export const CLOUD_OLD_DOWNLOAD_MS = 10 * 60000;
// ... but only after it has kept failing this long, so one failed attempt
// (the network still waking up after a resume, a brief hiccup) does not
// turn every cloud dog grey for the seconds until the next one succeeds.
export const CLOUD_FAILING_GRACE_MS = 60000;

// A hold that is the dog riding along with this phone (RideAlong) is not
// indoors: it is drawn like any other dog and timed by its positions.
export const isIndoorHold = dog => !!dog?.heldReason && dog.heldSource !== 'ride';

/**
 * The clock cloud data is judged against.
 * @param cloud {{ lastDownloadAt?: number, failingSince?: number }} from the
 *   live cloud sync: when the last successful download started, and since
 *   when downloads have been failing without a success in between.
 */
//
// F2 (2026-10-15): the last download survives the app going away, so after a
// long background (or a run of hung attempts) it can be hours old. Judged by
// it, a cloud dog last seen 2 hours ago was drawn as current for the first 10
// minutes of failing downloads. Once that download is older than
// CLOUD_OLD_DOWNLOAD_MS and downloads have been failing for more than
// CLOUD_FAILING_GRACE_MS, cloud dogs are judged by now. While the first
// attempt after a resume is still under way nothing changes (the map is
// catching up meanwhile, ResumeCatchUp).
export function cloudClock(cloud, now) {
  const last = cloud?.lastDownloadAt;
  if (!Number.isFinite(last)) return now;
  const failing = cloud?.failingSince;
  if (Number.isFinite(failing)) {
    if (now - failing > CLOUD_FAILING_FALLBACK_MS) return now;
    if (now - last > CLOUD_OLD_DOWNLOAD_MS && now - failing > CLOUD_FAILING_GRACE_MS) return now;
  }
  return last;
}

/**
 * @param dog a merged dog (DogMerge.mergeDogMarkers): `coordinate`, `fixAt` and
 *   `fixSource` (its newest valid position), `packetAt` and `packetSource` (its
 *   newest packet), `heldReason`/`heldSource`.
 * @param options.now the map clock
 * @param options.cloud see cloudClock
 * @param options.pauses [{ pausedAt: number, resumedAt: number|null }] when
 *   the user disconnected this phone's receiver and when it was receiving
 *   again (null while still disconnected), oldest first (the receiver's
 *   getState().receiverPauses).
 * @returns {{ drawn: boolean, stale: boolean, basis: 'position'|'packet',
 *   source: 'ble'|'cloud'|null, lastAt: number|null, ageMs: number|null }}
 *   `lastAt` is the time to show (「最後 10:12」); `basis` says whether it is
 *   a position (「沒有新位置」) or a packet (「沒有新資料」).
 */
export function dogFreshness(dog, { now = Date.now(), cloud = null, pauses = [] } = {}) {
  const held = isIndoorHold(dog);
  const basis = held ? 'packet' : 'position';
  const lastAt = held ? (Number.isFinite(dog.packetAt) ? dog.packetAt : dog.fixAt) : dog?.fixAt;
  const source = (held ? dog.packetSource ?? dog.fixSource : dog?.fixSource) ?? null;
  if (!dog?.coordinate || !Number.isFinite(lastAt)) {
    return { drawn: !!dog?.coordinate, stale: false, basis, source, lastAt: null, ageMs: null };
  }
  const reference = source === 'cloud' ? cloudClock(cloud, now) : now;
  // A time from the future of the clock it is judged against comes from a
  // clock running ahead (a teammate's phone, the server, or this phone's own
  // clock set back since): it says nothing about how fresh the position is,
  // so it is not believed and never counts as fresh (F5).
  if (lastAt - reference > SUSPECT_AHEAD_MS) {
    return { drawn: true, stale: true, suspect: true, basis, source, lastAt, ageMs: null };
  }
  const ageMs = Math.max(0, reference - lastAt);
  if (source === 'cloud') return { drawn: true, stale: ageMs > STALE_AFTER_MS, basis, source, lastAt, ageMs };
  // The time the stale clock runs from: the position (or packet), moved on to
  // each reconnect the dog was still fine for.
  let from = lastAt;
  for (const pause of [...(pauses || [])].sort((left, right) => left.pausedAt - right.pausedAt)) {
    if (!Number.isFinite(pause?.pausedAt) || pause.pausedAt <= from) continue;
    // Already stale when switched off: the plain formula from here on.
    if (pause.pausedAt - from > STALE_AFTER_MS) break;
    // Still switched off: the clock stands still.
    if (!Number.isFinite(pause.resumedAt)) return { drawn: true, stale: false, basis, source, lastAt, ageMs };
    from = Math.max(from, pause.resumedAt);
  }
  return { drawn: true, stale: now - from > STALE_AFTER_MS, basis, source, lastAt, ageMs };
}

const pad = value => String(value).padStart(2, '0');

/** 「10:12」 today, 「10/1 14:32」 on another day (local time). */
export function lastTimeText(at, now) {
  const date = new Date(at);
  const today = new Date(now);
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const sameDay = date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth()
    && date.getDate() === today.getDate();
  return sameDay ? time : `${date.getMonth() + 1}/${date.getDate()} ${time}`;
}

/** The card's words for a stale dog: 「沒有新位置・最後 10:12」, or null. */
export function staleText(freshness, now) {
  if (!freshness?.stale || !Number.isFinite(freshness.lastAt)) return null;
  const what = freshness.basis === 'packet' ? t("c1040") : t("c475");
  return t("c1039", { what: what, value: lastTimeText(freshness.lastAt, now) });
}

/** The same for TalkBack: 「沒有新位置，最後 10:12」, or null. */
export function staleSpeech(freshness, now) {
  return staleText(freshness, now)?.replace('・', '，') ?? null;
}
