import React from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { mapColors as colors } from './MapTheme';
import { formatTime, positionLabel } from './MapFormat';
import { WINDOW_PRESETS } from '../tracking/TrackingPreferences';
import BottomSheet from './BottomSheet';
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

export function sheetSummary(tracking) {
  if (tracking.errors?.[tracking.mode]) return '資料讀取失敗 · 上滑查看';
  if (!tracking.preferences?.ready) return '正在讀取設定…';
  if (tracking.ready?.[tracking.mode] === false) return '正在準備 SQLite…';
  if (tracking.point.id === null && !tracking.initialSnapshotReady)
    return '正在讀取追蹤資料…';
  if (tracking.point.id === null)
    return '等待硬體資料';
  return `最後更新 ${formatTime(tracking.point.receivedAt)}`;
}

export default function TrackingSheet({
  tracking,
  master,
  dogs = [],
  showRouteControls = true,
  dogAliases,
  bottomInset,
  topInset = 100,
  onHeight,
  onDogDetails,
  onReceiverDetails,
}) {
  const point = tracking.point;
  const summary = sheetSummary(tracking);
  const { preferences } = tracking;
  // Only a card that has not loaded yet is disabled. Dimming everything while
  // a write is in flight made every eye tap flash the whole card.
  const disabled = !preferences.ready;
  const dogVisibility = (
    <VisibilityButton
      role="slave"
      // In the list header this one eye covers every dog, not just one row.
      subject="所有狗"
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
        <Text style={styles.hint}>
          資料庫最後更新：{formatTime(point.receivedAt)}
        </Text>
        {!tracking.historyLoaded && (
          <Text style={styles.hint}>正在載入本機路徑…</Text>
        )}
        {point.id === null && (
          <Text style={styles.hint}>
            等待硬體寫入資料；不會自動使用假資料。
          </Text>
        )}
        <DogList
          dogs={dogs}
          onDetails={onDogDetails}
          dogAliases={dogAliases}
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
        {/* Only one handler can be drawn: the cloud rows carry each dog's
            position and the id of the Master that relayed it, never that
            Master's own position (hardware question H2, still open). */}
        {dogs.some(dog => dog.source === 'cloud') && (
          <Text style={styles.hint}>
            其他 Master 的位置不在雲端資料裡（雲端只有各狗的位置），所以地圖上只有這支
            手機連線的領犬員。
          </Text>
        )}
        {/* The receiver is no longer drawn on the map (v3), so its panel opens
            from this row instead of from a marker; its range ring cannot be
            turned off, so the row has no eye. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="領犬員（接收器）詳細資料"
          disabled={!onReceiverDetails || !master}
          onPress={onReceiverDetails}
        >
          <Position role="master" position={master} />
          <View style={styles.metrics}>
            <Stat icon="battery" label="領犬員電量"
              level={point.masterBatteryValid ? point.masterBatteryPercentage : null}
              value={battery(point.masterBatteryValid, point.masterBatteryPercentage)} />
          </View>
        </Pressable>
        {showRouteControls ? <View style={styles.section}>
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
        : <Text style={styles.hint}>狗圖示超過 3 分鐘未收到封包才隱藏；充電時保留在原處並標示通訊狀態。在室內或 GPS 訊號弱時，狗停在最後清楚定位的地方，離開後自動恢復跟隨；GPS 未定位時保留最後有效位置，歷史軌跡仍保留查詢區間內的最後位置。</Text>}
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
          接收範圍圈半徑 1 公里，以接收器為中心；接收器連著而且有位置時才畫。
        </Text>
        <Text style={styles.hint}>
          點地圖上的狗或上面的領犬員列，可以看詳細資料（距離、硬體回報、LoRa 訊號）。
        </Text>
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
