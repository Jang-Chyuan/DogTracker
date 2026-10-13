import { t } from '../i18n';
// Dogs with a problem outside the visible map (design v3 A1「畫面外的狗用小頭像
// 提示」, DESIGN.md §9.6 and §15「畫面外提示」). Pure: given where each dog is on
// screen, which hints to draw where. The renderer draws them (EdgeHintView)
// and frames a hint's dogs when it is tapped.
//
// - Only dogs with a problem (the red 「!」 on the map: not in receiver range,
//   battery low, no new position) get a hint; a healthy dog off screen shows
//   nothing (2026-10-13: hints for every dog cluttered the map; a problem must
//   stay findable when the dog is off screen). 框住全部 shows every dog.
// - Eight directions, by the dog's bearing from the middle of the visible map
//   on screen (screen space: a turned map turns the hints with it): the four
//   sides, and the four corners for dogs within 22.5° of a diagonal. One hint
//   per direction that has dogs off it, with an arrow pointing that way.
// - A side hint sits where the line from the middle to its dogs leaves the
//   visible map; a corner hint sits in its corner, or next to it along either
//   edge when a fixed control is there (the compass under the gear, the
//   bottom right buttons).
// - Up to 3 small faces, all with the red frame, in DogOrder's stable order
//   (the open dog first, then by signal-source number), then 「+N」 for the
//   rest.
// - The visible map is the screen minus the top controls and the bottom card;
//   a dog under the card counts as off screen.
import { layout, size as sizes, space } from '../theme/tokens';
import { tagSize } from './DogMarkers';
import { compareDogOrder } from './DogOrder';

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

// The eight directions in screen space, clockwise from the right: a direction
// at index i points at i × 45° (0° = right, 90° = down: screen y grows down).
export const EDGE_DIRECTIONS = Object.freeze(['right', 'bottomRight', 'bottom', 'bottomLeft', 'left',
  'topLeft', 'top', 'topRight']);
const CORNER_WORD = { topLeft: t("c1301"), topRight: t("c1302"), bottomLeft: t("c1303"), bottomRight: t("c1304") };
const DIRECTION_WORD = { ...SIDE_WORD, ...CORNER_WORD };
// The two edges a corner hint can slide along when its corner is taken.
const CORNER_EDGES = { topLeft: ['top', 'left'], topRight: ['top', 'right'],
  bottomLeft: ['bottom', 'left'], bottomRight: ['bottom', 'right'] };

const normalAngle = angle => ((angle % 360) + 360) % 360;

/** The direction (one of EDGE_DIRECTIONS) of a screen-space angle in degrees. */
export function edgeDirection(angle) {
  return EDGE_DIRECTIONS[Math.round(normalAngle(angle) / 45) % 8];
}

/** The screen-space angle (degrees, 0 = right, 90 = down) a direction points at. */
export const directionAngle = direction => EDGE_DIRECTIONS.indexOf(direction) * 45;

/**
 * TalkBack: 「右上方畫面外有 1 隻狗有問題：小黑，點兩下移過去」,
 * 「左邊畫面外有 2 隻狗有問題：小黑、豆豆，點兩下移過去」.
 */
export function edgeHintSpeech(direction, markers) {
  const names = markers.map(marker => marker.name).join('、');
  return t('c1320', { value: DIRECTION_WORD[direction], length: markers.length, names });
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

/** The live compass (§15: 48dp, 16dp from the right, at `top`), for the hints to keep clear of. */
export const compassBox = (width, top) => ({ left: width - layout.screenEdge - sizes.floatingButton,
  right: width - layout.screenEdge, top, bottom: top + sizes.floatingButton });

export const hintBox = item => ({ left: item.x, right: item.x + item.width,
  top: item.y, bottom: item.y + item.height });

const overlapArea = (box, other) => (boxesOverlap(box, other)
  ? (Math.min(box.right, other.right) - Math.max(box.left, other.left))
    * (Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top)) : 0);

/**
 * @param markers DogMarkers.dogMarkers output
 * @param points screen positions by dog, in dp: { [slaveId]: { x, y } } (from
 *   pointForCoordinate: already screen space when the map is turned)
 * @param view { width, height, top, bottom, bottomRow, obstacles }: the
 *   screen, and how much of its top and bottom the controls and the card
 *   cover; bottomRow: the height of the bottom row (「今天 x km」 beside 我的位置)
 *   a bottom hint sits above; obstacles: more fixed controls to keep clear of
 *   (the compass while the map is turned)
 * @returns [{ side, key, angle, x, y, width, height, faces: marker[], extra,
 *   slaveIds, coordinates, label }]  side: one of EDGE_DIRECTIONS; angle: where
 *   the arrow points (degrees, screen space); x/y: the hint's top-left corner
 */
export function edgeHints(markers = [], points = {}, { width, height, top = 0, bottom = 0, bottomRow = 0, fontScale = 1,
  shownTop = top, obstacles = [] } = {}) {
  if (!(width > 0 && height > 0)) return [];
  const visibleTop = top;
  const visibleBottom = height - bottom;
  if (!(visibleBottom > visibleTop)) return [];
  // 066: a dog the user can see needs no hint. Seen = any part of its face on
  // screen above the card and below what covers the top (`shownTop`: the top
  // cards, not the map's own padding for the gear row).
  const seen = (marker, point) => {
    const radius = (marker.size || 0) / 2;
    return point.x + radius >= 0 && point.x - radius <= width
      && point.y + radius >= shownTop && point.y - radius <= visibleBottom;
  };
  const center = { x: width / 2, y: (visibleTop + visibleBottom) / 2 };
  const halfWidth = width / 2;
  const halfHeight = (visibleBottom - visibleTop) / 2;
  const off = [];
  for (const marker of markers) {
    const point = points[marker.slaveId];
    // A healthy dog off screen gets no hint (§9.6).
    if (!marker.problem) continue;
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    if (seen(marker, point)) continue;
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    if (!dx && !dy) continue;
    const horizontal = Math.abs(dx) / halfWidth >= Math.abs(dy) / halfHeight;
    // Where the line from the middle to the dog leaves the visible map.
    const scale = horizontal ? halfWidth / Math.abs(dx) : halfHeight / Math.abs(dy);
    off.push({
      marker,
      angle: normalAngle((Math.atan2(dy, dx) * 180) / Math.PI),
      exit: { x: center.x + dx * scale, y: center.y + dy * scale },
    });
  }
  if (!off.length) return [];

  const groups = sectorGroups(off);

  const occupied = markers.flatMap(marker => {
    const point = points[marker.slaveId];
    return point && point.x >= 0 && point.x <= width && point.y >= visibleTop && point.y <= visibleBottom
      ? [markerBox(marker, point, fontScale)] : [];
  });
  occupied.push(...mapControlBoxes({ width, height, bottom, bottomRow }), ...obstacles.filter(Boolean));
  // The bottom right buttons (框住全部 above 我的位置) and the gaps around them.
  const buttonsTop = visibleBottom - 2 * sizes.floatingButton - layout.floatingGap;
  const buttonsLeft = width - layout.screenEdge - sizes.floatingButton;
  const bottomY = visibleBottom - (bottomRow ? bottomRow + layout.floatingGap : EDGE_HINT_MARGIN) - hint.height;
  // Where a hint `w` wide can sit along each edge: the fixed coordinate and
  // the range of the other one (both for the hint's top-left corner).
  const tracks = w => ({
    left: { vertical: true, fixed: EDGE_HINT_MARGIN, low: visibleTop + EDGE_HINT_MARGIN,
      high: visibleBottom - EDGE_HINT_MARGIN - hint.height },
    right: { vertical: true, fixed: width - EDGE_HINT_MARGIN - w, low: visibleTop + EDGE_HINT_MARGIN,
      high: buttonsTop - layout.floatingGap - hint.height },
    top: { vertical: false, fixed: visibleTop + EDGE_HINT_MARGIN, low: EDGE_HINT_MARGIN,
      high: width - EDGE_HINT_MARGIN - w },
    bottom: { vertical: false, fixed: bottomY, low: EDGE_HINT_MARGIN,
      high: buttonsLeft - layout.floatingGap - w },
  });

  const result = [];
  for (const group of groups) {
    const ordered = [...group.items].sort((left, right) => compareDogOrder(left.marker, right.marker));
    const faces = ordered.slice(0, hint.maxAvatars).map(item => item.marker);
    const extra = ordered.length - faces.length;
    const hintWidth = edgeHintWidth(faces.length, extra);
    const edgeTracks = tracks(hintWidth);
    const corner = !!CORNER_EDGES[group.direction];
    const usable = corner ? CORNER_EDGES[group.direction] : [group.direction];
    // Where the hint would like to be (its top-left corner): in its corner, or
    // centred where the line to its dogs leaves the visible map.
    let preferred;
    if (corner) {
      const [horizontal, vertical] = CORNER_EDGES[group.direction];
      preferred = { x: edgeTracks[vertical].fixed, y: edgeTracks[horizontal].fixed };
    } else {
      const exit = group.items.reduce((sum, item) => ({ x: sum.x + item.exit.x, y: sum.y + item.exit.y }),
        { x: 0, y: 0 });
      preferred = { x: exit.x / group.items.length - hintWidth / 2, y: exit.y / group.items.length - hint.height / 2 };
    }
    // Search along the usable edges; keep near the preferred place while
    // avoiding visible faces, name tags, fixed controls and hints already
    // placed. In a crowded edge use the least covered position rather than
    // losing the off-screen dogs entirely.
    const candidates = [];
    for (const name of usable) {
      const track = edgeTracks[name];
      const values = [track.vertical ? preferred.y : preferred.x, track.low, track.high];
      for (const box of occupied) values.push(track.vertical
        ? box.top - hint.height - layout.floatingGap : box.left - hintWidth - layout.floatingGap,
      track.vertical ? box.bottom + layout.floatingGap : box.right + layout.floatingGap);
      for (const value of values) {
        const along = clamp(value, track.low, track.high);
        candidates.push(track.vertical ? { x: track.fixed, y: along } : { x: along, y: track.fixed });
      }
    }
    const score = place => occupied.reduce((sum, other) => sum
      + overlapArea(hintBox({ ...place, width: hintWidth, height: hint.height }), other), 0);
    const distance = place => Math.hypot(place.x - preferred.x, place.y - preferred.y);
    const { x, y } = candidates.map(place => ({ place, cover: score(place), away: distance(place) }))
      .sort((a, b) => a.cover - b.cover || a.away - b.away)[0].place;
    occupied.push(hintBox({ x, y, width: hintWidth, height: hint.height }));
    const all = ordered.map(item => item.marker);
    result.push({
      side: group.direction, key: group.key, angle: group.angle,
      x, y, width: hintWidth, height: hint.height, faces, extra,
      slaveIds: all.map(marker => marker.slaveId),
      coordinates: all.map(marker => marker.coordinate),
      label: edgeHintSpeech(group.direction, all),
    });
  }
  // Reading order for TalkBack: top row left to right, then the sides, then
  // the bottom row.
  return result.sort((a, b) => READING_ORDER.indexOf(a.side) - READING_ORDER.indexOf(b.side));
}

const READING_ORDER = ['topLeft', 'top', 'topRight', 'left', 'right', 'bottomLeft', 'bottom', 'bottomRight'];

// One hint per eight-way direction; the arrow points exactly that way.
// Corners first: they have the least room.
function sectorGroups(off) {
  const byDirection = new Map();
  for (const item of off) {
    const direction = edgeDirection(item.angle);
    if (!byDirection.has(direction)) byDirection.set(direction, []);
    byDirection.get(direction).push(item);
  }
  const order = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight', 'left', 'right', 'top', 'bottom'];
  return order.filter(direction => byDirection.has(direction)).map(direction => ({
    direction, key: direction, angle: directionAngle(direction), items: byDirection.get(direction),
  }));
}
