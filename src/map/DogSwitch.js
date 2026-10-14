// Switching dogs from the open card (DESIGN.md「摘要卡片」「換狗」, 2026-10-14):
// the card's row of dogs (DogCarousel) and TalkBack's 下一隻／上一隻 go
// through one order of every dog on the map. Pure.
//
// - By signal-source number only (訊號源 4, 5, 6 …): no problems first, so a
//   dog getting a problem never moves, and the open dog keeps its own place
//   (the row scrolls to it). Dogs gone drop out, new ones fall into their
//   number's place.
// - A plain list with ends: no wrap-around (two dogs look like two).

/**
 * Every drawn dog in switching order (however the card was opened: a dog, a
 * 「N 隻」 tag, a notification).
 * @param markers the drawn dogs (DogMarkers.dogMarkers: slaveId)
 * @returns slaveIds by signal-source number
 */
export function switchOrder(markers = []) {
  return [...new Set(markers.map(marker => marker.slaveId))].sort((a, b) => a - b);
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
