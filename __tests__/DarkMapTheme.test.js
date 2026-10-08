import { darkTheme, lightTheme } from '../src/theme/ThemeProvider';
import { routeLines, withAlpha } from '../src/history/screen/HistoryMapModel';

const from = { latitude: 25, longitude: 121 };
const to = { latitude: 25.001, longitude: 121.001 };
const edges = [
  { start: 0, end: 10, from, to, mode: 'walking' },
  { start: 10, end: 20, from: to, to: from, mode: 'walking' },
];
test('dark routes use before/after opacity and upcoming dashes without changing light output', () => {
  const dark = routeLines(edges, {
    color: darkTheme.colors.route1,
    cursorTime: 10,
    theme: darkTheme,
  });
  expect(dark[0].color).toBe(withAlpha(darkTheme.colors.route1, 0.75));
  expect(dark[1].color).toBe(withAlpha(darkTheme.colors.route1, 0.6));
  expect(dark[0].dashed).toBe(false);
  expect(dark[1].dashed).toBe(true);
  const light = routeLines(edges, {
    color: lightTheme.colors.route1,
    cursorTime: 10,
    theme: lightTheme,
  });
  expect(light[0].color).toBe(lightTheme.colors.route1);
  expect(light[1].color).toBe(withAlpha(lightTheme.colors.route1, 0.3));
  expect(light[1].dashed).toBe(false);
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
