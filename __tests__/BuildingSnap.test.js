import { chooseBuilding, createBuildingSnapper, OVERPASS_URL } from '../src/placement/BuildingSnap';
import { snapHolds } from '../src/placement/HoldStore';
import { distanceMeters } from '../src/placement/IndoorHold';
import { offset } from '../__fixtures__/IndoorScenarios';

const DOOR = { latitude: 25, longitude: 121 };
// A square building with its centre `north`/`east` metres from the door.
function square(id, north, east, half) {
  const corners = [[-half, -half], [-half, half], [half, half], [half, -half]];
  return { id, geometry: corners.map(([n, e]) => {
    const point = offset(DOOR, north + n, east + e);
    return { lat: point.latitude, lon: point.longitude };
  }) };
}

test('a dog at the door of a house is drawn in the middle of that house', () => {
  const house = chooseBuilding(DOOR, [square(1, 12, 0, 8)]);
  expect(house.buildingId).toBe(1);
  expect(distanceMeters(house.coordinate, offset(DOOR, 12, 0))).toBeLessThan(0.5);
});

test('inside a house it moves to the middle; the smallest building that holds it wins', () => {
  const house = chooseBuilding(DOOR, [square(2, 3, 2, 10), square(3, 0, 0, 30)]);
  expect(house.buildingId).toBe(2);
});

test('large buildings, distant ones and big moves leave the dog where it was seen', () => {
  expect(chooseBuilding(DOOR, [square(4, 0, 0, 40)])).toBeNull();
  expect(chooseBuilding(DOOR, [square(5, 40, 0, 8)])).toBeNull();
  expect(chooseBuilding(DOOR, [])).toBeNull();
  expect(chooseBuilding(DOOR, [{ id: 6, geometry: [{ lat: 25, lon: 121 }] }])).toBeNull();
});

test('the lookup asks once per place, never waits, and tells the map when it knows', async () => {
  const fetchImpl = jest.fn(async () => ({ ok: true, json: async () => ({ elements: [square(1, 12, 0, 8)] }) }));
  const snapper = createBuildingSnapper({ fetchImpl });
  const heard = jest.fn();
  snapper.subscribe(heard);
  expect(snapper.lookup(DOOR)).toBeUndefined();
  expect(snapper.lookup(DOOR)).toBeUndefined();
  await new Promise(resolve => setImmediate(resolve));
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(fetchImpl.mock.calls[0][0]).toBe(OVERPASS_URL);
  // Only a rounded coordinate leaves the phone.
  expect(decodeURIComponent(fetchImpl.mock.calls[0][1].body)).toContain('25.0000,121.0000');
  expect(heard).toHaveBeenCalled();
  expect(snapper.lookup(DOOR).buildingId).toBe(1);
  const holds = snapHolds({ 4: { coordinate: DOOR, reason: '室內' } }, snapper);
  expect(holds[4]).toMatchObject({ buildingId: 1, anchor: DOOR, reason: '室內' });
  expect(distanceMeters(holds[4].coordinate, offset(DOOR, 12, 0))).toBeLessThan(0.5);
});

test('offline, the dog stays where it was seen', async () => {
  const snapper = createBuildingSnapper({ fetchImpl: jest.fn(async () => { throw new Error('offline'); }) });
  snapper.lookup(DOOR);
  await new Promise(resolve => setImmediate(resolve));
  expect(snapper.lookup(DOOR)).toBeNull();
  expect(snapHolds({ 4: { coordinate: DOOR } }, snapper)[4].coordinate).toEqual(DOOR);
});
