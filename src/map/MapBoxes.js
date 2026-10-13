// Screen boxes (dp) on the live map: a dog's face with its name tag, and the
// controls floating over the map. When a dog's card opens and the dog sits
// under the bottom right buttons or the bottom row, the map moves it into
// view (GoogleTrackingMap focusDog).
import { layout, size as sizes } from '../theme/tokens';
import { tagSize } from './DogMarkers';

export const boxesOverlap = (a, b) => a.left < b.right && b.left < a.right
  && a.top < b.bottom && b.top < a.bottom;

/** The face (`marker.size` round) at `point` and the name tag under it. */
export function markerBox(marker, point, fontScale = 1) {
  const tag = tagSize(marker.tag || marker.name, fontScale);
  const radius = (marker.size || sizes.marker.normal) / 2;
  const halfWidth = Math.max(radius, tag.width / 2);
  return { left: point.x - halfWidth, right: point.x + halfWidth,
    top: point.y - radius, bottom: point.y + radius + sizes.marker.labelGap + tag.height };
}

/** 框住全部 above 我的位置, bottom right, above what covers the bottom. */
export function mapButtonsBox({ width, height, bottom = 0 }) {
  return { left: width - layout.screenEdge - sizes.floatingButton - layout.floatingGap,
    right: width, top: height - bottom - 2 * sizes.floatingButton - layout.floatingGap,
    bottom: height - bottom };
}

/**
 * The bottom right buttons and, with `bottomRow` (its height), the bottom row
 * they stand on (「今天 x km」 beside 我的位置).
 */
export function mapControlBoxes(view) {
  const boxes = [mapButtonsBox(view)];
  if (view.bottomRow) boxes.push({ left: layout.screenEdge, right: view.width - layout.screenEdge,
    top: view.height - (view.bottom || 0) - view.bottomRow, bottom: view.height - (view.bottom || 0) });
  return boxes;
}
