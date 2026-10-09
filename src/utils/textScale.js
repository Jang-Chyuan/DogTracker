// 大字體 (DESIGN.md §3.4, 設計稿「無障礙」「大字體」): with the system font
// at 130% and up, a line that would be cut gets room to wrap instead (膠囊和
// 按鈕可以變高、文字換行、不裁字). Text that the design itself cuts with
// 「…」 (the card's address line, a long dog name in a capsule) keeps its cap.
import { PixelRatio } from 'react-native';
import { fontScale } from '../theme/tokens';

export const LARGE_FONT_SCALE = fontScale.large;

/** At least `threshold` (Android reports 1.3 as 1.2999…). */
export const fontScaleAtLeast = (scale, threshold) =>
  (scale || 1) >= threshold - 0.01;

export const isLargeFont = () =>
  fontScaleAtLeast(PixelRatio.getFontScale?.(), LARGE_FONT_SCALE);

/** `count` lines at the normal size; twice as many with a large system font. */
export const linesFor = count => (isLargeFont() ? count * 2 : count);
