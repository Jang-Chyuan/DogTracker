export const SHEET_COLLAPSED_HEIGHT = 76;
export function clampHeight(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
export function sheetStops(windowHeight, bottomInset, topInset, fontScale = 1) {
  // Keep the handle, title and update time visible at larger system font sizes.
  const collapsed = Math.max(
    SHEET_COLLAPSED_HEIGHT,
    28 + Math.ceil(36 * fontScale),
  );
  const expanded = Math.max(
    collapsed,
    windowHeight - bottomInset - topInset - 110,
  );
  return {
    collapsed,
    compact: Math.min(expanded, Math.max(collapsed, 160, windowHeight * 0.43)),
    expanded,
  };
}
export function shouldDragSheet(
  { dx, dy },
  currentHeight,
  maximum,
  scrollOffset,
) {
  return (
    Math.abs(dy) > 8 &&
    Math.abs(dy) > Math.abs(dx) &&
    (currentHeight < maximum - 1 || (dy > 0 && scrollOffset <= 0))
  );
}
export function settleSheet(height, velocity, stops) {
  const entries = Object.entries(stops);
  if (Math.abs(velocity) > 0.35) {
    const direction = velocity < 0 ? 1 : -1;
    const next = entries.filter(
      ([, value]) => direction * (value - height) > 1,
    );
    if (next.length)
      return next.sort(
        (a, b) => Math.abs(a[1] - height) - Math.abs(b[1] - height),
      )[0][0];
  }
  return entries.reduce(
    (best, item) =>
      Math.abs(item[1] - height) < Math.abs(stops[best] - height)
        ? item[0]
        : best,
    'collapsed',
  );
}
