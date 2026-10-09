import { logger } from '../logger';
import React, { createContext, useContext, useEffect } from 'react';
import { Appearance, useColorScheme } from 'react-native';
import * as light from './tokens';
import { appColors, floatingShadow } from './AppTheme';
import { legacyLight, legacyDark } from './legacyColors';
import darkSpec from './dark-tokens.json';
import lightMapStyle from './light-map-style.json';

export const lightTheme = {
  ...light,
  colors: { ...light.colors, ...light.extras },
  isDark: false,
  mapStyle: { google: lightMapStyle },
};
export const darkTheme = {
  ...lightTheme,
  isDark: true,
  colors: {
    ...lightTheme.colors,
    ...darkSpec.colors,
    ...darkSpec.darkOnly,
    ...light.darkAdditions,
    shadowBlack: darkSpec.shadow.floating.shadowColor,
    sheetHandle: darkSpec.darkOnly.grabHandle,
  },
  routeColors: darkSpec.routeColors,
  settingIcon: darkSpec.settingIcon,
  opacity: {
    ...light.opacity,
    ...darkSpec.opacity,
    faceGlow: darkSpec.opacity.cursorHalo,
  },
  shadow: darkSpec.shadow,
  mapStyle: darkSpec.mapStyle,
};
lightTheme.literalColors = { ...lightTheme.colors, ...legacyLight };
darkTheme.literalColors = {
  ...darkTheme.colors,
  ...Object.fromEntries(
    Object.entries(legacyDark).map(([key, token]) => [
      key,
      darkTheme.colors[token],
    ]),
  ),
};
// Disabled calendar dates retain the explicit 40% exception.
darkTheme.literalColors.disabledCalendarText = 'rgba(186,176,173,0.4)';
darkTheme.literalColors.markerShadow = 'rgba(0,0,0,0.4)';
darkTheme.literalColors.selectedMarkerShadow = 'rgba(0,0,0,0.4)';
lightTheme.appColors = appColors;
lightTheme.floatingShadow = floatingShadow;
darkTheme.appColors = {
  ink: darkTheme.colors.text,
  muted: darkTheme.colors.textMuted,
  canvas: darkTheme.colors.bg,
  surface: darkTheme.colors.surface,
  dog: darkTheme.colors.accent,
  master: darkTheme.colors.receiver,
  border: darkTheme.colors.line,
  danger: darkTheme.colors.crit,
  softDanger: darkTheme.colors.critBg,
  green: darkTheme.colors.ok,
};
darkTheme.floatingShadow = darkTheme.shadow.floating;
export const resolveStyles = factory => factory(getTheme());
// Light sets the width to 0 rather than leaving it out: a border taken away
// on a live dark → light switch left the history panel undrawn on Android.
lightTheme.floatingBorder = { borderWidth: 0 };
darkTheme.floatingBorder = {
  borderWidth: 1,
  borderColor: darkTheme.colors.floatingOutline,
};
const ThemeContext = createContext(null);
export const getTheme = () =>
  Appearance.getColorScheme() === 'dark' ? darkTheme : lightTheme;
export function ThemeProvider({ children }) {
  const scheme = useColorScheme();
  // Debug builds say when a scheme has been committed to the whole tree
  // (screenshot scripts wait for it; a debug re-render can take seconds).
  useEffect(() => {
    if (__DEV__) logger.log(`[Theme] applied ${scheme || 'light'}`);
  }, [scheme]);
  return (
    <ThemeContext.Provider value={scheme === 'dark' ? darkTheme : lightTheme}>
      {children}
    </ThemeContext.Provider>
  );
}
// Restricted to fixed-light export rendering; the application provider follows the system.
export function ThemeScope({ theme, children }) {
  return (
    <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
  );
}
export function useTheme() {
  const provided = useContext(ThemeContext);
  const scheme = useColorScheme();
  return provided || (scheme === 'dark' ? darkTheme : lightTheme);
}
// Each factory holds exactly two cached sheets. Theme identities are stable.
export function makeStyles(factory) {
  const cache = new WeakMap();
  return theme => {
    if (!cache.has(theme)) cache.set(theme, factory(theme));
    return cache.get(theme);
  };
}
export function useStyles(factory) {
  return factory(useTheme());
}
