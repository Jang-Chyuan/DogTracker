// Switching dogs from the open card (DESIGN.md「摘要卡片」「換狗」, 2026-10-13
// option B): ‹ › beside 看軌跡, a horizontal swipe on the card, and TalkBack's
// 下一隻／上一隻 actions all step through one order. Pure: MapScreen keeps the
// order taken when the card opened and DogCard reads the gestures.
//
// - The order is the edge hints' stable one (EdgeHints.compareDogOrder: the
//   open dog, dogs with a problem, then by signal-source number), taken once
//   when a card opens, so stepping never reshuffles it (a dog getting a
//   problem meanwhile does not jump the queue).
// - Opened from a 「N 隻」 tag: that group's dogs first, then the rest.
// - It wraps around: › on the last dog goes to the first.
import { compareDogOrder } from './EdgeHints';

/**
 * The dogs in switching order.
 * @param markers the drawn dogs (DogMarkers.dogMarkers: slaveId, problem)
 * @param openId the dog whose card is opening
 * @param group the slaveIds of the 「N 隻」 tag it was opened from, or null
 * @returns slaveIds, `openId` first
 */
export function switchOrder(markers = [], openId, group = null) {
  const inGroup = new Set(group?.length > 1 ? group : []);
  const sorted = markers
    .map(marker => ({ slaveId: marker.slaveId, problem: !!marker.problem, selected: marker.slaveId === openId }))
    .sort(compareDogOrder);
  return [
    ...sorted.filter(item => inGroup.has(item.slaveId)),
    ...sorted.filter(item => !inGroup.has(item.slaveId)),
  ].map(item => item.slaveId);
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

/** The dog `step` (+1 next, −1 previous) from `currentId`, wrapping; null with fewer than 2 dogs. */
export function switchTarget(order = [], currentId, step) {
  if (order.length < 2 || !step) return null;
  const index = order.indexOf(currentId);
  if (index < 0) return order[step > 0 ? 0 : order.length - 1];
  return order[(((index + Math.sign(step)) % order.length) + order.length) % order.length];
}

/** Where `currentId` is in the order: { index (1-based), count }. */
export function switchPosition(order = [], currentId) {
  const index = order.indexOf(currentId);
  return { index: index < 0 ? 0 : index + 1, count: order.length };
}

// ---- the swipe on the card ---------------------------------------------
// The card already closes on a downward drag (DogCard: dy > 8 and more down
// than sideways). A drag is a switch only when it is clearly sideways: past
// SWIPE_SLOP and at least SWIPE_RATIO times more across than down, so a
// slanted pull-down still closes the card. The map under the card never sees
// these touches (the card takes them), so map panning is not affected.
export const SWIPE_SLOP = 16;
export const SWIPE_RATIO = 1.5;
// Released past this, or flung faster than SWIPE_VELOCITY (dp/ms) after at
// least SWIPE_MIN_FLING, it switches; anything less springs back.
export const SWIPE_DISTANCE = 72;
export const SWIPE_VELOCITY = 0.5;
export const SWIPE_MIN_FLING = 24;

/** Whether a drag so far (PanResponder gesture: dx, dy) is a sideways swipe. */
export function isSwitchSwipe({ dx = 0, dy = 0 } = {}) {
  return Math.abs(dx) > SWIPE_SLOP && Math.abs(dx) >= SWIPE_RATIO * Math.abs(dy);
}

/**
 * What a released sideways swipe does: +1 (finger moved left: the next dog
 * comes in from the right), −1 (moved right: the previous one), 0 (springs back).
 */
export function swipeStep({ dx = 0, vx = 0 } = {}) {
  const far = Math.abs(dx) >= SWIPE_DISTANCE;
  const flung = Math.abs(dx) >= SWIPE_MIN_FLING && Math.abs(vx) >= SWIPE_VELOCITY && Math.sign(vx) === Math.sign(dx);
  if (!far && !flung) return 0;
  return dx < 0 ? 1 : -1;
}
