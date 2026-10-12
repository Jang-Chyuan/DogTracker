// Three history sheet positions. Header gestures resize; timeline gestures scroll.
import { t } from '../i18n';
import { forwardRef, useImperativeHandle, useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { PanResponder, PixelRatio, ScrollView, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { makeStyles, useStyles } from '../theme/ThemeProvider';
import { size, space, touch, border, fontScale as fontScales } from '../theme/tokens';
import { historyPanelSnapHeights, historyPanelSnapAt, historyUsesWideHeader } from '../map/MapPanelHeight';
import { behindSheet } from '../utils/a11yFocus';
import { fontScaleAtLeast } from '../utils/textScale';

const HistoryPanel = forwardRef(function HistoryPanel({ header, children,
  bottomInset = 0, scrollRef, above = null, floating = null, hidden = false, onHeightChange,
  collapsedHeader, dateHeight, topControlBottom, scopeKey, rangeOpen = false,
  controlScope = scopeKey, onControlRects }, ref) {
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
  const [floatingHeight, setFloatingHeight] = useState(touch.min * 2);
  const heights = historyPanelSnapHeights({ height: windowHeight, topInset: insets.top,
    topControlBottom: (topControlBottom ?? insets.top + touch.min) + (floating ? floatingHeight + space.s : 0), dateHeight, bottomInset });
  const [snap, setSnap] = useState('half');
  const [dragHeight, setDragHeight] = useState(null);
  const latest = useRef(null);
  // On the pixel grid: measured header heights jitter in the last float bits
  // (75.99997 vs 76). An unrounded cap then never matches the overlay layout
  // already reported for that same pixel position, and the controls stay unready.
  const cap = PixelRatio.roundToNearestPixel(dragHeight == null ? heights[snap]
    : Math.max(heights.collapsed, Math.min(heights.expanded, dragHeight)));
  latest.current = { heights, snap, cap, hidden };
  const origin = useRef(null);
  // New history/subject/owner opens half; date changes retain the enum.
  useEffect(() => { setSnap('half'); setDragHeight(null); origin.current = null; }, [scopeKey]);
  useEffect(() => { if (hidden) { setDragHeight(null); origin.current = null; } }, [hidden]);
  useEffect(() => { if (rangeOpen) setSnap(level => level === 'collapsed' ? 'half' : level); }, [rangeOpen]);
  useEffect(() => { setDragHeight(null); origin.current = null; }, [windowWidth, windowHeight, fontScale, bottomInset]);
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_, g) => !latest.current.hidden && Math.abs(g.dy) > space.s && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderGrant: () => { if (!latest.current.hidden) origin.current = latest.current.cap; },
    onPanResponderMove: (_, g) => { if (origin.current != null && !latest.current.hidden) setDragHeight(origin.current - g.dy); },
    onPanResponderRelease: (_, g) => {
      if (origin.current == null || latest.current.hidden) return;
      const now = latest.current;
      const end = Math.max(now.heights.collapsed, Math.min(now.heights.expanded, origin.current - g.dy));
      setSnap(historyPanelSnapAt(now.heights, end, Math.abs(g.dy) > space.l ? Math.sign(-g.dy) : 0, now.snap));
      origin.current = null; setDragHeight(null);
    },
    onPanResponderTerminate: () => { origin.current = null; setDragHeight(null); },
  }), []);
  const adjustSnap = useCallback(event => {
    const action = event.nativeEvent.actionName;
    if (latest.current.hidden || !['expand', 'collapse'].includes(action)) return;
    origin.current = null; setDragHeight(null);
    setSnap(level => {
      const levels = ['collapsed', 'half', 'expanded'];
      return levels[Math.max(0, Math.min(2, levels.indexOf(level) + (action === 'expand' ? 1 : -1)))];
    });
  }, []);
  const controls = { panelActions: [
    ...(snap !== 'expanded' ? [{ name: 'expand', label: t('c1254') }] : []),
    ...(snap !== 'collapsed' ? [{ name: 'collapse', label: t('c1255') }] : []),
  ], onPanelAction: adjustSnap };
  const collapsed = snap === 'collapsed' && dragHeight == null;
  const aboveVisible = !!above && !hidden
    && windowHeight - cap - (topControlBottom ?? insets.top + touch.min) >= touch.min + space.m;
  const floatingVisible = !collapsed && !!floating && !hidden;
  // Only overlay hosts remount on an owner/viewport/visibility change. The
  // sheet's scroll view and the map's native cursor responder stay mounted.
  const overlayScope = `${controlScope}:${windowWidth}:${windowHeight}:${hidden}:${aboveVisible}:${floatingVisible}`;
  const layoutOwner = useRef({ scope: overlayScope, cap, epoch: 0 });
  if (layoutOwner.current.scope !== overlayScope) layoutOwner.current = {
    scope: overlayScope, cap, epoch: layoutOwner.current.epoch + 1,
  };
  layoutOwner.current.cap = cap;
  const overlayEpoch = layoutOwner.current.epoch;
  const [overlayLayouts, setOverlayLayouts] = useState({});
  const measureOverlay = (name, height = null) => event => {
    if (layoutOwner.current.scope !== overlayScope || layoutOwner.current.epoch !== overlayEpoch
      || (height != null && layoutOwner.current.cap !== height)) return;
    const rect = event.nativeEvent.layout;
    if (name === 'floating') setFloatingHeight(rect.height);
    const next = { scope: overlayScope, epoch: overlayEpoch, cap: height, rect };
    setOverlayLayouts(previous => JSON.stringify(previous[name]) === JSON.stringify(next)
      ? previous : { ...previous, [name]: next });
  };
  const aboveLayout = overlayLayouts.above?.scope === overlayScope && overlayLayouts.above.epoch === overlayEpoch
    && overlayLayouts.above.cap === cap
    ? overlayLayouts.above.rect : null;
  // Both overlays are the panel's siblings, so their layouts are already in
  // the screen's coordinates; each is current only for the cap it sat on.
  const floatingLayout = overlayLayouts.floating?.scope === overlayScope && overlayLayouts.floating.epoch === overlayEpoch
    && overlayLayouts.floating.cap === cap
    ? overlayLayouts.floating.rect : null;
  useEffect(() => {
    const boxes = [];
    if (aboveVisible && aboveLayout) boxes.push(aboveLayout);
    if (floatingVisible && floatingLayout) boxes.push(floatingLayout);
    onControlRects?.({ boxes, ready: (!aboveVisible || !!aboveLayout)
      && (!floatingVisible || !!floatingLayout) });
  }, [aboveVisible, floatingVisible, aboveLayout, floatingLayout, onControlRects]);
  // A functional header keeps its date responder host mounted across the first
  // collapsed drag update. Replacing that host mid-touch loses native release.
  const shownHeader = typeof header === 'function' ? header(pan.panHandlers, controls, collapsed)
    : <View {...pan.panHandlers} testID="history-panel-date-drag">{collapsed && collapsedHeader ? collapsedHeader : header}</View>;
  // Map framing follows the actual sheet position and current viewport.
  // Only a settled position reframes the map; a finger-follow height would
  // refit the camera on every move and drop the viewer's own pan/rotation.
  // A drag that springs back to the same position does not reframe either.
  const settled = dragHeight == null;
  const reported = useRef(null);
  useEffect(() => {
    if (!settled || (reported.current?.cap === cap && reported.current.receiver === onHeightChange)) return;
    reported.current = { cap, receiver: onHeightChange };
    onHeightChange?.(cap);
  }, [cap, settled, onHeightChange]);
  useImperativeHandle(ref, () => ({ back: () => false }), []);
  return (
    <>
      {/* Keep the map control inside the screen's native bounds. A child
          placed above the panel is visible, but Android clips its accessible
          rectangle against the panel, leaving an invalid accessibility target. */}
      {above && windowHeight - cap - (topControlBottom ?? insets.top + touch.min) >= touch.min + space.m && <View testID="history-panel-above" pointerEvents="box-none"
        key={`above:${overlayScope}:${overlayEpoch}`} onLayout={measureOverlay('above', cap)}
        importantForAccessibility={behindSheet(hidden)}
        style={[styles.above, { bottom: cap + space.m }]}>{above}</View>}
      {/* The wide range handles sit above the panel for the same reason: a
          child outside its parent's bounds loses touch and TalkBack on Android. */}
      {!collapsed && floating && <View key={`floating:${overlayScope}:${overlayEpoch}`} testID="history-range-floating"
        importantForAccessibility={behindSheet(hidden)} onLayout={measureOverlay('floating', cap)}
        style={[styles.floating, { bottom: cap + space.s }]}>{floating}</View>}
      <View testID="history-panel" importantForAccessibility={behindSheet(hidden)}
        pointerEvents="box-none" style={[styles.panel, { height: cap }]}>
        <View style={styles.sheet}>
          <View testID="history-panel-header" style={styles.header}>{shownHeader}</View>
          {!collapsed && <ScrollView ref={scroller} style={styles.list} nestedScrollEnabled
            contentContainerStyle={{ paddingBottom: bottomInset + tailGap }}>
            <View testID="history-panel-content">
              {children}
            </View>
          </ScrollView>}
        </View>
      </View>
    </>
  );
});
export default HistoryPanel;
const getStyles = makeStyles(theme => ({
  panel: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 40, elevation: 12 },
  sheet: { flex: 1, backgroundColor: theme.colors.elevated,
    borderTopLeftRadius: size.historyPanel.corner, borderTopRightRadius: size.historyPanel.corner,
    ...theme.shadow.floating, ...theme.floatingBorder, elevation: 12, overflow: 'hidden' },
  above: { position: 'absolute', right: space.l, zIndex: 40, elevation: 12 },
  floating: { position: 'absolute', left: space.l, right: space.l,
    paddingHorizontal: space.s, paddingVertical: space.xs,
    borderRadius: size.historyPanel.corner, backgroundColor: theme.colors.elevated,
    ...theme.shadow.floating, ...theme.floatingBorder, borderWidth: border.regular,
    borderColor: theme.colors.accent, elevation: 12, zIndex: 40 },
  header: { flexShrink: 0 },
  list: { flex: 1, minHeight: 0 },
}));
