// Content-sized, non-draggable panel with a fixed date/range header.
import { forwardRef, useImperativeHandle, useRef, useState, useEffect } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { makeStyles, useStyles } from '../theme/ThemeProvider';
import { size, space, motion } from '../theme/tokens';
import { historyPanelMaxHeight, historyPanelMinHeight } from '../map/MapPanelHeight';
import { behindSheet } from '../utils/a11yFocus';

const HistoryPanel = forwardRef(function HistoryPanel({ header, children,
  bottomInset = 0, scrollRef, above = null, hidden = false, measureKey = '', onHeightChange }, ref) {
  const styles = useStyles(getStyles);
  const scroller = useRef(null);
  const headerHeight = useRef(null);
  // Timeline rows report positions relative to the independently scrolling list.
  useImperativeHandle(scrollRef, () => ({
    scrollTo: options => scroller.current?.scrollTo(options),
  }), []);
  const { height: windowHeight, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const cap = historyPanelMaxHeight(windowHeight, insets.top);
  // Reserve the date/summary header and two rows, plus the bottom inset.
  const minimum = historyPanelMinHeight(windowHeight, insets.top, bottomInset);
  const [height, setHeight] = useState(minimum);
  const epoch = `${measureKey}:${fontScale}:${cap}:${bottomInset}`;
  const measurement = useRef({ epoch, settled: false, timer: null });
  if (measurement.current.epoch !== epoch) {
    clearTimeout(measurement.current.timer);
    measurement.current = { epoch, settled: false, timer: null };
  }
  useEffect(() => () => clearTimeout(measurement.current.timer), []);
  const contentSize = useRef(null);
  const settleHeight = () => {
    const pending = measurement.current;
    if (pending.epoch !== epoch || pending.settled ||
      headerHeight.current == null || contentSize.current == null) return;
    const contentHeight = headerHeight.current + contentSize.current + bottomInset + space.l;
    clearTimeout(pending.timer);
    // Wait for the header and scaled text to finish layout; scrolling never
    // measures or changes the height. No height animation re-frames the map.
    pending.timer = setTimeout(() => {
      if (measurement.current !== pending) return;
      pending.settled = true;
      const next = Math.min(cap, Math.max(minimum, contentHeight));
      setHeight(next);
      onHeightChange?.(next);
    }, motion.rangeCollapse.duration);
  };
  const measure = event => {
    contentSize.current = event.nativeEvent.layout.height;
    settleHeight();
  };
  const measureHeader = event => {
    const next = event.nativeEvent.layout.height;
    if (headerHeight.current !== next) {
      headerHeight.current = next;
      // Expanding the range controls changes the fixed header even on the same day.
      measurement.current.settled = false;
    }
    settleHeight();
  };
  useEffect(() => {
    // A different day can have identical dimensions and emit no layout event.
    settleHeight();
    // Header layout also reopens measurement; list refreshes keep it stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epoch]);
  useImperativeHandle(ref, () => ({ back: () => false }), []);
  return (
    <View testID="history-panel" importantForAccessibility={behindSheet(hidden)}
      pointerEvents="box-none" style={[styles.panel, { height }]}>
      {above && <View pointerEvents="box-none" style={styles.above}>{above}</View>}
      <View style={styles.sheet}>
        <View testID="history-panel-header" style={styles.header} onLayout={measureHeader}>{header}</View>
        <ScrollView ref={scroller} style={styles.list} nestedScrollEnabled
          contentContainerStyle={{ paddingBottom: bottomInset + space.l }}>
          <View testID="history-panel-content" onLayout={measure}>
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
