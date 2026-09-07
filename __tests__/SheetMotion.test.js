import {
  clampHeight,
  sheetStops,
  settleSheet,
  shouldDragSheet,
  SHEET_COLLAPSED_HEIGHT,
} from '../src/map/SheetMotion';

const stops = { collapsed: 44, compact: 320, expanded: 600 };
test('finger movement is bounded and supports collapse/compact/full stops', () => {
  expect(clampHeight(-100, 44, 600)).toBe(44);
  expect(clampHeight(800, 44, 600)).toBe(600);
  expect(clampHeight(240, 44, 600)).toBe(240);
  expect(settleSheet(60, 0, stops)).toBe('collapsed');
  expect(settleSheet(300, 0, stops)).toBe('compact');
  expect(settleSheet(590, 0, stops)).toBe('expanded');
  expect(settleSheet(90, -0.8, stops)).toBe('compact');
  expect(settleSheet(380, -0.8, stops)).toBe('expanded');
  expect(settleSheet(280, 0.8, stops)).toBe('collapsed');
});
test('expand before scrolling, then allow native content scrolling; pull down at top collapses', () => {
  expect(shouldDragSheet({ dx: 0, dy: -25 }, 44, 600, 0)).toBe(true);
  expect(shouldDragSheet({ dx: 0, dy: -25 }, 320, 600, 0)).toBe(true);
  expect(shouldDragSheet({ dx: 0, dy: -25 }, 600, 600, 0)).toBe(false);
  expect(shouldDragSheet({ dx: 0, dy: 25 }, 600, 600, 150)).toBe(false);
  expect(shouldDragSheet({ dx: 0, dy: 25 }, 600, 600, 0)).toBe(true);
  expect(shouldDragSheet({ dx: 30, dy: 10 }, 320, 600, 0)).toBe(false);
  expect(shouldDragSheet({ dx: 0, dy: 5 }, 320, 600, 0)).toBe(false);
});
test('all stops fit the available height, including a short window with alerts', () => {
  for (const height of [320, 780]) {
    const values = sheetStops(height, 90, 150);
    expect(values.collapsed).toBe(SHEET_COLLAPSED_HEIGHT);
    expect(values.compact).toBeLessThanOrEqual(values.expanded);
    expect(values.expanded).toBeLessThan(height - 90);
  }
});
test('peek summary reserves room for system font scaling without inverting stops', () => {
  for (const fontScale of [1, 2, 3, 8]) {
    const values = sheetStops(320, 90, 150, fontScale);
    expect(values.collapsed).toBeGreaterThanOrEqual(39 + 20 * fontScale);
    expect(values.compact).toBeGreaterThanOrEqual(values.collapsed);
    expect(values.expanded).toBeGreaterThanOrEqual(values.compact);
  }
});
