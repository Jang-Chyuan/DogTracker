import React, { useEffect } from 'react';
import {
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { floatingShadow, mapColors as colors } from './MapTheme';
import { describeDogSource } from './DogMerge';
import { formatTime } from './MapFormat';
import Stat from './Stat';
import { Position } from './TrackingSheet';

function battery(valid, percentage) {
  return valid && percentage !== null ? percentage + '%' : '尚無有效資料';
}

/**
 * One panel for whichever marker was tapped.
 *
 * The dog and the handler used to answer a tap differently — a native callout
 * for one, this panel for the other. Both now open the same panel, and the
 * hardware and LoRa readings live in it rather than on the card: they describe
 * one pair, and the card can hold several dogs from several Masters.
 */
export default function DeviceDetails({
  tracking,
  subject,
  master,
  topInset,
  bottomInset,
  onClose,
}) {
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        onClose();
        return true;
      },
    );
    return () => subscription.remove();
  }, [onClose]);
  const { point } = tracking;
  const dog = subject?.kind === 'dog' ? subject.dog : null;
  // A history track answers a tap with the same panel as a live marker; only
  // its content differs, because a replayed moment has no hardware feed.
  const track = subject?.kind === 'track' ? subject.track : null;
  // Hardware fields come from this phone's BLE feed, so they only describe the
  // dog it is connected to.
  const live = dog && dog.source === 'ble' && dog.slaveId === point.slaveId;
  const title = track ? track.name : dog ? `狗 ${dog.slaveId}` : '領犬員資訊';
  return (
    <View style={[StyleSheet.absoluteFill, styles.root]} testID="device-details">
      <Pressable
        testID="device-details-backdrop"
        accessibilityRole="button"
        accessibilityLabel={`關閉${title}`}
        onPress={onClose}
        style={[StyleSheet.absoluteFill, styles.backdrop]}
      />
      <View style={[styles.panel, { top: topInset, bottom: bottomInset }]}>
        {/* The title and the close button stay put: scrolling the content away
            from its own close button is how a panel traps someone. */}
        <View style={styles.heading}>
          <Text style={styles.title}>{title}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`關閉${title}面板`}
            onPress={onClose}
            style={styles.close}
          >
            <Text style={styles.title}>×</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          {track ? (
            <>
              <Text style={styles.hint}>{track.sourceLabel}</Text>
              <Text style={styles.hint}>
                該時刻位置：{formatTime(track.latest?.time)}
              </Text>
              <View style={styles.stats}>
                <Stat icon="speed" label="速度" value={track.latest?.speed_kmh == null
                  ? '未知' : `${track.latest.speed_kmh.toFixed(1)} km/h`} />
                <Stat icon="clock" label="這段區間" value={`${track.count ?? 0} 筆`} />
              </View>
              <Text style={styles.hint}>
                歷史只讀這支手機存下來的資料；硬體回報與 LoRa 訊號只有即時連線那一對才有。
              </Text>
            </>
          ) : dog ? (
            <>
              <Text style={styles.hint}>來源：{describeDogSource(dog)}</Text>
              {/* No coordinates: the marker this panel belongs to is already
                  on the map, and six decimals tell nobody anything. */}
              <Text style={styles.hint}>回報時間：{formatTime(dog.receivedAt)}</Text>
              {dog.retained && (
                <Text style={styles.warning}>最後有效位置，非最新定位</Text>
              )}
              {dog.stale && (
                <Text style={styles.warning}>早於所選時間範圍，非目前位置</Text>
              )}
              {live || Number.isFinite(dog.distanceMeters) ? (
                <View style={styles.stats}>
                  <Stat icon="speed" label="速度"
                    value={Number.isFinite(dog.speedKmh) ? `${dog.speedKmh} km/h` : '— km/h'} />
                  <Stat icon="battery" label="電量" level={dog.batteryPercentage}
                    value={Number.isFinite(dog.batteryPercentage)
                      ? `${dog.batteryPercentage}%` : '—'} />
                  {Number.isFinite(dog.distanceMeters) && (
                    <Stat icon="distance" label={`與 Master ${dog.masterId ?? '—'} 的距離`}
                      value={`${dog.distanceMeters} m`} />
                  )}
                </View>
              ) : null}
              {live ? (
                <>
                  <View style={styles.divider} />
                  <Text style={styles.label}>硬體回報的定位與活動</Text>
                  <Text style={styles.hint}>
                    衛星 {point.satellites ?? '—'} · HDOP {point.hdop ?? '—'}
                  </Text>
                  <Text style={styles.hint}>
                    活動：{point.activityValid ? point.activity ?? '—' : '無有效資料'}
                  </Text>
                  <Text style={styles.hint}>GPS 時間：{point.gpsTime ?? '—'}</Text>
                  <View style={styles.divider} />
                  <Text style={styles.label}>LoRa 訊號品質</Text>
                  <Text style={styles.hint}>
                    RSSI {point.rssi ?? '—'} · SNR {point.snr ?? '—'}
                  </Text>
                  <Text style={styles.hint}>
                    Master ID: {point.masterId ?? '-'} | Slave ID: {point.slaveId ?? '-'}
                  </Text>
                  <Text style={styles.hint}>
                    資料表：{tracking.mode === 'demo' ? 'demo_dog_status' : 'dog_status'}
                    {' '}· DB row ID: {point.id ?? '—'}
                  </Text>
                </>
              ) : (
                <Text style={styles.hint}>
                  硬體細節（速度、電量、衛星、LoRa 訊號）只有這支手機正在收的那一對才有；
                  這隻狗的資料是 Master {dog.masterId ?? '—'} 上傳到雲端後下載的。
                </Text>
              )}
            </>
          ) : (
            <>
              <Position role="master" position={master} />
              <Text style={styles.hint}>Master ID: {point.masterId ?? '—'}</Text>
              <Text style={styles.hint}>
                領犬員裝置電量：
                {battery(point.masterBatteryValid, point.masterBatteryPercentage)}
              </Text>
              <Text style={styles.hint}>參考圈半徑 1 公里，跟隨領犬員。</Text>
            </>
          )}
        </ScrollView>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  root: {
    zIndex: 30,
    // Raise the whole modal root above the tracking sheet for Android touches.
    elevation: floatingShadow.elevation + 1,
  },
  backdrop: { backgroundColor: '#00000020' },
  panel: {
    position: 'absolute',
    right: 14,
    left: 14,
    maxHeight: 420,
    borderRadius: 22,
    backgroundColor: colors.surface,
    ...floatingShadow,
  },
  content: { paddingHorizontal: 18, paddingBottom: 18 },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 18,
    paddingRight: 8,
    paddingTop: 14,
    paddingBottom: 6,
  },
  close: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 18, color: colors.ink, fontWeight: '700' },
  label: { fontSize: 14, color: colors.ink, fontWeight: '600', marginTop: 10 },
  hint: { fontSize: 12, lineHeight: 19, color: colors.muted, marginTop: 8 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  warning: { fontSize: 12, lineHeight: 19, color: colors.danger, marginTop: 8 },
  divider: { height: 1, backgroundColor: '#E6E6E6', marginVertical: 12 },
});
