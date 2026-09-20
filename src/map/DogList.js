import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { mapColors as colors } from './MapTheme';
import { formatTime } from './MapFormat';
import Glyph from './Glyph';
import Stat from './Stat';
import TrackingAvatar from './TrackingAvatar';
import VisibilityButton from './VisibilityButton';
import { dogHistoryLabel, dogMapLabel } from '../mapHistory/DogAliases';

const percent = value => (Number.isFinite(value) ? `${value}%` : '—');
const speed = value => (Number.isFinite(value) ? `${value} km/h` : '— km/h');

export default function DogList({
  dogs, selectedSlaveId, hiddenSlaveIds = [], disabled, onSelect, onToggle, control,
  linkNote, dogAliases,
}) {
  return (
    <View>
      <View style={styles.header}>
        <Text style={styles.label}>狗（{dogs.length}）</Text>
        {control}
      </View>
      {!dogs.length && (
        <Text style={styles.hint}>目前沒有 24 小時內的狗定位。</Text>
      )}
      {!!linkNote && <Text style={styles.hint}>{linkNote}</Text>}
      {dogs.map(dog => {
        const name = dogMapLabel(dogHistoryLabel(dog.slaveId, dogAliases));
        const selected = dog.slaveId === selectedSlaveId;
        const hidden = hiddenSlaveIds.includes(dog.slaveId);
        return (
          <Pressable
            key={dog.slaveId}
            accessibilityRole="button"
            accessibilityLabel={name}
            accessibilityHint={selected ? '取消跟隨，地圖回到全部裝置' : '讓地圖跟隨這隻狗'}
            accessibilityState={{ selected, disabled }}
            disabled={disabled}
            onPress={() => onSelect(selected ? null : dog.slaveId)}
            style={[styles.row, selected && styles.rowSelected,
              hidden && styles.rowHidden, disabled && styles.disabled]}
          >
            <TrackingAvatar role="slave" size={36} />
            <View style={styles.text}>
              <Text style={styles.name}>
                {name}
                {selected ? ' · 地圖跟隨中' : ''}
              </Text>
              {/* Every row reads the same whatever answered it: where it came
                  from as an icon, then the same readings. */}
              <View style={styles.sourceRow}>
                <Glyph name={dog.source === 'cloud' ? 'cloud' : 'ble'}
                  color={colors.muted} size={15} />
                <Text style={styles.detail}>
                  {dog.source === 'cloud' ? `Master ${dog.masterId ?? '—'}` : 'BLE 直接收到'}
                  {dog.retained ? '・最後有效位置' : ''}
                </Text>
                <Glyph name="clock" color={colors.muted} size={14} />
                <Text style={styles.detail}>{formatTime(dog.receivedAt)}</Text>
              </View>
              <View style={styles.stats}>
                <Stat icon="speed" label="速度" value={speed(dog.speedKmh)} />
                <Stat icon="battery" label="電量" value={percent(dog.batteryPercentage)}
                  level={dog.batteryPercentage} />
                {Number.isFinite(dog.distanceMeters) && (
                  <Stat icon="distance" label={`與 Master ${dog.masterId ?? '—'} 的距離`}
                    value={`${dog.distanceMeters} m`} />
                )}
              </View>
              {dog.stale && (
                <Text style={styles.warning}>早於所選時間範圍，非目前位置</Text>
              )}
            </View>
            {/* Each dog carries its own eye: hiding one of five dogs used to
                mean hiding all of them. */}
            <VisibilityButton
              role="slave"
              size="small"
              subject={`${name} 的`}
              visible={!hidden}
              disabled={disabled}
              onPress={() => onToggle(dog.slaveId)}
            />
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
  rowHidden: { opacity: 0.6 },
  disabled: { opacity: 0.45 },
  text: { flex: 1 },
  name: { color: colors.ink, fontSize: 14, fontWeight: '600' },
  detail: { color: colors.muted, fontSize: 12 },
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4, flexWrap: 'wrap' },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  warning: { color: colors.danger, fontSize: 12, lineHeight: 18, marginTop: 3 },
});
