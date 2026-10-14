// Switching dogs from the open card (DESIGN.md「摘要卡片」「換狗」, 2026-10-14):
// the card's row of dogs (DogCarousel) and TalkBack's 下一隻／上一隻 go
// through one order of every dog on the map. Pure: MapScreen keeps the order
// taken when the card opened.
//
// - The order is DogOrder.compareDogOrder (the open dog, dogs with a
//   problem, then by signal-source number), taken once when a card opens,
//   so picking never reshuffles it (a dog getting a problem meanwhile does
//   not jump the queue).
// - A plain list with ends: no wrap-around (two dogs look like two).
import { compareDogOrder } from './DogOrder';

/**
 * Every drawn dog in switching order (however the card was opened: a dog, a
 * 「N 隻」 tag, a notification).
 * @param markers the drawn dogs (DogMarkers.dogMarkers: slaveId, problem)
 * @param openId the dog whose card is opening
 * @returns slaveIds, `openId` first
 */
export function switchOrder(markers = [], openId) {
  return markers
    .map(marker => ({ slaveId: marker.slaveId, problem: !!marker.problem, selected: marker.slaveId === openId }))
    .sort(compareDogOrder)
    .map(item => item.slaveId);
}

/**
 * The order taken at opening, as the map is now: dogs no longer drawn drop
 * out, dogs drawn since come last (in the same stable order).
 */
export function liveSwitchOrder(taken = [], markers = []) {
  const drawn = new Set(markers.map(marker => marker.slaveId));
  const kept = taken.filter(slaveId => drawn.has(slaveId));
  const known = new Set(kept);
  const added = switchOrder(markers.filter(marker => !known.has(marker.slaveId)), null);
  return [...kept, ...added];
}

/**
 * The dog `step` (+1 next, −1 previous) from `currentId` in the order; null
 * past either end (no wrap-around: the card's row of dogs is a plain list)
 * or with fewer than 2 dogs.
 */
export function switchTarget(order = [], currentId, step) {
  if (order.length < 2 || !step) return null;
  const index = order.indexOf(currentId);
  if (index < 0) return null;
  return order[index + Math.sign(step)] ?? null;
}
