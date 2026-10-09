import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, space, touch, type } from '../theme/tokens';
import { formatClockSeconds, formatCount, formatDate, formatDateTime } from '../map/MapFormat';
import { LoadState, PillButton, dataStyles } from '../settings/DataTable';
import { settingsStyles } from '../settings/SettingsUI';
import { LOCATION_RECORD_LIMIT } from './LocationTrackerDatabase';
import { useLocationTracker } from './useLocationTracker';

const motionLabel = state => ({ moving: '移動', suspected_stationary: '疑似靜止', stationary: '靜止', unknown: '未知' }[state] || '未判定');
const time = formatClockSeconds;
const date = formatDate;
const fixed = (value, digits, unit = '') => (value == null ? '—' : `${Number(value).toFixed(digits)}${unit}`);
// A gap of two minutes, or another recording session, is a break.
const BREAK_MS = 120000;

/**
 * 設定 → 診斷 → 記錄清單 (S8): the phone's recorded positions, newest first,
 * a page at a time; rows grouped by day, a line where the recording broke
 * off, a row pressed shows all it stored. Recording itself is switched on and
 * off in 設定 → 手機 (S4). `readPage` replaces where the rows come from (a
 * screen fixture's, in debug).
 */
export default function LocationTrackerScreen({ foreground, readPage }) {
  const tracker = useLocationTracker(foreground, readPage);
  const [open, setOpen] = useState(null);
  const rows = tracker.rows || [];
  return (
    <ScrollView testID="location-records" style={settingsStyles.page} contentContainerStyle={settingsStyles.content}>
      <Text style={dataStyles.hint}>
        {`已存 ${formatCount(tracker.total)}／${formatCount(LOCATION_RECORD_LIMIT)} 筆・第 ${tracker.page} 頁`}
      </Text>
      <View style={dataStyles.buttons}>
        <PillButton title="回到最新" onPress={tracker.refresh} />
        <PillButton title="上一頁" onPress={tracker.previous} disabled={tracker.page === 1 || tracker.loading} />
        <PillButton title="下一頁" onPress={tracker.next} disabled={!tracker.hasMore || tracker.loading} />
      </View>
      <LoadState testID="location-records" loading={tracker.loading && !rows.length} error={tracker.error ? `讀取失敗：${tracker.error}` : ''}
        empty={!rows.length} emptyText="還沒有位置記錄" onRetry={tracker.refresh} />
      {rows.map((row, index) => {
        const previous = rows[index - 1];
        const newDay = !previous || date(previous.location_at) !== date(row.location_at);
        const broke = previous && !newDay && (previous.location_at - row.location_at > BREAK_MS
          || previous.session_id !== row.session_id);
        const expanded = open === row.id;
        return (
          <View key={row.id}>
            {newDay ? <Text style={dataStyles.heading} accessibilityRole="header">{date(row.location_at)}</Text> : null}
            {broke ? <Text style={styles.break}>記錄中斷</Text> : null}
            <Pressable testID={`record-${row.id}`} accessibilityRole="button"
              accessibilityLabel={`${time(row.location_at)}，${fixed(row.latitude, 6)}, ${fixed(row.longitude, 6)}`}
              accessibilityState={{ expanded }} onPress={() => setOpen(current => (current === row.id ? null : row.id))}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
              <View style={styles.head}>
                <Text style={styles.time}>{time(row.location_at)}</Text>
                <Text style={styles.id}>{`#${row.id}`}</Text>
              </View>
              <Text style={styles.value}>{`${fixed(row.latitude, 6)}, ${fixed(row.longitude, 6)}`}</Text>
              <Text style={styles.detail}>
                {`精度 ${fixed(row.accuracy_meters, 1, ' m')}・速度 ${fixed(row.speed_kmh, 1, ' km/h')}・${motionLabel(row.motion_state)}`}
              </Text>
              {expanded ? <View style={styles.more}>
                <Text style={styles.detail}>{`海拔 ${row.altitude_meters ?? '—'} m・方向 ${row.heading_degrees ?? '—'}°`}</Text>
                <Text style={styles.detail}>{`寫入時間 ${formatDateTime(row.recorded_at)}`}</Text>
                {row.display_latitude != null ? <Text style={styles.detail}>
                  {`歷史顯示位置 ${fixed(row.display_latitude, 6)}, ${fixed(row.display_longitude, 6)}・${row.display_source === 'animated' ? '藍點動畫' : '定位管線'}`}
                </Text> : null}
                <Text style={styles.detail}>
                  {`原始速度 ${fixed(row.raw_speed_kmh, 1, ' km/h')}・速度估計精度 ${fixed(row.speed_accuracy_mps, 2, ' m/s')}`}
                </Text>
                {row.raw_latitude != null ? <Text style={styles.detail}>
                  {`原始位置 ${fixed(row.raw_latitude, 6)}, ${fixed(row.raw_longitude, 6)}；上面是${row.motion_state === 'stationary' ? '靜止鎖定' : '平滑'}後的位置`}
                </Text> : null}
              </View> : null}
            </Pressable>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: touch.row, paddingVertical: space.s + 2, paddingHorizontal: space.xs,
    borderTopWidth: 1, borderTopColor: colors.line },
  pressed: { backgroundColor: colors.pressedOverlay },
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  time: { ...type.status, color: colors.text },
  id: { ...type.small, color: colors.textMuted },
  value: { ...type.body, color: colors.text, marginTop: 2 },
  detail: { ...type.small, color: colors.textMuted, marginTop: 2 },
  more: { marginTop: space.xs },
  break: { ...type.captionBold, color: colors.warn, textAlign: 'center', paddingVertical: space.s,
    borderTopWidth: 1, borderTopColor: colors.line },
});
