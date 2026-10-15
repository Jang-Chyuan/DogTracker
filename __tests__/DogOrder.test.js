// The off-screen hints' stable face order (DogOrder.compareDogOrder, DESIGN
// §9.6): the open dog, then by number. It never depends on where the dogs are
// on screen (real phone: faces sorted by distance from the middle swapped
// places between renders). The card's row of dogs is by number only
// (DogSwitch.switchOrder).
import { compareDogOrder } from '../src/map/DogOrder';
import { switchOrder } from '../src/map/DogSwitch';

const dog = (slaveId, extra = {}) => ({ slaveId, name: `狗 ${slaveId}`, tag: `狗 ${slaveId}`, size: 40,
  problem: false, selected: false, ...extra });
const order = markers => [...markers].sort(compareDogOrder).map(marker => marker.slaveId);

test('by signal-source number, whatever order the dogs come in', () => {
  const markers = [dog(8), dog(4), dog(12), dog(6)];
  expect(order(markers)).toEqual([4, 6, 8, 12]);
  expect(order([...markers].reverse())).toEqual([4, 6, 8, 12]);
});

test('the open dog comes first, then the rest by number; a problem does not move a dog', () => {
  const markers = [dog(8), dog(4), dog(12, { problem: true }), dog(6, { selected: true }), dog(3, { problem: true })];
  expect(order(markers)).toEqual([6, 3, 4, 8, 12]);
  expect(order([...markers].reverse())).toEqual([6, 3, 4, 8, 12]);
  expect(order([dog(9, { problem: true }), dog(2, { selected: true, problem: true })])).toEqual([2, 9]);
});

test('the card\'s row of dogs is by number only, the open dog in its own place', () => {
  const markers = [dog(8), dog(4, { problem: true }), dog(6, { selected: true })];
  expect(switchOrder(markers)).toEqual([4, 6, 8]);
});

test('missing flags count as false', () => {
  expect(order([{ slaveId: 5 }, { slaveId: 2, selected: undefined }, { slaveId: 7, selected: 1 }])).toEqual([7, 2, 5]);
});
