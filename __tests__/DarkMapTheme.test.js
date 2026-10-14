import { darkTheme, lightTheme } from '../src/theme/ThemeProvider';
import { routeLines, withAlpha } from '../src/history/screen/HistoryMapModel';

const from = { latitude: 25, longitude: 121 };
const to = { latitude: 25.001, longitude: 121.001 };
const edges = [
  { start: 0, end: 10, from, to, mode: 'walking' },
  { start: 10, end: 20, from: to, to: from, mode: 'walking' },
];
// 2026-10-14: one strength all along (no before / after the cursor); a
// selected segment is full strength on the dark casing, never a fade.
test('dark routes are 75% all along and the selected segment full; light stays full', () => {
  const selection = { type: 'movement', mode: 'walking', start: 10, end: 20 };
  const dark = routeLines(edges, { color: darkTheme.colors.route1, theme: darkTheme, selection });
  expect(dark[0].color).toBe(withAlpha(darkTheme.colors.route1, 0.75));
  expect(dark[1].color).toBe(darkTheme.colors.route1);
  expect(dark[1].casing).toBe(darkTheme.colors.routeCasing);
  expect(dark.every(line => !line.dashed && line.dotted)).toBe(true);
  const light = routeLines(edges, { color: lightTheme.colors.route1, theme: lightTheme, selection });
  expect(light.map(line => line.color)).toEqual([lightTheme.colors.route1, lightTheme.colors.route1]);
  expect(light[1].casing).toBe(lightTheme.colors.routeCasing);
});
test('the PNG is fixed light: export builders read only the light palette', () => {
  const fs = require('fs');
  const path = require('path');
  const { exportColors, exportRouteColors } = require('../src/theme/exportPalette');
  expect(exportColors).toEqual(
    Object.fromEntries(
      Object.keys(exportColors).map(key => [key, lightTheme.colors[key]]),
    ),
  );
  expect(exportRouteColors).toEqual(lightTheme.routeColors);
  // No export builder follows the phone's scheme.
  const dir = path.join(__dirname, '..', 'src', 'mapHistory');
  fs.readdirSync(dir)
    .filter(name => /^Export.*\.js$/.test(name))
    .forEach(name => {
      const source = fs.readFileSync(path.join(dir, name), 'utf8');
      expect([name, /ThemeProvider|useTheme|Appearance/.test(source)]).toEqual([
        name,
        false,
      ]);
    });
});
