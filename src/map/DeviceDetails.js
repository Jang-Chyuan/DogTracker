import React, { useEffect } from 'react';
import {
  BackHandler,
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { floatingShadow, mapColors as colors } from './MapTheme';
import { formatTime } from './MapFormat';
import Stat from './Stat';
import ActivityHistoryChart from './ActivityHistoryChart';
import DogDetails from './DogDetails';
import ReceiverDetails, { receiverConnection } from './ReceiverDetails';
import { describeDog } from './DogList';
import { colors as tokens, space, type } from '../theme/tokens';

const maxSheet = (top, bottom) => {
  const { height } = Dimensions.get('window');
  // Leave the top third of the map for the dog the panel is about.
  return Math.max(320, Math.min(height * 0.62, height - top - bottom - 120));
};

// The dog's state in one word, coloured and written (DESIGN.md §2.3).
const dogChip = said => ({
  tone: said.current ? 'ok' : said.freshness.tier === 'recent' ? 'warn' : 'muted',
  label: said.current ? '定位正常' : said.group === 'silent' ? '未更新' : '無定位',
});
function StatusChip({ tone, label }) {
  return (
    <View style={[styles.chip, styles[`chip_${tone}`]]}>
      <Text style={[styles.chipText, styles[`chipText_${tone}`]]}>{label}</Text>
    </View>
  );
}


/**
 * One panel for whichever marker was tapped.
 *
 * The dog and the handler used to answer a tap differently — a native callout
 * for one, this panel for the other. Both now open the same panel, and the
 * hardware and LoRa readings live in it rather than on the card: they describe
 * one pair, and the card can hold several dogs from several Masters.
 */
export default function DeviceDetails({
  tracking,
  subject,
  dogAliases,
  activityOwner,
  activityActive = true,
  master,
  topInset,
  bottomInset,
  onClose,
  hidden,
  onToggleHidden,
  now = Date.now(),
  phone,
  mapHeading,
  mastersSeen,
  followed,
  onFollow,
  onTodayPath,
  todayPathBusy,
  onRename,
  onPanelHeight,
  receiverState,
  receiverId,
  onPreferences,
  onOpenReceiver,
}) {
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        onClose();
        return true;
      },
    );
    return () => subscription.remove();
  }, [onClose]);
  const { point } = tracking;
  const dog = subject?.kind === 'dog' ? subject.dog : null;
  // A history track answers a tap with the same panel as a live marker; only
  // its content differs, because a replayed moment has no hardware feed.
  const track = subject?.kind === 'track' ? subject.track : null;
  // Hardware fields come from this phone's BLE feed, so they only describe the
  // dog it is connected to.
  const live = dog && dog.source === 'ble' && dog.slaveId === point.slaveId;
  const slaveId = dog?.slaveId ?? (track?.role === 'slave' ? track.slaveId : null);
  const alias = slaveId != null ? dogAliases?.[slaveId]?.trim() : null;
  // A named dog keeps its collar number next to the name (DESIGN.md §12).
  // A live dog's panel takes the home card's place at the bottom, so the dog
  // itself stays in sight on the map above it (design 3). The handler and
  // history panels keep the floating card.
  const receiver = subject?.kind === 'master';
  const sheet = !!dog || receiver;
  const chip = dog ? dogChip(describeDog(dog, now, phone, mapHeading))
    : receiver ? receiverConnection(receiverState, now) : null;
  const title = slaveId != null ? (alias ? `${alias}・${slaveId}` : `狗 ${slaveId}`)
    : track ? track.name : (receiverId?.number ?? point.masterId) != null
      ? `接收器 ${receiverId?.number ?? point.masterId}` : '接收器';
  return (
    <View style={[StyleSheet.absoluteFill, styles.root]} testID="device-details">
      <Pressable
        testID="device-details-backdrop"
        accessibilityRole="button"
        accessibilityLabel={`關閉${title}`}
        onPress={onClose}
        style={[StyleSheet.absoluteFill, !sheet && styles.backdrop]}
      />
      <View
        style={sheet ? [styles.panel, styles.sheet, { bottom: bottomInset, maxHeight: maxSheet(topInset, bottomInset) }]
          : [styles.panel, { top: topInset, bottom: bottomInset }]}
        onLayout={sheet ? event => onPanelHeight?.(event.nativeEvent.layout.height) : undefined}
      >
        {sheet && <View style={styles.handleArea}><View style={styles.handle} /></View>}
        {/* The title and the close button stay put: scrolling the content away
            from its own close button is how a panel traps someone. */}
        <View style={[styles.heading, sheet && styles.headingSheet]}>
          <View style={styles.titleLine}>
            <Text style={styles.title} numberOfLines={1}>{title}</Text>
            {chip && <StatusChip {...chip} />}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`關閉${title}面板`}
            onPress={onClose}
            style={[styles.close, sheet && styles.closeRound]}
          >
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
        </View>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          {track ? (
            <>
              <Text style={styles.hint}>{track.sourceLabel}</Text>
              <Text style={styles.hint}>
                該時刻位置：{formatTime(track.latest?.time)}
              </Text>
              <View style={styles.stats}>
                <Stat icon="speed" label="速度" value={track.latest?.speed_kmh == null
                  ? '未知' : `${track.latest.speed_kmh.toFixed(1)} km/h`} />
                <Stat icon="clock" label="這段區間" value={`${track.count ?? 0} 筆`} />
              </View>
              <Text style={styles.hint}>
                歷史只讀這支手機存下來的資料；硬體回報與 LoRa 訊號只有即時連線那一對才有。
              </Text>
            </>
          ) : dog ? (
            <DogDetails
              key={dog.slaveId}
              dog={dog}
              live={live}
              point={point}
              now={now}
              phone={phone}
              mapHeading={mapHeading}
              alias={alias}
              mastersSeen={mastersSeen}
              followed={followed}
              hidden={hidden}
              onFollow={onFollow}
              onTodayPath={onTodayPath}
              todayPathBusy={todayPathBusy}
              onRename={onRename}
              onToggleHidden={onToggleHidden}
              chart={(
                <ActivityHistoryChart key={`${activityOwner}-${dog.slaveId}`}
                  database={tracking.cloudDatabase} owner={activityOwner}
                  slaveId={dog.slaveId} dogAliases={dogAliases}
                  active={activityActive && tracking.foreground && tracking.ready?.real} />
              )}
            />
          ) : (
            <ReceiverDetails point={point} position={master} state={receiverState} now={now} other={receiverId?.other}
              preferences={tracking.preferences} onPreferences={onPreferences}
              onOpenSettings={onOpenReceiver} />
          )}
        </ScrollView>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  hideButton: {
    marginTop: 12, minHeight: 48, borderRadius: 999, borderWidth: 1, borderColor: '#EDE6E4',
    alignItems: 'center', justifyContent: 'center',
  },
  hideText: { color: '#222222', fontSize: 16, fontWeight: '700' },
  root: {
    zIndex: 30,
    // Raise the whole modal root above the tracking sheet for Android touches.
    elevation: floatingShadow.elevation + 1,
  },
  backdrop: { backgroundColor: '#00000020' },
  panel: {
    position: 'absolute',
    right: 14,
    left: 14,
    maxHeight: 420,
    borderRadius: 22,
    backgroundColor: colors.surface,
    ...floatingShadow,
  },
  scroll: { flexShrink: 1 },
  content: { paddingHorizontal: 18, paddingBottom: 18 },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 18,
    paddingRight: 8,
    paddingTop: 14,
    paddingBottom: 6,
  },
  close: {
    minWidth: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headingSheet: { paddingTop: 0 },
  closeRound: { borderRadius: 24, backgroundColor: tokens.bg },
  closeText: { fontSize: 18, color: tokens.text, fontWeight: '700' },
  sheet: { left: 12, right: 12, borderRadius: 24 },
  handleArea: { height: 22, alignItems: 'center', justifyContent: 'center' },
  handle: { width: 40, height: 5, borderRadius: 3, backgroundColor: '#D8CFCC' },
  titleLine: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.s, minWidth: 0 },
  chip: { borderRadius: 999, paddingHorizontal: space.s, paddingVertical: 2 },
  chip_ok: { backgroundColor: tokens.okBg },
  chip_warn: { backgroundColor: tokens.warnBg },
  chip_muted: { backgroundColor: tokens.bg },
  chip_crit: { backgroundColor: tokens.critBg },
  chipText: { ...type.caption, fontWeight: '700' },
  chipText_ok: { color: tokens.ok },
  chipText_warn: { color: tokens.warn },
  chipText_muted: { color: tokens.textMuted },
  chipText_crit: { color: tokens.crit },
  title: { fontSize: 18, color: colors.ink, fontWeight: '700' },
  label: { fontSize: 14, color: colors.ink, fontWeight: '600', marginTop: 10 },
  hint: { fontSize: 12, lineHeight: 19, color: colors.muted, marginTop: 8 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  warning: { fontSize: 12, lineHeight: 19, color: colors.danger, marginTop: 8 },
  divider: { height: 1, backgroundColor: '#E6E6E6', marginVertical: 12 },
});
