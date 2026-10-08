import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Appearance, StyleSheet, Text, useColorScheme } from 'react-native';
import {
  ThemeProvider,
  useTheme,
  useStyles,
  makeStyles,
  lightTheme,
  darkTheme,
  getTheme,
} from '../src/theme/ThemeProvider';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: jest.fn(),
}));

let renderer;
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  renderer = null;
  jest.restoreAllMocks();
});

test('system changes live between stable theme objects without remounting children', async () => {
  const seen = [];
  const factory = jest.fn(theme =>
    StyleSheet.create({ text: { color: theme.colors.text } }),
  );
  const styles = makeStyles(factory);
  let mounts = 0;
  function Probe() {
    const theme = useTheme();
    const sheet = useStyles(styles);
    React.useEffect(() => {
      mounts += 1;
    }, []);
    seen.push({ theme, sheet });
    return <Text style={sheet.text}>theme</Text>;
  }
  const tree = () => (
    <ThemeProvider>
      <Probe />
    </ThemeProvider>
  );
  useColorScheme.mockReturnValue('light');
  await act(async () => {
    renderer = Renderer.create(tree());
  });
  const first = seen.at(-1);
  expect(first.theme).toBe(lightTheme);
  useColorScheme.mockReturnValue('dark');
  await act(async () => renderer.update(tree()));
  expect(seen.at(-1).theme).toBe(darkTheme);
  expect(seen.at(-1).sheet.text.color).toBe(darkTheme.colors.text);
  useColorScheme.mockReturnValue('light');
  await act(async () => renderer.update(tree()));
  expect(seen.at(-1).sheet).toBe(first.sheet);
  expect(factory).toHaveBeenCalledTimes(2);
  expect(mounts).toBe(1);
});

test('unspecified scheme defaults to light; non-hook consumers read Appearance', async () => {
  useColorScheme.mockReturnValue(null);
  let theme;
  function Probe() {
    theme = useTheme();
    return null;
  }
  await act(async () => {
    renderer = Renderer.create(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
  });
  expect(theme).toBe(lightTheme);
  jest.spyOn(Appearance, 'getColorScheme').mockReturnValue('dark');
  expect(getTheme()).toBe(darkTheme);
});

test('the floating border keeps its width key in light (removing it on a live dark → light switch left the history panel undrawn)', () => {
  expect(lightTheme.floatingBorder).toEqual({ borderWidth: 0 });
  expect(Object.keys(darkTheme.floatingBorder)).toEqual(
    expect.arrayContaining(Object.keys(lightTheme.floatingBorder)),
  );
});
