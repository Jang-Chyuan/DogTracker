import { TopRow } from '../src/mapHistory/HistoryScreen';
import { CursorLabelView } from '../src/mapHistory/HistoryMapMarkers';
import { Dimensions, StyleSheet } from 'react-native';
import { space, touch, layout as mapLayout } from '../src/theme/tokens';

// React Native delivers these layouts before the loaded map can project/focus
// a complete cursor card. The mock hosts do not run Yoga or emit onLayout.
export function measureHistoryMap(tree, { controls = true, container = true } = {}) {
  const host = id => tree.root.findAll(node => typeof node.type === 'string' && node.props.testID === id)[0];
  const layout = (node, box) => node.props.onLayout({ nativeEvent: { layout: box } });
  const { width, height } = Dimensions.get('window');
  if (container) layout(host('tracking-map-container'), { x: 0, y: 0, width, height });
  if (controls) {
    const top = tree.root.findByType(TopRow);
    layout(top.findAll(node => typeof node.type === 'string' && node.props.onLayout)[0],
      { x: space.s, y: top.props.top, width: width - 2 * space.s, height: touch.min });
    layout(host('history-back-now'), { x: 0, y: 0, width: 112, height: 40 });
    layout(host('history-export'), { x: width - 2 * space.s - touch.min, y: 0, width: touch.min, height: touch.min });
    if (top.props.subject !== 'phone') {
      // The pillSlot's layout callback owns the full dog capsule touch area.
      const slot = top.findAll(node => typeof node.type === 'string' && node.props.onLayout
        && !node.props.testID && node.props.pointerEvents !== 'box-none')[0];
      if (slot) layout(slot, { x: 124, y: 0, width: 120, height: touch.min });
    }
    const panel = host('history-panel');
    const cap = StyleSheet.flatten(panel.props.style).height;
    const above = host('history-panel-above');
    if (above) layout(above, { x: width - space.l - touch.min,
      y: height - cap - space.m - touch.min, width: touch.min, height: touch.min });
    const floating = host('history-range-floating');
    // A sibling of the panel: its layout is already in the screen's coordinates.
    if (floating) layout(floating, { x: space.l, y: height - cap - space.s - touch.min * 2,
      width: width - space.l * 2, height: touch.min * 2 });
    const compass = host('map-compass-layout');
    if (compass?.props.onLayout) layout(compass, { x: width - mapLayout.screenEdge - touch.min,
      y: StyleSheet.flatten(compass.props.style).top, width: touch.min, height: touch.min });
  }
  const label = tree.root.findAllByType(CursorLabelView).find(node => node.props.onLabelLayout);
  if (!label) throw new Error('native cursor label missing');
  layout(label.findAll(node => typeof node.type === 'string' && node.props.onLayout)[0],
    { x: 0, y: 0, width: 140, height: 44 });
  const cursorMarker = tree.root.findAll(node => typeof node.type === 'string' && node.props.testID === 'map-marker')
    .find(node => node.findAllByType(CursorLabelView).length);
  if (!cursorMarker) throw new Error('native cursor marker missing');
  layout(cursorMarker.findAll(node => typeof node.type === 'string' && node.props.collapsable === false && node.props.onLayout)[0],
    { x: 0, y: 0, width: 148, height: 83 });
}
