import React from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { mapColors as colors } from './MapTheme';
import { formatTime, positionLabel } from './MapFormat';
import { WINDOW_PRESETS } from '../tracking/TrackingPreferences';
import BottomSheet from './BottomSheet';
import DeviceRow from './DeviceRow';
import DogList from './DogList';
import Stat from './Stat';
import TrackingAvatar from './TrackingAvatar';
import VisibilityButton from './VisibilityButton';

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

/**
 * The one line of time the card shows, at the top.
 *
 * It reads the newest row of everything the card lists, not just the BLE feed:
 * with the collar silent and the cloud still arriving, a header that only knew
 * about BLE said the data was hours old while dog rows below it updated every
 * few seconds.
 */
export function sheetSummary(tracking, dogs = []) {
  if (tracking.errors?.[tracking.mode]) return '資料讀取失敗 · 上滑查看';
  if (!tracking.preferences?.ready) return '正在讀取設定…';
  if (tracking.ready?.[tracking.mode] === false) return '正在準備 SQLite…';
  if (tracking.point.id === null && !dogs.length) {
    if (!tracking.initialSnapshotReady) return '正在讀取追蹤資料…';
    return tracking.mode === 'demo' ? '尚無 Demo 資料' : '等待硬體資料';
  }
  // An unusable time is passed through rather than replaced by zero, so
  // formatTime can still say 尚無資料 instead of inventing 1970.
  const times = [tracking.point.receivedAt, ...dogs.map(dog => dog.receivedAt)]
    .filter(Number.isFinite);
  return `最後更新 ${formatTime(times.length
    ? Math.max(...times) : tracking.point.receivedAt)}`;
}

export default function TrackingSheet({
  tracking,
  onZoom,
  onDetails,
  onRememberDog,
  master,
  slave,
  dogs = [],
  bottomInset,
  topInset = 100,
  onHeight,
}) {
  const point = tracking.point;
  const summary = sheetSummary(tracking, dogs);
  const { preferences } = tracking;
  // Only a card that has not loaded yet is disabled. Dimming everything while
  // a write is in flight made every eye tap flash the whole card.
  const disabled = !preferences.ready;
  // Demo mode never merges dogs, so it keeps the single-dog row.
  const showDogList = tracking.mode === 'real';
  // Demo mode has one dog and no list, so it keeps a single eye of its own.
  const demoVisibility = (
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
  );
  return (
    <BottomSheet
      name="tracking"
      title="最新詳細資訊"
      summary={summary}
      bottomInset={bottomInset}
      topInset={topInset}
      onHeight={onHeight}
    >
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
            hiddenSlaveIds={preferences.value.hiddenSlaveIds}
            disabled={disabled}
            onZoom={dog => {
              // Where the map opens next time it is launched.
              onRememberDog?.(dog.slaveId);
              onZoom?.(dog.coordinate);
            }}
            onDetails={dog => onDetails?.({ kind: 'dog', slaveId: dog.slaveId })}
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
          />
        ) : (
          <Position role="slave" position={slave} visibilityControl={demoVisibility} />
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
        {showDogList && (
          // The handler is a device in the same list, read and operated like a
          // dog: tap to go there, ⓘ for the details, eye to keep it off the map.
          <DeviceRow
            role="master"
            title={`領犬員 · Master ${point.masterId ?? '—'}`}
            subject="領犬員"
            sourceIcon="ble"
            sourceText="BLE 直接收到"
            receivedAt={point.receivedAt}
            hidden={!preferences.value.showMasterMarker}
            disabled={disabled}
            warning={master?.retained ? '最後有效位置（非最新定位）' : ''}
            onZoom={master ? () => onZoom?.(master) : null}
            onDetails={() => onDetails?.({ kind: 'master' })}
            onToggle={() =>
              tracking.saveTrackingPreferences({
                showMasterMarker: !preferences.value.showMasterMarker,
              })
            }
          >
            <Stat icon="battery" label="電量"
              level={point.masterBatteryValid ? point.masterBatteryPercentage : null}
              value={battery(point.masterBatteryValid, point.masterBatteryPercentage)} />
          </DeviceRow>
        )}
        {!showDogList && (
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
        )}
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
    </BottomSheet>
  );
}
// The card shell (motion, handle, scroll) lives in BottomSheet.
const styles = StyleSheet.create({
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
