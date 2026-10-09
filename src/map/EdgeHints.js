import { t } from '../i18n';
// Dogs outside the visible map (design v3 A1「畫面外的狗用小頭像提示」, 判定表
// 「畫面邊緣的提示」「畫面外提示：左右兩邊都有狗在畫面外」, DESIGN.md §9.6 and
// §15「畫面外提示」). Pure: given where each dog is on screen, which hints to
// draw where. The renderer draws them (EdgeHintView) and frames a hint's dogs
// when it is tapped.
//
// - One hint per side that has dogs off it, at the edge where the line from
//   the middle of the visible map to the dogs leaves it, pointing outwards.
// - Up to 3 small faces (dogs with a problem first, so their red frame shows),
//   then 「+N」 for the rest.
// - The visible map is the screen minus the top controls and the bottom card;
//   a dog under the card counts as off screen. Hints keep clear of the bottom
//   right buttons.
import { layout, size as sizes, space } from '../theme/tokens';
import { tagSize } from './DogMarkers';

const hint = sizes.edgeHint;
export const EDGE_HINT_MARGIN = space.s;
// Inside a hint: side padding, the arrow and the gap after it.
const PADDING = space.s;
const ARROW = sizes.edgeHint.arrow;
const GAP = space.xs;
// 「+N」 at 14sp bold: about 9dp per character.
const plusWidth = extra => (extra > 0 ? GAP + 9 * String(`+${extra}`).length : 0);

const SIDE_WORD = { left: t("c749"), right: t("c750"), top: t("c751"), bottom: t("c746") };

/** The hint's width for `count` faces and `extra` more dogs. */
export function edgeHintWidth(count, extra = 0) {
  const faces = count > 0 ? hint.avatar + (count - 1) * (hint.avatar - hint.overlap) : 0;
  return PADDING + ARROW + GAP + faces + plusWidth(extra) + PADDING;
}

/**
 * TalkBack: 「左邊畫面外有 2 隻狗：小黑、豆豆，其中豆豆有問題，點兩下移過去」.
 */
export function edgeHintSpeech(side, markers) {
  const names = markers.map(marker => marker.name).join('、');
  const problems = markers.filter(marker => marker.problem).map(marker => marker.name);
  const problemPart = problems.length ? t("c748", { value: problems.join('、') }) : '';
  return t("c747", { value: SIDE_WORD[side], length: markers.length, names: names, problemPart: problemPart });
}

const clamp = (value, low, high) => (high < low ? low : Math.min(high, Math.max(low, value)));

export const boxesOverlap = (a, b) => a.left < b.right && b.left < a.right
  && a.top < b.bottom && b.top < a.bottom;

export function markerBox(marker, point, fontScale = 1) {
  const tag = tagSize(marker.tag || marker.name, fontScale);
  const radius = (marker.size || sizes.marker.normal) / 2;
  const halfWidth = Math.max(radius, tag.width / 2);
  return { left: point.x - halfWidth, right: point.x + halfWidth,
    top: point.y - radius, bottom: point.y + radius + sizes.marker.labelGap + tag.height };
}

export function mapButtonsBox({ width, height, bottom = 0 }) {
  return { left: width - layout.screenEdge - sizes.floatingButton - layout.floatingGap,
    right: width, top: height - bottom - 2 * sizes.floatingButton - layout.floatingGap,
    bottom: height - bottom };
}

export function mapControlBoxes(view) {
  const boxes = [mapButtonsBox(view)];
  if (view.bottomRow) boxes.push({ left: layout.screenEdge, right: view.width - layout.screenEdge,
    top: view.height - (view.bottom || 0) - view.bottomRow, bottom: view.height - (view.bottom || 0) });
  return boxes;
}

export const hintBox = item => ({ left: item.x, right: item.x + item.width,
  top: item.y, bottom: item.y + item.height });

/**
 * @param markers DogMarkers.dogMarkers output
 * @param points screen positions by dog, in dp: { [slaveId]: { x, y } }
 * @param view { width, height, top, bottom, bottomRow }: the screen, and how
 *   much of its top and bottom the controls and the card cover; bottomRow: the
 *   height of the bottom row (「今天 x km」 beside 我的位置) a bottom hint sits
 *   above
 * @returns [{ side, x, y, width, height, faces: marker[], extra, slaveIds,
 *   coordinates, label }]  x/y: the hint's top-left corner
 */
export function edgeHints(markers = [], points = {}, { width, height, top = 0, bottom = 0, bottomRow = 0, fontScale = 1 } = {}) {
  if (!(width > 0 && height > 0)) return [];
  const visibleTop = top;
  const visibleBottom = height - bottom;
  if (!(visibleBottom > visibleTop)) return [];
  const center = { x: width / 2, y: (visibleTop + visibleBottom) / 2 };
  const halfWidth = width / 2;
  const halfHeight = (visibleBottom - visibleTop) / 2;
  const sides = new Map();
  for (const marker of markers) {
    const point = points[marker.slaveId];
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    if (point.x >= 0 && point.x <= width && point.y >= visibleTop && point.y <= visibleBottom) continue;
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const horizontal = Math.abs(dx) / halfWidth >= Math.abs(dy) / halfHeight;
    const side = horizontal ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'top' : 'bottom');
    // Where the line from the middle to the dog leaves the visible map.
    const scale = horizontal ? halfWidth / Math.abs(dx) : halfHeight / Math.abs(dy);
    const exit = { x: center.x + dx * scale, y: center.y + dy * scale };
    if (!sides.has(side)) sides.set(side, []);
    sides.get(side).push({ marker, exit, distance: Math.hypot(dx, dy) });
  }
  const result = [];
  const occupied = markers.flatMap(marker => {
    const point = points[marker.slaveId];
    return point && point.x >= 0 && point.x <= width && point.y >= visibleTop && point.y <= visibleBottom
      ? [markerBox(marker, point, fontScale)] : [];
  });
  occupied.push(...mapControlBoxes({ width, height, bottom, bottomRow }));
  // The bottom right buttons (框住全部 above 我的位置) and the gaps around them.
  const buttonsTop = visibleBottom - 2 * sizes.floatingButton - layout.floatingGap;
  const buttonsLeft = width - layout.screenEdge - sizes.floatingButton;
  for (const side of ['left', 'right', 'top', 'bottom']) {
    const items = sides.get(side);
    if (!items) continue;
    // Problems first (their faces carry the red frame), then the nearest.
    const ordered = [...items].sort((left, right) => Number(right.marker.problem) - Number(left.marker.problem)
      || left.distance - right.distance || left.marker.slaveId - right.marker.slaveId);
    const faces = ordered.slice(0, hint.maxAvatars).map(item => item.marker);
    const extra = ordered.length - faces.length;
    const hintWidth = edgeHintWidth(faces.length, extra);
    const along = items.reduce((sum, item) => sum + (side === 'left' || side === 'right' ? item.exit.y : item.exit.x), 0)
      / items.length;
    let x, y;
    if (side === 'left' || side === 'right') {
      const lowest = side === 'right' ? buttonsTop - layout.floatingGap - hint.height
        : visibleBottom - EDGE_HINT_MARGIN - hint.height;
      y = clamp(along - hint.height / 2, visibleTop + EDGE_HINT_MARGIN, lowest);
      x = side === 'left' ? EDGE_HINT_MARGIN : width - EDGE_HINT_MARGIN - hintWidth;
    } else {
      const rightmost = side === 'bottom' ? buttonsLeft - layout.floatingGap - hintWidth
        : width - EDGE_HINT_MARGIN - hintWidth;
      x = clamp(along - hintWidth / 2, EDGE_HINT_MARGIN, rightmost);
      y = side === 'top' ? visibleTop + EDGE_HINT_MARGIN
        : visibleBottom - (bottomRow ? bottomRow + layout.floatingGap : EDGE_HINT_MARGIN) - hint.height;
    }
    // Search along this edge; preserve the hint while avoiding visible faces,
    // name tags and previously placed hints. In a crowded edge use the least
    // covered position rather than losing the off-screen dogs entirely.
    const vertical = side === 'left' || side === 'right';
    const low = vertical ? visibleTop + EDGE_HINT_MARGIN : EDGE_HINT_MARGIN;
    const high = vertical
      ? (side === 'right' ? buttonsTop - layout.floatingGap : visibleBottom - EDGE_HINT_MARGIN) - hint.height
      : (side === 'bottom' ? buttonsLeft - layout.floatingGap : width - EDGE_HINT_MARGIN) - hintWidth;
    const original = vertical ? y : x;
    const candidates = [original, low, high];
    for (const box of occupied) candidates.push(vertical
      ? box.top - hint.height - layout.floatingGap : box.left - hintWidth - layout.floatingGap,
    vertical ? box.bottom + layout.floatingGap : box.right + layout.floatingGap);
    const score = value => {
      const box = hintBox({ x: vertical ? x : value, y: vertical ? value : y,
        width: hintWidth, height: hint.height });
      return occupied.reduce((sum, other) => sum + (boxesOverlap(box, other)
        ? (Math.min(box.right, other.right) - Math.max(box.left, other.left))
          * (Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top)) : 0), 0);
    };
    const best = candidates.map(value => clamp(value, low, high))
      .sort((a, b) => score(a) - score(b) || Math.abs(a - original) - Math.abs(b - original))[0];
    if (vertical) y = best;
    else x = best;
    occupied.push(hintBox({ x, y, width: hintWidth, height: hint.height }));
    const all = ordered.map(item => item.marker);
    result.push({
      side, x, y, width: hintWidth, height: hint.height, faces, extra,
      slaveIds: all.map(marker => marker.slaveId),
      coordinates: all.map(marker => marker.coordinate),
      label: edgeHintSpeech(side, all),
    });
  }
  return result;
}
