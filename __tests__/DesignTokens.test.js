import { colors, touch, type } from '../src/theme/tokens';

// WCAG relative luminance and contrast ratio.
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map(i => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// The light palette only stays readable in sunlight if the text on it is dark.
test.each([
  ['text on bg', colors.text, colors.bg, 7],
  ['text on surface', colors.text, colors.surface, 7],
  ['muted text on surface', colors.textMuted, colors.surface, 4.5],
  ['muted text on bg', colors.textMuted, colors.bg, 4.5],
  ['primary button text', colors.tonalText, colors.tonal, 4.5],
  ['selected row text', colors.text, colors.brandSoft, 7],
  ['ok status on surface', colors.ok, colors.surface, 4.5],
  ['ok status on its chip', colors.ok, colors.okBg, 4.5],
  ['warn status on its chip', colors.warn, colors.warnBg, 4.5],
  ['warn status on surface', colors.warn, colors.surface, 4.5],
  ['problem text on its card', colors.crit, colors.critBg, 7],
])('%s', (_, fg, bg, minimum) => {
  expect(contrast(fg, bg)).toBeGreaterThanOrEqual(minimum);
});

test('key text is at least 16sp and nothing is below 13sp', () => {
  expect(type.status.fontSize).toBeGreaterThanOrEqual(16);
  expect(type.body.fontSize).toBeGreaterThanOrEqual(16);
  Object.values(type).forEach(style => expect(style.fontSize).toBeGreaterThanOrEqual(13));
});

test('touch targets follow the 48dp floor', () => {
  expect(touch.min).toBeGreaterThanOrEqual(48);
  expect(touch.primary).toBeGreaterThan(touch.min);
});
