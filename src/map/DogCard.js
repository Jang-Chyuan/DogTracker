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
// How long the rows' height must hold still before the card keeps it.
const ROOM_SETTLE_MS = 300;
// Opening (2026-10-14: the card grew once after it had risen): the card
// stays hidden until every dog's row is measured and the sizes have held
// still for OPEN_STILL_MS, then rises straight to its final height. If that
// takes longer than OPEN_BUDGET_MS it rises at the height it has and keeps
// it (no room added later), so opening never feels slower. (The hidden rows
// are laid out in the card's own pass, so on a phone they come with it.)
const OPEN_STILL_MS = 48;
const OPEN_BUDGET_MS = 150;
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
    // 充電中: a plain fact, like 一般 (the 電量 row says the same).
    charging: colors.text,
    missing: colors.activityMissing,
  };
});

/**
 * The round 「!」 of a problem (red) or a warning (amber) row (2026-10-14),
 * centred in its own lane between the label and the value.
 */
function Mark({ tone }) {
  const { colors } = useTheme();
  const styles = useStyles(getStyles);
  const TONE = useStyles(getTONE);
  return (
    <View style={styles.mark}>
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
 * right end, or 「手機沒有定位」. Always there, whatever the status
 * (2026-10-16): the value beside it wraps instead. The phone's own old fix
 * (「手機位置 3 分鐘前」) is a line of the row under it (StatusRow), so it
 * never widens this column and squeezes the value.
 */
function Distance({ headline, heading }) {
  const { colors } = useTheme();
  const styles = useStyles(getStyles);
  if (headline?.kind === 'no-phone') {
    return (
      <Text style={styles.noPhone} accessible={false}>
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
    <View style={styles.distanceEnd} testID="dog-card-distance">
      <View style={styles.distanceLine}>
        <View style={{ transform: [{ rotate: turn }] }} testID="dog-card-arrow">
          <Glyph name="arrow" color={colors.text} size={sizes.card.directionIcon} />
        </View>
        <Text style={styles.distance} accessible={false}>{headline.distance}</Text>
      </View>
    </View>
  );
}

function StatusRow({ row, first, onPress, headline = null, heading = 0 }) {
  const { fontScale, width } = useWindowDimensions();
  const labelWidth = sizes.card.labelWidth * Math.max(1, fontScale);
  const stacked = labelWidth + sizes.card.markLane > width * 0.4;
  // The distance always sits at the first line's right end (2026-10-16: going
  // under the words made the row a line taller, and the card kept that room
  // for every dog); a value too long beside it wraps in its own column.
  const distance = headline ? <Distance headline={headline} heading={heading} /> : null;
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
  // Three columns (2026-10-14): the label, right-aligned so every label
  // ends on one line; a lane only for the 「!」, right after it (the same on
  // every row, with or without one); the value. Label, 「!」 and value share
  // the first line; the lines under it (address, the second problem) stay
  // in the value's column. Label over value (the largest fonts): the lane
  // first, then the label and the value stacked beside it.
  const scale = Math.max(1, fontScale);
  const valueLine = type.value.lineHeight * scale;
  const label = (
    <View style={[styles.labelCell, stacked ? styles.labelCellStacked : {
      width: labelWidth, marginTop: (valueLine - type.caption.lineHeight * scale) / 2 }]}>
      <Text style={[styles.rowLabel, !stacked && styles.rowLabelEnd]} accessible={false}>
        {row.label}
      </Text>
    </View>
  );
  const lane = (
    <View
      style={[styles.lane, {
        marginTop: ((stacked ? type.caption.lineHeight * scale : valueLine) - sizes.card.labelMark) / 2,
      }]}
      testID="dog-card-mark-lane"
    >
      {markTone && <Mark tone={markTone} />}
    </View>
  );
  const head = (
    <>
      {/* The first line: the value, and the distance beside it. */}
      <View style={styles.firstLine}>
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
        {distance}
      </View>
    </>
  );
  // Under the first line, the whole width of the value's column (under the
  // distance too): the address or coordinates, two lines at most; the
  // second problem; the phone's old fix at the right edge.
  const rest = [
    row.key !== 'activity' && row.detail ? (
      <Text key="detail" style={styles.detailLine} numberOfLines={linesFor(2)} accessible={false}>
        {row.detail}
      </Text>
    ) : null,
    // Measuring only (an address still asked): the room of its lines.
    row.reserveLines && !row.detail ? (
      <View key="room" style={[styles.detailRoom, {
        height: row.reserveLines * type.small.lineHeight * scale,
      }]} />
    ) : null,
    row.alert ? (
      <Text key="alert" style={[styles.alertLine, { color: TONE.crit.text }]} accessible={false}>
        {row.alert}
      </Text>
    ) : null,
    // Under the distance, at the row's right edge.
    headline?.kind === 'distance' && headline.phoneAge ? (
      <Text key="phoneAge" style={[styles.phoneAge, styles.phoneAgeLine]} accessible={false}>
        {headline.phoneAge}
      </Text>
    ) : null,
  ].filter(Boolean);
  const content = (
    <View
      style={[
        styles.row,
        !first && styles.rowLine,
        !row.pressable && styles.rowStill,
        !row.pressable && row.twoLine && styles.rowTwoLine,
      ]}
      testID={`dog-card-row-${row.key}`}
    >
      {stacked ? (
        <>
          {lane}
          <View style={styles.stack}>
            {label}
            <View style={styles.rowTexts}>
              {head}
              {rest}
            </View>
          </View>
        </>
      ) : (
        <View style={styles.rowBody}>
          <View style={styles.headLine}>
            {label}
            {lane}
            <View style={styles.rowTexts}>{head}</View>
          </View>
          {rest.length ? (
            <View style={{ marginLeft: labelWidth + sizes.card.markLane }}>{rest}</View>
          ) : null}
        </View>
      )}
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

/**
 * The rows' height to keep: see DogCard. Before the card is shown it follows
 * the measurements as they come (up or down); once shown it only grows, by a
 * height that has held still for ROOM_SETTLE_MS (a row measured once before
 * its address came must not keep that room) — and not at all when the card
 * opened before the measurements were done (`frozen`). It is worked out
 * afresh — and may then shrink — only when the dogs in the row change or the
 * font size does (2026-10-16: a tall dog that left kept its room); never
 * because another dog of the same row was picked.
 */
function useRowsRoom(reserve, fontScale) {
  const [heights, setHeights] = useState({});
  const keys = new Set(['rows', 'first', ...reserve.map(item => `dog-${item.key}`)]);
  const changedAt = useRef(0);
  const measure = (key, event) => {
    const height = Math.round(event.nativeEvent.layout.height);
    setHeights(current => {
      if (current[key] === height) return current;
      changedAt.current = Date.now();
      return { ...current, [key]: height };
    });
  };
  const firsts = Object.entries(heights).filter(([key]) => key === 'first' || (key.startsWith('dog-') && keys.has(key)))
    .map(([, height]) => height);
  const want = heights.rows ? heights.rows - (heights.first ?? 0) + Math.max(0, ...firsts) : 0;
  const measuredAll = [...keys].every(key => heights[key] != null);
  const [held, setHeld] = useState(0);
  const shown = useRef(false);
  const frozen = useRef(false);
  // Which dogs are in the row (in any order: the open one comes first) and
  // the font size: a change of either measures the room again.
  const dogsKey = `${fontScale}|${reserve.map(item => item.key).sort((a, b) => a - b).join(',')}`;
  const lastDogs = useRef(dogsKey);
  const remeasure = useRef(false);
  if (lastDogs.current !== dogsKey) {
    lastDogs.current = dogsKey;
    if (shown.current) {
      remeasure.current = true;
      frozen.current = false;
    }
  }
  useEffect(() => {
    if (!shown.current) return undefined;
    if (remeasure.current) {
      if (!measuredAll || !want) return undefined;
      const timer = setTimeout(() => {
        remeasure.current = false;
        setHeld(want);
      }, ROOM_SETTLE_MS);
      return () => clearTimeout(timer);
    }
    if (frozen.current || want <= held) return undefined;
    const timer = setTimeout(() => setHeld(current => Math.max(current, want)), ROOM_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [want, held, measuredAll, dogsKey]);
  // Shown: what it took when it rose, then only more (see above).
  const wantRef = useRef(want);
  wantRef.current = want;
  const open = () => {
    shown.current = true;
    setHeld(wantRef.current);
  };
  return { room: shown.current ? held : want, measure, ready: measuredAll, changedAt, frozen, open };
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
  const { height: windowHeight, width: windowWidth, fontScale } = useWindowDimensions();
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
  // card is open — so neither the card nor the map buttons jump. Since
  // 2026-10-16 that tallest row is only the lines a dog really has (the
  // distance stays beside the first line), and the room is measured again
  // when the dogs in the row or the font size change.
  const room = useRowsRoom(reserve, fontScale || 1);
  const reserveRef = useRef(reserve);
  reserveRef.current = reserve;
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
  // Hidden until it opens (see OPEN_STILL_MS): the height it would have.
  const pending = useRef({ value: 0, since: 0, timer: null });
  useEffect(() => () => clearTimeout(pending.current.timer), []);
  const rise = value => {
    room.open();
    measured.current = value;
    setHeight(value);
    callbacks.current.onHeight?.(value);
    offset.setValue(value);
    slideOrFade(offset, 0, {
      fade,
      show: true,
      duration: motion.cardRise.duration,
      easing: ease,
    }).start();
  };
  const roomRef = useRef(room);
  roomRef.current = room;
  const tryOpen = () => {
    const wait = pending.current;
    clearTimeout(wait.timer);
    if (measured.current || !wait.value) return;
    const current = roomRef.current;
    const now = Date.now();
    const still = now - Math.max(current.changedAt.current, wait.changedAt ?? 0) >= OPEN_STILL_MS;
    if (!reserveRef.current.length || (current.ready && still)) {
      rise(wait.value);
    } else if (now - wait.since >= OPEN_BUDGET_MS) {
      current.frozen.current = true;
      rise(wait.value);
    } else {
      wait.timer = setTimeout(tryOpen, OPEN_STILL_MS / 3);
    }
  };
  const onLayout = event => {
    const own = Math.round(event.nativeEvent.layout.height);
    // What it covers, counted from the screen bottom (it floats above it).
    const value = own ? own + CARD_INSET + insets.bottom : 0;
    if (!value) return;
    if (!measured.current) {
      if (value !== pending.current.value) {
        pending.current.value = value;
        pending.current.changedAt = Date.now();
      }
      if (!pending.current.since) pending.current.since = Date.now();
      tryOpen();
      return;
    }
    if (value === measured.current) return;
    measured.current = value;
    setHeight(value);
    callbacks.current.onHeight?.(value);
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
        bounces={false}
        scrollEventThrottle={16}
        onScroll={event => {
          scrollTop.current = event.nativeEvent.contentOffset.y;
        }}
      >
        <View style={[styles.rows, { minHeight: room.room }]}>
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
    scroll: { flexGrow: 0, flexShrink: 1 },
    // 「↗ 320 m」 at the first row's right end, at every font.
    distanceEnd: { alignItems: 'flex-end', flexShrink: 0, marginLeft: space.s },
    distanceLine: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
    distance: { ...type.status, color: colors.text },
    phoneAge: { ...type.caption, color: colors.textMuted },
    phoneAgeLine: { textAlign: 'right' },
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
    // 68dp, wider when the system font makes the word longer (設計稿
    // 「卡片狀態列在大字體」): the label never wraps, the value does.
    labelCell: {
      minWidth: sizes.card.labelWidth,
      paddingLeft: space.s,
      flexShrink: 0,
    },
    labelCellStacked: { paddingLeft: 0 },
    // Every label ends on the same line, 4dp before the 「!」.
    rowLabelEnd: { textAlign: 'right' },
    // The 「!」 lane: 4dp after the label, the 16dp 「!」, 8dp before the value
    // — the same on every row; level with the first line.
    lane: {
      width: sizes.card.markLane,
      paddingLeft: space.xs,
      alignSelf: 'flex-start',
      flexShrink: 0,
    },
    rowBody: { flex: 1 },
    headLine: { flexDirection: 'row', alignItems: 'flex-start' },
    // Label over value (the largest fonts), right of the lane.
    stack: { flex: 1, gap: space.xs },
    rowLabel: { ...type.caption, color: colors.textMuted },
    rowTexts: { flex: 1, minWidth: 0 },
    firstLine: { flexDirection: 'row', alignItems: 'flex-start' },
    value: { ...type.value, flex: 1, flexShrink: 1 },
    detailInline: { ...type.small, color: colors.textMuted, fontWeight: type.body.fontWeight },
    detailLine: { ...type.small, color: colors.textMuted, marginTop: space.xs },
    detailRoom: { marginTop: space.xs },
    alertLine: { ...type.small, fontWeight: type.value.fontWeight, marginTop: space.xs },
    mark: { width: sizes.card.labelMark, height: sizes.card.labelMark },
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
