// Fixed half-screen panel: date/range stays put; only the timeline scrolls.
import { forwardRef, useImperativeHandle, useRef, useEffect } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { makeStyles, useStyles } from '../theme/ThemeProvider';
import { size, space, border, fontScale as fontScales } from '../theme/tokens';
import { historyPanelMaxHeight, historyUsesWideHeader } from '../map/MapPanelHeight';
import { behindSheet } from '../utils/a11yFocus';
import { fontScaleAtLeast } from '../utils/textScale';

const HistoryPanel = forwardRef(function HistoryPanel({ header, children,
  bottomInset = 0, scrollRef, above = null, floating = null, hidden = false, onHeightChange }, ref) {
  const styles = useStyles(getStyles);
  const scroller = useRef(null);
  // Timeline rows report positions relative to the independently scrolling list.
  useImperativeHandle(scrollRef, () => ({
    scrollTo: options => scroller.current?.scrollTo(options),
  }), []);
  const { width: windowWidth, height: windowHeight, fontScale } = useWindowDimensions();
  // At large fonts the fixed header leaves a shorter list viewport. Avoid
  // pushing the last row's circle above it at maximum scroll, while retaining
  // the entire navigation inset, and an optional gap where room permits.
  const largeFont = fontScaleAtLeast(fontScale, fontScales.faceOnly);
  const shortWide = historyUsesWideHeader({ width: windowWidth, height: windowHeight });
  // A full END row can just fit in a short-wide large-font viewport after
  // its required navigation inset. Extra gutter would push the top offscreen
  // at maximum scroll; the navigation inset itself is never reduced.
  const largeFontGap = shortWide ? 0 : space.s;
  const tailGap = largeFont ? largeFontGap : space.l;
  const insets = useSafeAreaInsets();
  const cap = historyPanelMaxHeight(windowHeight, insets.top);
  // Report the actual fixed height immediately, including after rotation/inset changes.
  useEffect(() => { onHeightChange?.(cap); }, [cap, onHeightChange]);
  useImperativeHandle(ref, () => ({ back: () => false }), []);
  return (
    <View testID="history-panel" importantForAccessibility={behindSheet(hidden)}
      pointerEvents="box-none" style={[styles.panel, { height: cap }]}>
      {above && <View pointerEvents="box-none" style={styles.above}>{above}</View>}
      <View style={styles.sheet}>
        <View testID="history-panel-header" style={styles.header}>{header}</View>
        <ScrollView ref={scroller} style={styles.list} nestedScrollEnabled
          contentContainerStyle={{ paddingBottom: bottomInset + tailGap }}>
          <View testID="history-panel-content">
            {children}
          </View>
        </ScrollView>
      </View>
      {floating && <View testID="history-range-floating" style={styles.floating}>{floating}</View>}
    </View>
  );
});
export default HistoryPanel;
const getStyles = makeStyles(theme => ({
  panel: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 40, elevation: 12 },
  sheet: { flex: 1, backgroundColor: theme.colors.elevated,
    borderTopLeftRadius: size.historyPanel.corner, borderTopRightRadius: size.historyPanel.corner,
    ...theme.shadow.floating, ...theme.floatingBorder, elevation: 12, overflow: 'hidden' },
  above: { position: 'absolute', right: space.l, top: -(size.floatingButton + space.m) },
  floating: { position: 'absolute', left: space.l, right: space.l, bottom: '100%',
    marginBottom: space.s, paddingHorizontal: space.s, paddingVertical: space.xs,
    borderRadius: size.historyPanel.corner, backgroundColor: theme.colors.elevated,
    ...theme.shadow.floating, ...theme.floatingBorder, borderWidth: border.regular,
    borderColor: theme.colors.accent, elevation: 12, zIndex: 1 },
  header: { flexShrink: 0 },
  list: { flex: 1, minHeight: 0 },
}));
