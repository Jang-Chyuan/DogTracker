import { t } from '../i18n';
// The live map's top cards (design v3 A2/A2c/A6, 「提醒卡（A2、A2c、N3 共用）」
// 「A6 上方卡片」「提醒卡的堆疊」): 8dp under the gear, 16dp from the sides,
// stacked 8dp apart in TopAlerts.topCards' order. A problem card is white with
// a 4dp red edge, a 32dp pale red icon circle, a dark red title and one tonal
// pill on the right; A6 has an accent edge, a tonal dog circle and its buttons
// under the text. Provider-neutral views: MapScreen decides what they do.
import { useTheme, useStyles, makeStyles } from '../theme/ThemeProvider';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Circle, Ellipse, Path } from 'react-native-svg';
import Glyph from './Glyph';
import { isReduceMotion } from '../utils/reduceMotion';
import { isLargeFont, linesFor } from '../utils/textScale';
import { DOG_ARTS } from '../dogs/DogArt';
import {
  layout,
  motion,
  radius,
  size as sizes,
  touch,
  type,
  space,
  border,
} from '../theme/tokens';

// A6b (D10): the whole card is one button to S2.
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const ease = Easing.bezier(...motion.easeOut);
const card = sizes.alertCard;
// The ✕ is a 48dp target around an 18dp glyph.
const CLOSE_SLOP = (touch.min - sizes.alertCard.closeIcon) / 2;
const PILL_SLOP = (touch.min - card.buttonHeight) / 2;
// The quiet second button of A6 (「登入 Supabase」), as in the mockup.
const getQUIET_BG = makeStyles(theme => {
  const { literalColors: themeLiteral } = theme;
  return themeLiteral.quietAlertBackground;
});

function DogMark({ color, size = sizes.icon.row }) {
  const art = DOG_ARTS.classic;
  const line = {
    stroke: color,
    strokeWidth: 5,
    fill: 'none',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  };
  return (
    <Svg width={size} height={size} viewBox="16 18 88 88" accessible={false}>
      {art.lines.map(d => (
        <Path key={d} d={d} {...line} />
      ))}
      {art.dots.map(dot => (
        <Circle key={dot.cx} {...dot} fill={color} />
      ))}
      <Ellipse {...art.nose} fill={color} />
    </Svg>
  );
}

// The body: the title (`head`), then the words and buttons; A6's scroll
// past its 180dp under a fixed title (設計稿「A6 卡片的高度」).
function Wrap({ info, head, children }) {
  const styles = useStyles(getStyles);
  if (!info)
    return (
      <View style={styles.body}>
        {head}
        {children}
      </View>
    );
  return (
    <View style={[styles.body, styles.infoBody]}>
      {head}
      <ScrollView
        nestedScrollEnabled
        testID="top-card-scroll"
        style={styles.infoScroll}
      >
        {children}
      </ScrollView>
    </View>
  );
}

function Pill({ action, onPress }) {
  const styles = useStyles(getStyles);
  return (
    <Pressable
      testID={`top-card-action-${action.id}`}
      accessibilityRole="button"
      accessibilityLabel={action.label}
      accessibilityState={{ disabled: !!action.busy }}
      disabled={!!action.busy}
      hitSlop={PILL_SLOP}
      onPress={() => onPress?.(action.id)}
      style={({ pressed }) => [
        styles.pill,
        action.quiet && styles.pillQuiet,
        pressed && styles.pressed,
        action.busy && styles.busy,
      ]}
    >
      <Text
        style={[styles.pillText, action.quiet && styles.pillQuietText]}
        numberOfLines={linesFor(1)}
      >
        {action.label}
      </Text>
    </Pressable>
  );
}

/**
 * One card; slides in from above (220 ms). Closed (✕), it is already gone
 * from the stack's list — the gear's red dot lights at once — and only slides
 * out (160 ms) before `onGone`.
 */
function TopCard({ value, leaving = false, onAction, onClose, onGone }) {
  const { colors } = useTheme();
  const styles = useStyles(getStyles);
  const shown = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(shown, {
      toValue: 1,
      duration: motion.cardRise.duration,
      easing: ease,
      useNativeDriver: true,
    }).start();
  }, [shown]);
  useEffect(() => {
    if (!leaving) return;
    Animated.timing(shown, {
      toValue: 0,
      duration: 160,
      easing: ease,
      useNativeDriver: true,
    }).start(() => onGone?.(value.id));
  }, [leaving, shown, onGone, value.id]);
  const close = event => { event?.stopPropagation?.(); onClose?.(value); };
  const tap = value.tapAction ? () => onAction?.(value.tapAction) : undefined;
  const Container = value.tapAction ? AnimatedPressable : Animated.View;
  const info = value.kind === 'info';
  // With a large system font an alert card's button goes under its words
  // (like A6's), so the title is not squeezed into a narrow column.
  const stacked = info || isLargeFont();
  const translateY = shown.interpolate({
    inputRange: [0, 1],
    outputRange: [isReduceMotion() ? 0 : -12, 0],
  });
  const closeButton = value.closable && (
    <Pressable
      testID={`top-card-close-${value.id}`}
      accessibilityRole="button"
      accessibilityLabel={value.closeLabel || t("c765")}
      hitSlop={CLOSE_SLOP}
      onPress={close}
      style={({ pressed }) => [styles.close, pressed && styles.pressed]}
    >
      <Glyph name="close" color={colors.iconMuted} size={sizes.icon.smallAction} />
    </Pressable>
  );

  return (
    <Container
      accessible={false}
      onPress={tap}
      testID={leaving ? undefined : `top-card-${value.id}`}
      accessibilityLiveRegion="polite"
      pointerEvents={leaving ? 'none' : 'auto'}
      style={[
        styles.card,
        info ? styles.info : styles.alert,
        stacked && styles.stackedCard,
        value.tapAction && styles.waiting,
        { opacity: shown, transform: [{ translateY }] },
      ]}
    >
      <View style={[styles.icon, info ? styles.iconInfo : styles.iconAlert]}>
        {info ? (
          value.tapAction
            ? <Glyph name="locate" color={colors.tonalText} size={sizes.icon.row} />
            : <DogMark color={colors.tonalText} />
        ) : (
          <Glyph name={value.icon} color={colors.problemBadge} size={sizes.icon.smallAction} />
        )}
      </View>
      {/* A6 grows with its words; past 180dp (a large system font, a narrow
          screen) its words and buttons scroll inside while the icon and ✕
          stay (設計稿「A6 卡片的高度」). */}
      <Wrap
        info={info}
        head={
          // The title stays put; the words under it (and A6's buttons) scroll.
          <Text
            style={[styles.title, !info && styles.alertTitle]}
            numberOfLines={info ? undefined : linesFor(2)}
            accessible
            onPress={tap}
            accessibilityRole={value.tapAction ? 'button' : info ? undefined : 'alert'}
            accessibilityLabel={value.label || `${value.title}，${value.detail}`}
          >
            {value.title}
          </Text>
        }
      >
        <Text
          style={[styles.detail, !info && styles.alertDetail]}
          numberOfLines={info ? undefined : linesFor(2)}
          importantForAccessibility="no"
        >
          {value.detail}
        </Text>
        {stacked && value.actions.length > 0 && (
          <View style={styles.buttons}>
            {value.actions.map(action => (
              <Pill key={action.id} action={action} onPress={onAction} />
            ))}
          </View>
        )}
      </Wrap>
      {!stacked &&
        value.actions.map(action => (
          <Pill key={action.id} action={action} onPress={onAction} />
        ))}
      {closeButton}
    </Container>
  );
}

/**
 * The stack of top cards at `top`; reports its height (0 without cards) so
 * the compass and what the map frames keep clear of it.
 */
export default function TopAlertCards({
  cards,
  top,
  onAction,
  onClose,
  onHeight,
}) {
  const styles = useStyles(getStyles);
  // Cards closed with ✕ that are still sliding out, where they stood.
  const [leaving, setLeaving] = useState([]);
  const close = useCallback(
    value => {
      setLeaving(current => [
        ...current.filter(item => item.value.id !== value.id),
        { value, index: cards.findIndex(item => item.id === value.id) },
      ]);
      onClose?.(value.id);
    },
    [cards, onClose],
  );
  const gone = useCallback(
    id => setLeaving(current => current.filter(item => item.value.id !== id)),
    [],
  );
  const shown = cards.map(value => ({ value, leaving: false }));
  for (const item of leaving) {
    if (cards.some(value => value.id === item.value.id)) continue;
    shown.splice(Math.min(Math.max(item.index, 0), shown.length), 0, {
      value: item.value,
      leaving: true,
    });
  }
  const empty = !shown.length;
  useEffect(() => {
    if (empty) onHeight?.(0);
  }, [empty, onHeight]);
  if (empty) return null;
  return (
    <View
      testID="top-cards"
      style={[styles.stack, { top }]}
      pointerEvents="box-none"
      onLayout={event => onHeight?.(event.nativeEvent.layout.height)}
    >
      {shown.map(item => (
        <TopCard
          key={item.value.id}
          value={item.value}
          leaving={item.leaving}
          onAction={onAction}
          onClose={close}
          onGone={gone}
        />
      ))}
    </View>
  );
}

// N3 (design v3 「提醒卡（A2、A2c、N3 共用）」「N3 提醒卡的位置」): the same
// card off the live map, without a button or ✕ — the whole card is pressed.
// Slides down (220 ms) when it arrives; when its 5 s are over (`leaving`) it
// slides up (160 ms) before `onGone`; only history keeps 「⚠ N」.
export function N3Card({ value, leaving = false, top, onPress, onGone, onHeight }) {
  const { colors } = useTheme();
  const styles = useStyles(getStyles);
  const shown = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    shown.setValue(0);
    Animated.timing(shown, {
      toValue: 1,
      duration: motion.cardRise.duration,
      easing: ease,
      useNativeDriver: true,
    }).start();
  }, [shown, value.id]);
  useEffect(() => {
    if (!leaving) return;
    Animated.timing(shown, {
      toValue: 0,
      duration: 160,
      easing: ease,
      useNativeDriver: true,
    }).start(({ finished }) => finished && onGone?.(value.id));
  }, [leaving, shown, onGone, value.id]);
  const translateY = shown.interpolate({
    inputRange: [0, 1],
    outputRange: [isReduceMotion() ? 0 : -16, 0],
  });
  return (
    <View
      style={[styles.stack, { top }]}
      pointerEvents="box-none"
      onLayout={event => onHeight?.(event.nativeEvent.layout.height)}
    >
      <Animated.View
        pointerEvents={leaving ? 'none' : 'auto'}
        style={{ opacity: shown, transform: [{ translateY }] }}
      >
        <Pressable
          testID={leaving ? undefined : 'n3-card'}
          accessibilityRole="button"
          accessibilityLiveRegion="polite"
          accessibilityLabel={`${value.title}，${value.detail}`}
          accessibilityHint={t("c771")}
          onPress={() => onPress?.(value)}
          style={({ pressed }) => [styles.card, styles.alert, pressed && styles.pressed]}
        >
          <View style={[styles.icon, styles.iconAlert]}>
            <Glyph name={value.icon} color={colors.problemBadge} size={sizes.icon.smallAction} />
          </View>
          <View style={styles.body}>
            <Text style={[styles.title, styles.alertTitle]} numberOfLines={linesFor(2)}>
              {value.title}
            </Text>
            <Text style={[styles.detail, styles.alertDetail]} numberOfLines={linesFor(1)}>
              {value.detail}
            </Text>
          </View>
        </Pressable>
      </Animated.View>
    </View>
  );
}

// 「⚠ N」 (判定表「歷史、設定的紅色「⚠ N」」): 36dp high (48dp target), 10dp
// sides, round, critBg with a 1dp alertBorder edge, crit 14sp bold.
const BADGE_SLOP = (touch.min - sizes.chip.height) / 2;
export function AlertBadge({ badge, onPress, style }) {
  const { colors } = useTheme();
  const styles = useStyles(getStyles);
  if (!badge) return null;
  return (
    <Pressable
      testID="alert-badge"
      accessibilityRole="button"
      accessibilityLabel={badge.label}
      hitSlop={BADGE_SLOP}
      onPress={() => onPress?.(badge)}
      style={({ pressed }) => [styles.badge, pressed && styles.pressed, style]}
    >
      <Glyph name="warning" color={colors.crit} size={sizes.icon.inline} />
      <Text style={styles.badgeText}>{badge.count}</Text>
    </Pressable>
  );
}

const getStyles = makeStyles(theme => {
  const { colors, literalColors: themeLiteral } = theme;
  const QUIET_BG = getQUIET_BG(theme);
  return StyleSheet.create({
    stack: {
      position: 'absolute',
      left: layout.screenEdge,
      right: layout.screenEdge,
      gap: card.gap,
      zIndex: 25,
    },
    card: {
      // 48dp at least: the whole card is pressed (N3).
      minHeight: touch.min,
      flexDirection: 'row',
      alignItems: 'center',
      gap: card.gap,
      backgroundColor: colors.surface,
      borderRadius: radius.alertCard,
      borderWidth: border.hairline,
      borderLeftWidth: border.emphasis,
      paddingVertical: space.s,
      paddingLeft: space.s,
      paddingRight: space.s,
      shadowColor: themeLiteral.alertShadow,
      shadowOpacity: theme.isDark ? 0.4 : 0.14,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: sizes.alertCard.shadowDrop },
      elevation: 4,
    },
    alert: {
      backgroundColor: theme.isDark ? colors.critBg : colors.surface,
      borderColor: colors.alertBorder,
      borderLeftColor: colors.critLine,
    },
    info: {
      borderColor: colors.line,
      borderLeftColor: colors.accent,
      alignItems: 'flex-start',
    },
    waiting: { borderColor: colors.floatingOutline, borderLeftColor: colors.accent },
    icon: {
      width: card.icon,
      height: card.icon,
      borderRadius: card.icon / 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconAlert: { backgroundColor: colors.alertIconBg },
    iconInfo: { backgroundColor: colors.tonal, alignSelf: 'center' },
    body: { flex: 1, minWidth: 0 },
    infoScroll: { flexShrink: 1 },
    // A card whose button went under its words: icon and ✕ at the top.
    stackedCard: { alignItems: 'flex-start' },
    // 180dp for the whole card, less its padding.
    infoBody: { maxHeight: card.a6MaxHeight - 2 * space.s },
    title: { ...type.cardTitle, color: colors.text },
    alertTitle: { color: colors.crit },
    detail: { ...type.small, color: colors.textMuted },
    alertDetail: { color: colors.alertDetail },
    // 設計稿「A6 卡片的高度」: wrapped buttons keep 48dp targets 8dp apart
    // (28dp pills, PILL_SLOP above and below each), and the last row's slop
    // stays inside the scrolling body.
    buttons: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      columnGap: card.gap,
      rowGap: card.gap + 2 * PILL_SLOP,
      // The row's own box takes in the first and last pills' slop: Android
      // only finds a touch inside its parent's box.
      marginTop: card.gap - PILL_SLOP,
      paddingVertical: PILL_SLOP,
    },
    pill: {
      // 28dp, taller with a large system font (不裁字).
      minHeight: card.buttonHeight,
      borderRadius: radius.full,
      paddingHorizontal: space.m,
      justifyContent: 'center',
      backgroundColor: theme.isDark ? colors.alertIconBg : colors.tonal,
    },
    pillQuiet: { backgroundColor: QUIET_BG },
    pillText: {
      ...type.captionBold,
      color: theme.isDark ? colors.crit : colors.tonalText,
    },
    pillQuietText: { color: colors.text },
    busy: { opacity: 0.6 },
    close: {
      width: sizes.alertCard.closeIcon,
      height: sizes.alertCard.closeIcon,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pressed: { opacity: 0.7 },
    badge: {
      minHeight: sizes.chip.height,
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.xs,
      paddingHorizontal: space.s,
      borderRadius: radius.full,
      borderWidth: border.hairline,
      borderColor: colors.alertBorder,
      backgroundColor: colors.critBg,
    },
    badgeText: { ...type.value, color: colors.crit },
  });
});
