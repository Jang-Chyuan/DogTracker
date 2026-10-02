// Where things sit in the home sheet, in sheet coordinates (dp, origin at the
// sheet's top-left). Pure and marked as worklets, so the UI thread runs them
// every frame of a drag while jest can call them directly.

export const HANDLE_HEIGHT = 22;
export const HEADER_HEIGHT = 46;
export const SIDE = 16;              // horizontal padding inside the sheet
export const CHIP_WIDTH = 72;
export const CHIP_GAP = 8;
export const STRIP_RING = 46;        // avatar ring in the strip
export const ROW_RING = 42;          // avatar ring in a list row (DogList)
export const ROW_RING_CENTER_X = 18 + ROW_RING / 2; // content padding 18, row inset cancels
export const CHIP_TEXT = 40;         // name and status lines under the ring, at font scale 1

// The three heights the sheet settles at. The collapsed sheet holds the
// header and the avatar strip, growing with the system font size.
export function liveSheetStops(windowHeight, bottomInset, topInset, fontScale = 1) {
  const scale = Math.min(fontScale, 1.6);
  const collapsed = Math.ceil(HANDLE_HEIGHT + HEADER_HEIGHT * scale + STRIP_RING + 4 + CHIP_TEXT * scale + 12);
  const expanded = Math.max(collapsed, windowHeight - bottomInset - topInset - 24);
  const half = Math.min(expanded, Math.max(collapsed + 3 * 60, Math.round(windowHeight * 0.45)));
  return { collapsed, half, expanded };
}

export function headerBottom(fontScale = 1) {
  'worklet';
  return HANDLE_HEIGHT + HEADER_HEIGHT * Math.min(fontScale, 1.6);
}

// 0 while collapsed, 1 from the half height up: the flight happens between.
export function flightProgress(height, stops) {
  'worklet';
  const span = stops.half - stops.collapsed;
  if (span <= 0) return height > stops.collapsed ? 1 : 0;
  return Math.max(0, Math.min(1, (height - stops.collapsed) / span));
}

// Centre of a dog's avatar in the strip, after the strip's horizontal scroll.
export function stripSlot(index, scrollX, fontScale = 1) {
  'worklet';
  return {
    x: SIDE + index * (CHIP_WIDTH + CHIP_GAP) + CHIP_WIDTH / 2 - scrollX,
    y: headerBottom(fontScale) + STRIP_RING / 2,
  };
}

// Centre of a dog's avatar in its list row, after the list's vertical scroll.
// rowY and rowHeight are measured from the row itself, so large fonts and
// wrapped text move the target with the row.
export function rowSlot(rowY, rowHeight, scrollY, fontScale = 1) {
  'worklet';
  return {
    x: ROW_RING_CENTER_X,
    y: headerBottom(fontScale) + rowY + rowHeight / 2 - scrollY,
  };
}

// One avatar's position part-way through the flight. Each avatar leaves a
// little after the one before it; y leads and x follows, so they first spread
// down to their rows and then slide left instead of bunching on a diagonal.
// With reduced motion the avatar does not travel: it is either here or there.
export function flightPoint(progress, index, from, to, reduced = false) {
  'worklet';
  const p = Math.max(0, Math.min(1, (progress - Math.min(index, 6) * 0.05) / 0.7));
  if (reduced) {
    const there = progress >= 0.5;
    return { x: there ? to.x : from.x, y: there ? to.y : from.y, size: there ? ROW_RING : STRIP_RING, p: there ? 1 : 0 };
  }
  const px = p * p;
  const py = 1 - (1 - p) * (1 - p);
  return {
    x: from.x + (to.x - from.x) * px,
    y: from.y + (to.y - from.y) * py,
    size: STRIP_RING + (ROW_RING - STRIP_RING) * p,
    p,
  };
}

// Which stop a released drag settles at: a fling goes to the next stop in
// its direction, a slow release to the nearest one. Velocity in dp/s, up is
// positive.
export function settleStop(height, velocityUp, stops) {
  'worklet';
  const entries = [['collapsed', stops.collapsed], ['half', stops.half], ['expanded', stops.expanded]];
  if (Math.abs(velocityUp) > 350) {
    const ahead = entries.filter(([, value]) => (velocityUp > 0 ? value > height + 1 : value < height - 1));
    if (ahead.length) return velocityUp > 0 ? ahead[0][0] : ahead[ahead.length - 1][0];
  }
  let best = entries[0];
  for (const entry of entries) if (Math.abs(entry[1] - height) < Math.abs(best[1] - height)) best = entry;
  return best[0];
}
