import { darkTheme, lightTheme } from '../src/theme/ThemeProvider';
import { routeLines, withAlpha } from '../src/history/screen/HistoryMapModel';
import { lightExportPresentation } from '../src/theme/exportTheme';

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
test('PNG presentation is fixed light without mutating the displayed dark model', () => {
  const lines = routeLines(edges, {
    color: darkTheme.colors.route1,
    cursorTime: 10,
    theme: darkTheme,
  });
  const presentation = {
    historyRoute: {
      color: darkTheme.colors.route1,
      lines,
      faces: [{ color: darkTheme.colors.route2 }],
    },
  };
  const exported = lightExportPresentation(presentation);
  expect(exported.historyRoute.color).toBe(lightTheme.colors.route1);
  expect(exported.historyRoute.lines.map(line => line.color)).toEqual([
    withAlpha(lightTheme.colors.route1, 1),
    withAlpha(lightTheme.colors.route1, 0.3),
  ]);
  expect(exported.historyRoute.lines.every(line => !line.dashed)).toBe(true);
  expect(exported.historyRoute.faces[0].color).toBe(lightTheme.colors.route2);
  expect(presentation.historyRoute.lines[1].dashed).toBe(true);
});
