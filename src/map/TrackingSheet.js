import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { floatingShadow, mapColors as colors } from './MapTheme';
import { formatTime, positionLabel } from './MapFormat';
import { WINDOW_PRESETS } from '../tracking/TrackingPreferences';
import DogList from './DogList';
import Stat from './Stat';
import TrackingAvatar from './TrackingAvatar';
import VisibilityButton from './VisibilityButton';
import {
  clampHeight,
  sheetStops,
  settleSheet,
  shouldDragSheet,
} from './SheetMotion';

export const windowLabel = minutes =>
  (minutes < 60 ? `${minutes} 分` : `${minutes / 60} 小時`);

// Re-exported for the existing callers of the sheet.
export { formatTime, positionLabel };
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
  dogs = [],
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
  // Only a card that has not loaded yet is disabled. Dimming everything while
  // a write is in flight made every eye tap flash the whole card.
  const disabled = !preferences.ready;
  // Demo mode never merges dogs, so it keeps the single-dog row.
  const showDogList = tracking.mode === 'real';
  const dogVisibility = (
    <VisibilityButton
      role="slave"
      // In the list header this one eye covers every dog, not just one row.
      subject={showDogList ? '所有狗' : undefined}
      visible={preferences.value.showSlaveMarker}
      disabled={disabled}
      onPress={() =>
        tracking.saveTrackingPreferences({
          showSlaveMarker: !preferences.value.showSlaveMarker,
        })
      }
    />
  );
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
        {showDogList ? (
          <DogList
            dogs={dogs}
            selectedSlaveId={preferences.value.focusSlaveId}
            hiddenSlaveIds={preferences.value.hiddenSlaveIds}
            disabled={disabled}
            onSelect={focusSlaveId =>
              tracking.saveTrackingPreferences({ focusSlaveId })
            }
            onToggle={slaveId =>
              tracking.saveTrackingPreferences({
                hiddenSlaveIds: preferences.value.hiddenSlaveIds.includes(slaveId)
                  ? preferences.value.hiddenSlaveIds.filter(id => id !== slaveId)
                  : [...preferences.value.hiddenSlaveIds, slaveId],
                // Showing a dog again must also bring back every dog marker,
                // otherwise its eye would say visible while nothing is drawn.
                ...(preferences.value.showSlaveMarker ? {} : { showSlaveMarker: true }),
              })
            }
            control={dogVisibility}
            linkNote={'同時顯示 BLE 直接收到的與雲端下載的位置，每隻狗取最新的一筆；'
              + '來源寫在各列，不想看的狗可以單獨關掉眼睛。'}
          />
        ) : (
          <Position role="slave" position={slave} visibilityControl={dogVisibility} />
        )}
        {!showDogList && (
          <View style={styles.metrics}>
            <Stat icon="speed" label="狗速度" value={`${point.speedKmh ?? '—'} km/h`} />
            <Stat icon="battery" label="狗電量"
              level={point.batteryValid ? point.batteryPercentage : null}
              value={battery(point.batteryValid, point.batteryPercentage)} />
          </View>
        )}
        {/* Only one handler can be drawn: the cloud rows carry each dog's
            position and the id of the Master that relayed it, never that
            Master's own position (hardware question H2, still open). */}
        {dogs.some(dog => dog.source === 'cloud') && (
          <Text style={styles.hint}>
            其他 Master 的位置不在雲端資料裡（雲端只有各狗的位置），所以地圖上只有這支
            手機連線的領犬員。
          </Text>
        )}
        <View style={!preferences.value.showMasterMarker && styles.hiddenRow}>
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
            <Stat icon="battery" label="領犬員電量"
              level={point.masterBatteryValid ? point.masterBatteryPercentage : null}
              value={battery(point.masterBatteryValid, point.masterBatteryPercentage)} />
          </View>
        </View>
        {/* One section: whether the path is drawn, and how far back it goes.
            Two separate controls for the same line confused the reading. */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>移動路徑</Text>
            <Switch
              accessibilityLabel="顯示移動路徑"
              value={preferences.value.showTrails}
              disabled={disabled}
              onValueChange={value =>
                tracking.saveTrackingPreferences({ showTrails: value })
              }
              trackColor={{ true: colors.master }}
            />
          </View>
          {!preferences.value.showTrails ? (
            <Text style={styles.hint}>開啟後可以選擇要畫多久的路徑。</Text>
          ) : (
            <>
          <Text style={styles.label}>顯示過去多久的路徑</Text>
          <View style={styles.windowRow}>
            {WINDOW_PRESETS.map(minutes => {
              const selected = preferences.value.windowMinutes === minutes;
              return (
                <Pressable
                  key={minutes}
                  accessibilityRole="button"
                  accessibilityLabel={`過去 ${windowLabel(minutes)}`}
                  accessibilityState={{ selected, disabled }}
                  disabled={disabled}
                  style={[styles.window, selected && styles.windowSelected,
                    disabled && styles.disabled]}
                  onPress={() => tracking.saveTrackingPreferences({ windowMinutes: minutes })}
                >
                  <Text style={[styles.windowText, selected && styles.windowTextSelected]}>
                    {windowLabel(minutes)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.hint}>
            地圖畫出這段時間內走過的路線，最多 24 小時；更早的紀錄在「歷史」。
            只畫眼睛開啟的對象。
          </Text>
            </>
          )}
        </View>
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
        <Text style={styles.hint}>
          參考圈半徑 1 公里，跟隨領犬員眼睛。路徑採 1 公尺誤差上限簡化，DB
          原始座標不會因簡化而改寫。
        </Text>
        <Text style={styles.hint}>
          點地圖上的狗或領犬員可以看該裝置的詳細資料（距離、硬體回報、LoRa 訊號）。
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
  section: {
    marginTop: 14,
    padding: 12,
    borderRadius: 14,
    backgroundColor: '#F3F6F4',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  sectionTitle: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  hiddenRow: { opacity: 0.6 },
  windowRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  window: {
    minHeight: 40,
    paddingHorizontal: 12,
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: '#EAF1EC',
  },
  windowSelected: { backgroundColor: colors.master },
  windowText: { color: colors.ink, fontSize: 13, fontWeight: '600' },
  windowTextSelected: { color: '#FFFFFF' },
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
