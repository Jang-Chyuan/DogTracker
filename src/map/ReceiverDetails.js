import React from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { colors, space, touch, type } from '../theme/tokens';
import { describeReceiver, formatClock } from './HomeStatus';
import { formatTime } from './MapFormat';

// Connection in one word, written and coloured (DESIGN.md §2.3). The status
// pill only appears when something is wrong; the panel always says.
export function receiverConnection(state, now) {
  const said = describeReceiver(state, now);
  if (!said.show) return { tone: 'ok', label: '連線正常' };
  const label = said.label.split('｜')[1] || said.label;
  return { tone: said.tone === 'crit' ? 'crit' : said.tone === 'idle' ? 'muted' : 'warn', label };
}

function Reading({ label, value, missing }) {
  return (
    <View style={styles.reading} accessible accessibilityLabel={`${label}，${value}`}>
      <Text style={styles.readingLabel}>{label}</Text>
      <Text style={[styles.readingValue, missing && styles.readingMissing]}>{value}</Text>
    </View>
  );
}

// The whole row toggles (48 dp, label included), and TalkBack hears it once,
// as one switch.
function Row({ label, value, onChange, disabled }) {
  return (
    <Pressable style={styles.switchRow} onPress={() => onChange(!value)} disabled={disabled}
      accessibilityRole="switch" accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled: !!disabled }}>
      <Text style={styles.switchLabel}>{label}</Text>
      <Switch accessibilityLabel={label} value={value} disabled={disabled} onValueChange={onChange}
        trackColor={{ false: colors.line, true: colors.tonal }} thumbColor={value ? colors.accent : colors.surface}
        importantForAccessibility="no-hide-descendants" accessibilityElementsHidden />
    </Pressable>
  );
}

/**
 * The receiver's panel (design 1: tap the receiver on the map or its row in
 * the card). The title's chip says whether it is connected; below: its
 * battery, when it last heard a collar,
 * whether it has its own position, and the two map switches that used to be
 * eyes on the card.
 */
export default function ReceiverDetails({
  point, position, state, now, preferences, onPreferences, onOpenSettings, other,
}) {
  // The newest packet can be from a receiver used before this one.
  const battery = other || point.id === null ? '尚無資料'
    : point.masterBatteryValid && point.masterBatteryPercentage !== null ? `${point.masterBatteryPercentage}%` : '未回報';
  const last = state?.lastReceivedAt > 0 ? formatClock(state.lastReceivedAt) : '尚未收到';
  const where = point.id === null || other ? '尚無資料' : !position ? '無定位'
    : position.retained || position.stale ? `最後位置 ${formatTime(position.receivedAt)}` : '有定位';
  const busy = !preferences?.ready;
  const shown = preferences?.value || {};
  return (
    <View testID="receiver-details">
      <View style={styles.grid}>
        <Reading label="電量" value={battery} missing={!/%$/.test(battery)} />
        <Reading label="最後收訊" value={last} missing={!(state?.lastReceivedAt > 0)} />
        <Reading label="接收器位置" value={where} missing={where !== '有定位'} />
      </View>
      <Row label="在地圖上顯示接收器" value={shown.showMasterMarker !== false} disabled={busy}
        onChange={value => onPreferences?.({ showMasterMarker: value })} />
      <Row label="1 公里參考圈" value={shown.showRangeCircle !== false} disabled={busy}
        onChange={value => onPreferences?.({ showRangeCircle: value })} />
      <Pressable onPress={onOpenSettings} accessibilityRole="button" accessibilityLabel="接收器設定"
        accessibilityHint="到設定裡的接收器頁" style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
        <Text style={styles.buttonText}>接收器設定</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s, marginBottom: space.s },
  reading: { flexBasis: '47%', flexGrow: 1, backgroundColor: colors.bg, borderRadius: 12, padding: space.m },
  readingLabel: { ...type.caption, color: colors.textMuted },
  readingValue: { ...type.status, color: colors.text },
  readingMissing: { fontWeight: '400', color: colors.textMuted },
  switchRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: touch.min,
    borderTopWidth: 1, borderTopColor: colors.line,
  },
  switchLabel: { ...type.body, color: colors.text, flex: 1 },
  button: {
    minHeight: touch.min, borderRadius: 999, borderWidth: 1, borderColor: colors.line,
    alignItems: 'center', justifyContent: 'center', marginTop: space.m,
  },
  buttonText: { ...type.status, color: colors.text },
  pressed: { transform: [{ scale: 0.97 }] },
});
