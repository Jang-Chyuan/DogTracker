import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, shadow, space, touch, type } from '../theme/tokens';
import { describeCloud, describeReceiver } from './HomeStatus';
import { useReceiverState } from './useReceiverState';

const TONES = {
  ok: { dot: colors.ok, background: colors.surface, border: colors.line, text: colors.text },
  idle: { dot: colors.textMuted, background: colors.surface, border: colors.line, text: colors.text },
  warn: { dot: colors.warn, background: colors.warnBg, border: '#EBCB8B', text: colors.warn },
  crit: { dot: colors.critLine, background: colors.critBg, border: '#F4CFC9', text: colors.crit },
};

function Pill({ status, onPress, testID }) {
  const tone = TONES[status.tone] ?? TONES.idle;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={status.label.replace('｜', '，')}
      style={({ pressed }) => [
        styles.pill,
        { backgroundColor: tone.background, borderColor: tone.border },
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.dot, { backgroundColor: tone.dot }]} />
      <Text style={[styles.pillText, { color: tone.text }]}>
        {status.label}
      </Text>
    </Pressable>
  );
}

/**
 * The top of the home map: a problem card when the receiver needs attention,
 * then a pill for each thing worth knowing. When everything works it draws
 * nothing. Problems do not animate in; they are simply there.
 */
export function HomeStatusBar({ top, receiver, cloud, onReceiver, onCloud, onLayout }) {
  if (!receiver.show && !cloud.show) return null;
  return (
    <View style={[styles.root, { top }]} pointerEvents="box-none" onLayout={onLayout}>
      {receiver.alert && (
        <View style={styles.alert} accessibilityRole="alert" testID="home-alert">
          <View style={styles.alertText}>
            {/* Only the title is a live region, and the ⚠ is not read out. */}
            <Text style={styles.alertTitle} accessibilityLiveRegion="assertive"
              accessibilityLabel={receiver.alert.title}>
              <Text style={styles.alertIcon}>⚠ </Text>
              {receiver.alert.title}
            </Text>
            <Text style={styles.alertDetail}>{receiver.alert.detail}</Text>
          </View>
          <Pressable
            onPress={onReceiver}
            accessibilityRole="button"
            accessibilityLabel="開啟接收器設定"
            style={({ pressed }) => [styles.alertButton, pressed && styles.pressed]}
          >
            <Text style={styles.alertButtonText}>接收器設定</Text>
          </Pressable>
        </View>
      )}
      <View style={styles.pills} pointerEvents="box-none">
        {receiver.show && !receiver.alert && (
          <Pill testID="home-receiver-pill" status={receiver} onPress={onReceiver} />
        )}
        {cloud.show && <Pill testID="home-cloud-pill" status={cloud} onPress={onCloud} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', zIndex: 20, left: space.m, right: space.m, gap: space.s },
  pills: { alignItems: 'flex-start', gap: space.s },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s,
    minHeight: touch.min,
    paddingHorizontal: space.m,
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: '100%',
    ...shadow.floating,
  },
  pressed: { transform: [{ scale: 0.97 }] },
  dot: { width: 9, height: 9, borderRadius: 5 },
  pillText: { ...type.status, flexShrink: 1 },
  alert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    padding: space.m,
    paddingLeft: space.m,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#F4CFC9',
    borderLeftWidth: 4,
    borderLeftColor: colors.critLine,
    backgroundColor: colors.critBg,
    ...shadow.floating,
  },
  alertText: { flex: 1 },
  alertTitle: { ...type.status, color: colors.crit },
  alertIcon: { color: colors.critLine },
  alertDetail: { ...type.status, fontWeight: '400', color: colors.crit },
  alertButton: {
    minHeight: touch.primary,
    paddingHorizontal: space.l,
    borderRadius: 999,
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: '#F4CFC9',
  },
  alertButtonText: { ...type.status, color: '#B3261E' },
});

// Re-renders when the receiver poll (every 2 s) or the sync state changes;
// nothing on screen counts seconds, so no clock of its own is needed.
// `state` lets the map share one receiver poll with the card and the panel;
// without it this component polls on its own.
export default function HomeStatus({ active, cloudSync, top, onReceiver, onCloud, onHeight, readState, state }) {
  const polled = useReceiverState(active && state === undefined, readState);
  const receiverState = state === undefined ? polled : state;
  const now = Date.now();
  const receiver = describeReceiver(receiverState, now);
  const cloud = describeCloud(cloudSync, now);
  const visible = receiver.show || cloud.show;
  // With nothing to show the map gets its space back.
  useEffect(() => {
    if (!visible) onHeight?.(0);
  }, [visible, onHeight]);
  return (
    <HomeStatusBar
      top={top}
      receiver={receiver}
      cloud={cloud}
      onReceiver={onReceiver}
      onCloud={onCloud}
      onLayout={event => onHeight?.(event.nativeEvent.layout.height)}
    />
  );
}
