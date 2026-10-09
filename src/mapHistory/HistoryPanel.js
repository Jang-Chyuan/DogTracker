// A fixed map panel. All content scrolls, including the header at large fonts.
import { forwardRef, useImperativeHandle, useRef } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { makeStyles, useStyles } from '../theme/ThemeProvider';
import { size, space } from '../theme/tokens';
import { mapPanelHeight } from '../map/MapPanelHeight';
import { behindSheet } from '../utils/a11yFocus';

const HistoryPanel = forwardRef(function HistoryPanel({ header, children,
  bottomInset = 0, scrollRef, above = null, hidden = false }, ref) {
  const styles = useStyles(getStyles);
  const scroller = useRef(null);
  const headerHeight = useRef(0);
  // Timeline rows report positions relative to the list, after the header.
  useImperativeHandle(scrollRef, () => ({
    scrollTo: options => scroller.current?.scrollTo({
      ...options, y: options.y + headerHeight.current,
    }),
  }), []);
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const height = mapPanelHeight(windowHeight, insets.top);
  useImperativeHandle(ref, () => ({ back: () => false }), []);
  return (
    <View testID="history-panel" importantForAccessibility={behindSheet(hidden)}
      pointerEvents="box-none" style={[styles.panel, { height }]}>
      {above && <View pointerEvents="box-none" style={styles.above}>{above}</View>}
      <View style={styles.sheet}>
        <ScrollView ref={scroller} style={styles.list} nestedScrollEnabled
          contentContainerStyle={{ paddingBottom: bottomInset + space.l }}>
          <View testID="history-panel-header"
            onLayout={event => { headerHeight.current = event.nativeEvent.layout.height; }}>{header}</View>
          {children}
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
  list: { flex: 1 },
}));
