// The faces in an off-screen hint (「‹ 🐶🐶🐶 +1」) keep one order while the
// map moves (real phone: they swapped places between renders, because they
// were sorted by distance from the middle of the screen).
import { edgeHints } from '../src/map/EdgeHints';

const view = { width: 400, height: 800, top: 80, bottom: 0 };
// Off-screen hints are only for dogs with a problem (§9.6).
const dog = (slaveId, extra = {}) => ({ slaveId, name: `狗 ${slaveId}`, tag: `狗 ${slaveId}`, size: 48,
  problem: true, selected: false, ...extra });
// All off the left edge; `order` says which is nearest the middle.
const pointsFor = order => Object.fromEntries(order.map((slaveId, index) =>
  [slaveId, { x: -60 - index * 80, y: 400 + index * 10 }]));
const faces = (markers, points) => edgeHints(markers, points, view)
  .find(item => item.side === 'left').faces.map(marker => marker.slaveId);

test('faces keep the signal-source order whichever dog is nearest, with +N for the rest', () => {
  const markers = [dog(8), dog(4), dog(12), dog(6)];
  const first = edgeHints(markers, pointsFor([12, 8, 6, 4]), view).find(item => item.side === 'left');
  expect(first.faces.map(marker => marker.slaveId)).toEqual([4, 6, 8]);
  expect(first.extra).toBe(1);
  // The camera moved: another dog is nearest now; the faces stay put.
  expect(faces(markers, pointsFor([4, 6, 12, 8]))).toEqual([4, 6, 8]);
  expect(faces([...markers].reverse(), pointsFor([6, 12, 4, 8]))).toEqual([4, 6, 8]);
});

test('the open dog comes first, then the rest by number; healthy dogs are not in the hint', () => {
  const markers = [dog(8), dog(4), dog(12), dog(6, { selected: true }), dog(3, { problem: false })];
  expect(faces(markers, pointsFor([4, 8, 12, 6, 3]))).toEqual([6, 4, 8]);
  expect(faces(markers, pointsFor([3, 6, 12, 8, 4]))).toEqual([6, 4, 8]);
});
