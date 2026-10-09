// The live map's floating controls (design v3 A1, DESIGN.md §15「浮動按鈕與上方
// 卡片」): the two 48dp round buttons bottom right (框住全部 above 我的位置),
// the off-screen dog hints (EdgeHints) and the bottom tip that says why a grey
// button did nothing. Provider-neutral views: the renderer decides what they do.
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import Glyph from './Glyph';
import DogAvatar from '../dogs/DogAvatar';
import { colors, layout, motion, radius, shadow, size as sizes, type } from '../theme/tokens';

const ease = Easing.bezier(...motion.easeOut);

/** A pressable that shrinks to 0.97 for 120 ms while pressed (motion.press). */
export function PressScale({ style, children, onPress, ...rest }) {
  const scale = useRef(new Animated.Value(1)).current;
  const to = value => Animated.timing(scale, { toValue: value, duration: motion.press.duration, easing: ease,
    useNativeDriver: true }).start();
  return (
    <Pressable onPress={onPress} onPressIn={() => to(motion.press.scale)} onPressOut={() => to(1)} {...rest}>
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

/**
 * 框住全部 and 我的位置: right 16dp, `bottom` above the card (or the screen
 * bottom), 12dp apart. 我的位置 turns iconMuted without a phone fix; it can
 * still be pressed, and says why (onMyLocation decides).
 */
export function MapButtons({ bottom, phoneAvailable, onFrameAll, onMyLocation }) {
  return (
    <View style={[styles.buttons, { bottom }]} pointerEvents="box-none">
      <PressScale testID="map-frame-all" accessibilityRole="button" accessibilityLabel="框住全部"
        accessibilityHint="把所有狗和手機放進畫面" onPress={onFrameAll} style={styles.round}>
        <Glyph name="frame" color={colors.text} size={sizes.icon.map} />
      </PressScale>
      <PressScale testID="map-my-location" accessibilityRole="button" accessibilityLabel="我的位置"
        accessibilityHint={phoneAvailable ? '把地圖移到手機的位置' : '手機沒有定位'}
        onPress={onMyLocation} style={styles.round}>
        <Glyph name="locate" color={phoneAvailable ? colors.phone : colors.iconMuted} size={sizes.icon.map} />
      </PressScale>
    </View>
  );
}

const hint = sizes.edgeHint;
const ARROW = { left: '‹', right: '›', top: '‹', bottom: '‹' };
const ARROW_TURN = { left: '0deg', right: '0deg', top: '90deg', bottom: '-90deg' };

function HintFace({ marker, avatar, first }) {
  const face = <DogAvatar avatar={avatar} size={hint.avatar} stale={marker.stale} border={1.5} />;
  return (
    <View style={[styles.hintFace, !first && { marginLeft: -hint.overlap }]}
      testID={marker.problem ? 'edge-hint-face-problem' : 'edge-hint-face'}>
      {marker.problem ? <View style={styles.problemRing}>{face}</View> : face}
    </View>
  );
}

/** One off-screen hint: faces, 「+N」 and the arrow pointing out of the screen. */
export function EdgeHintView({ value, avatars = {}, onPress }) {
  const arrow = (
    <Text style={[styles.arrow, { transform: [{ rotate: ARROW_TURN[value.side] }] }]}
      allowFontScaling={false}>{ARROW[value.side]}</Text>
  );
  return (
    <Pressable testID={`edge-hint-${value.side}`} accessibilityRole="button" accessibilityLabel={value.label}
      onPress={onPress} hitSlop={(sizes.floatingButton - hint.height) / 2}
      style={[styles.hint, { left: value.x, top: value.y, width: value.width }]}>
      {value.side !== 'right' && arrow}
      <View style={styles.faces}>
        {value.faces.map((marker, index) => (
          <HintFace key={marker.slaveId} marker={marker} avatar={avatars[marker.slaveId]} first={index === 0} />
        ))}
      </View>
      {value.extra > 0 && <Text style={styles.extra} allowFontScaling={false}>+{value.extra}</Text>}
      {value.side === 'right' && arrow}
    </Pressable>
  );
}

/**
 * The bottom tip (下方提示): 48dp high, 16dp from the sides, white with a 1dp
 * line, for 5 seconds. `message` { text, key }: a new key shows it again.
 */
export function MapTip({ message, bottom, onDone }) {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!message) return undefined;
    opacity.setValue(0);
    Animated.timing(opacity, { toValue: 1, duration: motion.cardRise.duration, easing: ease,
      useNativeDriver: true }).start();
    const timer = setTimeout(() => onDone?.(), motion.snackbarVisibleMs);
    return () => clearTimeout(timer);
  }, [message, opacity, onDone]);
  if (!message) return null;
  return (
    <Animated.View testID="map-tip" accessibilityLiveRegion="polite" pointerEvents="none"
      style={[styles.tip, { bottom, opacity }]}>
      <Text style={styles.tipText} numberOfLines={1}>{message.text}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  buttons: { position: 'absolute', right: layout.screenEdge, gap: layout.floatingGap, alignItems: 'flex-end' },
  round: {
    width: sizes.floatingButton, height: sizes.floatingButton, borderRadius: radius.button,
    backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadow.floating,
  },
  hint: {
    position: 'absolute', height: hint.height, borderRadius: radius.full, backgroundColor: colors.surface,
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, gap: 4, ...shadow.floating,
  },
  faces: { flexDirection: 'row', alignItems: 'center' },
  hintFace: { width: hint.avatar, height: hint.avatar, borderRadius: hint.avatar / 2 },
  problemRing: {
    margin: -hint.problemBorder, borderRadius: hint.avatar / 2 + hint.problemBorder,
    borderWidth: hint.problemBorder, borderColor: colors.problemBadge,
  },
  arrow: { ...type.value, width: 10, textAlign: 'center', color: colors.text },
  extra: { ...type.value, color: colors.text },
  tip: {
    position: 'absolute', left: layout.screenEdge, right: layout.screenEdge, minHeight: 48,
    borderRadius: radius.snackbar, backgroundColor: colors.snackbar, borderWidth: 1, borderColor: colors.line,
    justifyContent: 'center', paddingHorizontal: layout.screenEdge, ...shadow.floating,
  },
  tipText: { ...type.body, color: colors.text },
});
