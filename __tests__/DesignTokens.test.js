import fs from 'fs';
import path from 'path';
import { lightTheme, darkTheme } from '../src/theme/ThemeProvider';
import darkSpec from '../src/theme/dark-tokens.json';
import * as tokens from '../src/theme/tokens';
import {
  colors,
  settingIcon,
  smallTypeExceptions,
  touch,
  type,
  routeColors,
} from '../src/theme/tokens';

const WHITE = '#FFFFFF';

// WCAG relative luminance and contrast ratio.
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map(i => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
// An opaque colour drawn at `alpha` over `bg`.
function composite(hex, alpha, bg) {
  const channel = (h, i) => parseInt(h.slice(i, i + 2), 16);
  return `#${[1, 3, 5]
    .map(i =>
      Math.round(channel(hex, i) * alpha + channel(bg, i) * (1 - alpha))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Text needs 4.5:1 (7:1 for the main text and the problem text, read in
// sunlight); icons, lines and badges need 3:1.
describe('text contrast', () => {
  test.each([
    ['text on bg', colors.text, colors.bg, 7],
    ['text on surface', colors.text, colors.surface, 7],
    ['text on a selected row', colors.text, colors.brandSoft, 7],
    ['muted text on surface', colors.textMuted, colors.surface, 4.5],
    ['muted text on bg', colors.textMuted, colors.bg, 4.5],
    ['primary button text', colors.tonalText, colors.tonal, 4.5],
    [
      'text button (稍後再說) on surface',
      colors.tonalText,
      colors.surface,
      4.5,
    ],
    ['ok status on surface', colors.ok, colors.surface, 4.5],
    ['ok status on its chip', colors.ok, colors.okBg, 4.5],
    ['warn value on surface', colors.warn, colors.surface, 4.5],
    ['warn status on its chip', colors.warn, colors.warnBg, 4.5],
    ['problem text on surface', colors.crit, colors.surface, 7],
    ['problem text on its card', colors.crit, colors.critBg, 7],
    ['white "!" on the problem badge', WHITE, colors.problemBadge, 4.5],
    ['white "!" on the amber warn icon', WHITE, colors.warnIcon, 4.5],
    ['休息中 on the card', colors.activityLow, colors.surface, 4.5],
    ['劇烈活動 on the card', colors.activityHighText, colors.surface, 4.5],
    ['phone name label', colors.phone, colors.surface, 4.5],
    ['receiver number on its tag', WHITE, colors.receiverRing, 4.5],
    ['snackbar text', colors.text, colors.snackbar, 7],
    // The 070 success tick is information, not decoration: it has to be
    // readable on the card and on the flat settings page behind it.
    ['success tick on a card', colors.successIcon, colors.surface, 4.5],
    ['success tick on the page', colors.successIcon, colors.bg, 4.5],
  ])('%s', (_, fg, bg, minimum) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(minimum);
  });
});

describe('graphic contrast', () => {
  test.each([
    ['indoor house badge on white border', colors.receiver, WHITE],
    [
      'problem badge on the map label halo',
      colors.problemBadge,
      colors.mapLabelHalo,
    ],
    ['alert card edge / out-of-range line', colors.critLine, colors.surface],
    ['muted icon', colors.iconMuted, colors.surface],
    ['history stale ring', colors.staleRing, colors.surface],
    ['faded route', colors.routeFaded, colors.surface],
    ['alert card icon', colors.problemBadge, colors.alertIconBg],
    ...routeColors.map((c, i) => [`route${i + 1} line`, c, colors.surface]),
    ...Object.entries(settingIcon).map(([name, { bg, line }]) => [
      `settings icon ${name}`,
      line,
      bg,
    ]),
  ])('%s', (_, fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(3);
  });

  // The design draws the ring at 55% opacity: about 2.1:1 on a white map. It
  // is a reference boundary, not the only cue (the red "!" and the card carry
  // the out-of-range problem); this pins the value so a change is deliberate.
  test('range ring as drawn (55% over white)', () => {
    const drawn = composite(
      colors.rangeRing,
      tokens.opacity.rangeRingStroke,
      WHITE,
    );
    expect(contrast(drawn, WHITE)).toBeGreaterThanOrEqual(2);
  });

  // accent is a shape colour only: white text on it would fail.
  test('accent is not usable under white text', () => {
    expect(contrast(WHITE, colors.accent)).toBeLessThan(4.5);
  });
});

test('key text is at least 16sp and nothing is below 13sp except the listed exceptions', () => {
  ['body', 'status'].forEach(name =>
    expect(type[name].fontSize).toBeGreaterThanOrEqual(16),
  );
  Object.entries(type).forEach(([name, style]) => {
    const floor = smallTypeExceptions[name] ?? 13;
    expect(style.fontSize).toBeGreaterThanOrEqual(floor);
  });
});

test('touch targets follow the 48dp floor', () => {
  Object.entries(touch)
    .filter(([name]) => name !== 'calendarCell')
    .forEach(([, value]) => expect(value).toBeGreaterThanOrEqual(48));
  expect(touch.primary).toBeGreaterThan(touch.min);
});

// DESIGN.md and tokens.js must describe the same palette and type scale.
describe('DESIGN.md matches tokens.js', () => {
  const doc = fs.readFileSync(path.join(__dirname, '..', 'DESIGN.md'), 'utf8');
  const tokenRows = doc
    .split('\n')
    .filter(line => line.startsWith('| `'))
    .map(line => line.split('|').map(cell => cell.trim()))
    .map(cells => ({
      names: [...cells[1].matchAll(/`([^`]+)`/g)].map(m => m[1]),
      values: [...cells[2].matchAll(/`([^`]+)`/g)].map(m => m[1]),
      cells,
      darkValues: [...cells[3].matchAll(/`([^`]+)`/g)].map(m => m[1]),
      size: cells[2].match(/^(\d+)sp \/ (\d+)/),
    }));

  const resolve = (root, name) =>
    name.split('.').reduce((node, key) => node?.[key], root);
  const lookup = name => resolve({ ...colors, settingIcon }, name);

  const colorRows = tokenRows.filter(row => row.values.length > 0);
  const typeRows = tokenRows.filter(row => row.size);

  test('token table rows are well formed', () => {
    tokenRows.forEach(({ cells, values, size }) => {
      expect(cells.length).toBe(size ? 5 : 6);
      // A colour cell without backticks would be skipped by the checks below.
      if (/#[0-9A-Fa-f]{3}|rgba\(/.test(cells[2])) {
        expect(values.length).toBeGreaterThan(0);
      } else {
        expect(size).toBeTruthy();
      }
    });
  });

  test('every colour DESIGN.md lists exists with the same value', () => {
    expect(colorRows.length).toBeGreaterThan(40);
    colorRows.forEach(({ names, values }) => {
      const actual = names.flatMap(name => {
        const value = lookup(name);
        if (value === undefined) {
          throw new Error(
            `DESIGN.md lists \`${name}\`, which is not in tokens.js`,
          );
        }
        return typeof value === 'object' ? [value.bg, value.line] : [value];
      });
      expect(actual.map(v => v.toUpperCase())).toEqual(
        values.map(v => v.toUpperCase()),
      );
    });
  });

  test('dark column matches the dark theme', () => {
    const lookupDark = name =>
      resolve(
        { ...darkTheme.colors, settingIcon: darkTheme.settingIcon },
        name,
      );
    colorRows.forEach(({ names, darkValues }) => {
      const actual = names.flatMap(name => {
        const value = lookupDark(name);
        return typeof value === 'object' ? [value.bg, value.line] : [value];
      });
      expect(actual.map(v => v.toUpperCase())).toEqual(
        darkValues.map(v => v.toUpperCase()),
      );
    });
  });

  test('every colour token is documented in DESIGN.md', () => {
    const documented = new Set(colorRows.flatMap(row => row.names));
    const colorNames = [
      ...Object.keys(colors),
      ...Object.keys(settingIcon).map(name => `settingIcon.${name}`),
    ];
    expect(colorNames.filter(name => !documented.has(name))).toEqual([]);
  });

  test('every type size DESIGN.md lists matches tokens.js', () => {
    expect(typeRows.map(row => row.names[0]).sort()).toEqual(
      Object.keys(type).sort(),
    );
    typeRows.forEach(({ names, size }) => {
      expect(type[names[0]].fontSize).toBe(Number(size[1]));
      expect(type[names[0]].fontWeight).toBe(size[2]);
    });
  });

  test('every backticked token reference in the prose exists', () => {
    // A name resolves if it is a colour, a type style or a path into the exports.
    const exists = name =>
      name in colors ||
      name in type ||
      resolve({ ...tokens, settingIcon }, name) !== undefined;
    const referenced = [...doc.matchAll(/`([A-Za-z][A-Za-z0-9.]*)`/g)].map(
      m => m[1],
    );
    // Code identifiers that are not tokens.
    const notTokens = new Set([
      'accessibilityRole',
      'accessibilityLabel',
      'translateY',
      'height',
      // Code names in the prose (060), not tokens.
      'linesFor',
      'PressScale',
      'MarkerA11yLayer',
    ]);
    const unknown = referenced.filter(
      name => !exists(name) && !notTokens.has(name),
    );
    expect([...new Set(unknown)]).toEqual([]);
  });
});

test('both schemes cover every original colour-bearing token and match the design source', () => {
  Object.keys(lightTheme.colors).forEach(key =>
    expect(darkTheme.colors[key]).toBeDefined(),
  );
  // Every light colour has a dark value of its own: from the design's dark
  // table, its dark-only list, or darkAdditions (tokens added later, with the
  // reasoning in tokens.js). Nothing silently stays light in the dark theme.
  const explicit = new Set([
    ...Object.keys(darkSpec.colors),
    ...Object.keys(darkSpec.darkOnly),
    ...Object.keys(tokens.darkAdditions),
    'sheetHandle', // = darkOnly.grabHandle
  ]);
  expect(
    [...Object.keys(tokens.colors), ...Object.keys(tokens.extras)].filter(
      key => !explicit.has(key),
    ),
  ).toEqual([]);
  Object.entries(tokens.darkAdditions).forEach(([key, value]) =>
    expect(darkTheme.colors[key]).toBe(value),
  );
  for (const group of ['colors', 'settingIcon', 'opacity', 'shadow']) {
    const visit = (expected, actual) =>
      Object.entries(expected).forEach(([key, value]) => {
        if (value && typeof value === 'object' && !Array.isArray(value))
          visit(value, actual[key]);
        else expect(actual[key]).toEqual(value);
      });
    visit(darkSpec[group], darkTheme[group]);
  }
  expect(darkTheme.routeColors).toEqual(darkSpec.routeColors);
  expect(darkTheme.mapStyle).toEqual(darkSpec.mapStyle);
  Object.entries(darkSpec.darkOnly).forEach(([key, value]) =>
    expect(darkTheme.colors[key]).toBe(value),
  );
  expect(darkTheme.colors.sheetHandle).toBe(darkSpec.darkOnly.grabHandle);
});

test('the original light palette is unchanged', () => {
  const baseline = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, 'fixtures', 'light-tokens.json'),
      'utf8',
    ),
  );
  // 070-j adds a dedicated map-header alpha. Keep exact equality for every
  // pre-existing token; allow explicit additions verified below.
  const originalOpacity = { ...tokens.opacity };
  delete originalOpacity.mapHeaderBacking;
  const originalColors = { ...tokens.colors };
  delete originalColors.activityMissing;
  Object.entries(baseline).forEach(([group, value]) =>
    expect(group === 'opacity' ? originalOpacity : group === 'colors' ? originalColors : tokens[group]).toEqual(value),
  );
});

test('the new map-header backing alpha is explicitly 85% in both themes', () => {
  expect(tokens.opacity.mapHeaderBacking).toBe(0.85);
  expect(lightTheme.opacity.mapHeaderBacking).toBe(0.85);
  expect(darkSpec.opacity.mapHeaderBacking).toBe(0.85);
  expect(darkTheme.opacity.mapHeaderBacking).toBe(0.85);
});

describe('dark text and graphic contrast', () => {
  const c = darkTheme.colors;
  test.each([
    ['main text', c.text, c.surface, 7],
    ['elevated text', c.text, c.elevated, 7],
    ['muted text', c.textMuted, c.elevated, 4.5],
    ['tonal action', c.tonalText, c.tonal, 4.5],
    ['problem text', c.crit, c.critBg, 4.5],
    ['warn value', c.warn, c.surface, 4.5],
    ['warn glyph', c.onWarnIcon, c.warnIcon, 4.5],
    ['problem glyph', WHITE, c.problemBadge, 4.5],
    ['floating outline', c.floatingOutline, c.mapBase, 3],
    ['plain list pill', c.textMuted, c.pillPlain, 4.5],
    ['indoor list pill', c.receiver, c.pillIndoor, 4.5],
    ['red action text', c.critAction, c.surface, 4.5],
    ['red action text in a dialog', c.critAction, c.elevated, 4.5],
    ['success tick', c.successIcon, c.surface, 4.5],
    ['success tick on the page', c.successIcon, c.bg, 4.5],
    ['success tick in a dialog', c.successIcon, c.elevated, 4.5],
    ...darkTheme.routeColors.flatMap((color, i) => [
      [
        `route${i + 1} upcoming over land`,
        composite(color, darkTheme.opacity.routeUpcoming, c.mapBase),
        c.mapBase,
        3,
      ],
      [
        `route${i + 1} before cursor over highway`,
        composite(color, darkTheme.opacity.routeBeforeCursor, '#4A423E'),
        '#4A423E',
        3,
      ],
    ]),
  ])('%s', (_, foreground, background, minimum) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(minimum);
  });
});

test('spacing is exactly the design scale and border weights are documented widths', () => {
  expect(tokens.space).toEqual({ xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 32 });
  // §4 / §15: line, outline, selection, marker/time/endpoint and handle rings,
  // plus the 4dp accent edge of alert cards.
  const documented = [1, 1.5, 1.6, 2, 2.4, 2.5, 3, 4];
  expect(Object.values(tokens.border).length).toBeGreaterThan(0);
  Object.values(tokens.border).forEach(width => expect(documented).toContain(width));
});

test('D18 small shape tokens preserve container radii and cursor padding', () => {
  expect(tokens.radius).toMatchObject({ full: 999, settingIcon: 999, snackbar: 999,
    cursorLabel: 16, card: 16, sheet: 16, dialog: 24, alertCard: 14,
    input: 12, stayRow: 12, scanFrame: 16 });
  expect(tokens.size.cursor).toMatchObject({ labelPaddingV: 4, labelPaddingH: 10 });
});


test.each([lightTheme, darkTheme])('missing activity is neutral, distinct and readable ($isDark)', theme => {
  const c = theme.colors;
  expect(c.activityMissing).not.toBe(c.text);
  expect(c.activityMissing).not.toBe(c.activityNormal);
  expect(c.activityMissing).not.toBe(c.activityLow);
  // Text AA is stricter than the 3:1 minimum for gaps and legend swatches.
  expect(contrast(c.activityMissing, c.surface)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(c.activityMissing, c.bg)).toBeGreaterThanOrEqual(4.5);
});
