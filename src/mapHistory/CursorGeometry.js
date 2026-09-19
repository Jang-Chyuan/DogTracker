export function snapToRoute(segments, point) {
  let best = null, distance = Infinity;
  for (const segment of segments) for (let i = 0; i < segment.length; i += 1) {
    const a = segment[i], b = segment[Math.min(i + 1, segment.length - 1)];
    const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
    const f = length ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length)) : 0;
    const x = a.x + dx * f, y = a.y + dy * f, d = (x - point.x) ** 2 + (y - point.y) ** 2;
    if (d < distance) { distance = d; best = { x, y, time: a.time + (b.time - a.time) * f, a, b }; }
  }
  return best;
}
export function intersectsBox(a, b, box) {
  let low = 0, high = 1;
  for (const [start, delta, min, max] of [[a.x, b.x - a.x, box.x - 8, box.x + box.width + 8],
    [a.y, b.y - a.y, box.y - 8, box.y + box.height + 8]]) {
    if (delta === 0) { if (start < min || start > max) return false; }
    else {
      const t1 = (min - start) / delta, t2 = (max - start) / delta;
      low = Math.max(low, Math.min(t1, t2)); high = Math.min(high, Math.max(t1, t2));
      if (low > high) return false;
    }
  }
  return true;
}
export function cursorLabelBox(segments, cursor, width, height, top, bottom) {
  const boxes = [];
  for (let y = top + 8; y + 58 < height - bottom; y += 32)
    for (let x = 8; x + 146 < width; x += 32) boxes.push({ x, y, width: 146, height: 58 });
  boxes.sort((a, b) => (a.x + 73 - cursor.x) ** 2 + (a.y + 29 - cursor.y) ** 2 -
    ((b.x + 73 - cursor.x) ** 2 + (b.y + 29 - cursor.y) ** 2));
  return boxes.find(box => !segments.some(segment => segment.some((p, i) =>
    intersectsBox(p, segment[Math.min(i + 1, segment.length - 1)], box)))) || null;
}
