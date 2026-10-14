import { space, type } from '../theme/tokens';

export const cursorProjectionKey = (cursor, revision, width, height, top, bottom, scope = '') =>
  `${scope}:${cursor?.coordinate?.latitude}:${cursor?.coordinate?.longitude}:${revision}:${width}:${height}:${top}:${bottom}`;

const intersects = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x
  && a.y < b.y + b.height && a.y + a.height > b.y;
const inside = (box, view) => box.x >= view.left && box.y >= view.top
  && box.x + box.width <= view.right && box.y + box.height <= view.bottom;
const safe = (box, view, controls) => inside(box, view) && !controls.some(control => intersects(box, control));
const nativeBox = (point, size) => ({ x: point.x - size.width / 2, y: point.y - size.above,
  width: size.width, height: size.height });
const pinBox = (point, size) => ({ x: point.x - size.pinHalf, y: point.y - size.pinAbove,
  width: size.pinHalf * 2, height: size.pinAbove + size.below });

/** Screen-space only: never changes a coordinate, accepted time or marker anchor. */
export function cursorLabelPlacement(point, size, view, controls = []) {
  if (!point || !size?.width || !size?.height) return { hidden: false, box: null, pinSafe: true };
  if (point.x < view.left || point.x > view.right || point.y < view.top || point.y > view.bottom)
    return { hidden: true, box: null, pinSafe: false };
  const original = nativeBox(point, size);
  const pin = pinBox(point, size);
  const pinSafe = safe(pin, view, controls);
  if (pinSafe && safe(original, view, controls)) return { hidden: false, box: null, pinSafe };
  const clampX = x => Math.max(view.left, Math.min(view.right - size.width, x));
  const candidates = [
    { ...original, x: clampX(original.x) },
    { ...original, y: point.y + size.below + space.s },
    { ...original, x: point.x + size.pinHalf + space.s, y: point.y - size.height / 2 },
    { ...original, x: point.x - size.pinHalf - space.s - size.width, y: point.y - size.height / 2 },
  ];
  const box = candidates.find(candidate => safe(candidate, view, controls) && !intersects(candidate, pin));
  // pinSafe: the dot/face and its name tag are wholly visible; a moved label
  // cannot fix a pin under the panel or a control, only a camera move can.
  return { hidden: true, box: box ?? null, pinSafe };
}

/** A requested camera move needs room for the actual label AND its true pin. */
export function cursorCameraTarget(size, view, controls = []) {
  if (!size?.width || view.right - view.left < Math.max(size.width, size.pinHalf * 2)
    || view.bottom - view.top < size.above + size.below + space.s * 2) return null;
  const firstY = view.top + size.above + space.s;
  const lastY = view.bottom - size.below - space.s;
  const xs = [(view.left + view.right) / 2,
    view.left + Math.max(size.width / 2, size.pinHalf), view.right - Math.max(size.width / 2, size.pinHalf)];
  const ys = [(firstY + lastY) / 2, firstY, lastY];
  for (const y of ys) for (const x of xs) {
    const point = { x, y };
    if (safe(nativeBox(point, size), view, controls) && safe(pinBox(point, size), view, controls)) return point;
  }
  return null;
}

/** Additional padding is solely for requested framing, not SDK mapPadding. */
export function measuredCursorFrame(base, size, view, controls = [], topControls = controls) {
  if (!cursorCameraTarget(size, view, controls)) return null;
  // Floating bottom/right controls are collision obstacles, not a top band.
  const controlBottom = topControls.reduce((bottom, box) => Math.max(bottom, box.y + box.height), view.top);
  const padding = { ...base, top: Math.max(base.top, size.above + space.s) + controlBottom - view.top,
    bottom: Math.max(base.bottom, size.below + space.s),
    left: Math.max(base.left, size.width / 2 + space.s, size.pinHalf + space.s),
    right: Math.max(base.right, size.width / 2 + space.s, size.pinHalf + space.s) };
  return view.bottom - view.top > padding.top + padding.bottom
    && view.right - view.left > padding.left + padding.right ? padding : null;
}

/**
 * The cursor's label in dp around the cursor point (its moved `placement.box`
 * when the label moved aside, else the native one above the point), or null
 * before both are measured.
 */
export function labelBoxAround(point, size, placement) {
  if (!point || !size?.width) return null;
  if (placement?.hidden && !placement.box) return null;
  const box = placement?.box ?? nativeBox(point, size);
  return { x: box.x - point.x, y: box.y - point.y, width: box.width, height: box.height };
}

// A time marker around its point: the ring and the 「08:00」 under it.
const TIME_MARKER = { x: -space.xl, y: -space.s, width: space.xl * 2, height: type.mapLabel.lineHeight + space.m };

/**
 * Whether a time marker at `coordinate` would sit under the cursor's label
 * (`labelBox` from labelBoxAround), from the map's scale and its heading.
 */
export function timeUnderLabel(coordinate, cursorCoordinate, labelBox, metresPerDp, heading = 0) {
  if (!coordinate || !cursorCoordinate || !labelBox || !(metresPerDp > 0)) return false;
  const east = (coordinate.longitude - cursorCoordinate.longitude)
    * Math.cos((cursorCoordinate.latitude * Math.PI) / 180) * 111320;
  const north = (coordinate.latitude - cursorCoordinate.latitude) * 110540;
  const turn = (heading * Math.PI) / 180;
  const x = (east * Math.cos(turn) - north * Math.sin(turn)) / metresPerDp;
  const y = -(north * Math.cos(turn) + east * Math.sin(turn)) / metresPerDp;
  return intersects({ ...TIME_MARKER, x: x + TIME_MARKER.x, y: y + TIME_MARKER.y }, labelBox);
}
