import { t } from '../i18n';
// A dog's summary card (design v3 A3/A3b/A7b; DESIGN.md「摘要卡片」「卡片的
// 狀態列」): it rises from the bottom when a dog is tapped and replaces the old
// dog list, follow button and dog panel. No ✕: it closes by swiping it down,
// tapping empty map, or the back key. With other dogs on the map its top is
// the row of dogs (DogCarousel) that picks another; alone, the dog's face and
// name. The face carries the pencil badge and opens the edit sheet. It only
// draws DogCardModel.dogCard().
import { useTheme, useStyles, makeStyles } from '../theme/ThemeProvider';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AccessibilityInfo,
  Animated,
  BackHandler,
  Easing,
  PanResponder,
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
import DogCarousel from './DogCarousel';
import { isLargeFont, linesFor } from '../utils/textScale';
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
// How long the rows' height must hold still before the card keeps it.
const ROOM_SETTLE_MS = 300;
// The card floats a little off the screen edges, as in the A3 mockups.
const CARD_INSET = space.s;
// 看軌跡 is 40dp drawn (2026-10-14: smaller, the rows get the room); the
// finger still gets 48dp.
const TRACK_SLOP = (touch.min - sizes.card.track) / 2;

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

/**
 * The round 「!」 of a problem (red) or a warning (amber) row (2026-10-14):
 * in front of the label, in the card's side margin, level with the label —
 * it takes no width from the value or the address, and no height.
 */
function Mark({ tone }) {
  const { colors } = useTheme();
  const styles = useStyles(getStyles);
  const TONE = useStyles(getTONE);
  return (
    <View style={styles.mark} pointerEvents="none">
      <BangGlyph
        size={sizes.card.labelMark}
        background={TONE[tone].badge}
        color={tone === 'warn' ? colors.onWarnIcon : colors.avatarFrameMap}
        testID={`dog-card-mark-${tone}`}
      />
    </View>
  );
}

/**
 * The direction and distance from the phone (「↗ 320 m」) at the first row's
 * right end, or 「手機沒有定位」; the phone's own old fix under it.
 */
function Distance({ headline, heading, under, onWidth }) {
  const { colors } = useTheme();
  const styles = useStyles(getStyles);
  const measure = event => onWidth?.(event.nativeEvent.layout.width);
  if (headline?.kind === 'no-phone') {
    return (
      <Text style={[styles.noPhone, under && styles.distanceUnder]} accessible={false} onLayout={measure}>
        {headline.text}
      </Text>
    );
  }
  if (headline?.kind !== 'distance') return null;
  // The arrow points at the dog on the map as drawn: a rotated map turns it.
  const turn = `${
    (((headline.bearing - (heading || 0)) % 360) + 360) % 360
  }deg`;
  return (
    <View style={under ? styles.distanceUnder : styles.distanceEnd} testID="dog-card-distance" onLayout={measure}>
      <View style={styles.distanceLine}>
        <View style={{ transform: [{ rotate: turn }] }} testID="dog-card-arrow">
          <Glyph name="arrow" color={colors.text} size={sizes.card.directionIcon} />
        </View>
        <Text style={styles.distance} accessible={false}>{headline.distance}</Text>
      </View>
      {headline.phoneAge ? (
        <Text style={styles.phoneAge} accessible={false}>{headline.phoneAge}</Text>
      ) : null}
    </View>
  );
}

function StatusRow({ row, first, onPress, headline = null, heading = 0 }) {
  const { fontScale, width } = useWindowDimensions();
  const labelWidth = sizes.card.labelWidth * Math.max(1, fontScale);
  const stacked = labelWidth > width * 0.4;
  // The distance sits beside the first line when the value fits there on one
  // line with it; otherwise (a narrow phone, a large font, a long value) it
  // goes under the row's words, rather than squeezing the value into a
  // narrow column that wraps 「沒有新位置・最後 / 09:05」. Until measured: beside,
  // except at a large font.
  const [fit, setFit] = useState({ value: 0, distance: 0, room: 0 });
  const measured = fit.value > 0 && fit.distance > 0 && fit.room > 0;
  const under = headline ? (measured ? fit.value + space.s + fit.distance > fit.room : isLargeFont()) : false;
  const keep = key => value => setFit(current =>
    (Math.abs(current[key] - value) < 0.5 ? current : { ...current, [key]: value }));
  const distance = headline
    ? <Distance headline={headline} heading={heading} under={under} onWidth={keep('distance')} /> : null;
  const { colors } = useTheme();
  const TONE = useStyles(getTONE);
  const ACTIVITY_TONE = useStyles(getACTIVITY_TONE);
  const styles = useStyles(getStyles);
  // One 「!」 for the row: its value's, or the second problem's (不在接收範圍
  // under 室內 or 沒有新位置).
  const markTone = row.tone || (row.alert ? 'crit' : null);
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
        !row.pressable && styles.rowStill,
        !row.pressable && row.twoLine && styles.rowTwoLine,
      ]}
      testID={`dog-card-row-${row.key}`}
    >
      <View style={[styles.labelCell, { width: stacked ? undefined : labelWidth }]}>
        {markTone && <Mark tone={markTone} />}
        <Text style={styles.rowLabel} accessible={false}>
          {row.label}
        </Text>
      </View>
      <View style={styles.rowValue}>
        <View style={styles.rowTexts}>
          {/* The first line: the value, and the distance beside it only. */}
          {headline ? (
            // The value's own width on one line, to see whether it fits.
            <Text
              style={[styles.value, styles.sample]}
              numberOfLines={1}
              accessible={false}
              importantForAccessibility="no-hide-descendants"
              onTextLayout={event => keep('value')(Math.max(0,
                ...event.nativeEvent.lines.map(line => line.width)))}
            >
              {row.value}
            </Text>
          ) : null}
          <View style={styles.firstLine}
            onLayout={headline ? event => keep('room')(event.nativeEvent.layout.width) : undefined}>
            <Text
              style={[styles.value, { color: valueColor }]}
              accessible={false}
            >
              {row.value}
              {row.key === 'activity' && row.detail ? (
                // 「休息中・已 12 分鐘」 (DESIGN.md 摘要卡片).
                <Text style={styles.detailInline}>{`・${row.detail}`}</Text>
              ) : null}
              {row.key === 'activity' && row.at ? (
                <Text style={styles.detailInline}>{`（${clock(row.at)}）`}</Text>
              ) : null}
            </Text>
            {distance && !under ? distance : null}
          </View>
          {/* Under it, the whole width (under the distance too): the
              address or coordinates, two lines at most; the second problem. */}
          {row.key !== 'activity' && row.detail ? (
            <Text
              style={styles.detailLine}
              numberOfLines={linesFor(2)}
              accessible={false}
            >
              {row.detail}
            </Text>
          ) : null}
          {row.alert ? (
            <Text style={[styles.alertLine, { color: TONE.crit.text }]} accessible={false}>
              {row.alert}
            </Text>
          ) : null}
          {distance && under ? distance : null}
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

/**
 * The card's top: alone, the dog's face (the edit button, a pencil badge on
 * it) and name; with other dogs, the row of dogs (DogCarousel).
 */
function CardHeader({ card, avatar, switcher, onEdit, width }) {
  const { colors } = useTheme();
  const styles = useStyles(getStyles);
  const actions = useMemo(() => switcher ? [
    ...(switcher.next != null ? [{ name: 'next', label: t('c1291') }] : []),
    ...(switcher.previous != null ? [{ name: 'previous', label: t('c1292') }] : []),
  ] : undefined, [switcher]);
  const onAction = useCallback(event => {
    switcher?.onStep(event.nativeEvent.actionName === 'next' ? 1 : -1);
  }, [switcher]);
  if (switcher?.dogs?.length > 1) {
    return (
      <DogCarousel
        dogs={switcher.dogs}
        currentId={card.slaveId}
        width={width}
        onSelect={switcher.onSelect}
        onEdit={onEdit}
        actions={actions?.length ? actions : undefined}
        onAction={onAction}
      />
    );
  }
  return (
    <View style={styles.header}>
      <Pressable
        testID="dog-card-edit"
        accessibilityRole="button"
        accessibilityLabel={t('c378', { dogName: card.name })}
        onPress={onEdit}
        style={({ pressed }) => [styles.edit, pressed && styles.pressed]}
      >
        <DogAvatar
          avatar={avatar}
          size={sizes.card.avatar}
          stale={card.stale}
          border={0}
        />
        <View style={styles.editBadge} testID="dog-card-edit-badge">
          <Glyph name="pencil" color={colors.textMuted} size={sizes.card.editBadgeIcon} />
        </View>
      </Pressable>
      <Text style={styles.name} numberOfLines={linesFor(1)}>
        {card.name}
      </Text>
    </View>
  );
}

/** The rows' height to keep: see DogCard. */
function useRowsRoom(reserve) {
  const [heights, setHeights] = useState({});
  const keys = new Set(['rows', 'first', ...reserve.map(item => `dog-${item.key}`)]);
  const measure = (key, event) => {
    const height = Math.round(event.nativeEvent.layout.height);
    setHeights(current => (current[key] === height ? current : { ...current, [key]: height }));
  };
  const firsts = Object.entries(heights).filter(([key]) => key === 'first' || (key.startsWith('dog-') && keys.has(key)))
    .map(([, height]) => height);
  const want = heights.rows ? heights.rows - (heights.first ?? 0) + Math.max(0, ...firsts) : 0;
  // Only a height that has settled (unchanged for ROOM_SETTLE_MS) is kept: a
  // row measured once before its distance found its place must not keep
  // the room it needed for a moment.
  const [held, setHeld] = useState(0);
  useEffect(() => {
    if (want <= held) return undefined;
    const timer = setTimeout(() => setHeld(current => Math.max(current, want)), ROOM_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [want, held]);
  return { held, measure };
}

/**
 * @param card DogCardModel.dogCard()
 * @param avatar the dog's face (useDogAvatars), or null for the default
 * @param switcher MapScreen's, with other dogs on the map: the order's dogs
 *   (each { slaveId, name, avatar, problem, stale }), onSelect(slaveId),
 *   onStep(±1) for TalkBack and next／previous (null at an end)
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
    switcher = null,
    reserve = [],
  },
  ref,
) {
  const styles = getStyles(useTheme());
  const insets = useSafeAreaInsets();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
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
  // Another dog picked: the body below swaps by a short fade (the row of
  // dogs stays put), and TalkBack hears which dog it is now.
  const bodyFade = useRef(new Animated.Value(1)).current;
  const shownDog = useRef(card.slaveId);
  useEffect(() => {
    if (shownDog.current === card.slaveId) return;
    shownDog.current = card.slaveId;
    AccessibilityInfo.announceForAccessibility?.(card.name);
    bodyFade.setValue(motion.cardSwap.from);
    Animated.timing(bodyFade, {
      toValue: 1,
      duration: motion.cardSwap.duration,
      easing: ease,
      useNativeDriver: true,
    }).start();
    // Only a new dog, not every reading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.slaveId]);
  // The card keeps one height from dog to dog (2026-10-14): the rows get
  // room for the tallest first row any dog in the row of dogs shows (each
  // measured, never seen), and never give back room once taken while the
  // card is open — so neither the card nor the map buttons jump.
  const room = useRowsRoom(reserve);
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
      <CardHeader
        card={card}
        avatar={avatar}
        switcher={switcher}
        onEdit={onEdit}
        width={windowWidth - 2 * CARD_INSET}
      />
      <Animated.View style={[styles.body, { opacity: bodyFade }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        bounces={false}
        scrollEventThrottle={16}
        onScroll={event => {
          scrollTop.current = event.nativeEvent.contentOffset.y;
        }}
      >
        <View style={[styles.rows, { minHeight: room.held }]}>
          <View onLayout={event => room.measure('rows', event)}>
            {card.rows.map((row, index) => (
              <View key={row.key} onLayout={index === 0 ? event => room.measure('first', event) : undefined}>
                <StatusRow
                  row={row}
                  first={index === 0}
                  onPress={row.key === 'activity' ? onActivity : undefined}
                  headline={index === 0 ? card.headline : null}
                  heading={heading}
                />
              </View>
            ))}
          </View>
          {/* The other dogs' first rows, never seen: the room they need. */}
          {reserve.length ? (
            <View style={styles.reserve} pointerEvents="none" accessible={false}
              importantForAccessibility="no-hide-descendants">
              {reserve.map(item => (
                <View key={item.key} onLayout={event => room.measure(`dog-${item.key}`, event)}>
                  <StatusRow row={item.row} first headline={item.headline} heading={heading} />
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </ScrollView>
      <PressScale
        testID="dog-card-track"
        accessibilityRole="button"
        accessibilityLabel={t('c071')}
        accessibilityState={{ disabled: trackBusy }}
        disabled={trackBusy}
        onPress={onTrack}
        hitSlop={{ top: TRACK_SLOP, bottom: TRACK_SLOP }}
        style={styles.track}
      >
        <Text style={styles.trackText}>{t('c071')}</Text>
      </PressScale>
      </Animated.View>
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
      paddingBottom: layout.cardPadding - space.xs,
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
      marginBottom: 0,
    },
    // One dog: its face (the edit button) and name, side by side.
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: touch.min,
      gap: space.s,
      marginLeft: -space.xs,
    },
    name: { ...type.title, color: colors.text, flexShrink: 1 },
    // The face is the edit button: 48dp, the 40dp face in the middle and a
    // 20dp neutral pencil badge at its bottom right (never red: the red
    // 「!」 is a problem).
    edit: {
      width: touch.min,
      height: touch.min,
      borderRadius: radius.full,
      alignItems: 'center',
      justifyContent: 'center',
    },
    editBadge: {
      position: 'absolute',
      right: 0,
      bottom: 0,
      width: sizes.card.editBadge,
      height: sizes.card.editBadge,
      borderRadius: radius.full,
      backgroundColor: colors.surface,
      borderWidth: border.hairline,
      borderColor: colors.line,
      alignItems: 'center',
      justifyContent: 'center',
    },
    body: { flexShrink: 1 },
    // Laid out like the rows, under them, and never seen.
    reserve: { position: 'absolute', left: 0, right: 0, top: 0, opacity: 0 },
    // Out to the card's edges (the 「!」 in front of a label sits in the
    // side margin, and a scroll view cuts off what is outside it).
    scroll: { flexGrow: 0, flexShrink: 1, marginHorizontal: -layout.cardPadding },
    scrollContent: { paddingHorizontal: layout.cardPadding },
    // 「↗ 320 m」 at the first row's right end; under its words at a large font.
    distanceEnd: { alignItems: 'flex-end', flexShrink: 0, marginLeft: space.s },
    distanceUnder: { alignSelf: 'flex-start', alignItems: 'flex-start', marginTop: space.xs },
    // Measured off screen: no wrapping, never seen.
    sample: { position: 'absolute', left: 0, top: 0, width: sizes.card.measureWidth, opacity: 0, flex: 0 },
    distanceLine: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
    distance: { ...type.status, color: colors.text },
    phoneAge: { ...type.caption, color: colors.textMuted },
    noPhone: { ...type.caption, color: colors.textMuted, marginLeft: space.s, flexShrink: 0 },
    // Set apart from the row of dogs (or the face and name) above.
    rows: { marginTop: space.m, borderTopWidth: border.hairline, borderTopColor: colors.line },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: touch.cardRow,
      paddingVertical: space.s,
    },
    // Rows that are not buttons: 40dp, 56dp with a second line (位置 indoors).
    rowStill: { minHeight: sizes.card.row, paddingVertical: space.xs },
    rowTwoLine: { minHeight: sizes.card.rowTwoLine },
    rowTarget: { minHeight: touch.cardRow },
    rowLine: { borderTopWidth: border.hairline, borderTopColor: colors.line },
    // 72dp, wider when the system font makes the word longer (設計稿
    // 「卡片狀態列在大字體」): the label never wraps, the value does.
    labelCell: {
      minWidth: sizes.card.labelWidth,
      paddingLeft: space.s,
      paddingRight: space.s,
      flexShrink: 0,
      justifyContent: 'center',
    },
    rowLabel: { ...type.caption, color: colors.textMuted },
    rowValue: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: space.s,
    },
    rowTexts: { flex: 1, minWidth: 0 },
    firstLine: { flexDirection: 'row', alignItems: 'flex-start' },
    value: { ...type.value, flex: 1, flexShrink: 1 },
    detailInline: { ...type.small, color: colors.textMuted, fontWeight: type.body.fontWeight },
    detailLine: { ...type.small, color: colors.textMuted, marginTop: space.xs },
    alertLine: { ...type.small, fontWeight: type.value.fontWeight, marginTop: space.xs },
    // In front of the label text, mostly in the card's 16dp side margin
    // (3dp from the label, 5dp from the card's edge), centred on the label.
    mark: {
      position: 'absolute',
      left: sizes.card.labelMarkLeft,
      top: 0,
      bottom: 0,
      width: sizes.card.labelMark,
      justifyContent: 'center',
    },
    track: {
      minHeight: sizes.card.track,
      paddingVertical: space.xs,
      borderRadius: radius.button,
      backgroundColor: colors.tonal,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: space.m,
    },
    trackText: { ...type.cardTitle, color: colors.tonalText },
    pressed: { backgroundColor: colors.pressedOverlay },
  });
});
