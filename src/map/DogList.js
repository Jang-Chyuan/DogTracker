import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { mapColors as colors } from './MapTheme';
import { describeDogSource } from './DogMerge';
import { formatTime } from './MapFormat';
import TrackingAvatar from './TrackingAvatar';

/**
 * The home map draws one marker per dog; the card lists the same dogs so the
 * user can read who is where, which source answered, and pick the one the map
 * should follow. Tapping the followed dog again releases the camera.
 */
export default function DogList({ dogs, selectedSlaveId, disabled, onSelect, control }) {
  return (
    <View>
      <View style={styles.header}>
        <Text style={styles.label}>狗（{dogs.length}）</Text>
        {control}
      </View>
      {!dogs.length && (
        <Text style={styles.hint}>目前沒有 24 小時內的狗定位。</Text>
      )}
      {dogs.map(dog => {
        const selected = dog.slaveId === selectedSlaveId;
        return (
          <Pressable
            key={dog.slaveId}
            accessibilityRole="button"
            accessibilityLabel={`狗 ${dog.slaveId}`}
            accessibilityHint={selected ? '取消跟隨，地圖回到全部裝置' : '讓地圖跟隨這隻狗'}
            accessibilityState={{ selected, disabled }}
            disabled={disabled}
            onPress={() => onSelect(selected ? null : dog.slaveId)}
            style={[styles.row, selected && styles.rowSelected, disabled && styles.disabled]}
          >
            <TrackingAvatar role="slave" size={36} />
            <View style={styles.text}>
              <Text style={styles.name}>
                狗 {dog.slaveId}
                {selected ? ' · 地圖跟隨中' : ''}
              </Text>
              <Text style={styles.detail}>
                {describeDogSource(dog)} · {formatTime(dog.receivedAt)}
              </Text>
              <Text selectable style={styles.detail}>
                {dog.coordinate.latitude.toFixed(6)}, {dog.coordinate.longitude.toFixed(6)}
              </Text>
              {dog.stale && (
                <Text style={styles.warning}>早於所選時間範圍，非目前位置</Text>
              )}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  label: { color: colors.ink, fontSize: 14, fontWeight: '600' },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 19, marginBottom: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 8,
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: '#F3F6F4',
  },
  rowSelected: { borderColor: colors.dog, backgroundColor: '#FDEDEC' },
  disabled: { opacity: 0.45 },
  text: { flex: 1 },
  name: { color: colors.ink, fontSize: 14, fontWeight: '600' },
  detail: { color: colors.muted, fontSize: 12, marginTop: 3 },
  warning: { color: colors.danger, fontSize: 12, lineHeight: 18, marginTop: 3 },
});
