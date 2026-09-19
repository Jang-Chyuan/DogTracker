import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { mapColors as colors } from '../map/MapTheme';
import { cursorFraction, SPEEDS, speedLabel } from './HistoryPlayback';

const clock = value => new Date(value).toLocaleTimeString('zh-TW', {
  hour12: false, hour: '2-digit', minute: '2-digit',
});
const stamp = value => new Date(value).toLocaleString('zh-TW', { hour12: false });

/**
 * A transport bar, the way media players are laid out: one round play/pause
 * button, a scrubber between the start and end of what was recorded, and the
 * moment being drawn under it. Speed sits below, out of the way of the two
 * controls people actually reach for.
 */
export default function HistoryPlaybackControls({ playback }) {
  const width = useRef(0);
  const [dragging, setDragging] = useState(false);
  const { window, at, playing } = playback;
  const active = Number.isFinite(at);
  const fraction = active ? cursorFraction(at, window) : 1;
  const seekTo = x => {
    if (!width.current) return;
    playback.seek(x / width.current);
  };
  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>回放</Text>
        {active && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="結束回放，顯示整段"
            onPress={playback.stop}
            style={styles.reset}
          >
            <Text style={styles.resetText}>顯示整段</Text>
          </Pressable>
        )}
      </View>
      {!window ? (
        <Text style={styles.hint}>這段區間沒有可以回放的定位。</Text>
      ) : (
        <>
          <View style={styles.transport}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={playing ? '暫停回放' : '播放這段區間'}
              onPress={playback.toggle}
              style={({ pressed }) => [styles.play, pressed && styles.pressed]}
            >
              {playing ? (
                <View style={styles.pauseIcon}>
                  <View style={styles.pauseBar} />
                  <View style={styles.pauseBar} />
                </View>
              ) : (
                <View style={styles.playIcon} />
              )}
            </Pressable>
            <View style={styles.trackColumn}>
              <View
                accessibilityRole="adjustable"
                accessibilityLabel="回放進度"
                accessibilityValue={{ min: 0, max: 100, now: Math.round(fraction * 100) }}
                accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
                onAccessibilityAction={event => playback.seek(
                  fraction + (event.nativeEvent.actionName === 'increment' ? 0.05 : -0.05))}
                onLayout={event => { width.current = event.nativeEvent.layout.width; }}
                onStartShouldSetResponder={() => true}
                // Only horizontal drags belong to the scrubber; a vertical one
                // is the card being scrolled or dragged.
                onMoveShouldSetResponder={(_, gesture) =>
                  Math.abs(gesture?.dx ?? 0) > Math.abs(gesture?.dy ?? 0)}
                onResponderGrant={event => {
                  setDragging(true);
                  seekTo(event.nativeEvent.locationX);
                }}
                onResponderMove={event => seekTo(event.nativeEvent.locationX)}
                onResponderRelease={() => setDragging(false)}
                onResponderTerminate={() => setDragging(false)}
                style={styles.track}
                testID="playback-track"
              >
                {/* The bar measures the touch against itself. Without this the
                    knob or the fill becomes the touch target mid-drag and
                    locationX restarts from that child's own left edge, which
                    made the cursor jump back and then forward again. */}
                <View pointerEvents="none" style={styles.rail} />
                <View pointerEvents="none"
                  style={[styles.fill, { width: `${fraction * 100}%` }]} />
                <View pointerEvents="none"
                  style={[styles.knob, { left: `${fraction * 100}%` },
                    dragging && styles.knobHeld]} />
              </View>
              <View style={styles.timeRow}>
                <Text style={styles.time}>{clock(window.since)}</Text>
                <Text style={styles.time}>{clock(window.until)}</Text>
              </View>
            </View>
          </View>
          <Text style={styles.now}>
            {active ? stamp(at) : `完整區間 ${clock(window.since)}–${clock(window.until)}`}
          </Text>
          <View style={styles.speedRow}>
            <Text style={styles.speedLabel}>速度</Text>
            {SPEEDS.map(value => (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityLabel={speedLabel(value)}
                accessibilityState={{ selected: playback.speed === value }}
                onPress={() => playback.setSpeed(value)}
                style={[styles.speed, playback.speed === value && styles.speedSelected]}
              >
                <Text style={[styles.speedText,
                  playback.speed === value && styles.speedTextSelected]}>
                  {speedLabel(value)}
                </Text>
              </Pressable>
            ))}
          </View>
        </>
      )}
    </View>
  );
}

const KNOB = 18;
const styles = StyleSheet.create({
  card: {
    marginTop: 14,
    padding: 12,
    borderRadius: 14,
    backgroundColor: '#F3F6F4',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  title: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  reset: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 10 },
  resetText: { color: colors.master, fontSize: 13, fontWeight: '700' },
  transport: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  play: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.dog,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.8 },
  // Triangle and bars instead of glyphs: the app ships no icon font, and ▶ in
  // a Text lands differently on every device.
  playIcon: {
    marginLeft: 4,
    width: 0,
    height: 0,
    borderTopWidth: 11,
    borderBottomWidth: 11,
    borderLeftWidth: 18,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: '#FFFFFF',
  },
  pauseIcon: { flexDirection: 'row', gap: 5 },
  pauseBar: { width: 5, height: 20, borderRadius: 2, backgroundColor: '#FFFFFF' },
  trackColumn: { flex: 1 },
  track: { height: 36, justifyContent: 'center' },
  rail: { height: 6, borderRadius: 3, backgroundColor: '#D8E2DB' },
  fill: {
    position: 'absolute',
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.master,
  },
  knob: {
    position: 'absolute',
    width: KNOB,
    height: KNOB,
    marginLeft: -KNOB / 2,
    borderRadius: KNOB / 2,
    backgroundColor: '#FFFFFF',
    borderWidth: 3,
    borderColor: colors.master,
  },
  knobHeld: { transform: [{ scale: 1.25 }] },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  time: { color: colors.muted, fontSize: 11 },
  now: { color: colors.ink, fontSize: 13, fontWeight: '600', marginTop: 8 },
  speedRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  speedLabel: { color: colors.muted, fontSize: 12, marginRight: 2 },
  speed: {
    minHeight: 36,
    paddingHorizontal: 10,
    justifyContent: 'center',
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
  },
  speedSelected: { backgroundColor: colors.master },
  speedText: { color: colors.ink, fontSize: 12, fontWeight: '600' },
  speedTextSelected: { color: '#FFFFFF' },
});
