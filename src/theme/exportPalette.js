// The exported PNG is always light (design 深色模式「匯出的 PNG 一律用淺色」,
// L16): it is a file for other people and for printing, so it never follows
// the phone's dark setting. Export builders read these fixed light values.
import { colors, opacity, routeColors } from './tokens';
import darkSpec from './dark-tokens.json';

export const exportColors = colors;
export const exportRouteColors = routeColors;
// What the shared history map model needs to draw the PNG's map in light,
// whatever the phone's theme (routeLines / historyMapPresentation).
export const exportLightTheme = {
  isDark: false,
  colors,
  routeColors,
  opacity,
};

const ROUTE_KEYS = ['route1', 'route2', 'route3', 'route4', 'phone'];

/**
 * A route colour taken from the screen (the history look, which follows the
 * phone's theme) turned into its light value for the PNG: dark route1–4 and
 * phone map to the light ones; any other colour is kept.
 */
export function exportRouteColor(color, darkColors = darkSpec.colors) {
  if (!color) return color;
  const value = String(color).toUpperCase();
  const key = ROUTE_KEYS.find(
    name =>
      String(darkColors[name]).toUpperCase() === value ||
      String(colors[name]).toUpperCase() === value,
  );
  return key ? colors[key] : color;
}
