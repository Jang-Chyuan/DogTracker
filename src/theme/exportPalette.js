// The exported PNG is always light (design 深色模式「匯出的 PNG 一律用淺色」,
// L16): it is a file for other people and for printing, so it never follows
// the phone's dark setting. Export builders read these fixed light values.
import { colors, routeColors } from './tokens';

export const exportColors = colors;
export const exportRouteColors = routeColors;
