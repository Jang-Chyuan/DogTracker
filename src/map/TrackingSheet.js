import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { mapColors as colors } from './MapTheme';
import { formatTime, positionLabel } from './MapFormat';
import { WINDOW_PRESETS } from '../tracking/TrackingPreferences';
import LiveSheet from './LiveSheet';
import DogList, { describeDog } from './DogList';
import { phoneNote } from './DogReadout';
import { dogHistoryLabel, dogMapLabel } from '../mapHistory/DogAliases';
import { colors as tokens } from '../theme/tokens';
import Glyph from './Glyph';

export const windowLabel = minutes =>
  (minutes < 60 ? `${minutes} 分` : `${minutes / 60} 小時`);

// Re-exported for the existing callers of the sheet.
export { formatTime, positionLabel };

// The handler's own receiver, in one line: which one, its battery, and only
// if something is wrong, what.
function ReceiverRow({ point, position, onPress }) {
  const valid = point.masterBatteryValid && point.masterBatteryPercentage !== null;
  const problem = point.id === null ? '尚無資料'
    : !position ? '無定位'
    // A fix that stopped updating is a problem too, not only one kept from an
    // older packet.
    : position.retained || position.stale ? `最後位置 ${formatTime(position.receivedAt)}` : '';
  const battery = valid ? `${point.masterBatteryPercentage}%` : point.id === null ? '' : '電量未回報';
  const name = point.masterId != null ? `接收器 ${point.masterId}` : '接收器';
  return (
    <Pressable
      style={({ pressed }) => [styles.receiverRow, pressed && styles.pressed]}
      onPress={onPress}
      testID="receiver-row"
      accessibilityRole="button"
      accessibilityHint="打開接收器面板"
      accessibilityLabel={[name, valid ? `電量 ${battery}` : battery, problem].filter(Boolean).join('，')}>
      <View style={styles.receiverInfo}>
      {/* The same numbered square as on the map. */}
      <View style={styles.receiverBadge}>
        <Text style={styles.receiverBadgeText} allowFontScaling={false}>{point.masterId ?? ''}</Text>
      </View>
      <View style={styles.positionText}>
        <Text style={styles.receiverName}>{name}</Text>
        <View style={styles.receiverLine}>
          {valid && <Glyph name="battery" color={tokens.textMuted} level={point.masterBatteryPercentage} />}
          <Text style={styles.receiverSub}>
            {[battery, problem].filter(Boolean).join('・')}
          </Text>
        </View>
      </View>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
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
  recording,
  onOpenReceiver,
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
  // Before any dog is known, the card says what it is waiting for. After
  // that the avatars carry each dog's state, and the only line left is the
  // one problem every row shares: without the phone's own fix no distance
  // can be shown, said once here instead of on every row.
  const summary = !listed.length ? sheetSummary(tracking) : phoneNote(shown.phone);
  const strip = shownDogs.map(dog => {
    const said = describeDog(dog, shown.now, shown.phone, shown.mapHeading);
    // Under an avatar only a problem is written; the ring colour repeats it.
    const status = said.condition;
    const aged = said.freshness.tier === 'recent';
    return {
      id: dog.slaveId,
      name: dogMapLabel(dogHistoryLabel(dog.slaveId, dogAliases)),
      status,
      spoken: said.condition || '定位正常',
      statusColor: said.current ? tokens.ok : aged ? tokens.warn : tokens.textMuted,
      ring: said.current ? tokens.ok : aged ? tokens.warn : '#8A948F',
      onPress: (pageY, pageX) => onPickDog?.(dog, pageY, pageX),
    };
  });
  // Only a card that has not loaded yet is disabled. Dimming everything while
  // a write is in flight made every tap flash the whole card.
  const disabled = !preferences.ready;
  return (
    <LiveSheet
      title={listed.length ? `${listed.length} 隻狗` : '狗'}
      summary={summary}
      // The phone's own track is being kept for history (design 1).
      badge={recording ? '手機記錄中' : ''}
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
            })
          }
        />
        {/* Below the list: the flying avatars land on rows measured from the
            list's top, so nothing may sit above it. */}
        {!tracking.historyLoaded && <Text style={styles.hint}>正在載入本機路徑…</Text>}
        {point.id === null && <Text style={styles.hint}>等待接收器資料</Text>}
        <ReceiverRow point={point} position={master} onPress={onOpenReceiver} />
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
        : null}
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
  receiverRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60,
    borderTopWidth: 1, borderTopColor: tokens.line, paddingTop: 8, marginTop: 4,
  },
  receiverInfo: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  chevron: { fontSize: 22, color: tokens.textMuted, paddingHorizontal: 8 },
  pressed: { opacity: 0.85 },
  receiverBadge: {
    width: 36, height: 36, borderRadius: 10, backgroundColor: tokens.receiver,
    alignItems: 'center', justifyContent: 'center',
  },
  receiverBadgeText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  receiverName: { fontSize: 16, fontWeight: '700', color: tokens.text },
  receiverLine: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  receiverSub: { fontSize: 13, color: tokens.textMuted, flexShrink: 1 },
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
