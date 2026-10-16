// 2026-10-16: the faces cut off at the edges of the row of dogs ended at a
// hard line next to ‹ ›. Each edge now fades into the card's own colour
// (surface, light and dark), and lets every touch through to the faces.
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Stop } from 'react-native-svg';
import DogCarousel from '../src/map/DogCarousel';
import { ThemeScope, lightTheme, darkTheme } from '../src/theme/ThemeProvider';
import { size as sizes } from '../src/theme/tokens';

const dogs = [4, 5, 6, 8, 9].map(slaveId => ({ slaveId, name: `狗 ${slaveId}`, avatar: null, problem: false,
  stale: false }));

test.each([lightTheme, darkTheme])('both edges fade into the card surface ($isDark)', async theme => {
  let renderer;
  await act(async () => {
    renderer = Renderer.create(<ThemeScope theme={theme}>
      <DogCarousel dogs={dogs} currentId={6} width={380} onSelect={() => {}} />
    </ThemeScope>);
  });
  for (const side of ['left', 'right']) {
    const fade = renderer.root.findAll(node => node.props.testID === `dog-card-fade-${side}`
      && typeof node.type === 'string')[0];
    expect(fade.props.pointerEvents).toBe('none');
    const stops = fade.findAllByType(Stop).map(stop => [stop.props.stopColor, stop.props.stopOpacity]);
    // Opaque card colour at the window's edge, clear inwards.
    expect(stops).toEqual([[theme.colors.surface, '1'], [theme.colors.surface, '0']]);
    expect(fade.findAll(node => node.props.width === sizes.card.carousel.edgeFade).length).toBeGreaterThan(0);
  }
  await act(async () => renderer.unmount());
});
