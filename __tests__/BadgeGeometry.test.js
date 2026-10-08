import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { StyleSheet } from 'react-native';
import { problemBadgePosition, houseBadgePosition } from '../src/map/BadgeGeometry';
import { markerFrame } from '../src/map/DogMarkerView';
import { SettingsGear } from '../src/map/MapControls';
import { ThemeScope, lightTheme, darkTheme } from '../src/theme/ThemeProvider';

test.each([32, 40, 48, 56])('badge centres lie on the %idp outer face rim and stay in the marker bitmap', size => {
  const radius = size / 2;
  const frame = markerFrame(size);
  for (const diameter of [14, 16]) {
    const problem = problemBadgePosition(size, diameter);
    const house = houseBadgePosition(size, diameter);
    const problemX = radius - problem.right - diameter / 2;
    const problemY = problem.top + diameter / 2 - radius;
    expect(Math.hypot(problemX, problemY)).toBeCloseTo(radius);
    expect(problemX).toBeCloseTo(-problemY);
    expect(house.top + diameter / 2 - radius).toBeCloseTo(size / 4);
    expect(Math.hypot(house.left + diameter / 2 - radius, size / 4)).toBeCloseTo(radius);
    for (const position of [problem, house]) {
      const left = position.left ?? size - position.right - diameter;
      expect((frame.width - size) / 2 + left).toBeGreaterThanOrEqual(0);
      expect((frame.width - size) / 2 + left + diameter).toBeLessThanOrEqual(frame.width);
      expect(8 + position.top).toBeGreaterThanOrEqual(0);
      expect(8 + position.top + diameter).toBeLessThanOrEqual(frame.height);
    }
  }
});

test.each([lightTheme, darkTheme])('settings dot sits on the rim with a surface ring and visible overflow ($isDark)', async theme => {
  let renderer;
  await act(async () => {
    renderer = Renderer.create(<ThemeScope theme={theme}><SettingsGear top={8} alert /></ThemeScope>);
  });
  const dot = renderer.root.findAll(node => node.props.testID === 'map-settings-dot' && typeof node.type === 'string')[0];
  expect(StyleSheet.flatten(dot.props.style)).toMatchObject({ top: 2, right: 2, width: 10, height: 10, borderWidth: 2, borderColor: theme.colors.surface });
  let parent = dot.parent;
  let visibleViews = 0;
  while (parent) {
    const style = StyleSheet.flatten(parent.props.style);
    expect(style?.overflow).not.toBe('hidden');
    if (style?.overflow === 'visible') visibleViews++;
    parent = parent.parent;
  }
  expect(visibleViews).toBeGreaterThanOrEqual(3);
  await act(async () => renderer.unmount());
});
