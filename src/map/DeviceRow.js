import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { mapColors as colors } from './MapTheme';
import { formatTime } from './MapFormat';
import Glyph from './Glyph';
import TrackingAvatar from './TrackingAvatar';
import VisibilityButton from './VisibilityButton';

/**
 * One device in the card: a dog or the handler, drawn and operated the same
 * way. Tapping the row takes the map to it; the ⓘ button opens the panel with
 * what the row has no space for; the eye keeps it off the map.
 *
 * The row used to mean "follow this dog", which made the camera chase one
 * animal until the row was tapped again — a mode to remember on a screen
 * that is read at a glance. A tap now just goes there.
 */
export default function DeviceRow({
  role,
  title,
  sourceIcon,
  sourceText,
  receivedAt,
  hidden,
  disabled,
  subject,
  eyeSubject = subject,
  warning,
  onZoom,
  onDetails,
  onToggle,
  children,
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint="地圖移到這個位置並放大"
      accessibilityState={{ disabled: disabled || !onZoom }}
      disabled={disabled || !onZoom}
      onPress={onZoom}
      style={[styles.row, hidden && styles.hidden, disabled && styles.disabled]}
    >
      <TrackingAvatar role={role} size={36} />
      <View style={styles.text}>
        <Text style={styles.name}>{title}</Text>
        {/* Every row reads the same whatever answered it: where it came from
            as an icon, then the same readings. */}
        <View style={styles.sourceRow}>
          {!!sourceIcon && <Glyph name={sourceIcon} color={colors.muted} size={15} />}
          {!!sourceText && <Text style={styles.detail}>{sourceText}</Text>}
          <Glyph name="clock" color={colors.muted} size={14} />
          <Text style={styles.detail}>{formatTime(receivedAt)}</Text>
        </View>
        <View style={styles.stats}>{children}</View>
        {!!warning && <Text style={styles.warning}>{warning}</Text>}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${subject}詳細資料`}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onDetails}
        style={[styles.icon, disabled && styles.disabled]}
      >
        <Glyph name="info" color={colors.muted} size={22} />
      </Pressable>
      <VisibilityButton
        role={role}
        size="small"
        subject={eyeSubject}
        visible={!hidden}
        disabled={disabled}
        onPress={onToggle}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    padding: 8,
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: '#F3F6F4',
  },
  hidden: { opacity: 0.6 },
  disabled: { opacity: 0.45 },
  text: { flex: 1 },
  name: { color: colors.ink, fontSize: 14, fontWeight: '600' },
  detail: { color: colors.muted, fontSize: 12 },
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4, flexWrap: 'wrap' },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  warning: { color: colors.danger, fontSize: 12, lineHeight: 18, marginTop: 3 },
  // The same 44 pt target as the eye beside it.
  icon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F0F3F1',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
});
