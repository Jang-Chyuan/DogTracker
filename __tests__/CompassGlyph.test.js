// The compass (2026-10-16 user feedback on #226): no ring, only the needle,
// as tall as the gear (2..22 of the 24-unit canvas) so it does not look
// smaller than the other map buttons. North half red, south half `color`.
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Circle, Path } from 'react-native-svg';
import Glyph from '../src/map/Glyph';

jest.mock('../src/theme/ThemeProvider', () => ({ useTheme: () => ({ literalColors: { critLine: '#E00000' } }) }));

const ys = d => d.match(/-?\d+(\.\d+)?/g).map(Number).filter((_, index) => index % 2 === 1);

test('the compass is only the needle: no ring, about as tall as the gear', () => {
  let renderer;
  act(() => { renderer = Renderer.create(<Glyph name="compass" color="#222222" />); });
  expect(renderer.root.findAllByType(Circle)).toHaveLength(0);
  const [north, south] = renderer.root.findAllByType(Path).map(node => node.props);
  expect(north.fill).toBe('#E00000');
  expect(south.fill).toBe('#222222');
  expect(Math.min(...ys(north.d))).toBeLessThanOrEqual(3);
  act(() => renderer.unmount());
});
