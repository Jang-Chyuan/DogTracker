// The live map's top cards (design v3 A2/A2c/A6, 「提醒卡（A2、A2c、N3 共用）」
// 「A6 上方卡片」「提醒卡的堆疊」): 8dp under the gear, 16dp from the sides,
// stacked 8dp apart in TopAlerts.topCards' order. A problem card is white with
// a 4dp red edge, a 32dp pale red icon circle, a dark red title and one tonal
// pill on the right; A6 has an accent edge, a tonal dog circle and its buttons
// under the text. Provider-neutral views: MapScreen decides what they do.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Ellipse, Path } from 'react-native-svg';
import Glyph from './Glyph';
import { DOG_ARTS } from '../dogs/DogArt';
import { colors, layout, motion, radius, size as sizes, type } from '../theme/tokens';

const ease = Easing.bezier(...motion.easeOut);
const card = sizes.alertCard;
// The ✕ is a 48dp target around an 18dp glyph.
const CLOSE_SLOP = (48 - 24) / 2;
const PILL_SLOP = (48 - card.buttonHeight) / 2;
// The quiet second button of A6 (「登入 Supabase」), as in the mockup.
const QUIET_BG = '#F4F1EF';

function DogMark({ color, size = 20 }) {
  const art = DOG_ARTS.classic;
  const line = { stroke: color, strokeWidth: 5, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' };
  return (
    <Svg width={size} height={size} viewBox="16 18 88 88" accessible={false}>
      {art.lines.map(d => <Path key={d} d={d} {...line} />)}
      {art.dots.map(dot => <Circle key={dot.cx} {...dot} fill={color} />)}
      <Ellipse {...art.nose} fill={color} />
    </Svg>
  );
}

function Pill({ action, onPress }) {
  return (
    <Pressable testID={`top-card-action-${action.id}`} accessibilityRole="button" accessibilityLabel={action.label}
      accessibilityState={{ disabled: !!action.busy }} disabled={!!action.busy} hitSlop={PILL_SLOP}
      onPress={() => onPress?.(action.id)}
      style={({ pressed }) => [styles.pill, action.quiet && styles.pillQuiet, pressed && styles.pressed,
        action.busy && styles.busy]}>
      <Text style={[styles.pillText, action.quiet && styles.pillQuietText]} numberOfLines={1}>{action.label}</Text>
    </Pressable>
  );
}

/**
 * One card; slides in from above (220 ms). Closed (✕), it is already gone
 * from the stack's list — the gear's red dot lights at once — and only slides
 * out (160 ms) before `onGone`.
 */
function TopCard({ value, leaving = false, onAction, onClose, onGone }) {
  const shown = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(shown, { toValue: 1, duration: motion.cardRise.duration, easing: ease,
      useNativeDriver: true }).start();
  }, [shown]);
  useEffect(() => {
    if (!leaving) return;
    Animated.timing(shown, { toValue: 0, duration: 160, easing: ease, useNativeDriver: true })
      .start(() => onGone?.(value.id));
  }, [leaving, shown, onGone, value.id]);
  const close = () => onClose?.(value);
  const info = value.kind === 'info';
  const translateY = shown.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] });
  const closeButton = value.closable && (
    <Pressable testID={`top-card-close-${value.id}`} accessibilityRole="button" accessibilityLabel="關閉"
      hitSlop={CLOSE_SLOP} onPress={close} style={({ pressed }) => [styles.close, pressed && styles.pressed]}>
      <Glyph name="close" color={colors.iconMuted} size={18} />
    </Pressable>
  );
  return (
    <Animated.View testID={leaving ? undefined : `top-card-${value.id}`} accessibilityLiveRegion="polite"
      pointerEvents={leaving ? 'none' : 'auto'}
      style={[styles.card, info ? styles.info : styles.alert, { opacity: shown, transform: [{ translateY }] }]}>
      <View style={[styles.icon, info ? styles.iconInfo : styles.iconAlert]}>
        {info ? <DogMark color={colors.tonalText} />
          : <Glyph name={value.icon} color={colors.problemBadge} size={18} />}
      </View>
      <View style={styles.body} accessible accessibilityRole={info ? undefined : 'alert'}
        accessibilityLabel={`${value.title}，${value.detail}`}>
        <Text style={[styles.title, !info && styles.alertTitle]} numberOfLines={2}>{value.title}</Text>
        <Text style={styles.detail} numberOfLines={info ? 3 : 2}>{value.detail}</Text>
        {info && (
          <View style={styles.buttons}>
            {value.actions.map(action => <Pill key={action.id} action={action} onPress={onAction} />)}
          </View>
        )}
      </View>
      {!info && value.actions.map(action => <Pill key={action.id} action={action} onPress={onAction} />)}
      {closeButton}
    </Animated.View>
  );
}

/**
 * The stack of top cards at `top`; reports its height (0 without cards) so
 * the compass and what the map frames keep clear of it.
 */
export default function TopAlertCards({ cards, top, onAction, onClose, onHeight }) {
  // Cards closed with ✕ that are still sliding out, where they stood.
  const [leaving, setLeaving] = useState([]);
  const close = useCallback(value => {
    setLeaving(current => [...current.filter(item => item.value.id !== value.id),
      { value, index: cards.findIndex(item => item.id === value.id) }]);
    onClose?.(value.id);
  }, [cards, onClose]);
  const gone = useCallback(id => setLeaving(current => current.filter(item => item.value.id !== id)), []);
  const shown = cards.map(value => ({ value, leaving: false }));
  for (const item of leaving) {
    if (cards.some(value => value.id === item.value.id)) continue;
    shown.splice(Math.min(Math.max(item.index, 0), shown.length), 0, { value: item.value, leaving: true });
  }
  const empty = !shown.length;
  useEffect(() => {
    if (empty) onHeight?.(0);
  }, [empty, onHeight]);
  if (empty) return null;
  return (
    <View testID="top-cards" style={[styles.stack, { top }]} pointerEvents="box-none"
      onLayout={event => onHeight?.(event.nativeEvent.layout.height)}>
      {shown.map(item => (
        <TopCard key={item.value.id} value={item.value} leaving={item.leaving} onAction={onAction} onClose={close}
          onGone={gone} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { position: 'absolute', left: layout.screenEdge, right: layout.screenEdge, gap: card.gap, zIndex: 25 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: card.gap, backgroundColor: colors.surface,
    borderRadius: radius.alertCard, borderWidth: card.border, borderLeftWidth: card.edge,
    paddingVertical: 10, paddingLeft: 10, paddingRight: 8,
    shadowColor: '#000', shadowOpacity: 0.14, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 4,
  },
  alert: { borderColor: colors.alertBorder, borderLeftColor: colors.critLine },
  info: { borderColor: colors.line, borderLeftColor: colors.accent, alignItems: 'flex-start' },
  icon: { width: card.icon, height: card.icon, borderRadius: card.icon / 2, alignItems: 'center', justifyContent: 'center' },
  iconAlert: { backgroundColor: colors.alertIconBg },
  iconInfo: { backgroundColor: colors.tonal, alignSelf: 'center' },
  body: { flex: 1, minWidth: 0 },
  title: { ...type.cardTitle, color: colors.text },
  alertTitle: { color: colors.crit },
  detail: { ...type.small, color: colors.textMuted },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: card.gap, marginTop: card.gap },
  pill: {
    height: card.buttonHeight, borderRadius: radius.full, paddingHorizontal: 12, justifyContent: 'center',
    backgroundColor: colors.tonal,
  },
  pillQuiet: { backgroundColor: QUIET_BG },
  pillText: { ...type.captionBold, color: colors.tonalText },
  pillQuietText: { color: colors.text },
  busy: { opacity: 0.6 },
  close: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.7 },
});
