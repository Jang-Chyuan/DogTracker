// One distance, as the app writes it everywhere a single distance is shown:
// the dog card's direction line, history list rows, the history cursor and
// the PNG list (DESIGN §7, 2026-10-13). Totals — the summary and 「今天 x km」
// — are always km (HistoryText.km, TodayDistance).
//
//   < 100 m      metres, 5 m steps        「0 m」「40 m」「95 m」
//   100–999 m    metres, 10 m steps       「120 m」「850 m」
//   ≥ 1 km       km, one decimal          「1.0 km」「12.4 km」
//
// Each step is decided on the rounded value: 98 m is 「100 m」, 996 m is
// 「1.0 km」. GPS cannot do better than a few metres, and a number that
// flickers by one metre every second only distracts.

const tenths = metres => (Math.round(metres / 100) / 10).toFixed(1);

export function distanceText(metres) {
  const value = Number.isFinite(metres) && metres > 0 ? metres : 0;
  const fives = Math.round(value / 5) * 5;
  if (fives < 100) return `${fives} m`;
  const tens = Math.round(value / 10) * 10;
  if (tens < 1000) return `${tens} m`;
  return `${tenths(value)} km`;
}
