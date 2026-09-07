import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { floatingShadow, mapColors as colors } from './MapTheme';
import TrackingAvatar from './TrackingAvatar';
import VisibilityButton from './VisibilityButton';
import {
  clampHeight,
  sheetStops,
  settleSheet,
  shouldDragSheet,
} from './SheetMotion';

export function positionLabel(position) {
  if (!position) return '尚無有效座標';
  const { latitude, longitude } = position.coordinate;
  return latitude.toFixed(6) + ', ' + longitude.toFixed(6);
}
export function formatTime(value) {
  return Number.isFinite(value)
    ? new Date(value).toLocaleString('zh-TW', { hour12: false })
    : '尚無資料';
}
export function Position({ role, position, visibilityControl }) {
  return (
    <View style={styles.positionRow}>
      <TrackingAvatar role={role} size={36} />
      <View style={styles.positionText}>
        <Text style={styles.label}>
          {role === 'master' ? '領犬員 · Master' : '狗 · Slave'}
        </Text>
        <Text selectable style={styles.coordinate}>
          {positionLabel(position)}
        </Text>
        {position?.retained && (
          <Text style={styles.warning}>
            最後有效位置（非最新定位）· {formatTime(position.receivedAt)}
          </Text>
        )}
      </View>
      {visibilityControl}
    </View>
  );
}
function battery(valid, percentage) {
  return valid && percentage !== null ? percentage + '%' : '尚無有效資料';
}

export function sheetSummary(tracking) {
  if (tracking.errors?.[tracking.mode]) return '資料讀取失敗 · 上滑查看';
  if (!tracking.preferences?.ready) return '正在讀取設定…';
  if (tracking.ready?.[tracking.mode] === false) return '正在準備 SQLite…';
  if (tracking.point.id === null && !tracking.initialSnapshotReady)
    return '正在讀取追蹤資料…';
  if (tracking.point.id === null)
    return tracking.mode === 'demo' ? '尚無 Demo 資料' : '等待硬體資料';
  return `最後更新 ${formatTime(tracking.point.receivedAt)}`;
}

export default function TrackingSheet({
  tracking,
  master,
  slave,
  bottomInset,
  topInset = 100,
  onHeight,
}) {
  const { height: windowHeight, fontScale } = useWindowDimensions();
  const stops = useMemo(
    () => sheetStops(windowHeight, bottomInset, topInset, fontScale),
    [windowHeight, bottomInset, topInset, fontScale],
  );
  const [level, setLevel] = useState('collapsed');
  const animation = useRef(new Animated.Value(stops.collapsed)).current;
  const current = useRef(stops.collapsed);
  const start = useRef(stops.collapsed);
  const scroll = useRef(null);
  const scrollOffset = useRef(0);
  const motion = useRef(null);
  motion.current = { stops, level, onHeight };
  useEffect(() => {
    const listener = animation.addListener(({ value }) => {
      current.current = value;
    });
    return () => {
      animation.removeListener(listener);
      animation.stopAnimation();
    };
  }, [animation]);
  useEffect(() => {
    onHeight(stops[level]);
    const transition = Animated.spring(animation, {
      toValue: stops[level],
      speed: 22,
      bounciness: 0,
      useNativeDriver: false,
    });
    transition.start();
    return () => transition.stop();
  }, [animation, stops, level, onHeight]);

  const settle = useRef(null);
  settle.current = next => {
    setLevel(next);
    if (next !== 'expanded') {
      scroll.current?.scrollTo({ y: 0, animated: false });
      scrollOffset.current = 0;
    }
    // Also settle when the target is the existing level (a short/cancelled drag).
    if (next === motion.current.level) {
      motion.current.onHeight(motion.current.stops[next]);
      Animated.spring(animation, {
        toValue: motion.current.stops[next],
        speed: 22,
        bounciness: 0,
        useNativeDriver: false,
      }).start();
    }
  };
  const pan = useMemo(() => {
    const handlers = {
      onPanResponderGrant: () => {
        animation.stopAnimation();
        start.current = current.current;
      },
      onPanResponderMove: (_, gesture) => {
        animation.setValue(
          clampHeight(
            start.current - gesture.dy,
            motion.current.stops.collapsed,
            motion.current.stops.expanded,
          ),
        );
      },
      onPanResponderRelease: (_, gesture) =>
        settle.current(
          settleSheet(current.current, gesture.vy, motion.current.stops),
        ),
      onPanResponderTerminate: () => settle.current(motion.current.level),
    };
    return {
      content: PanResponder.create({
        ...handlers,
        onMoveShouldSetPanResponderCapture: (_, gesture) =>
          shouldDragSheet(
            gesture,
            current.current,
            motion.current.stops.expanded,
            scrollOffset.current,
          ),
      }),
      handle: PanResponder.create({
        ...handlers,
        // The handle always drags the sheet, even if its content is scrolled.
        onMoveShouldSetPanResponderCapture: (_, gesture) =>
          shouldDragSheet(
            gesture,
            current.current,
            motion.current.stops.expanded,
            0,
          ),
      }),
    };
  }, [animation]);
  const point = tracking.point;
  const summary = sheetSummary(tracking);
  const { preferences } = tracking;
  const disabled = !preferences.ready || preferences.busy;
  return (
    <Animated.View
      style={[styles.sheet, { bottom: bottomInset, height: animation }]}
      testID="tracking-sheet"
      {...pan.content.panHandlers}
    >
      <View
        style={[styles.handleArea, { height: stops.collapsed }]}
        testID="tracking-sheet-handle"
        {...pan.handle.panHandlers}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={`最新詳細資訊。${summary}。上滑展開、下滑收合`}
        accessibilityValue={{
          min: 0,
          max: 2,
          now: ['collapsed', 'compact', 'expanded'].indexOf(level),
        }}
        accessibilityActions={[
          { name: 'increment', label: '展開' },
          { name: 'decrement', label: '收合' },
        ]}
        onAccessibilityAction={event => {
          const levels = ['collapsed', 'compact', 'expanded'];
          const index =
            levels.indexOf(level) +
            (event.nativeEvent.actionName === 'increment' ? 1 : -1);
          settle.current(levels[Math.max(0, Math.min(2, index))]);
        }}
      >
        <View style={styles.handle} />
        <Text
          style={styles.summary}
          numberOfLines={1}
          testID="tracking-sheet-summary"
        >
          最新詳細資訊
        </Text>
        <Text style={styles.summaryTime} numberOfLines={1}>
          {summary}
        </Text>
      </View>
      <ScrollView
        ref={scroll}
        contentContainerStyle={styles.content}
        nestedScrollEnabled
        bounces={false}
        testID="tracking-sheet-content"
        scrollEnabled={level === 'expanded'}
        scrollEventThrottle={16}
        onScroll={event => {
          scrollOffset.current = Math.max(0, event.nativeEvent.contentOffset.y);
        }}
        accessibilityElementsHidden={level === 'collapsed'}
        importantForAccessibility={
          level === 'collapsed' ? 'no-hide-descendants' : 'auto'
        }
      >
        <Text style={styles.hint}>
          資料庫最後更新：{formatTime(point.receivedAt)}
        </Text>
        {!tracking.historyLoaded && (
          <Text style={styles.hint}>正在載入本機路徑…</Text>
        )}
        {point.id === null && (
          <Text style={styles.hint}>
            {tracking.mode === 'demo'
              ? '尚無 Demo 資料。'
              : '等待硬體寫入資料；不會自動使用假資料。'}
          </Text>
        )}
        <Position
          role="slave"
          position={slave}
          visibilityControl={
            <VisibilityButton
              role="slave"
              visible={preferences.value.showSlaveMarker}
              disabled={disabled}
              onPress={() =>
                tracking.saveTrackingPreferences({
                  showSlaveMarker: !preferences.value.showSlaveMarker,
                })
              }
            />
          }
        />
        <View style={styles.metrics}>
          <Text style={styles.metric}>狗速度 {point.speedKmh ?? '—'} km/h</Text>
          <Text style={styles.metric}>
            狗裝置電量 {battery(point.batteryValid, point.batteryPercentage)}
          </Text>
        </View>
        <Position
          role="master"
          position={master}
          visibilityControl={
            <VisibilityButton
              role="master"
              visible={preferences.value.showMasterMarker}
              disabled={disabled}
              onPress={() =>
                tracking.saveTrackingPreferences({
                  showMasterMarker: !preferences.value.showMasterMarker,
                })
              }
            />
          }
        />
        <View style={styles.metrics}>
          <Text style={styles.metric}>
            領犬員裝置電量{' '}
            {battery(point.masterBatteryValid, point.masterBatteryPercentage)}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="顯示路徑"
          accessibilityState={{
            selected: preferences.value.showTrails,
            disabled,
          }}
          disabled={disabled}
          style={[styles.routeControl, disabled && styles.disabled]}
          onPress={() =>
            tracking.saveTrackingPreferences({
              showTrails: !preferences.value.showTrails,
            })
          }
        >
          <Text style={styles.label}>顯示路徑</Text>
          <Text style={styles.label}>
            {preferences.value.showTrails ? '開啟' : '關閉'}
          </Text>
        </Pressable>
        <Text style={styles.hint}>只顯示眼睛開啟的對象之路徑</Text>
        {preferences.busy && <Text style={styles.hint}>儲存中…</Text>}
        {preferences.error && (
          <View>
            <Text accessibilityRole="alert" style={styles.warning}>
              設定未成功讀取或儲存：{preferences.error}。未套用失敗的變更。
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="重試讀取設定"
              disabled={preferences.busy}
              style={styles.routeControl}
              onPress={tracking.retryTrackingPreferences}
            >
              <Text style={styles.label}>重試讀取設定</Text>
            </Pressable>
          </View>
        )}
        <Text style={styles.label}>
          狗與領犬員距離 {point.distanceMeters ?? '—'} m
        </Text>
        <Text style={styles.hint}>距離採用資料庫回報值。</Text>
        <Text style={styles.hint}>
          參考圈半徑 1 公里，跟隨領犬員眼睛。路徑採 1 公尺誤差上限簡化，DB
          原始資料不變。
        </Text>
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
          資料表：{tracking.mode === 'demo' ? 'demo_dog_status' : 'dog_status'}{' '}
          · DB row ID: {point.id ?? '—'}
        </Text>
      </ScrollView>
    </Animated.View>
  );
}
const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    zIndex: 10,
    left: 12,
    right: 12,
    borderRadius: 24,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    ...floatingShadow,
  },
  handleArea: {
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    gap: 4,
  },
  handle: { width: 40, height: 5, backgroundColor: '#C6CCC9', borderRadius: 3 },
  summary: {
    alignSelf: 'stretch',
    textAlign: 'center',
    color: colors.ink,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  summaryTime: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  routeControl: {
    minHeight: 48,
    padding: 12,
    marginVertical: 10,
    borderRadius: 12,
    backgroundColor: '#EAF1EC',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  disabled: { opacity: 0.45 },
  title: {
    fontSize: 21,
    fontWeight: '700',
    color: colors.ink,
    marginBottom: 8,
  },
  content: { padding: 18, paddingTop: 0, paddingBottom: 24 },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 19, marginBottom: 6 },
  positionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 12,
    gap: 10,
  },
  positionText: { flex: 1 },
  label: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  coordinate: { color: colors.muted, fontSize: 12, marginTop: 3 },
  warning: { color: colors.danger, fontSize: 12, lineHeight: 18, marginTop: 3 },
  metrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
    marginBottom: 14,
  },
  metric: {
    backgroundColor: colors.canvas,
    padding: 8,
    color: colors.ink,
    borderRadius: 8,
    fontSize: 12,
  },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 12 },
});
