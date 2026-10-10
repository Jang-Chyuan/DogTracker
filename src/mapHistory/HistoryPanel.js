// Fixed half-screen panel: date/range stays put; only the timeline scrolls.
import { forwardRef, useImperativeHandle, useRef, useEffect } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { makeStyles, useStyles } from '../theme/ThemeProvider';
import { size, space, fontScale as fontScales } from '../theme/tokens';
import { historyPanelMaxHeight } from '../map/MapPanelHeight';
import { behindSheet } from '../utils/a11yFocus';
import { fontScaleAtLeast } from '../utils/textScale';

const HistoryPanel = forwardRef(function HistoryPanel({ header, children,
  bottomInset = 0, scrollRef, above = null, hidden = false, onHeightChange }, ref) {
  const styles = useStyles(getStyles);
  const scroller = useRef(null);
  // Timeline rows report positions relative to the independently scrolling list.
  useImperativeHandle(scrollRef, () => ({
    scrollTo: options => scroller.current?.scrollTo(options),
  }), []);
  const { height: windowHeight, fontScale } = useWindowDimensions();
  // At large fonts the fixed header leaves a shorter list viewport. Avoid
  // pushing the last row's circle above it at maximum scroll, while retaining
  // the entire navigation inset and a small gap below the last text.
  const tailGap = fontScaleAtLeast(fontScale, fontScales.faceOnly) ? space.s : space.l;
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
  header: { flexShrink: 0 },
  list: { flex: 1, minHeight: 0 },
}));
