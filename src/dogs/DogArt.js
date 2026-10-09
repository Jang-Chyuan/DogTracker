import { t } from '../i18n';
// The dog illustrations for avatars, in the style chosen on 2026-10-01
// (design 9 B+C, design 10): few lines, outlines left open, dot eyes, an ω
// mouth, ears drawn apart. One line colour, no fills. Coordinates are on the
// 120×120 grid of the design report's drawings; 原本 is its D1 head and 捲毛
// its D4.

const eyes = (left = 49, right = 71, y = 58) => [
  { cx: left, cy: y, r: 3 }, { cx: right, cy: y, r: 3 },
];
const MOUTH = 'M54 69q3 4 6 0 3 4 6 0';

export const DOG_ARTS = {
  classic: {
    label: t("c631"),
    lines: ['M38 37c8-7 36-7 44 0', 'M39 35C24 35 17 52 21 71c2 7 9 8 12 2 2-5 2-11 4-17',
      'M81 35c15 0 22 17 18 36-2 7-9 8-12 2-2-5-2-11-4-17', 'M41 78c9 9 29 9 38 0', MOUTH],
    dots: eyes(), nose: { cx: 60, cy: 64.5, rx: 3.4, ry: 2.5 },
  },
  prick: {
    label: t("c640"),
    lines: ['M41 39c6-4 32-4 38 0', 'M41 42L38 27l13 8', 'M79 42l3-15-13 8',
      'M40 44c-4 11-3 25 2 34', 'M80 44c4 11 3 25-2 34', 'M42 78c9 9 27 9 36 0', MOUTH],
    dots: eyes(), nose: { cx: 60, cy: 64.5, rx: 3.4, ry: 2.5 },
  },
  floppy: {
    label: t("c635"),
    lines: ['M38 37c8-7 36-7 44 0', 'M39 35C22 35 13 60 18 88c2 7 10 7 12 0 2-7 2-16 5-26',
      'M81 35c17 0 26 25 21 53-2 7-10 7-12 0-2-7-2-16-5-26', 'M41 78c9 9 29 9 38 0', MOUTH],
    dots: eyes(), nose: { cx: 60, cy: 64.5, rx: 3.4, ry: 2.5 },
  },
  short: {
    label: t("c643"),
    lines: ['M35 41c10-9 40-9 50 0', 'M36 41c-9-3-14 6-10 13', 'M84 41c9-3 14 6 10 13',
      'M33 46c-3 13 1 26 9 32', 'M87 46c3 13-1 26-9 32', 'M42 78c10 7 26 7 36 0', 'M48 67c2 8 22 8 24 0'],
    dots: eyes(46, 74, 56), nose: { cx: 60, cy: 61, rx: 4.4, ry: 3.2 },
  },
  curly: {
    label: t("c634"),
    lines: ['M30.9 50.1 Q29.1 44.6 34.9 43.0 Q34.8 37.2 40.9 37.1 Q42.4 31.6 48.4 33.1 Q51.5 28.1 56.8 31.2 '
      + 'Q61.2 27.1 65.4 31.4 Q70.9 28.7 73.6 33.9 Q79.6 32.8 80.7 38.4 Q86.8 38.9 86.3 44.6 Q91.9 46.7 89.8 52.0 '
      + 'Q94.6 55.5 91.0 60.0 Q94.6 64.5 89.8 68.0 Q91.9 73.3 86.3 75.4 Q86.8 81.1 80.7 81.6 Q79.6 87.2 73.6 86.1 '
      + 'Q70.9 91.3 65.4 88.6 Q61.2 92.9 56.8 88.8 Q51.5 91.9 48.4 86.9 Q42.4 88.4 40.9 82.9 Q34.8 82.8 34.9 77.0 '
      + 'Q29.1 75.4 30.9 69.9',
    'M34 36c-10 2-14 14-10 24 4 3 8 1 9-4M86 36c10 2 14 14 10 24-4 3-8 1-9-4', 'M54 70q3 4 6 0 3 4 6 0'],
    dots: eyes(49, 71, 60), nose: { cx: 60, cy: 66, rx: 3.2, ry: 2.4 },
  },
};
export const DOG_ART_KEYS = Object.keys(DOG_ARTS);

// Background and line colour, in two rows: six full colours with white
// lines (柔珊瑚, the app's own colour and the app icon's look, is the
// default) and the same six as light tints with dark lines.
export const DOG_COLORS = {
  coral: { label: t("c633"), bg: '#F2867A', line: '#FFFFFF' },
  orange: { label: t("c639"), bg: '#E8925A', line: '#FFFFFF' },
  green: { label: t("c636"), bg: '#4FAE8A', line: '#FFFFFF' },
  blue: { label: t("c629"), bg: '#5E9FD3', line: '#FFFFFF' },
  purple: { label: t("c641"), bg: '#8C7AD0', line: '#FFFFFF' },
  cocoa: { label: t("c632"), bg: '#A47A5B', line: '#FFFFFF' },
  blush: { label: t("c630"), bg: '#FFE4DF', line: '#3A2B2A' },
  apricot: { label: t("c628"), bg: '#FFE9D4', line: '#3A2B2A' },
  mint: { label: t("c638"), bg: '#DDF3EA', line: '#3A2B2A' },
  sky: { label: t("c644"), bg: '#DCEBF7', line: '#3A2B2A' },
  lavender: { label: t("c637"), bg: '#ECE8FA', line: '#3A2B2A' },
  sand: { label: t("c642"), bg: '#F1E7DA', line: '#3A2B2A' },
};
export const DOG_COLOR_KEYS = Object.keys(DOG_COLORS);
// The full colours first, then their light tints, six to a row.
export const DOG_COLOR_ROWS = [DOG_COLOR_KEYS.slice(0, 6), DOG_COLOR_KEYS.slice(6)];

// A dog nobody has set up yet.
export const DEFAULT_AVATAR = Object.freeze({ kind: 'art', art: 'classic', color: 'coral' });

// What may be stored: an illustration by name, or a small JPEG photo.
export function normalizeAvatar(value) {
  if (value?.kind === 'art' && DOG_ARTS[value.art] && DOG_COLORS[value.color])
    return { kind: 'art', art: value.art, color: value.color };
  if (value?.kind === 'photo' && typeof value.uri === 'string' && value.uri.startsWith('data:image/'))
    return { kind: 'photo', uri: value.uri };
  return null;
}
