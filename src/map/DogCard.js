import { t } from '../i18n';
// A dog's summary card (design v3 A3/A3b/A7b; DESIGN.md「摘要卡片」「卡片的
// 狀態列」): it rises from the bottom when a dog is tapped and replaces the old
// dog list, follow button and dog panel. No ✕: it closes by swiping it down,
// tapping empty map, or the back key. It only draws DogCardModel.dogCard().
import { useTheme, useStyles, makeStyles } from '../theme/ThemeProvider';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  BackHandler,
  Easing,
  PanResponder,
  PixelRatio,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DogAvatar from '../dogs/DogAvatar';
import Glyph from './Glyph';
import { dogCardMaxHeight } from './MapPanelHeight';
import { PressScale } from './MapControls';
import BangGlyph from '../components/BangGlyph';
import { slideOrFade } from '../utils/reduceMotion';
import { linesFor } from '../utils/textScale';
import {
  layout,
  motion,
  radius,
  size as sizes,
  space,
  touch,
  type,
  border,
} from '../theme/tokens';

const ease = Easing.bezier(...motion.easeOut);
// The grab handle (the mockups' #b9c3bd: visible on white, not a control).
const getHANDLE = makeStyles(theme => {
  const { literalColors: themeLiteral } = theme;
  return themeLiteral.sheetHandle;
});
// Closing goes a little faster than rising, like the history range bar.
const CLOSE_MS = 180;
// A swipe down further than this share of the card's height, or faster than
// this, closes it; anything less springs back.
const CLOSE_SHARE = 0.25;
const CLOSE_VELOCITY = 0.5;
// The card floats a little off the screen edges, as in the A3 mockups.
const CARD_INSET = space.s;

const getTONE = makeStyles(theme => {
  const { colors } = theme;
  return {
    crit: { text: colors.crit, badge: colors.problemBadge },
    warn: { text: colors.warn, badge: colors.warnIcon },
  };
});
const getACTIVITY_TONE = makeStyles(theme => {
  const { colors } = theme;
  return {
    rest: colors.activityLow,
    vigorous: colors.activityHighText,
    normal: colors.text,
    missing: colors.activityMissing,
  };
});

/** The 18dp round 「!」 in front of a problem (red) or a warning (amber) value. */
function Mark({ tone }) {
  const { colors } = useTheme();
  const styles = useStyles(getStyles);
  const TONE = useStyles(getTONE);
  // Level with the value's first line as the font grows (設計稿「卡片狀態列
  // 的長字」: 「!」靠第一行對齊); the mark itself is a vector, always centred.
  const grow =
    (type.value.lineHeight * ((PixelRatio.getFontScale?.() || 1) - 1)) / 2;
  return (
    <View style={[styles.mark, { marginTop: styles.mark.marginTop + grow }]}>
      <BangGlyph
        size={sizes.card.warnIcon}
        background={TONE[tone].badge}
        color={tone === 'warn' ? colors.onWarnIcon : colors.avatarFrameMap}
        testID={`dog-card-mark-${tone}`}
      />
    </View>
  );
}

function StatusRow({ row, first, onPress }) {
  const { fontScale, width } = useWindowDimensions();
  const labelWidth = sizes.card.labelWidth * Math.max(1, fontScale);
  const stacked = labelWidth > width * 0.4;
  const { colors } = useTheme();
  const TONE = useStyles(getTONE);
  const ACTIVITY_TONE = useStyles(getACTIVITY_TONE);
  const styles = useStyles(getStyles);
  const tone = row.tone && TONE[row.tone];
  const valueColor = tone
    ? tone.text
    : row.key === 'activity'
    ? ACTIVITY_TONE[row.activityTone] || ACTIVITY_TONE.missing
    : colors.text;
  const content = (
    <View
      style={[
        styles.row,
        stacked && { flexDirection: 'column', alignItems: 'stretch', gap: space.xs },
        !first && styles.rowLine,
        row.twoLine && styles.rowTwoLine,
      ]}
      testID={`dog-card-row-${row.key}`}
    >
      <Text style={[styles.rowLabel, { width: stacked ? undefined : labelWidth }]} accessible={false}>
        {row.label}
      </Text>
      <View style={styles.rowValue}>
        {tone && <Mark tone={row.tone} />}
        <View style={styles.rowTexts}>
          <Text
            style={[styles.value, { color: valueColor }]}
            accessible={false}
          >
            {row.value}
            {row.key === 'activity' && row.detail ? (
              <Text style={styles.detailInline}>{` ${row.detail}`}</Text>
            ) : null}
            {row.key === 'activity' && row.at ? (
              <Text style={styles.detailInline}>{`（${clock(row.at)}）`}</Text>
            ) : null}
          </Text>
          {row.key !== 'activity' && row.detail ? (
            <Text
              style={styles.detailLine}
              numberOfLines={1}
              accessible={false}
            >
              {row.detail}
            </Text>
          ) : null}
        </View>
      </View>
      {row.pressable && (
        <Glyph name="chevron" color={colors.textMuted} size={sizes.icon.row} />
      )}
    </View>
  );

  if (!row.pressable) {
    return (
      <View accessible accessibilityLabel={row.speech}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={row.speech}
      onPress={onPress}
      style={({ pressed }) => [styles.rowTarget, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

const pad = value => String(value).padStart(2, '0');
const clock = at => {
  const date = new Date(at);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

function Headline({ headline, speech, heading }) {
  const { colors } = useTheme();
  const styles = useStyles(getStyles);
  if (headline.kind === 'no-phone') {
    return (
      <View
        style={styles.headline}
        accessible
        accessibilityRole="header"
        accessibilityLabel={speech}
      >
        <Text style={styles.noPhone}>{headline.text}</Text>
      </View>
    );
  }
  if (headline.kind !== 'distance') return null;
  // The arrow points at the dog on the map as drawn: a rotated map turns it.
  const turn = `${
    (((headline.bearing - (heading || 0)) % 360) + 360) % 360
  }deg`;
  return (
    <View
      style={styles.headline}
      accessible
      accessibilityRole="header"
      accessibilityLabel={speech}
    >
      <View style={{ transform: [{ rotate: turn }] }} testID="dog-card-arrow">
        <Glyph name="arrow" color={colors.text} size={sizes.card.directionIcon} />
      </View>
      <Text style={styles.distance}>{headline.distance}</Text>
      <Text style={styles.suffix}>{headline.suffix}</Text>
    </View>
  );
}

/**
 * @param card DogCardModel.dogCard()
 * @param avatar the dog's face (useDogAvatars), or null for the default
 * @param heading the map's rotation in degrees (0 = north up)
 * @param onClosed called once the card has slid away (after close())
 * @param onHeight the card's height while open (0 once closed)
 * @param ref close(): slide away, then onClosed
 */
const DogCard = forwardRef(function DogCard(
  {
    card,
    avatar,
    heading = 0,
    onClosed,
    onHeight,
    onEdit,
    onActivity,
    onTrack,
    trackBusy = false,
  },
  ref,
) {
  const { colors } = useTheme();
  const styles = getStyles(useTheme());
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [height, setHeight] = useState(0);
  // Off screen until measured, then it rises (220 ms, motion.cardRise).
  const offset = useRef(new Animated.Value(windowHeight)).current;
  // 減少動態效果: the card fades in place instead of rising (slideOrFade).
  const fade = useRef(new Animated.Value(1)).current;
  const measured = useRef(0);
  const closing = useRef(false);
  const scrollTop = useRef(0);
  const callbacks = useRef({});
  callbacks.current = { onClosed, onHeight };
  // The close that is running (a slide, or the reduced-motion fade).
  const closingRun = useRef(null);
  const mounted = useRef(true);
  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    // The map buttons go down with the card, not after it.
    callbacks.current.onHeight?.(0);
    closingRun.current = slideOrFade(offset, measured.current || windowHeight, {
      fade,
      show: false,
      duration: CLOSE_MS,
      easing: ease,
    });
    closingRun.current.start(({ finished }) => {
      if (finished && mounted.current) callbacks.current.onClosed?.();
    });
  }, [offset, fade, windowHeight]);
  useImperativeHandle(ref, () => ({ close }), [close]);
  // A card replaced while it slides away (another dog tapped) stops here and
  // does not report a close of the new one.
  useEffect(
    () => () => {
      mounted.current = false;
      closingRun.current?.stop();
      offset.stopAnimation();
      fade.stopAnimation();
    },
    [offset, fade],
  );
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        close();
        return true;
      },
    );
    return () => subscription.remove();
  }, [close]);
  const onLayout = event => {
    const own = Math.round(event.nativeEvent.layout.height);
    // What it covers, counted from the screen bottom (it floats above it).
    const value = own ? own + CARD_INSET + insets.bottom : 0;
    if (!value || value === measured.current) return;
    const first = !measured.current;
    measured.current = value;
    setHeight(value);
    callbacks.current.onHeight?.(value);
    if (first) {
      offset.setValue(value);
      slideOrFade(offset, 0, {
        fade,
        show: true,
        duration: motion.cardRise.duration,
        easing: ease,
      }).start();
    }
  };
  const pan = useRef(
    PanResponder.create({
      // Only a clear downward drag, and only while the rows are scrolled to the
      // top: a drag inside the rows scrolls them.
      onMoveShouldSetPanResponderCapture: (_, gesture) =>
        !closing.current &&
        gesture.dy > 8 &&
        Math.abs(gesture.dy) > Math.abs(gesture.dx) &&
        scrollTop.current <= 0,
      onPanResponderMove: (_, gesture) =>
        offset.setValue(Math.max(0, gesture.dy)),
      onPanResponderRelease: (_, gesture) => {
        if (
          gesture.dy > measured.current * CLOSE_SHARE ||
          gesture.vy > CLOSE_VELOCITY
        )
          close();
        else
          Animated.spring(offset, {
            toValue: 0,
            ...motion.sheetSpring,
            useNativeDriver: true,
          }).start();
      },
      onPanResponderTerminate: () =>
        Animated.spring(offset, {
          toValue: 0,
          ...motion.sheetSpring,
          useNativeDriver: true,
        }).start(),
    }),
  ).current;
  // At most 75% of the screen below the status bar; the header and 看軌跡
  // stay, the headline and rows scroll.
  const maxHeight = dogCardMaxHeight(windowHeight, insets.top, insets.bottom);
  return (
    <Animated.View
      testID="dog-card"
      onLayout={onLayout}
      {...pan.panHandlers}
      style={[
        styles.card,
        {
          maxHeight,
          bottom: CARD_INSET + insets.bottom,
          transform: [{ translateY: offset }],
          opacity: fade,
        },
        !height && styles.unmeasured,
      ]}
    >
      <View style={styles.handle} accessible={false} />
      <View style={styles.header}>
        <DogAvatar
          avatar={avatar}
          size={sizes.card.avatar}
          stale={card.stale}
          border={0}
        />
        <Text style={styles.name} numberOfLines={linesFor(1)}>
          {card.name}
        </Text>
        <Text style={styles.source}>{card.sourceLabel}</Text>
        <View style={styles.spacer} />
        <Pressable
          testID="dog-card-edit"
          accessibilityRole="button"
          accessibilityLabel={t('c378', { dogName: card.name })}
          onPress={onEdit}
          hitSlop={space.xs}
          style={({ pressed }) => [styles.pencil, pressed && styles.pressed]}
        >
          <Glyph
            name="pencil"
            color={colors.textMuted}
            size={sizes.icon.pencil}
          />
        </Pressable>
      </View>
      <ScrollView
        style={styles.scroll}
        bounces={false}
        scrollEventThrottle={16}
        onScroll={event => {
          scrollTop.current = event.nativeEvent.contentOffset.y;
        }}
      >
        <Headline
          headline={card.headline}
          speech={card.headlineSpeech}
          heading={heading}
        />
        <View style={styles.rows}>
          {card.rows.map((row, index) => (
            <StatusRow
              key={row.key}
              row={row}
              first={index === 0}
              onPress={row.key === 'activity' ? onActivity : undefined}
            />
          ))}
        </View>
      </ScrollView>
      <PressScale
        testID="dog-card-track"
        accessibilityRole="button"
        accessibilityLabel={t('c071')}
        accessibilityState={{ disabled: trackBusy }}
        disabled={trackBusy}
        onPress={onTrack}
        style={styles.track}
      >
        <Text style={styles.trackText}>{t('c071')}</Text>
      </PressScale>
    </Animated.View>
  );
});

export default DogCard;

const getStyles = makeStyles(theme => {
  const { colors, shadow } = theme;
  const HANDLE = getHANDLE(theme);
  return StyleSheet.create({
    card: {
      position: 'absolute',
      left: CARD_INSET,
      right: CARD_INSET,
      zIndex: 25,
      backgroundColor: colors.surface,
      borderRadius: radius.sheet,
      paddingHorizontal: layout.cardPadding,
      paddingBottom: layout.cardPadding,
      ...shadow.floating,
      ...theme.floatingBorder,
      elevation: 8,
    },
    unmeasured: { opacity: 0 },
    handle: {
      alignSelf: 'center',
      width: sizes.sheet.cardHandleLength,
      height: sizes.sheet.handleThickness,
      borderRadius: sizes.sheet.handleThickness / 2,
      backgroundColor: HANDLE,
      marginTop: space.s,
      marginBottom: space.xs,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: touch.min,
      gap: space.m,
    },
    name: { ...type.title, color: colors.text, flexShrink: 1 },
    source: { ...type.caption, color: colors.textMuted },
    spacer: { flex: 1 },
    pencil: {
      width: touch.min,
      height: touch.min,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: -space.m,
      borderRadius: radius.full,
    },
    scroll: { flexGrow: 0, flexShrink: 1 },
    headline: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      minHeight: touch.min,
      columnGap: space.xs,
      paddingVertical: space.xs,
    },
    distance: { ...type.headline, color: colors.text },
    suffix: { ...type.caption, color: colors.textMuted, marginTop: space.xs },
    noPhone: { ...type.title, color: colors.textMuted },
    rows: { borderTopWidth: border.hairline, borderTopColor: colors.line, marginTop: space.xs },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: touch.cardRow,
      paddingVertical: space.s,
    },
    rowTwoLine: { minHeight: touch.cardRowTwoLine },
    rowTarget: { minHeight: touch.cardRow },
    rowLine: { borderTopWidth: border.hairline, borderTopColor: colors.line },
    rowLabel: {
      ...type.caption,
      color: colors.textMuted,
      // 72dp, wider when the system font makes the word longer (設計稿
      // 「卡片狀態列在大字體」): the label never wraps, the value does.
      minWidth: sizes.card.labelWidth,
      paddingLeft: space.s,
      paddingRight: space.s,
      flexShrink: 0,
    },
    rowValue: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: space.s,
    },
    rowTexts: { flex: 1 },
    value: { ...type.value },
    detailInline: { ...type.small, color: colors.textMuted, fontWeight: type.body.fontWeight },
    detailLine: { ...type.small, color: colors.textMuted, marginTop: space.xs },
    mark: {
      width: sizes.card.warnIcon,
      height: sizes.card.warnIcon,
      borderRadius: sizes.card.warnIcon / 2,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: space.xs,
    },
    track: {
      minHeight: touch.primary,
      paddingVertical: space.s,
      borderRadius: radius.button,
      backgroundColor: colors.tonal,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: space.m,
    },
    trackText: { ...type.status, color: colors.tonalText },
    pressed: { backgroundColor: colors.pressedOverlay },
  });
});
