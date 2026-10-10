import { size as sizes, space, border } from '../theme/tokens';

// Move a label upward until it clears all labels already placed.
export function clearLabelOverlap(rect, placed, gap = 6) {
  // DOMRect coordinates are prototype getters, so object spread loses them.
  let box = { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
  for (;;) {
    const collisions = placed.filter(other => box.left < other.right + gap && box.right + gap > other.left
      && box.top < other.bottom + gap && box.bottom + gap > other.top);
    if (!collisions.length) return box.top - rect.top;
    const shift = box.bottom - Math.min(...collisions.map(other => other.top)) + gap;
    box = { ...box, top: box.top - shift, bottom: box.bottom - shift };
  }
}

export function lineHitsBox(start, end, box, padding = 3) {
  let lo = 0, hi = 1;
  for (const [axis, min, max] of [['x', box.left - padding, box.right + padding], ['y', box.top - padding, box.bottom + padding]]) {
    const delta = end[axis] - start[axis];
    if (Math.abs(delta) < 1e-9) {
      if (start[axis] < min || start[axis] > max) return false;
    } else {
      const a = (min - start[axis]) / delta, b = (max - start[axis]) / delta;
      lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b));
      if (lo > hi) return false;
    }
  }
  return true;
}

export function labelLineEnd(point, box) {
  const center = { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 };
  const dx = point.x - center.x, dy = point.y - center.y;
  const scale = Math.min(dx ? (box.right - box.left) / 2 / Math.abs(dx) : Infinity,
    dy ? (box.bottom - box.top) / 2 / Math.abs(dy) : Infinity);
  return { x: center.x + dx * scale, y: center.y + dy * scale };
}

export function linesCross(a, b, c, d) {
  if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-7 || Math.hypot(d.x - c.x, d.y - c.y) < 1e-7) return false;
  const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const abC = cross(a, b, c), abD = cross(a, b, d);
  const cdA = cross(c, d, a), cdB = cross(c, d, b);
  const epsilon = 1e-7;
  if (abC * abD < -epsilon && cdA * cdB < -epsilon) return true;
  // A shared collar position is allowed, but overlapping line segments are not.
  if ([abC, abD, cdA, cdB].every(value => Math.abs(value) < epsilon)) {
    const axis = Math.abs(b.x - a.x) > Math.abs(b.y - a.y) ? 'x' : 'y';
    return Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis]))
      - Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis])) > epsilon;
  }
  const inside = (p, q, r) => Math.abs(cross(p, q, r)) < epsilon
    && (r.x - p.x) * (r.x - q.x) + (r.y - p.y) * (r.y - q.y) < -epsilon;
  return inside(a, b, c) || inside(a, b, d) || inside(c, d, a) || inside(c, d, b);
}

export function spreadDogIcons(points, gap = 44, spacing = 48) {
  const placed = [];
  const display = points.map(origin => {
    let chosen = origin;
    search: for (let ring = 0; ring <= points.length + 2; ring++) {
      for (let step = 0; step < (ring ? 32 : 1); step++) {
        const angle = -Math.PI / 2 + step * Math.PI / 16;
        const candidate = { x: origin.x + Math.cos(angle) * ring * spacing, y: origin.y + Math.sin(angle) * ring * spacing };
        if (placed.some(other => Math.abs(other.x - candidate.x) < gap && Math.abs(other.y - candidate.y) < gap)) continue;
        chosen = candidate; break search;
      }
    }
    placed.push(chosen);
    return chosen;
  });
  // Keep the separated slots, but exchange assignments to uncross the legs.
  // Swapping crossing straight segments reduces their total length.
  for (let pass = 0; pass < points.length * points.length * 10; pass++) {
    let changed = false;
    for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
      if (!linesCross(points[i], display[i], points[j], display[j])) continue;
      if (linesCross(points[i], display[j], points[j], display[i])) continue;
      [display[i], display[j]] = [display[j], display[i]];
      changed = true;
    }
    if (!changed) break;
  }
  return display;
}

export function placeDogLabel(point, width, height, placed, icons, bounds, lines = []) {
  const overlaps = (a, b) => a.left < b.right + 6 && a.right + 6 > b.left
    && a.top < b.bottom + 6 && a.bottom + 6 > b.top;
  for (let ring = 0; ring < placed.length + icons.length + 10; ring++) {
    for (let step = 0; step < 32; step++) {
      const angle = -Math.PI / 2 + step * Math.PI / 16;
      const dx = Math.cos(angle), dy = Math.sin(angle);
      const distance = 30 + Math.abs(dx) * width / 2 + Math.abs(dy) * height / 2 + ring * 18;
      const left = point.x + dx * distance - width / 2, top = point.y + dy * distance - height / 2;
      const box = { left, top, right: left + width, bottom: top + height, angle };
      if (box.left < bounds.left || box.right > bounds.right || box.top < bounds.top || box.bottom > bounds.bottom) continue;
      if ([...placed, ...icons].some(other => overlaps(box, other))) continue;
      const end = labelLineEnd(point, box);
      if (placed.some(other => lineHitsBox(point, end, other))) continue;
      if (lines.some(line => lineHitsBox(line.start, line.end, box))) continue;
      if (lines.some(line => linesCross(point, end, line.start, line.end))) continue;
      return box;
    }
  }
  const clearance = sizes.marker.normal / 2 + space.s + border.hairline;
  const box = { left: point.x - width / 2, right: point.x + width / 2, top: point.y - clearance - height, bottom: point.y - clearance };
  const shift = clearLabelOverlap(box, [...placed, ...icons]);
  return { ...box, top: box.top + shift, bottom: box.bottom + shift, side: 'top' };
}
