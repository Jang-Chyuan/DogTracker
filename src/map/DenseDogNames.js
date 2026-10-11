// Candidate display policy only: never changes a dog's coordinate, face,
// press identity or accessibility item. The separate picker owns selection.
import { tagSize } from './DogMarkers';
import { size as sizes } from '../theme/tokens';

const finitePoint = point => Number.isFinite(point?.x) && Number.isFinite(point?.y);
const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const inside = (box, view) => !view || (box.left >= 0 && box.right <= view.width
  && box.top >= (view.top || 0) && box.bottom <= view.height - (view.bottom || 0));

// Integer SDK layers: a named ordinary carrier wins ordinary ties, while
// an unnamed problem head still stays visible above it. Selected wins both.
export function denseDogFaceLayer(marker, tag = null) {
  if (marker.selected) return 40;
  return marker.problem ? (tag ? 37 : 34) : (tag ? 32 : 31);
}

function coveredByPriorityHead(marker, point, markers, points) {
  const layer = denseDogFaceLayer(marker);
  return markers.some(other => {
    if (other.slaveId === marker.slaveId || denseDogFaceLayer(other) <= layer) return false;
    const head = points?.[other.slaveId];
    if (!finitePoint(head)) return false;
    return (point.x - head.x) ** 2 + (point.y - head.y) ** 2 <= (other.size / 2) ** 2;
  });
}

/** Names only, in map dp; positions/press handlers remain with the caller.
 * Selected name wins. Other names use stable problem-first/id order, so
 * polling or input ordering does not silently change the visible carrier.
 * Offscreen/clipped names never reserve space for dogs still on screen.
 * tagSize is the existing conservative text estimate, not native font QA.
 */
export function denseDogNames(markers, points, { fontScale = 1, view = null, margin = 4 } = {}) {
  const tags = Object.fromEntries(markers.map(marker => [marker.slaveId, null]));
  const ordered = [...markers].sort((a, b) => Number(!!b.selected) - Number(!!a.selected)
    || Number(!!b.problem) - Number(!!a.problem) || a.slaveId - b.slaveId);
  const placed = [];
  for (const marker of ordered) {
    const point = points?.[marker.slaveId];
    if (!finitePoint(point)) continue;
    // A shorter capsule can fit where a higher-priority head's own long
    // name did not. Do not put that shorter name under somebody else's face.
    if (coveredByPriorityHead(marker, point, markers, points)) continue;
    const measured = tagSize(marker.tag || marker.name, fontScale);
    const top = point.y + marker.size / 2 + sizes.marker.labelGap;
    const box = { left: point.x - measured.width / 2 - margin,
      right: point.x + measured.width / 2 + margin,
      top: top - margin, bottom: top + measured.height + margin };
    if (!inside(box, view) || placed.some(other => overlaps(box, other))) continue;
    tags[marker.slaveId] = { text: marker.tag || marker.name, group: 1, problem: !!marker.problem };
    placed.push(box);
  }
  return tags;
}

// Picker rows use stable IDs, not projected positions or screen-sort order.
// Coordinates are read live by openDog; no projected point becomes a fix.
export function denseDogChoices(markers) {
  return [...markers].sort((a, b) => a.slaveId - b.slaveId);
}
