// Off-screen hints in eight directions (DESIGN.md §9.6): the four sides and
// the four corners, by the dog's bearing on screen from the middle of the
// visible map. A real phone: 「只有上下左右，看不出狗在哪個方向」.
import {
  boxesOverlap, compassBox, directionAngle, edgeDirection, edgeHints, hintBox, mapButtonsBox, mapControlBoxes,
} from '../src/map/EdgeHints';

// A phone (411×891dp): the gear row on top, a 48dp bottom row above the tabs.
const view = { width: 411, height: 891, top: 76, bottom: 80, bottomRow: 48 };
const centre = { x: 205.5, y: (76 + 811) / 2 };
const dog = (slaveId, extra = {}) => ({ slaveId, name: `狗 ${slaveId}`, tag: `狗 ${slaveId}`, size: 40,
  problem: false, selected: false, ...extra });
// `screen` degrees on screen: 0 = right, 90 = down; 2 km off at zoom 16.
const towards = (screen, distance = 2000) => ({
  x: centre.x + distance * Math.cos((screen * Math.PI) / 180),
  y: centre.y + distance * Math.sin((screen * Math.PI) / 180),
});
const sides = hints => Object.fromEntries(hints.map(hint => [hint.side, hint.slaveIds]));

test('a bearing within 22.5° of a diagonal is a corner; the rest is a side', () => {
  expect([0, 22, 23, 45, 67, 68, 90, 135, 180, 225, 270, 292, 293, 315, 337, 338, -45]
    .map(edgeDirection)).toEqual(['right', 'right', 'bottomRight', 'bottomRight', 'bottomRight', 'bottom',
    'bottom', 'bottomLeft', 'left', 'topLeft', 'top', 'top', 'topRight', 'topRight', 'topRight', 'right',
    'topRight']);
  expect(['right', 'bottomRight', 'top', 'topRight'].map(directionAngle)).toEqual([0, 45, 270, 315]);
});

test('one hint per direction with dogs off it; corner hints sit in their corner and point there', () => {
  const angles = { 1: 270, 2: 315, 3: 330, 4: 0, 5: 45, 6: 90, 7: 135, 8: 180, 9: 225 };
  const markers = Object.keys(angles).map(id => dog(Number(id)));
  const points = Object.fromEntries(Object.entries(angles).map(([id, angle]) => [id, towards(angle)]));
  const hints = edgeHints(markers, points, view);
  expect(sides(hints)).toEqual({ top: [1], topRight: [2, 3], right: [4], bottomRight: [5], bottom: [6],
    bottomLeft: [7], left: [8], topLeft: [9] });
  const hint = side => hints.find(item => item.side === side);
  // The arrow points the hint's way, whatever the exact bearing of its dogs.
  expect(hints.map(item => [item.side, item.angle])).toEqual(expect.arrayContaining([
    ['topRight', 315], ['bottomLeft', 135], ['top', 270], ['right', 0]]));
  // Top left and top right: 8dp in from the corner of the visible map.
  expect(hint('topLeft')).toMatchObject({ x: 8, y: 76 + 8 });
  expect(hint('topRight').y).toBe(76 + 8);
  expect(hint('topRight').x + hint('topRight').width).toBe(411 - 8);
  // Bottom left: above the bottom row, 8dp from the left.
  expect(hint('bottomLeft')).toMatchObject({ x: 8, y: 811 - 48 - 12 - 36 });
  expect(hint('topRight').label).toBe('右上方畫面外有 2 隻狗：狗 2、狗 3，點兩下移過去');
  expect(hint('bottomLeft').label).toBe('左下方畫面外有 1 隻狗：狗 7，點兩下移過去');
  for (const one of hints) for (const other of hints) {
    if (one !== other) expect(boxesOverlap(hintBox(one), hintBox(other))).toBe(false);
  }
});

test('a corner taken by a fixed control: the hint moves next to it along an edge, clear of it', () => {
  const markers = [dog(1), dog(2)];
  const points = { 1: towards(315), 2: towards(45) };
  // The turned map's compass under the gear, in the top right corner.
  const compass = compassBox(411, 76 + 16);
  const hints = edgeHints(markers, points, { ...view, obstacles: [compass] });
  const topRight = hints.find(item => item.side === 'topRight');
  const bottomRight = hints.find(item => item.side === 'bottomRight');
  expect(boxesOverlap(hintBox(topRight), compass)).toBe(false);
  // Still at the corner's edges: along the top, or down the right side.
  expect(topRight.y === 76 + 8 || topRight.x + topRight.width === 411 - 8).toBe(true);
  expect(topRight.y).toBeLessThan(centre.y);
  expect(topRight.x).toBeGreaterThan(centre.x);
  // Bottom right holds 框住全部 and 我的位置: the hint goes beside them.
  for (const box of mapControlBoxes(view)) expect(boxesOverlap(hintBox(bottomRight), box)).toBe(false);
  expect(boxesOverlap(hintBox(bottomRight), mapButtonsBox(view))).toBe(false);
  expect(bottomRight.x).toBeGreaterThan(centre.x);
  expect(bottomRight.y).toBeGreaterThan(centre.y);
  // Without the compass the top right hint is back in its corner.
  const plain = edgeHints(markers, points, view).find(item => item.side === 'topRight');
  expect(plain).toMatchObject({ y: 76 + 8, x: 411 - 8 - plain.width });
});

test('a turned map: the direction is where the dog is on screen, not on the compass', () => {
  // The camera turned 90° (east at the top). A dog due north of the middle
  // shows to its left; one north-east, top left.
  const heading = 90;
  const project = bearing => towards(bearing - heading - 90);
  const markers = [dog(1), dog(2), dog(3)];
  const points = { 1: project(0), 2: project(45), 3: project(90) };
  const hints = edgeHints(markers, points, view);
  expect(sides(hints)).toEqual({ left: [1], topLeft: [2], top: [3] });
  expect(hints.find(item => item.side === 'topLeft').label).toBe('左上方畫面外有 1 隻狗：狗 2，點兩下移過去');
});

test('the faces of a corner hint keep their order while the map moves (#139)', () => {
  const markers = [dog(8), dog(4), dog(12, { problem: true }), dog(6), dog(9, { selected: true })];
  const faces = order => {
    const points = Object.fromEntries(order.map((slaveId, index) => [slaveId, towards(225 + index * 3, 600 + index * 400)]));
    const hint = edgeHints(markers, points, view).find(item => item.side === 'topLeft');
    return [hint.faces.map(marker => marker.slaveId), hint.extra, hint.slaveIds];
  };
  expect(faces([4, 6, 8, 9, 12])).toEqual([[9, 12, 4], 2, [9, 12, 4, 6, 8]]);
  expect(faces([12, 9, 8, 6, 4])).toEqual([[9, 12, 4], 2, [9, 12, 4, 6, 8]]);
});
