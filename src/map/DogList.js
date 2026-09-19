import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { mapColors as colors } from './MapTheme';
import DeviceRow from './DeviceRow';
import Stat from './Stat';

const percent = value => (Number.isFinite(value) ? `${value}%` : '—');
const speed = value => (Number.isFinite(value) ? `${value} km/h` : '— km/h');

export default function DogList({
  dogs, hiddenSlaveIds = [], disabled, onZoom, onDetails, onToggle,
}) {
  return (
    <View>
      <Text style={styles.label}>狗（{dogs.length}）</Text>
      {!dogs.length && (
        <Text style={styles.hint}>目前沒有 24 小時內的狗定位。</Text>
      )}
      {dogs.map(dog => (
        <DeviceRow
          key={dog.slaveId}
          role="slave"
          title={`狗 ${dog.slaveId}`}
          subject={`狗 ${dog.slaveId}`}
          eyeSubject={`狗 ${dog.slaveId} 的`}
          sourceIcon={dog.source === 'cloud' ? 'cloud' : 'ble'}
          sourceText={(dog.source === 'cloud'
            ? `Master ${dog.masterId ?? '—'}` : 'BLE 直接收到')
            + (dog.retained ? '・最後有效位置' : '')}
          receivedAt={dog.receivedAt}
          hidden={hiddenSlaveIds.includes(dog.slaveId)}
          disabled={disabled}
          warning={dog.stale ? '早於所選時間範圍，非目前位置' : ''}
          onZoom={dog.coordinate ? () => onZoom(dog) : null}
          onDetails={() => onDetails(dog)}
          onToggle={() => onToggle(dog.slaveId)}
        >
          <Stat icon="speed" label="速度" value={speed(dog.speedKmh)} />
          <Stat icon="battery" label="電量" value={percent(dog.batteryPercentage)}
            level={dog.batteryPercentage} />
          {Number.isFinite(dog.distanceMeters) && (
            <Stat icon="distance" label={`與 Master ${dog.masterId ?? '—'} 的距離`}
              value={`${dog.distanceMeters} m`} />
          )}
        </DeviceRow>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { color: colors.ink, fontSize: 14, fontWeight: '600', marginTop: 12 },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 19, marginBottom: 6 },
});
