// The live map's one stable dog order (DogOrder.compareDogOrder): the card's
// ‹ › switch goes through the dogs in it. It never depends on where the dogs
// are on screen (real phone: faces sorted by distance from the middle swapped
// places between renders).
import { compareDogOrder } from '../src/map/DogOrder';

const dog = (slaveId, extra = {}) => ({ slaveId, name: `狗 ${slaveId}`, tag: `狗 ${slaveId}`, size: 40,
  problem: false, selected: false, ...extra });
const order = markers => [...markers].sort(compareDogOrder).map(marker => marker.slaveId);

test('by signal-source number, whatever order the dogs come in', () => {
  const markers = [dog(8), dog(4), dog(12), dog(6)];
  expect(order(markers)).toEqual([4, 6, 8, 12]);
  expect(order([...markers].reverse())).toEqual([4, 6, 8, 12]);
});

test('the open dog comes first, then dogs with a problem, then the rest by number', () => {
  const markers = [dog(8), dog(4), dog(12, { problem: true }), dog(6, { selected: true }), dog(3, { problem: true })];
  expect(order(markers)).toEqual([6, 3, 12, 4, 8]);
  expect(order([...markers].reverse())).toEqual([6, 3, 12, 4, 8]);
  // An open dog with a problem is still just first.
  expect(order([dog(9, { problem: true }), dog(2, { selected: true, problem: true })])).toEqual([2, 9]);
});

test('missing flags count as false', () => {
  expect(order([{ slaveId: 5 }, { slaveId: 2, problem: undefined }, { slaveId: 7, problem: 1 }])).toEqual([7, 2, 5]);
});
