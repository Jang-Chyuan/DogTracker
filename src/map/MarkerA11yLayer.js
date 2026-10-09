// TalkBack on the map's dogs (設計稿「無障礙」狗標記). Google draws the dog
// markers as bitmaps, so the label on the marker's view never reaches
// TalkBack (only the SDK's own blue dot does). This layer puts one invisible
// accessibility item over each dog on screen, with the marker's one sentence
// (「小黑・室內，充電中 62%，不在接收範圍，沒有新資料，最後 10:05」; a group
// tag's 「3 隻…」); a double tap does what tapping the dog does. It takes no
// touches (pointerEvents none): fingers still reach the map.
import { StyleSheet, View } from 'react-native';
import { touch } from '../theme/tokens';

const ACTIONS = [{ name: 'activate' }];

/**
 * `items`: [{ id, label, x, y }] — screen points (dp) of the dogs on screen,
 * in the map's own coordinates; `onActivate(id)`.
 */
export default function MarkerA11yLayer({ items, onActivate }) {
  if (!items?.length) return null;
  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      testID="marker-a11y-layer"
    >
      {items.map(item => (
        <View
          key={item.id}
          testID={`marker-a11y-${item.id}`}
          accessible
          accessibilityRole="button"
          accessibilityLabel={item.label}
          accessibilityActions={ACTIONS}
          onAccessibilityAction={event => {
            if (event.nativeEvent.actionName === 'activate') onActivate(item.id);
          }}
          style={[
            styles.item,
            { left: item.x - touch.min / 2, top: item.y - touch.min / 2 },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  item: { position: 'absolute', width: touch.min, height: touch.min },
});

/**
 * The items for the dogs on screen: each dog's own sentence, a group tag's
 * sentence on the dog carrying it (DogMarkers.nameTags) and nothing for the
 * other dogs in that group; nothing for a dog without a screen point or
 * outside the visible area.
 */
export function markerA11yItems(markers, points, { width, height, groupLabel, grouped } = {}) {
  if (!points) return [];
  return markers.flatMap(marker => {
    // A dog inside a group tag is read with the group (one item, its menu).
    if (grouped?.(marker)) return [];
    const point = points[marker.slaveId];
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return [];
    if (point.x < 0 || point.y < 0 || (width && point.x > width) || (height && point.y > height)) return [];
    return [{ id: marker.slaveId, label: groupLabel?.(marker) || marker.label, x: point.x, y: point.y }];
  });
}

const two = value => String(value).padStart(2, '0');
const clock = at => {
  const date = new Date(at);
  return `${two(date.getHours())}:${two(date.getMinutes())}`;
};

/**
 * A history stop on the map (設計稿「無障礙」停留編號): 「停留 2，09:35 到
 * 10:05，30 分鐘，點兩下跳到開始」; an indoor hold 「室內，…」.
 */
export function stopSpeech(place) {
  // A switch of transport is a moment, not a stay (the list's 「換交通方式」).
  if (place.type === 'switch') {
    const at = Number.isFinite(place.start) ? `，${clock(place.start)}` : '';
    return `換交通方式 ${place.number}${at}，點兩下跳到這裡`;
  }
  const lead = place.kind === 'indoor' ? '室內' : `停留 ${place.number}`;
  const length = Number.isFinite(place.durationMs)
    ? place.durationMs
    : place.end - place.start;
  const span =
    Number.isFinite(place.start) && Number.isFinite(place.end)
      ? `，${clock(place.start)} 到 ${clock(place.end)}，${Math.round(
          length / 60000,
        )} 分鐘`
      : '';
  return `${lead}${span}，點兩下跳到開始`;
}
