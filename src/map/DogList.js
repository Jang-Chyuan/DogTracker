import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import TrackingAvatar from './TrackingAvatar';
import { colors, space, touch, type } from '../theme/tokens';
import { dogHistoryLabel, dogMapLabel } from '../mapHistory/DogAliases';
import { dogFreshness, FRESH_MS } from './DogFreshness';
import { MOVEMENT_WORDS, fromPhone, lowBattery, movement, positionAge } from './DogReadout';

function clock(at) {
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

// What a row (and the popover) says about a dog, in the same words.
export function describeDog(dog, now, phone, mapHeading = 0) {
  const freshness = dogFreshness(dog, now);
  const group = dogGroup(dog, now);
  const current = group === 'ok';
  const state = current ? movement(dog, freshness.tier) : 'unknown';
  const where = fromPhone(dog, phone, mapHeading);
  // Never call a silent collar "receiving": no packets is a different problem
  // from packets without a fix.
  const condition = group === 'silent' ? '沒有收到新資料'
    : group === 'nofix' ? '有收訊、沒有定位' : MOVEMENT_WORDS[state];
  const time = !dog.coordinate || freshness.tier === 'gone' ? ''
    : current ? '定位即時'
    : dog.retained && freshness.tier === 'fresh' ? `最後位置 ${clock(dog.lastPositionAt)}`
    : `最後位置 ${positionAge(dog, freshness.tier, now)}`;
  const distanceText = where.kind === 'ok' ? where.distance
    : where.kind === 'no-phone' ? '手機無定位' : '無定位';
  return { freshness, group, current, condition, time, where, distanceText, low: lowBattery(dog) };
}

// Status ring around the avatar: words in the row carry the state, the ring
// only repeats it.
const RING = { fresh: colors.ok, recent: colors.warn, old: '#8A948F', gone: '#8A948F' };

// The three mutually exclusive groups the header counts (DESIGN.md §6):
// silent  no packet for two minutes
// nofix   packets arrive, but the newest has no fix (DogMerge marks it
//         retained) or the last fix has aged
// ok      a current fix in the newest packet
export function dogGroup(dog, now) {
  const lastPacket = dog.lastPacketAt ?? dog.lastPositionAt;
  if (!Number.isFinite(lastPacket) || now - lastPacket > FRESH_MS) return 'silent';
  if (dog.retained || !dog.coordinate) return 'nofix';
  return dogFreshness(dog, now).tier === 'fresh' ? 'ok' : 'nofix';
}

export function groupSummary(dogs, now) {
  const counts = { ok: 0, nofix: 0, silent: 0 };
  dogs.forEach(dog => { counts[dogGroup(dog, now)] += 1; });
  return [
    counts.ok && `定位正常 ${counts.ok}`,
    counts.nofix && `無定位 ${counts.nofix}`,
    counts.silent && `未更新 ${counts.silent}`,
  ].filter(Boolean).join('・');
}

function Arrow({ bearing }) {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" style={{ transform: [{ rotate: `${bearing}deg` }] }}>
      <Path d="M12 2l7 18-7-4-7 4z" fill={colors.text} />
    </Svg>
  );
}

function BatteryLow() {
  return (
    <Svg width={18} height={12} viewBox="0 0 24 16" accessibilityElementsHidden importantForAccessibility="no">
      <Path d="M2 2h17v12H2zM21 6v4" stroke={colors.critLine} strokeWidth={2.2} fill="none" />
      <Path d="M5 5h3v6H5z" fill={colors.critLine} />
    </Svg>
  );
}

function DogRow({ dog, name, now, phone, mapHeading, followed, onPick }) {
  const { freshness, current, condition, time, where, distanceText, low } = describeDog(dog, now, phone, mapHeading);
  const sub = [condition, followed && (current ? '跟隨中' : '跟隨暫停')].filter(Boolean).join('・');
  const spoken = where.kind === 'ok' ? `${where.compass}方 ${distanceText}` : distanceText;
  return (
    <Pressable
      testID={`dog-row-${dog.slaveId}`}
      accessibilityRole="button"
      accessibilityLabel={`${name}，${sub}${low ? `，電量 ${dog.batteryPercentage}%` : ''}，${spoken}${time ? `，${time}` : ''}`}
      accessibilityHint="把地圖移到這隻狗，並打開選項"
      accessibilityState={{ selected: followed }}
      onPress={event => onPick(dog, event.nativeEvent.pageY)}
      style={({ pressed }) => [styles.row, followed && styles.rowFollowed, pressed && styles.pressed]}
    >
      <View style={[styles.ring, { borderColor: RING[freshness.tier] }]}>
        <TrackingAvatar role="slave" size={34} />
      </View>
      <View style={styles.middle}>
        <View style={styles.nameLine}>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          {low && <BatteryLow />}
        </View>
        <Text style={styles.sub} numberOfLines={2}>
          {sub}{low ? `・電量 ${dog.batteryPercentage}%` : ''}
        </Text>
      </View>
      <View style={styles.right}>
        <View style={styles.distanceLine}>
          {where.kind === 'ok' && <Arrow bearing={where.bearing} />}
          <Text style={[styles.distance, where.kind !== 'ok' && styles.distanceMissing]}>{distanceText}</Text>
        </View>
        <Text style={[styles.age, !current && freshness.tier === 'recent' && styles.ageRecent]}>
          {time}
        </Text>
      </View>
    </Pressable>
  );
}

/**
 * The dog list in the home card: one row per dog with only what the handler
 * acts on. Tapping a row moves the map there once and opens the dog's
 * popover; following and details live in that popover. Dogs hidden from the
 * map stay at the bottom with a 顯示 button.
 */
export default function DogList({
  dogs, now, phone, mapHeading = 0, selectedSlaveId, hiddenSlaveIds = [],
  onPick, onShow, control, dogAliases,
}) {
  const shown = dogs.filter(dog => !hiddenSlaveIds.includes(dog.slaveId));
  const hidden = dogs.filter(dog => hiddenSlaveIds.includes(dog.slaveId));
  const nameOf = dog => dogMapLabel(dogHistoryLabel(dog.slaveId, dogAliases));
  return (
    <View>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>{dogs.length} 隻狗</Text>
          {!!dogs.length && <Text style={styles.summary}>{groupSummary(dogs, now)}</Text>}
        </View>
        {control}
      </View>
      {!dogs.length && <Text style={styles.empty}>目前沒有 24 小時內的狗資料。</Text>}
      {shown.map(dog => (
        <DogRow key={dog.slaveId} dog={dog} name={nameOf(dog)} now={now} phone={phone}
          mapHeading={mapHeading} followed={dog.slaveId === selectedSlaveId} onPick={onPick} />
      ))}
      {hidden.map(dog => (
        <View key={dog.slaveId} style={[styles.row, styles.hiddenRow]} testID={`dog-hidden-${dog.slaveId}`}>
          <View style={[styles.ring, styles.ringNone]}>
            <TrackingAvatar role="slave" size={34} tint="#C9CFCC" />
          </View>
          <View style={styles.middle}>
            <Text style={[styles.name, styles.hiddenName]}>{nameOf(dog)}</Text>
            <Text style={styles.sub}>已隱藏，不顯示在地圖上</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`顯示${nameOf(dog)}`}
            onPress={() => onShow(dog.slaveId)}
            style={({ pressed }) => [styles.showButton, pressed && styles.pressed]}
          >
            <Text style={styles.showText}>顯示</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.s, marginBottom: space.xs },
  headerText: { flex: 1 },
  title: { ...type.status, color: colors.text },
  summary: { ...type.caption, color: colors.textMuted },
  empty: { ...type.caption, color: colors.textMuted, marginVertical: space.s },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 60,
    paddingVertical: space.s, paddingHorizontal: space.s, marginHorizontal: -space.s,
    borderTopWidth: 1, borderTopColor: colors.line,
  },
  rowFollowed: { backgroundColor: colors.brandSoft, borderLeftWidth: 3, borderLeftColor: colors.accent },
  pressed: { opacity: 0.85 },
  ring: { width: 42, height: 42, borderRadius: 21, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  ringNone: { borderColor: 'transparent' },
  middle: { flex: 1, minWidth: 0 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  name: { ...type.status, color: colors.text, flexShrink: 1 },
  sub: { ...type.caption, color: colors.textMuted },
  right: { alignItems: 'flex-end' },
  distanceLine: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  distance: { ...type.status, color: colors.text },
  distanceMissing: { fontSize: 13, color: colors.textMuted, fontWeight: '400' },
  age: { ...type.caption, color: colors.textMuted },
  ageRecent: { color: colors.warn, fontWeight: '700' },
  hiddenRow: { backgroundColor: colors.bg },
  hiddenName: { color: colors.textMuted },
  showButton: {
    minHeight: touch.min, minWidth: touch.min, paddingHorizontal: space.l, borderRadius: 999,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.tonal,
  },
  showText: { ...type.status, color: colors.tonalText },
});
