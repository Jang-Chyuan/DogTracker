import React, { useEffect, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, shadow, space, touch, type } from '../theme/tokens';

const WIDTH = 260;
const ARROW = 14;

/**
 * The small window that opens next to a tapped dog: what the handler can do
 * with this dog, without covering the map. Its arrow points at the row or
 * avatar that opened it. Closed by ✕, by the back button, by tapping the map,
 * or replaced by tapping another dog.
 */
export default function DogPopover({ name, statusLine, anchorY, followed, followable, onFollow, onDetails, onClose }) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [boxHeight, setBoxHeight] = useState(150);
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [onClose]);
  // Sit just above the tapped row with the arrow pointing down at it; if a
  // row near the top leaves no room, sit below it with the arrow pointing up.
  const above = anchorY - insets.top - space.s >= boxHeight + ARROW;
  const position = above
    ? { bottom: Math.max(space.l, height - anchorY + ARROW + space.xs) }
    : { top: Math.min(anchorY + ARROW + space.xs, height - boxHeight - insets.bottom - space.s) };
  return (
    <View
      style={[styles.popover, position]}
      accessibilityViewIsModal
      onLayout={event => setBoxHeight(event.nativeEvent.layout.height)}
      testID="dog-popover"
    >
      <View style={styles.head}>
        <View style={styles.headText}>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          <Text style={styles.status}>{statusLine}</Text>
        </View>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={`關閉${name}的選項`}
          style={({ pressed }) => [styles.close, pressed && styles.pressed]}>
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
      </View>
      <View style={styles.actions}>
        <Pressable
          onPress={onFollow}
          disabled={!followed && !followable}
          accessibilityRole="button"
          accessibilityLabel={followed ? `停止跟隨${name}` : `跟隨${name}`}
          accessibilityState={{ disabled: !followed && !followable }}
          accessibilityHint={!followed && !followable ? '這隻狗沒有目前的定位，無法跟隨' : undefined}
          style={({ pressed }) => [styles.button, !followed && !followable && styles.disabled, pressed && styles.pressed]}
        >
          <Text style={styles.buttonText}>{followed ? '停止跟隨' : '跟隨'}</Text>
        </Pressable>
        <Pressable
          onPress={onDetails}
          accessibilityRole="button"
          accessibilityLabel={`${name}的詳細資料`}
          style={({ pressed }) => [styles.button, styles.primary, pressed && styles.pressed]}
        >
          <Text style={[styles.buttonText, styles.primaryText]}>詳細 ›</Text>
        </Pressable>
      </View>
      <View style={[styles.arrow, above ? styles.arrowDown : styles.arrowUp]} />
    </View>
  );
}

const styles = StyleSheet.create({
  popover: {
    position: 'absolute', zIndex: 40, left: space.l, width: WIDTH,
    backgroundColor: colors.surface, borderRadius: 18, padding: space.m,
    ...shadow.floating, elevation: 12,
  },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: space.s },
  headText: { flex: 1 },
  name: { ...type.title, color: colors.text },
  status: { ...type.caption, color: colors.textMuted, marginBottom: space.s },
  close: { width: touch.min, height: touch.min, borderRadius: touch.min / 2, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  closeText: { fontSize: 16, fontWeight: '700', color: colors.text },
  actions: { flexDirection: 'row', gap: space.s },
  button: {
    flex: 1, minHeight: touch.min, borderRadius: 999, borderWidth: 1, borderColor: colors.line,
    alignItems: 'center', justifyContent: 'center',
  },
  primary: { backgroundColor: colors.tonal, borderColor: colors.tonal },
  buttonText: { ...type.status, color: colors.text },
  primaryText: { color: colors.tonalText },
  disabled: { opacity: 0.4 },
  pressed: { transform: [{ scale: 0.97 }] },
  arrow: {
    position: 'absolute', left: 28, width: ARROW, height: ARROW,
    backgroundColor: colors.surface, transform: [{ rotate: '45deg' }],
  },
  arrowDown: { bottom: -ARROW / 2 },
  arrowUp: { top: -ARROW / 2 },
});
