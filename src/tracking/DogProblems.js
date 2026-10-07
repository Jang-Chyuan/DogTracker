// What is wrong with a dog, shared by the map (one red "!" and a larger
// face), the card (one row per problem) and the alerts. Pure.
//
// Design v3「狗的標記：所有情況」: a dog has a problem when it is out of the
// receiver's range, its battery is at 20% or below while not charging, or it
// has had no new position for 10 minutes (DogFreshness). Several problems
// still draw one "!"; which ones is written on the card. Charging and being
// held indoors are states, not problems.
import { RANGE_STATUS } from './ReceiverRange';

export const LOW_BATTERY_PERCENT = 20;

/**
 * @param dog a merged dog (DogMerge): `batteryPercentage`, `charging`
 * @param freshness DogFreshness.dogFreshness of the same dog
 * @param range the dog's receiver-range judgement (ReceiverRange), or null
 * @returns {{ outOfRange: boolean, lowBattery: boolean, stale: boolean, any: boolean }}
 */
export function dogProblems(dog, freshness, range) {
  const battery = dog?.batteryPercentage;
  const outOfRange = range?.status === RANGE_STATUS.OUT;
  const lowBattery = Number.isFinite(battery) && battery <= LOW_BATTERY_PERCENT && !dog?.charging;
  const stale = !!freshness?.stale;
  return { outOfRange, lowBattery, stale, any: outOfRange || lowBattery || stale };
}
