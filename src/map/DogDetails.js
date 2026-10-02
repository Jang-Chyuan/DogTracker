import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, space, touch, type } from '../theme/tokens';
import { describeDog } from './DogList';
import { MOVEMENT_WORDS, movement } from './DogReadout';
import { formatTime } from './MapFormat';

// One reading in the 2×2 grid. A missing value says why it is missing,
// never a blank or a 0 (DESIGN.md §7.4).
function Reading({ label, value, missing }) {
  return (
    <View style={styles.reading} accessible accessibilityLabel={`${label}，${value}`}>
      <Text style={styles.readingLabel}>{label}</Text>
      <Text style={[styles.readingValue, missing && styles.readingMissing]}>{value}</Text>
    </View>
  );
}

function Button({ label, onPress, primary, disabled, hint }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      accessibilityHint={hint}
      style={({ pressed }) => [styles.button, primary && styles.primary, disabled && styles.disabled,
        pressed && styles.pressed]}
    >
      <Text style={[styles.buttonText, primary && styles.primaryText]}>{label}</Text>
    </Pressable>
  );
}

/**
 * A dog's panel: the same facts as its list row, then what can be done with
 * the dog, then — folded away — where the data came from and the radio and
 * GPS diagnostics. It reads the same merged dog as the row, so the two never
 * disagree about the Master or the readings.
 */
export default function DogDetails({
  dog, live, point, now, phone, mapHeading, alias, mastersSeen = [], followed, hidden,
  onFollow, onTodayPath, todayPathBusy, onRename, onToggleHidden, chart,
}) {
  const said = describeDog(dog, now, phone, mapHeading);
  const state = said.current ? movement(dog, said.freshness.tier) : 'unknown';
  const [diagnostics, setDiagnostics] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(alias || '');
  const commit = () => { onRename?.(draft.trim()); setRenaming(false); };
  const where = said.where.kind === 'ok' ? `${said.where.distance}・${said.where.compass}方`
    : said.where.kind === 'no-phone' ? '手機無定位' : '狗無定位';
  const battery = Number.isFinite(dog.batteryPercentage) ? `${dog.batteryPercentage}%`
    : dog.source === 'cloud' ? '雲端資料未提供' : '未回報';
  const toReceiver = Number.isFinite(dog.distanceMeters) ? `${dog.distanceMeters} m`
    : dog.source === 'cloud' ? '雲端資料未提供' : '無接收器位置';
  const source = dog.source === 'ble' ? '這支手機的接收器（BLE）' : `雲端・經 Master ${dog.masterId ?? '—'}`;
  return (
    <View>
      {/* The chip in the title says which state; an old fix also says when. */}
      {!said.current && !!said.time && <Text style={styles.status}>{said.time}</Text>}

      <View style={styles.grid}>
        <Reading label="方向與距離" value={where} missing={said.where.kind !== 'ok'} />
        <Reading label="狀態" value={said.current ? MOVEMENT_WORDS[state] : said.condition} missing={!said.current} />
        <Reading label="電量" value={battery} missing={!Number.isFinite(dog.batteryPercentage)} />
        <Reading label="離接收器" value={toReceiver} missing={!Number.isFinite(dog.distanceMeters)} />
      </View>

      {chart}

      <View style={styles.actions}>
        <Button label={followed ? '停止跟隨' : '跟隨這隻狗'} primary onPress={onFollow}
          disabled={!followed && (!said.current || hidden)}
          hint={followed ? undefined : hidden ? '這隻狗在地圖上隱藏中，先顯示才能跟隨'
            : !said.current ? '這隻狗沒有目前的定位，無法跟隨' : undefined} />
        <Button label="今天的路徑" onPress={onTodayPath} disabled={!onTodayPath || todayPathBusy}
          hint="在歷史軌跡頁看這隻狗今天的路徑" />
      </View>

      {renaming ? (
        <View style={styles.renameRow}>
          <TextInput
            value={draft}
            onChangeText={text => setDraft(text.slice(0, 20))}
            placeholder={`狗 ${dog.slaveId}`}
            maxLength={20}
            autoFocus
            accessibilityLabel={`狗 ${dog.slaveId} 的名稱`}
            accessibilityHint={`清空就恢復成「狗 ${dog.slaveId}」，只存在這支手機`}
            style={styles.input}
            returnKeyType="done"
            onSubmitEditing={commit}
          />
          <Button label="取消" onPress={() => setRenaming(false)} />
          <Button label="儲存" primary onPress={commit} />
        </View>
      ) : null}

      <View style={styles.links}>
        {!renaming && onRename && (
          <Pressable onPress={() => { setDraft(alias || ''); setRenaming(true); }} accessibilityRole="button"
            accessibilityLabel="改名" style={styles.link}>
            <Text style={styles.linkText}>改名</Text>
          </Pressable>
        )}
        <Pressable onPress={onToggleHidden} accessibilityRole="button" style={styles.link}
          accessibilityLabel={hidden ? '在地圖上顯示這隻狗' : '在地圖上隱藏這隻狗'}>
          <Text style={styles.linkText}>{hidden ? '顯示' : '隱藏'}</Text>
        </Pressable>
        <View style={styles.spacer} />
        <Pressable onPress={() => setDiagnostics(open => !open)} accessibilityRole="button"
          accessibilityLabel="資料來源與診斷" accessibilityState={{ expanded: diagnostics }} style={styles.link}>
          <Text style={styles.linkText}>資料來源與診斷 {diagnostics ? '▴' : '▾'}</Text>
        </Pressable>
      </View>

      {diagnostics && (
        <View style={styles.diagnostics} testID="dog-diagnostics">
          <Text style={styles.diag}>來源：{source}</Text>
          {mastersSeen.length > 1 && (
            <Text style={styles.diag}>最近 2 分鐘收到牠的 Master：{mastersSeen.join('、')}（顯示最新一筆）</Text>
          )}
          <Text style={styles.diag}>最後收到封包：{formatTime(dog.lastPacketAt ?? dog.receivedAt)}</Text>
          <Text style={styles.diag}>最後有效定位：{formatTime(dog.lastPositionAt)}</Text>
          <Text style={styles.diag}>速度：{Number.isFinite(dog.speedKmh) ? `${dog.speedKmh} km/h` : '—'}</Text>
          {live ? (
            <>
              <Text style={styles.diag}>衛星 {point.satellites ?? '—'}・HDOP {point.hdop ?? '—'}・GPS 時間 {point.gpsTime ?? '—'}</Text>
              <Text style={styles.diag}>LoRa：RSSI {point.rssi ?? '—'}・SNR {point.snr ?? '—'}</Text>
              <Text style={styles.diag}>Master {point.masterId ?? '—'}／Slave {point.slaveId ?? '—'}・資料列 {point.id ?? '—'}</Text>
            </>
          ) : (
            <Text style={styles.diag}>衛星、HDOP、LoRa 訊號只有這支手機正在接收的狗才有。</Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  status: { ...type.caption, color: colors.warn, fontWeight: '700', marginBottom: space.s },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s, marginBottom: space.m },
  reading: { flexBasis: '47%', flexGrow: 1, backgroundColor: colors.bg, borderRadius: 12, padding: space.m },
  readingLabel: { ...type.caption, color: colors.textMuted },
  readingValue: { ...type.status, color: colors.text },
  readingMissing: { fontWeight: '400', color: colors.textMuted },
  actions: { flexDirection: 'row', gap: space.s, marginTop: space.s },
  button: {
    flex: 1, minHeight: touch.min, borderRadius: 999, borderWidth: 1, borderColor: colors.line,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.m,
  },
  primary: { backgroundColor: colors.tonal, borderColor: colors.tonal },
  buttonText: { ...type.status, color: colors.text },
  primaryText: { color: colors.tonalText },
  disabled: { opacity: 0.4 },
  pressed: { transform: [{ scale: 0.97 }] },
  renameRow: { flexDirection: 'row', gap: space.s, marginTop: space.m, alignItems: 'center' },
  input: {
    flex: 2, minHeight: touch.min, borderWidth: 1.5, borderColor: colors.accent, borderRadius: 12,
    paddingHorizontal: space.m, ...type.body, color: colors.text,
  },
  links: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: space.xs },
  spacer: { flex: 1 },
  link: { minHeight: touch.min, minWidth: touch.min, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xs },
  linkText: { ...type.status, fontWeight: '400', color: colors.tonalText },
  diagnostics: { backgroundColor: colors.bg, borderRadius: 12, padding: space.m, gap: space.xs },
  diag: { ...type.caption, color: colors.textMuted },
});
