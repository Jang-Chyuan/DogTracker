import { t } from '../i18n';
// Which problems exist right now, each as one episode (design v3 N, 「每一種提醒」
// 「條件、再提醒、解除」, edges「提醒」「電量」). Pure snapshot reducer: the caller
// hands in a complete picture every tick (a dog left out has no problem) and
// keeps the returned state for the next one.
//
// - Every problem is here whatever S6 says: the switches control the
//   notifications only (AlertScheduler), never what the app shows (「⚠ N」,
//   the gear's red dot, the dog's red 「!」).
// - The dog problems are DogProblems' (the same as the map's red 「!」); a dog
//   never located is not drawn and has none. 快離開 and activity never alert.
// - 不在接收範圍 only for a dog this phone's receiver heard (ReceiverRange is
//   handed in, never recomputed here).
// - 電量低: 20% or under, not charging. 10% once more for a dog. It stays one
//   episode until the battery is over 30% (21–30% hides the problem but a drop
//   back to 20% is not a new one): `present: false` while hidden.
// - 接收器斷線 and 位置存不進手機 are TopAlerts' (the same as the top cards).
import { dogFreshness } from '../tracking/DogFreshness';
import { dogProblems, LOW_BATTERY_PERCENT } from '../tracking/DogProblems';
import { receiverOutage, storageProblem, RECEIVER_BATTERY_LOW } from '../map/TopAlerts';
import { receiverNumber } from '../map/ReceiverState';

// edges「更嚴重」: 接收器斷線 ＞ 圈外 ＞ 位置存不進手機 ＞ 未更新 ＞ 狗電量低 ＞ 接收器電量低.
export const SEVERITY = Object.freeze({
  'receiver-disconnected': 6,
  'dog-out-of-range': 5,
  storage: 4,
  'dog-stale': 3,
  'dog-battery': 2,
  'receiver-battery': 1,
});

// A latched battery episode ends once the battery is over this.
export const BATTERY_CLEAR_PERCENT = 30;
// A dog's battery at or under this alerts once more (level 2).
export const BATTERY_AGAIN_PERCENT = 10;

export const alertKey = (kind, subject) => `${kind}:${subject}`;

/** Most severe first, then a stable order. */
export const bySeverity = (left, right) => (right.severity - left.severity) || left.key.localeCompare(right.key);

/**
 * @param previous the state this returned last time ({} at first)
 * @param input.dogs merged dogs (DogMerge) with `name` and `range` (the
 *   dog's ReceiverRange judgement, or null)
 * @param input.receiver the receiver's native state (getState())
 * @param input.receiverBattery { valid, percentage } of the receiver itself
 * @param input.storageError the failed write's reason, or null
 * @param input.now, input.cloud, input.pauses as DogFreshness.dogFreshness
 * @returns {{ active: Object<string, event>, batteries: Object, events: Array }}
 *   `events` are this tick's transitions ({ ...event, type: 'start' |
 *   'escalate' | 'clear', at }).
 */
export function updateAlertEvents(previous = {}, {
  dogs = [], receiver = null, receiverBattery = null, storageError = null, now, cloud = null, pauses = [],
} = {}) {
  const active = {};
  const batteries = { ...previous.batteries };
  const add = (kind, subject, detail = {}, startedAt = null) => {
    const key = alertKey(kind, subject);
    active[key] = {
      key, kind, subject, severity: SEVERITY[kind], level: 1, present: true,
      startedAt: startedAt ?? previous.active?.[key]?.startedAt ?? now,
      ...detail,
    };
  };
  // One latched battery episode per collar or receiver.
  const battery = (kind, subject, percentage, charging, detail) => {
    const latch = alertKey(kind, subject);
    if (Number.isFinite(percentage) && percentage > BATTERY_CLEAR_PERCENT) delete batteries[latch];
    const threshold = kind === 'receiver-battery' ? RECEIVER_BATTERY_LOW : LOW_BATTERY_PERCENT;
    const low = Number.isFinite(percentage) && percentage <= threshold && !charging;
    if (low) {
      const level = kind === 'dog-battery' && percentage <= BATTERY_AGAIN_PERCENT ? 2 : 1;
      batteries[latch] = {
        kind, subject, startedAt: batteries[latch]?.startedAt ?? now,
        level: Math.max(batteries[latch]?.level || 0, level), detail, percentage,
      };
    }
    if (batteries[latch]) {
      add(kind, subject, { ...batteries[latch].detail, ...detail,
        percentage: Number.isFinite(percentage) ? percentage : batteries[latch].percentage,
        level: batteries[latch].level, present: low }, batteries[latch].startedAt);
    }
  };

  let localDogs = 0;
  for (const dog of dogs) {
    const freshness = dogFreshness(dog, { now, cloud, pauses });
    if (!freshness.drawn) continue;
    const local = freshness.source !== 'cloud';
    if (local) localDogs += 1;
    const problems = dogProblems(dog, freshness, dog.range);
    const detail = {
      name: dog.name || t("c1009", { slaveId: dog.slaveId }), source: freshness.source || 'ble',
      // A dog this phone's receiver hears goes quiet when the receiver drops.
      receiverAffected: local,
    };
    if (problems.stale) {
      add('dog-stale', dog.slaveId, { ...detail, basis: freshness.basis, lastAt: freshness.lastAt,
        ageMs: freshness.ageMs });
    }
    if (problems.outOfRange && (local || previous.active?.[alertKey('dog-out-of-range', dog.slaveId)])) add('dog-out-of-range', dog.slaveId, detail);
    battery('dog-battery', dog.slaveId, dog.batteryPercentage, !!dog.charging, detail);
  }
  const outage = receiverOutage(receiver, now);
  if (outage) {
    // A new disconnection is a new episode (its own start time).
    add('receiver-disconnected', 'receiver', { outage: { ...outage, dogCount: localDogs }, source: 'ble' },
      outage.since);
  }
  const storage = storageProblem(storageError);
  if (storage) add('storage', 'phone', { storage, source: 'ble' });
  const number = receiverNumber(receiver);
  if (receiver?.enabled && number != null) {
    // Another receiver's low battery is not this one's.
    for (const [latch, value] of Object.entries(batteries)) {
      if (value?.kind === 'receiver-battery' && value.subject !== number) delete batteries[latch];
    }
    battery('receiver-battery', number, receiverBattery?.valid ? receiverBattery.percentage : null, false,
      { number, source: 'ble' });
  }
  // A latched battery without a reading this time (the dog not heard, the
  // receiver switched off) is still the same episode: kept, not shown.
  for (const [latch, value] of Object.entries(batteries)) {
    if (!active[latch] && value?.kind && value.subject != null) {
      add(value.kind, value.subject, { ...value.detail, percentage: value.percentage, level: value.level,
        present: false }, value.startedAt);
    }
  }

  const events = [];
  for (const item of Object.values(active)) {
    const old = previous.active?.[item.key];
    if (!old || old.startedAt !== item.startedAt) events.push({ ...item, type: 'start', at: now });
    else if (item.level > (old.level || 1)) events.push({ ...item, type: 'escalate', at: now });
  }
  for (const old of Object.values(previous.active || {})) {
    if (!active[old.key]) events.push({ ...old, type: 'clear', at: now });
  }
  return { active, batteries, events };
}
