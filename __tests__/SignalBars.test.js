import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import Svg, { Rect } from 'react-native-svg';
import SignalBars from '../src/onboarding/SignalBars';
import { ThemeScope, lightTheme, darkTheme } from '../src/theme/ThemeProvider';

test.each([lightTheme, darkTheme])('signal bars use theme colors and phone-signal geometry', theme => {
  let screen;
  act(() => { screen = Renderer.create(<ThemeScope theme={theme}><SignalBars bars={2} /></ThemeScope>); });
  const svg = screen.root.findByType(Svg);
  expect(svg.props).toMatchObject({ width: 16, height: 12, accessible: false });
  expect(screen.root.findAllByType(Rect).map(bar => {
    const { x, y, width, height, rx, fill } = bar.props;
    return { x, y, width, height, rx, fill };
  })).toEqual([3, 6, 9, 12].map((height, index) => ({
    x: index * 4, y: 12 - height, width: 3, height, rx: 1,
    fill: index < 2 ? theme.colors.text : theme.colors.line,
  })));
  act(() => screen.update(<SignalBars bars={0} />));
  expect(screen.toJSON()).toBeNull();
  act(() => screen.unmount());
});
