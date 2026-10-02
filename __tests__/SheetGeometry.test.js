import {
  CHIP_GAP, CHIP_WIDTH, ROW_RING, ROW_RING_CENTER_X, SIDE, STRIP_RING,
  flightPoint, flightProgress, headerBottom, liveSheetStops, rowSlot, settleStop, stripSlot,
} from '../src/map/SheetGeometry';

const stops = { collapsed: 200, half: 400, expanded: 700 };

test('the collapsed sheet holds the header and the strip, and grows with the font', () => {
  const normal = liveSheetStops(890, 100, 80, 1);
  const large = liveSheetStops(890, 100, 80, 1.5);
  expect(large.collapsed).toBeGreaterThan(normal.collapsed);
  expect(normal.half).toBeGreaterThanOrEqual(normal.collapsed + 180);
  expect(normal.expanded).toBe(890 - 100 - 80 - 24);
});

test('the flight runs between collapsed and half, and stays done above half', () => {
  expect(flightProgress(200, stops)).toBe(0);
  expect(flightProgress(300, stops)).toBe(0.5);
  expect(flightProgress(400, stops)).toBe(1);
  expect(flightProgress(650, stops)).toBe(1);
});

test('strip slots follow the strip scroll; row slots follow the measured row and the list scroll', () => {
  expect(stripSlot(0, 0)).toEqual({ x: SIDE + CHIP_WIDTH / 2, y: headerBottom() + STRIP_RING / 2 });
  expect(stripSlot(2, 40).x).toBe(SIDE + 2 * (CHIP_WIDTH + CHIP_GAP) + CHIP_WIDTH / 2 - 40);
  // A row that wrapped to 80 dp at y 60 has its avatar at its own middle.
  expect(rowSlot(60, 80, 0)).toEqual({ x: ROW_RING_CENTER_X, y: headerBottom() + 100 });
  expect(rowSlot(60, 80, 30).y).toBe(headerBottom() + 70);
  // A larger font pushes the list down with the header.
  expect(rowSlot(60, 80, 0, 1.4).y).toBeGreaterThan(rowSlot(60, 80, 0, 1).y);
});

test('each avatar starts where it is and ends on its row, leaving one after another', () => {
  const from = { x: 200, y: 90 };
  const to = { x: 39, y: 300 };
  expect(flightPoint(0, 0, from, to)).toMatchObject({ x: 200, y: 90, size: STRIP_RING });
  expect(flightPoint(1, 3, from, to)).toMatchObject({ x: 39, y: 300, size: ROW_RING });
  // Half way, the first dog is further along than the fourth.
  expect(flightPoint(0.5, 0, from, to).p).toBeGreaterThan(flightPoint(0.5, 3, from, to).p);
  // y leads x: part-way, the avatar has dropped more than it has moved left.
  const mid = flightPoint(0.4, 0, from, to);
  expect((mid.y - from.y) / (to.y - from.y)).toBeGreaterThan((from.x - mid.x) / (from.x - to.x));
});

test('with reduced motion an avatar is either in the strip or on its row, never in between', () => {
  const from = { x: 200, y: 90 };
  const to = { x: 39, y: 300 };
  expect(flightPoint(0.3, 0, from, to, true)).toMatchObject({ x: 200, y: 90 });
  expect(flightPoint(0.7, 0, from, to, true)).toMatchObject({ x: 39, y: 300 });
});

test('a fling goes to the next stop in its direction; a slow release to the nearest', () => {
  expect(settleStop(260, 800, stops)).toBe('half');
  expect(settleStop(260, -800, stops)).toBe('collapsed');
  expect(settleStop(450, 800, stops)).toBe('expanded');
  expect(settleStop(260, 0, stops)).toBe('collapsed');
  expect(settleStop(330, 0, stops)).toBe('half');
});
