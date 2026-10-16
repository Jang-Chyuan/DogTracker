import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Path } from 'react-native-svg';
import Glyph from '../src/map/Glyph';
import { EXPORT_ICONS } from '../src/mapHistory/ExportDraw';

jest.mock('../src/theme/ThemeProvider', () => ({ useTheme: () => ({ literalColors: {} }) }));

test('D19 option B uses separated circular toes and the same pad on screen and PNG', () => {
  const expected =
    'M6.5 10.8a1.6 1.6 0 1 1-3.2 0a1.6 1.6 0 1 1 3.2 0' +
    'M10.5 5.6a1.6 1.6 0 1 1-3.2 0a1.6 1.6 0 1 1 3.2 0' +
    'M16.7 5.6a1.6 1.6 0 1 1-3.2 0a1.6 1.6 0 1 1 3.2 0' +
    'M20.7 10.8a1.6 1.6 0 1 1-3.2 0a1.6 1.6 0 1 1 3.2 0' +
    'M12 12.6c-2.7 0-5 2.9-5 4.9 0 1.5 1.2 2.4 2.6 2.4.9 0 1.5-.4 2.4-.4s1.5.4 2.4.4c1.4 0 2.6-.9 2.6-2.4 0-2-2.3-4.9-5-4.9z';
  let renderer;
  act(() => { renderer = Renderer.create(<Glyph name="paw" color="#123456" />); });
  expect(renderer.root.findByType(Path).props).toMatchObject({
    d: expected, stroke: '#123456', strokeWidth: 2, fill: 'none',
    strokeLinecap: 'round', strokeLinejoin: 'round',
  });
  expect(renderer.toJSON().props.viewBox).toBe('0 0 24 24');
  expect(EXPORT_ICONS.paw).toEqual({ stroke: expected });
  act(() => renderer.unmount());
});

test('框住全部 icon keeps the four corner brackets and holds the paw instead of a dot', () => {
  const { PAW_STROKE } = require('../src/map/PawGeometry');
  const { Circle } = require('react-native-svg');
  let renderer;
  act(() => { renderer = Renderer.create(<Glyph name="frame" color="#123456" />); });
  const paths = renderer.root.findAllByType(Path);
  expect(paths.some(p => p.props.d === PAW_STROKE && p.props.stroke === '#123456')).toBe(true);
  expect(paths.some(p => p.props.d === 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5')).toBe(true);
  expect(renderer.root.findAllByType(Circle)).toHaveLength(0);
  act(() => renderer.unmount());
});

test('框住全部 paw keeps at least 3dp from every bracket', () => {
  const { FRAME_PAW } = require('../src/map/Glyph');
  const { scale, strokeWidth, cy } = FRAME_PAW;
  const half = (strokeWidth * scale) / 2;
  // PAW_STROKE spans x 3.3-20.7, y 4-19.9 (toe circles and pad), centred at (12, cy).
  const box = {
    x0: 12 + (3.3 - 12) * scale - half, x1: 12 + (20.7 - 12) * scale + half,
    y0: 12 + (4 - cy) * scale - half, y1: 12 + (19.9 - cy) * scale + half,
  };
  // Brackets M4 9V4h5 (and mirrors), stroke 2: inner edges at 5 / 19, arms to 9 / 15.
  const inner = { lo: 5, hi: 19 };
  expect(box.x0 - inner.lo).toBeGreaterThanOrEqual(3);
  expect(inner.hi - box.x1).toBeGreaterThanOrEqual(3);
  expect(box.y0 - inner.lo).toBeGreaterThanOrEqual(3);
  expect(inner.hi - box.y1).toBeGreaterThanOrEqual(3);
});
