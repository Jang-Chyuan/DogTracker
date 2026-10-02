import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { mapColors as colors } from './MapTheme';
import { formatTime, positionLabel } from './MapFormat';
import { WINDOW_PRESETS } from '../tracking/TrackingPreferences';
import LiveSheet from './LiveSheet';
import DogList, { describeDog, groupSummary } from './DogList';
import { dogHistoryLabel, dogMapLabel } from '../mapHistory/DogAliases';
import { colors as tokens } from '../theme/tokens';
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
  now = Date.now(),
  phone,
  mapHeading,
  onPickDog,
  covered,
}) {
  const point = tracking.point;
  const { preferences } = tracking;
  // While the finger drags the card, its content stays as it was, so no
  // avatar's destination moves mid-flight; new rows land when it settles.
  const [dragging, setDragging] = useState(false);
  // Everything that decides a row's height or an avatar's destination is
  // frozen together, not only the dogs.
  const live = { dogs, now, phone, mapHeading, hiddenIds: preferences.value.hiddenSlaveIds };
  const frozen = useRef(live);
  if (!dragging) frozen.current = live;
  const listed = frozen.current.dogs;
  const hiddenIds = frozen.current.hiddenIds;
  const shown = frozen.current;
  const shownDogs = listed.filter(dog => !hiddenIds.includes(dog.slaveId));
  // Before any dog is known, the card says what it is waiting for.
  const summary = listed.length ? groupSummary(listed, shown.now) : sheetSummary(tracking);
  const strip = shownDogs.map(dog => {
    const said = describeDog(dog, shown.now, shown.phone, shown.mapHeading);
    const status = said.group === 'silent' ? '未更新'
      : said.group === 'nofix' ? '無定位'
      : said.current ? '即時' : said.time.replace('最後位置 ', '');
    const aged = said.freshness.tier === 'recent';
    return {
      id: dog.slaveId,
      name: dogMapLabel(dogHistoryLabel(dog.slaveId, dogAliases)),
      status,
      statusColor: said.current ? tokens.ok : aged ? tokens.warn : tokens.textMuted,
      ring: said.current ? tokens.ok : aged ? tokens.warn : '#8A948F',
      onPress: (pageY, pageX) => onPickDog?.(dog, pageY, pageX),
    };
  });
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
    <LiveSheet
      title={listed.length ? `${listed.length} 隻狗` : '狗'}
      summary={summary}
      control={dogVisibility}
      strip={strip}
      bottomInset={bottomInset}
      topInset={topInset}
      onHeight={onHeight}
      onDragging={setDragging}
      covered={covered}
    >
      {({ onRowLayout }) => (<>
        <DogList
          dogs={listed}
          showHeader={false}
          onRowLayout={onRowLayout}
          avatarsHidden
          now={shown.now}
          phone={shown.phone}
          mapHeading={shown.mapHeading}
          dogAliases={dogAliases}
          selectedSlaveId={preferences.value.focusSlaveId}
          hiddenSlaveIds={hiddenIds}
          onPick={onPickDog}
          onShow={slaveId =>
            tracking.saveTrackingPreferences({
              hiddenSlaveIds: preferences.value.hiddenSlaveIds.filter(id => id !== slaveId),
              // Showing a dog again must also bring back every dog marker,
              // otherwise the dog would be listed as shown while nothing is drawn.
              ...(preferences.value.showSlaveMarker ? {} : { showSlaveMarker: true }),
            })
          }
          control={dogVisibility}
        />
        {/* Below the list: the flying avatars land on rows measured from the
            list's top, so nothing may sit above it. */}
        {!tracking.historyLoaded && (
          <Text style={styles.hint}>正在載入本機路徑…</Text>
        )}
        {point.id === null && (
          <Text style={styles.hint}>
            等待硬體寫入資料；不會自動使用假資料。
          </Text>
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
        : <Text style={styles.hint}>狗的定位超過 2 分鐘未更新，地圖上改成琥珀色或灰色並寫出最後位置的時間；超過 24 小時才拿掉。</Text>}
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
          參考圈半徑 1 公里，跟隨領犬員眼睛。
        </Text>
        <Text style={styles.hint}>
          點地圖上的狗或領犬員可以看該裝置的詳細資料（距離、硬體回報、LoRa 訊號）。
        </Text>
      </>)}
    </LiveSheet>
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
