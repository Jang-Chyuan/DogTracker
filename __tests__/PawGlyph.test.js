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
