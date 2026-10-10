import { t } from '../i18n';
// The live map's floating controls (design v3 A1, DESIGN.md §15「浮動按鈕與上方
// 卡片」): the two 48dp round buttons bottom right (框住全部 above 我的位置),
// the off-screen dog hints (EdgeHints) and the bottom tip that says why a grey
// button did nothing. Provider-neutral views: the renderer decides what they do.
import { useTheme, useStyles, makeStyles } from '../theme/ThemeProvider';
import { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Glyph from './Glyph';
import { useReduceMotion, moveDuration } from '../utils/reduceMotion';
import { linesFor } from '../utils/textScale';
import DogAvatar from '../dogs/DogAvatar';
import {
  layout,
  motion,
  radius,
  size as sizes,
  tabularNumbers,
  type,
  border,
  space,
  touch,
} from '../theme/tokens';

const ease = Easing.bezier(...motion.easeOut);
const visibleOverflow = StyleSheet.create({ visible: { overflow: 'visible' } }).visible;

/**
 * Every button's press (DESIGN.md §5.8, 設計稿「元件狀態」): it shrinks to 0.97
 * for 120 ms (motion.press) with pressedOverlay laid over it. Under 減少動態效果
 * only the overlay shows (no shrinking).
 */
export function PressScale({ style, children, onPress, overlay = true, ...rest }) {
  const { colors } = useTheme();
  const reduced = useReduceMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const to = value =>
    reduced
      ? scale.setValue(1)
      : Animated.timing(scale, {
          toValue: value,
          duration: motion.press.duration,
          easing: ease,
          useNativeDriver: true,
        }).start();
  const corner = StyleSheet.flatten(style)?.borderRadius ?? 0;
  return (
    <Pressable
      style={visibleOverflow}
      onPress={onPress}
      onPressIn={() => to(motion.press.scale)}
      onPressOut={() => to(1)}
      {...rest}
    >
      {({ pressed }) => (
        <Animated.View
          collapsable={false}
          style={[style, visibleOverflow, { transform: [{ scale }] }]}
        >
          {children}
          {overlay && pressed && (
            <View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFill,
                { borderRadius: corner, backgroundColor: colors.pressedOverlay },
              ]}
            />
          )}
        </Animated.View>
      )}
    </Pressable>
  );
}

/**
 * 框住全部 and 我的位置: right 16dp, `bottom` above the card (or the screen
 * bottom), 12dp apart. 我的位置 turns iconMuted without a phone fix; it can
 * still be pressed, and says why (onMyLocation decides). 「今天 x km」
 * (`today`, from TodayDistance.todayPill) sits left of 我的位置, 12dp apart.
 */
export function MapButtons({
  bottom,
  phoneAvailable,
  onFrameAll,
  onMyLocation,
  today = null,
  onToday,
}) {
  const { colors } = useTheme();
  const styles = useStyles(getStyles);
  // They ride up and down with the card (220 ms, motion.cardRise) instead of
  // jumping ahead of it.
  const lift = useRef(new Animated.Value(bottom)).current;
  useEffect(() => {
    const move = Animated.timing(lift, {
      toValue: bottom,
      // 減少動態效果: straight to the new place.
      duration: moveDuration(motion.cardRise.duration),
      easing: ease,
      useNativeDriver: false,
    });
    move.start();
    return () => move.stop();
  }, [lift, bottom]);
  return (
    <Animated.View
      style={[styles.buttons, { bottom: lift }]}
      pointerEvents="box-none"
    >
      <PressScale
        testID="map-frame-all"
        accessibilityRole="button"
        accessibilityLabel={t("c758")}
        accessibilityHint={t("c756")}
        onPress={onFrameAll}
        style={styles.round}
      >
        <Glyph name="frame" color={colors.text} size={sizes.icon.map} />
      </PressScale>
      <View style={styles.row} pointerEvents="box-none">
        {today && <TodayPill value={today} onPress={onToday} />}
        <PressScale
          testID="map-my-location"
          accessibilityRole="button"
          accessibilityLabel={t("c759")}
          accessibilityHint={
            phoneAvailable ? t("c757") : t("c726")
          }
          onPress={onMyLocation}
          style={styles.round}
        >
          <Glyph
            name="locate"
            color={phoneAvailable ? colors.phone : colors.iconMuted}
            size={sizes.icon.map}
          />
        </PressScale>
      </View>
    </Animated.View>
  );
}

/**
 * 「今天 x km」 (A1/A2): 48dp high, 16dp sides, fully round; a 20dp walking
 * person (phone colour; iconMuted when recording is off; iconMuted with a
 * slash when the phone has no location) and 16sp bold tabular figures.
 * Opens my route (history).
 */
export function TodayPill({ value, onPress }) {
  const { colors } = useTheme();
  const styles = useStyles(getStyles);
  const iconColor = value.icon === 'walk' ? colors.phone : colors.iconMuted;
  return (
    <PressScale
      testID="map-today"
      accessibilityRole="button"
      accessibilityLabel={value.label}
      accessibilityHint={t("c760")}
      onPress={onPress}
      style={styles.pill}
    >
      <View testID={`map-today-icon-${value.icon}`}>
        <Glyph
          name={value.icon === 'walk-off' ? 'walk-off' : 'walk'}
          color={iconColor}
          size={sizes.icon.walk}
        />
      </View>
      <Text
        style={[styles.pillText, value.muted && styles.pillMuted]}
        numberOfLines={1}
      >
        {value.text}
      </Text>
    </PressScale>
  );
}

/**
 * The settings gear (A1 top right): 48dp round, fixed 8dp under the status
 * bar and 16dp from the right; it does not move with the card. `alert` lights
 * the red dot (049 decides when).
 */
export function SettingsGear({
  top,
  alert = false,
  alertLabel = null,
  onPress,
}) {
  const { colors } = useTheme();
  const styles = useStyles(getStyles);
  return (
    <View style={[styles.gear, { top }]} pointerEvents="box-none">
      <PressScale
        testID="map-settings"
        accessibilityRole="button"
        accessibilityLabel={alert && alertLabel ? alertLabel : t("c482")}
        onPress={onPress}
        style={styles.round}
      >
        <Glyph name="gear" color={colors.text} size={sizes.icon.map} />
        {alert && <View testID="map-settings-dot" style={styles.gearDot} />}
      </PressScale>
    </View>
  );
}

/**
 * The compass (指南針): only while the map is turned; 48dp round, 16dp from
 * the right, at `top` (12dp under the gear, or under the top cards). The
 * needle points to north; a tap turns the map back to north.
 */
export function CompassButton({ top, heading, onPress }) {
  const { colors } = useTheme();
  const styles = useStyles(getStyles);
  return (
    <View style={[styles.gear, { top }]} pointerEvents="box-none">
      <PressScale
        testID="map-compass"
        accessibilityRole="button"
        accessibilityLabel={t("c755")}
        onPress={onPress}
        style={styles.round}
      >
        <View style={{ transform: [{ rotate: `${-heading}deg` }] }}>
          <Glyph
            name="compass"
            color={colors.iconMuted}
            size={sizes.icon.map}
          />
        </View>
      </PressScale>
    </View>
  );
}

const hint = sizes.edgeHint;
const ARROW = { left: '‹', right: '›', top: '‹', bottom: '‹' };
const ARROW_TURN = {
  left: '0deg',
  right: '0deg',
  top: '90deg',
  bottom: '-90deg',
};

function HintFace({ marker, avatar, first }) {
  const styles = useStyles(getStyles);
  const face = (
    <DogAvatar
      avatar={avatar}
      size={hint.avatar}
      stale={marker.stale}
      border={border.regular}
    />
  );
  return (
    <View
      style={[styles.hintFace, !first && { marginLeft: -hint.overlap }]}
      testID={marker.problem ? 'edge-hint-face-problem' : 'edge-hint-face'}
    >
      {marker.problem ? <View style={styles.problemRing}>{face}</View> : face}
    </View>
  );
}

/** One off-screen hint: faces, 「+N」 and the arrow pointing out of the screen. */
export function EdgeHintView({ value, avatars = {}, onPress }) {
  const styles = useStyles(getStyles);
  const arrow = (
    <Text
      style={[
        styles.arrow,
        { transform: [{ rotate: ARROW_TURN[value.side] }] },
      ]}
      allowFontScaling={false}
    >
      {ARROW[value.side]}
    </Text>
  );

  return (
    <Pressable
      testID={`edge-hint-${value.side}`}
      accessibilityRole="button"
      accessibilityLabel={value.label}
      onPress={onPress}
      hitSlop={(sizes.floatingButton - hint.height) / 2}
      style={({ pressed }) => [styles.hint, { left: value.x, top: value.y, width: value.width }, pressed && styles.pressed]}
    >
      {value.side !== 'right' && arrow}
      <View style={styles.faces}>
        {value.faces.map((marker, index) => (
          <HintFace
            key={marker.slaveId}
            marker={marker}
            avatar={avatars[marker.slaveId]}
            first={index === 0}
          />
        ))}
      </View>
      {value.extra > 0 && (
        <Text style={styles.extra} allowFontScaling={false}>
          +{value.extra}
        </Text>
      )}
      {value.side === 'right' && arrow}
    </Pressable>
  );
}

/**
 * The bottom tip (下方提示): 48dp high, 16dp from the sides, white with a 1dp
 * line, for 5 seconds. `message` { text, key, action? { label, onPress } }:
 * a new key shows it again; with an action (067 「開啟」) the tip takes taps
 * on its text button only.
 */
export function MapTip({ message, bottom, onDone, strong = false }) {
  const styles = useStyles(getStyles);
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!message) return undefined;
    opacity.setValue(0);
    Animated.timing(opacity, {
      toValue: 1,
      duration: motion.cardRise.duration,
      easing: ease,
      useNativeDriver: true,
    }).start();
    const timer = setTimeout(() => onDone?.(), motion.snackbarVisibleMs);
    return () => clearTimeout(timer);
  }, [message, opacity, onDone]);
  if (!message) return null;
  const action = message.action;
  return (
    <Animated.View
      testID="map-tip"
      accessibilityLiveRegion="polite"
      pointerEvents={action ? 'box-none' : 'none'}
      style={[styles.tip, action && styles.tipWithAction, { bottom, opacity }]}
    >
      <Text
        style={[styles.tipText, strong && styles.tipStrong, action && styles.tipTextWithAction]}
        numberOfLines={linesFor(action ? 3 : strong ? 2 : 1)}
      >
        {message.text}
      </Text>
      {action && (
        <Pressable
          testID="map-tip-action"
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={action.onPress}
          hitSlop={space.s}
          style={({ pressed }) => [styles.tipAction, pressed && styles.pressed]}
        >
          <Text style={styles.tipActionText}>{action.label}</Text>
        </Pressable>
      )}
    </Animated.View>
  );
}

const getStyles = makeStyles(theme => {
  const { colors, shadow } = theme;
  return StyleSheet.create({
    // 設計稿「元件狀態」: the pressed state.
    pressed: { backgroundColor: colors.pressedOverlay },
    buttons: {
      position: 'absolute',
      right: layout.screenEdge,
      gap: layout.floatingGap,
      alignItems: 'flex-end',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: layout.floatingGap,
    },
    pill: {
      minHeight: sizes.todayPill.height,
      paddingHorizontal: sizes.todayPill.paddingH,
      borderRadius: radius.full,
      backgroundColor: colors.surface,
      flexDirection: 'row',
      alignItems: 'center',
      gap: sizes.todayPill.iconGap,
      ...shadow.floating,
      ...theme.floatingBorder,
    },
    pillText: { ...type.status, ...tabularNumbers, color: colors.text },
    pillMuted: { color: colors.textMuted },
    gear: { position: 'absolute', right: layout.screenEdge, overflow: 'visible' },
    // Centre on the top-right rim of the 48dp circle; ring matches its surface.
    gearDot: {
      position: 'absolute',
      top: sizes.gear.problemDotInset,
      right: sizes.gear.problemDotInset,
      width: sizes.gear.problemDot,
      height: sizes.gear.problemDot,
      borderRadius: sizes.gear.problemDot / 2,
      backgroundColor: colors.critLine,
      borderWidth: border.strong,
      borderColor: colors.surface,
    },
    round: {
      width: sizes.floatingButton,
      height: sizes.floatingButton,
      borderRadius: radius.button,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
      ...shadow.floating,
      ...theme.floatingBorder,
    },
    hint: {
      position: 'absolute',
      height: hint.height,
      borderRadius: radius.full,
      backgroundColor: colors.surface,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: space.s,
      gap: space.xs,
      ...shadow.floating,
      ...theme.floatingBorder,
    },
    faces: { flexDirection: 'row', alignItems: 'center' },
    hintFace: {
      width: hint.avatar,
      height: hint.avatar,
      borderRadius: hint.avatar / 2,
    },
    problemRing: {
      margin: -hint.problemBorder,
      borderRadius: hint.avatar / 2 + hint.problemBorder,
      borderWidth: border.strong,
      borderColor: colors.problemBadge,
    },
    arrow: {
      ...type.value,
      width: sizes.edgeHint.arrow,
      textAlign: 'center',
      color: colors.text,
    },
    extra: { ...type.value, color: colors.text },
    tip: {
      position: 'absolute',
      left: layout.screenEdge,
      right: layout.screenEdge,
      minHeight: touch.min,
      borderRadius: radius.snackbar,
      backgroundColor: colors.snackbar,
      justifyContent: 'center',
      paddingHorizontal: layout.screenEdge,
      ...shadow.floating,
      ...theme.floatingBorder,
      // Over the history's sheets too (H3d over 選日期).
      zIndex: 70,
      elevation: 32,
    },
    tipText: { ...type.body, color: colors.text },
    // The history's H3d sentence: one line on a 360dp phone.
    tipStrong: { ...type.value, paddingVertical: space.m },
    // With an action: the words, then the text button on the right.
    tipWithAction: { flexDirection: 'row', alignItems: 'center', gap: space.s, paddingRight: space.s },
    tipTextWithAction: { flex: 1, paddingVertical: space.s },
    tipAction: { minHeight: touch.min, minWidth: touch.min, paddingHorizontal: space.s, alignItems: 'center',
      justifyContent: 'center', borderRadius: radius.full },
    tipActionText: { ...type.status, color: colors.tonalText },
  });
});
