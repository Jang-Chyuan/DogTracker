import { rangeLabelPlacement } from '../src/history/screen/HistoryRangeBar';
import { dragTimeTipBox } from '../src/mapHistory/HistoryDragTimeTip';
import { size, space } from '../src/theme/tokens';

const BOX = 48;
const inset = size.rangeBar.labelEdgeInset;
const gap = size.rangeBar.labelEdgeGap;
const place = (startX, endX, container) => rangeLabelPlacement({ startX, endX, container, box: BOX, inset, gap,
  close: endX - startX < BOX });

describe('H2b the times under the range handles stay inside the range box', () => {
  test.each([280, 320, 360, 411])('container %i: far-right end and far-left start are pushed in, aligned to the inner edge', container => {
    const track = container - BOX;
    const { start, end } = place(0, track, container);
    expect(start.left).toBeGreaterThanOrEqual(inset);
    expect(start.align).toBe('left');
    expect(end.left + BOX).toBeLessThanOrEqual(container - inset);
    expect(end.align).toBe('right');
    expect(start.left + BOX).toBeLessThanOrEqual(end.left);
  });

  test('in the middle the time is centred under its handle', () => {
    const { start, end } = place(100, 220, 360);
    expect(start).toEqual({ left: 100, align: 'center' });
    expect(end).toEqual({ left: 220, align: 'center' });
  });

  test.each([[0, 10], [300, 312], [306, 312], [140, 150], [0, 0.5]])('handles at %i and %i never overlap and never leave the box', (a, b) => {
    const container = 360;
    const { start, end } = place(Math.min(a, container - BOX), Math.min(b, container - BOX), container);
    for (const label of [start, end]) {
      expect(label.left).toBeGreaterThanOrEqual(inset);
      expect(label.left + BOX).toBeLessThanOrEqual(container - inset);
    }
    expect(start.left + BOX).toBeLessThanOrEqual(end.left);
  });

  test('close handles: start text ends left of its handle, end text starts right of its own', () => {
    const { start, end } = place(150, 170, 360);
    expect(start.align).toBe('right');
    expect(start.left + BOX).toBe(150 + BOX / 2 - gap);
    expect(end).toEqual({ left: 170 + BOX / 2 + gap, align: 'left' });
  });
});

test('the drag tooltip never leaves the bar, at 100% and 200% font', () => {
  for (const fontScale of [1, 2]) {
    const width = 360 + BOX;
    for (const x of [0, BOX / 2, width / 2, width - BOX / 2, width]) {
      const box = dragTimeTipBox(x, width, 0, -Infinity, fontScale);
      expect(box.left).toBeGreaterThanOrEqual(space.s);
      expect(box.left + box.width).toBeLessThanOrEqual(width - space.s);
    }
  }
});
