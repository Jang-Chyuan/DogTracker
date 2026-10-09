import { size, space, touch } from '../theme/tokens';

// Shared 75% cap for the live card and the content-sized history panel.
export function mapPanelHeight(windowHeight, topInset = 0) {
  return Math.max(0, Math.floor((windowHeight - topInset) * size.card.maxRatio));
}
export function dogCardMaxHeight(windowHeight, topInset = 0, bottomInset = 0) {
  return Math.max(0, mapPanelHeight(windowHeight, topInset) - space.s - bottomInset);
}

// Date/summary header reserve (three touch targets), two timeline rows, and end padding.
export function historyPanelMinHeight(windowHeight, topInset = 0, bottomInset = 0) {
  return Math.min(mapPanelHeight(windowHeight, topInset),
    3 * touch.min + 2 * (size.timeline.sectionHeight + space.m) + bottomInset + space.l);
}
