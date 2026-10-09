import { size, space } from '../theme/tokens';

// The live card's cap, including its large-font scroll fallback. History
// reserves this same space; text size never changes the map's visible area.
export function mapPanelHeight(windowHeight, topInset = 0) {
  return Math.max(0, Math.floor((windowHeight - topInset) * size.card.maxRatio));
}
export function dogCardMaxHeight(windowHeight, topInset = 0, bottomInset = 0) {
  return Math.max(0, mapPanelHeight(windowHeight, topInset) - space.s - bottomInset);
}
