// 060: where a large system font changes layouts (DESIGN.md §3.4).
import { PixelRatio } from 'react-native';
import { fontScaleAtLeast, linesFor } from '../src/utils/textScale';

test('Android reports 130% as 1.2999…; it still counts as 130%', () => {
  expect(fontScaleAtLeast(1.2999999, 1.3)).toBe(true);
  expect(fontScaleAtLeast(1.15, 1.3)).toBe(false);
  expect(fontScaleAtLeast(undefined, 1.3)).toBe(false);
});

test('a capped line gets twice the lines with a large font', () => {
  const spy = jest.spyOn(PixelRatio, 'getFontScale');
  spy.mockReturnValue(1);
  expect(linesFor(1)).toBe(1);
  spy.mockReturnValue(2);
  expect(linesFor(2)).toBe(4);
  spy.mockRestore();
});
