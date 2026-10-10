import { size, space, touch } from '../theme/tokens';

// Live dog card cap. History has its own smaller cap.
export function mapPanelHeight(windowHeight, topInset = 0) {
  return Math.max(0, Math.floor((windowHeight - topInset) * size.card.maxRatio));
}
export function dogCardMaxHeight(windowHeight, topInset = 0, bottomInset = 0) {
  return Math.max(0, mapPanelHeight(windowHeight, topInset) - space.s - bottomInset);
}

export function historyPanelMaxHeight(windowHeight, topInset = 0) {
  return Math.max(0, Math.floor((windowHeight - topInset) * size.historyPanel.maxRatio));
}

// Date/summary header reserve (three touch targets), two timeline rows, and end padding.
export function historyPanelMinHeight(windowHeight, topInset = 0, bottomInset = 0) {
  return Math.min(historyPanelMaxHeight(windowHeight, topInset),
    3 * touch.min + 2 * (size.timeline.sectionHeight + space.m) + bottomInset + space.l);
}

// A wide, short phone window has little vertical room in the fixed half panel.
// Tall tablets retain the ordinary header; narrow split windows need its full width.
export function historyUsesWideHeader({ width, height }) {
  return Number.isFinite(width) && Number.isFinite(height)
    && width >= 600 && height <= 500 && width > height;
}
