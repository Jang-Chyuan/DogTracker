import React, { useEffect } from 'react';
import {
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { floatingShadow, mapColors as colors } from './MapTheme';
import { heldSentence } from './DogMerge';
import { formatTime } from './MapFormat';
import Stat from './Stat';
import ActivityHistoryChart from './ActivityHistoryChart';

/**
 * The panel of a history track's marker (the phone's or a dog's position at
 * the replayed moment). On the live map a dog answers with its card (DogCard)
 * and the receiver is not drawn at all (v3), so this panel is history only.
 */
export default function DeviceDetails({
  tracking,
  subject,
  dogAliases,
  activityOwner,
  activityActive = true,
  topInset,
  bottomInset,
  onClose,
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
  const track = subject?.kind === 'track' ? subject.track : null;
  const slaveId = track?.role === 'slave' ? track.slaveId : null;
  const alias = slaveId != null ? dogAliases?.[slaveId]?.trim() : null;
  const title = alias ? `${alias}(id_${slaveId})` : track?.name ?? '';
  return (
    <View style={[StyleSheet.absoluteFill, styles.root]} testID="device-details">
      <Pressable
        testID="device-details-backdrop"
        accessibilityRole="button"
        accessibilityLabel={`關閉${title}`}
        onPress={onClose}
        style={[StyleSheet.absoluteFill, styles.backdrop]}
      />
      <View style={[styles.panel, { top: topInset, bottom: bottomInset }]}>
        {/* The title and the close button stay put: scrolling the content away
            from its own close button is how a panel traps someone. */}
        <View style={styles.heading}>
          <Text style={styles.title}>{title}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`關閉${title}面板`}
            onPress={onClose}
            style={styles.close}
          >
            <Text style={styles.title}>×</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          {track ? (
            <>
              <Text style={styles.hint}>{track.sourceLabel}</Text>
              {!!track.latest?.heldReason && <Text style={styles.label}>
                {heldSentence(track.latest, formatTime)}
              </Text>}
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
          ) : null}
          {Number.isInteger(slaveId) && slaveId >= 1 && slaveId <= 255 && (
            <ActivityHistoryChart database={tracking.cloudDatabase} owner={activityOwner}
              dogAliases={dogAliases} slaveId={slaveId} key={slaveId}
              active={activityActive && tracking.foreground && tracking.ready?.real} />
          )}
        </ScrollView>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
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
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 18, color: colors.ink, fontWeight: '700' },
  label: { fontSize: 14, color: colors.ink, fontWeight: '600', marginTop: 10 },
  hint: { fontSize: 12, lineHeight: 19, color: colors.muted, marginTop: 8 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  warning: { fontSize: 12, lineHeight: 19, color: colors.danger, marginTop: 8 },
  divider: { height: 1, backgroundColor: '#E6E6E6', marginVertical: 12 },
});
