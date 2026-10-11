import { TopRow } from '../src/mapHistory/HistoryScreen';
import { CursorLabelView } from '../src/mapHistory/HistoryMapMarkers';
import { Dimensions } from 'react-native';
import { space, touch } from '../src/theme/tokens';

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
