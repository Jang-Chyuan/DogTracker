import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import DogAvatar from '../dogs/DogAvatar';
import Glyph from './Glyph';
import { colors, space, touch, type } from '../theme/tokens';
import { dogHistoryLabel, dogMapLabel } from '../mapHistory/DogAliases';
import { dogFreshness, FRESH_MS } from './DogFreshness';
import { MOVEMENT_WORDS, fromPhone, lowBattery, movement, positionAge } from './DogReadout';

function clock(at) {
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

// What a row, the strip, the popover and the panel say about a dog. Only a
// problem is written out; a current dog says nothing more than where it is.
export const PROBLEM_WORDS = { silent: '未更新', nofix: '無定位' };
export function describeDog(dog, now, phone, mapHeading = 0) {
  const freshness = dogFreshness(dog, now);
  const group = dogGroup(dog, now);
  const current = group === 'ok';
  const state = current ? movement(dog, freshness.tier) : 'unknown';
  const where = fromPhone(dog, phone, mapHeading);
  // Never call a silent collar "receiving": no packets is a different problem
  // from packets without a fix.
  const condition = PROBLEM_WORDS[group] || '';
  // How old the last position is — only when it is not current.
  const age = current || !dog.coordinate || freshness.tier === 'gone' ? ''
    : dog.retained && freshness.tier === 'fresh' ? clock(dog.lastPositionAt)
    : positionAge(dog, freshness.tier, now);
  const time = age ? `最後位置 ${age}` : '';
  const distanceText = where.kind === 'ok' ? where.distance : '';
  // Everything a screen reader needs, in words, even where the screen shows
  // an icon or nothing.
  const spoken = [
    current ? MOVEMENT_WORDS[state] : condition,
    // A missing phone fix is announced once by the card, not on every dog.
    where.kind === 'ok' ? `${where.compass}方 ${where.distance}` : '',
    time,
  ].filter(Boolean).join('，');
  return { freshness, group, current, state, condition, age, time, where, distanceText, spoken, low: lowBattery(dog) };
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

function DogRow({ dog, name, avatar, now, phone, mapHeading, followed, onPick, onLayout, avatarHidden }) {
  const { freshness, group, current, state, condition, age, where, distanceText, spoken, low } =
    describeDog(dog, now, phone, mapHeading);
  const follow = followed ? (current ? '跟隨中' : '跟隨暫停') : '';
  const tone = current ? colors.textMuted : freshness.tier === 'recent' ? colors.warn : colors.textMuted;
  return (
    <Pressable
      testID={`dog-row-${dog.slaveId}`}
      accessibilityRole="button"
      accessibilityLabel={[name, spoken, follow, low && `電量 ${dog.batteryPercentage}%`].filter(Boolean).join('，')}
      accessibilityHint="把地圖移到這隻狗，並打開選項"
      accessibilityState={{ selected: followed }}
      onPress={event => onPick(dog, event.nativeEvent.pageY, event.nativeEvent.pageX)}
      onLayout={onLayout}
      style={({ pressed }) => [styles.row, followed && styles.rowFollowed, pressed && styles.pressed]}
    >
      {/* While the sheet draws the flying avatars on top, the row keeps the
          space but not the picture, so no avatar is drawn twice. */}
      <View style={[styles.ring, { borderColor: RING[freshness.tier] }, avatarHidden && styles.invisible]}>
        <DogAvatar avatar={avatar} size={34} />
      </View>
      <View style={styles.middle}>
        <View style={styles.nameLine}>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          {low && <BatteryLow />}
          {low && <Text style={styles.lowText}>{dog.batteryPercentage}%</Text>}
        </View>
        {/* Icon and a short word, so it reads in bright sun too (design 2):
            moving or still for a current dog, the problem and its age
            otherwise. */}
        <View style={styles.subLine}>
          {current ? (state !== 'unknown' && <Glyph name={state} color={tone} size={15} />)
            : <Glyph name={group === 'silent' ? 'no-signal' : 'no-fix'} color={tone} size={15} />}
          <Text style={[styles.sub, styles.subText, { color: tone }]} numberOfLines={2}>
            {[current ? MOVEMENT_WORDS[state] : condition, age, follow].filter(Boolean).join('・')}
          </Text>
        </View>
      </View>
      {where.kind === 'ok' && (
        <View style={styles.distanceLine}>
          <Arrow bearing={where.bearing} />
          <Text style={styles.distance}>{distanceText}</Text>
        </View>
      )}
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
  onPick, onShow, control, dogAliases, dogAvatars, showHeader = true, onRowLayout, avatarsHidden = false,
}) {
  const shown = dogs.filter(dog => !hiddenSlaveIds.includes(dog.slaveId));
  const hidden = dogs.filter(dog => hiddenSlaveIds.includes(dog.slaveId));
  const nameOf = dog => dogMapLabel(dogHistoryLabel(dog.slaveId, dogAliases));
  return (
    <View>
      {showHeader && (
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.title}>{dogs.length} 隻狗</Text>
          </View>
          {control}
        </View>
      )}
      {!dogs.length && <Text style={styles.empty}>目前沒有 24 小時內的狗資料。</Text>}
      {shown.map(dog => (
        <DogRow key={dog.slaveId} dog={dog} name={nameOf(dog)} avatar={dogAvatars?.[dog.slaveId]} now={now} phone={phone}
          mapHeading={mapHeading} followed={dog.slaveId === selectedSlaveId} onPick={onPick}
          avatarHidden={avatarsHidden}
          onLayout={onRowLayout ? event => onRowLayout(dog.slaveId, event.nativeEvent.layout) : undefined} />
      ))}
      {hidden.map(dog => (
        <View key={dog.slaveId} style={[styles.row, styles.hiddenRow]} testID={`dog-hidden-${dog.slaveId}`}>
          <View style={[styles.ring, styles.ringNone]}>
            <DogAvatar avatar={dogAvatars?.[dog.slaveId]} size={34} outline="#C9CFCC" />
          </View>
          <View style={styles.middle}>
            <Text style={[styles.name, styles.hiddenName]}>{nameOf(dog)}</Text>
            <Text style={styles.sub}>已隱藏</Text>
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
  invisible: { opacity: 0 },
  middle: { flex: 1, minWidth: 0 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  name: { ...type.status, color: colors.text, flexShrink: 1 },
  sub: { ...type.caption, color: colors.textMuted },
  subLine: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minWidth: 0 },
  subText: { flexShrink: 1 },
  lowText: { ...type.caption, color: colors.crit, fontWeight: '700' },
  distanceLine: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  distance: { ...type.status, color: colors.text },
  hiddenRow: { backgroundColor: colors.bg },
  hiddenName: { color: colors.textMuted },
  showButton: {
    minHeight: touch.min, minWidth: touch.min, paddingHorizontal: space.l, borderRadius: 999,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.tonal,
  },
  showText: { ...type.status, color: colors.tonalText },
});
