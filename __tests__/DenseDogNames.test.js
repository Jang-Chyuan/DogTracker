import { denseDogNames, denseDogChoices } from '../src/map/DenseDogNames';
import { nameTags } from '../src/map/DogMarkers';
import { markerA11yItems } from '../src/map/MarkerA11yLayer';

import { denseDogScene as scene } from '../__fixtures__/DenseDogScene';

const view = { width: 600, height: 800, top: 80, bottom: 150 };
const shown = tags => Object.entries(tags).filter(([, tag]) => tag != null).map(([id]) => Number(id));

test.each([16, 32, 64])('dense %i dogs: selected name wins; all true faces/IDs/a11y remain reachable', count => {
  const { markers, points } = scene(count);
  const original = JSON.stringify(markers);
  // Existing close-zoom policy admits every overlapping name. This proves
  // the input actually exercises the collision, rather than an easy diagram.
  expect(shown(nameTags(markers, points, 1, { group: false }))).toHaveLength(count);
  expect(shown(denseDogNames(markers, points, { view }))).toEqual([count]);
  expect(denseDogChoices(markers).map(row => row.slaveId)).toEqual(markers.map(row => row.slaveId));
  expect(markerA11yItems(markers, points, view)).toHaveLength(count);
  expect(JSON.stringify(markers)).toBe(original);
});

test.each([16, 32, 64])('%i dogs in two nearby groups preserve each group name when projections separate', count => {
  const { markers, points } = scene(count, { two: true, mpp: 0.05 });
  const names = shown(denseDogNames(markers, points, { view }));
  expect(names).toContain(count);
  expect(names.filter(id => id <= count / 2)).toContain(7);
  expect(names.length).toBeGreaterThanOrEqual(2);
  expect(names.length).toBeLessThan(count);
  expect(denseDogNames(markers, points, { view })).toEqual(denseDogNames([...markers].reverse(), points, { view }));
});

test('no selection preserves a problem name; selecting another dog overrides it without changing flags', () => {
  const { markers, points } = scene(16, { selected: null });
  expect(shown(denseDogNames(markers, points, { view }))).toEqual([7]);
  markers[15].selected = true;
  expect(shown(denseDogNames(markers, points, { view }))).toEqual([16]);
  expect(denseDogChoices(markers).filter(row => row.problem).map(row => row.slaveId)).toEqual([7, 14]);
});

test('pan/zoom/offscreen selected never suppress a different visible group or reset selection', () => {
  const near = scene(64, { two: true, mpp: 0.05 });
  const far = scene(64, { two: true, mpp: 2 });
  expect(shown(denseDogNames(far.markers, far.points, { view }))).toEqual([64]);
  const before = JSON.stringify(near.markers);
  near.points[64] = { x: -500, y: 240 };
  const names = shown(denseDogNames(near.markers, near.points, { view }));
  expect(names).not.toContain(64);
  expect(names.filter(id => id <= 32)).toHaveLength(1);
  expect(names.filter(id => id > 32)).toHaveLength(1);
  expect(near.markers[63].selected).toBe(true);
  expect(JSON.stringify(near.markers)).toBe(before);
  expect(denseDogChoices(near.markers)).toHaveLength(64);
});

test('font2, pending projection, source removal and clipped labels fail safely', () => {
  const { markers, points } = scene(16);
  expect(shown(denseDogNames(markers, points, { view, fontScale: 2 }))).toEqual([16]);
  expect(shown(denseDogNames(markers, null, { view }))).toEqual([]);
  expect(denseDogChoices(markers.filter(row => row.slaveId !== 16)).some(row => row.slaveId === 16)).toBe(false);
  const clipped = { width: 600, height: 270, top: 80, bottom: 0 };
  expect(shown(denseDogNames(markers, points, { view: clipped }))).toEqual([]);
});
