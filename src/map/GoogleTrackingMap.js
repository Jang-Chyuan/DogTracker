import { t } from '../i18n';
import { logger } from '../logger';
import { useTheme, useStyles, makeStyles } from '../theme/ThemeProvider';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Animated,
  PixelRatio,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MapView, {
  Marker as GoogleMarker,
  Circle,
  Polygon,
  Polyline,
  PROVIDER_GOOGLE,
} from 'react-native-maps';
import {
  layout,
  motion,
  size as sizes,
  border,
  space,
  type,
  touch,
} from '../theme/tokens';

import { MAP_LOAD_TIMEOUT_MS } from './TrackingMap';
import PhoneLocationOverlay from './PhoneLocationOverlay';
import HistoryCursor from '../mapHistory/HistoryCursor';
import {
  CursorFaceView,
  CursorMarkerView,
  cursorAnchor,
  IndoorMarkerView,
  StopMarkerView,
  TimeMarkerView,
} from '../mapHistory/HistoryMapMarkers';
import {
  historyFramePadding,
  nearestRouteSpot,
  routeGeometryIdentity,
  uncrowded,
} from '../history/screen/HistoryMapModel';
import DogMarkerView, { markerFrame } from './DogMarkerView';
import SeparatedDogMarkers from './SeparatedDogMarkers';
import { dogAtPoint, groupsAtZoom, nameTags } from './DogMarkers';
import {
  reportMapFramed,
  splashChrome,
  useSplashMarkersHidden,
} from '../app/hideSplash';
import { moveDuration } from '../utils/reduceMotion';
import MarkerA11yLayer, { markerA11yItems, stopSpeech } from './MarkerA11yLayer';
import { behindSheet } from '../utils/a11yFocus';
import {
  framedCoordinates,
  framePadding,
  frameAllCoordinates,
  receiverDogsCoordinates,
  phoneFix,
  PHONE_FIX_MAX_AGE_S,
  regionForFrame,
  overlayFramePadding,
} from './MapFraming';
import { edgeHints, markerBox, boxesOverlap, mapControlBoxes, hintBox } from './EdgeHints';
import { CompassButton, EdgeHintView, MapButtons, MapTip } from './MapControls';

// '#RRGGBB' at an opacity, as '#RRGGBBAA' for the map SDK.
const withOpacity = (hex, alpha) =>
  hex +
  Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();
// Range ring (DESIGN.md 判定表「接收範圍圈」): 1.5dp dashed 6/4 in rangeRing at
// 55%, filled with the same colour at 6%. Out-of-range line: critLine, 2dp,
// dashed 6/4. Widths are dp; Android takes dash lengths in pixels.
const getRANGE_RING = makeStyles(theme => {
  const { colors: tokens, opacity } = theme;
  return {
    stroke: withOpacity(tokens.rangeRing, opacity.rangeRingStroke),
    fill: withOpacity(tokens.rangeRing, opacity.rangeRingFill),
    width: border.regular,
  };
});
const OUT_OF_RANGE_WIDTH = 2;
const dash = () =>
  [6, 4].map(length => PixelRatio.getPixelSizeForLayoutSize(length));
// Drawing order: base map, ring, red lines, routes, dogs and phone.
const Z = { ring: 1, rangeLine: 2, route: 3 };
// A base map that draws nothing but grey (design #ECEEEC): what a map without
// tiles looks like, for the 地圖載入失敗 fixture.
const getNO_BASE_MAP = makeStyles(theme => {
  const { colors: tokens } = theme;
  return [
    { stylers: [{ visibility: 'off' }] },
    {
      featureType: 'landscape',
      elementType: 'geometry',
      stylers: [{ visibility: 'on' }, { color: tokens.mapFallback }],
    },
    {
      featureType: 'water',
      elementType: 'geometry',
      stylers: [{ visibility: 'on' }, { color: tokens.mapFallback }],
    },
  ];
});

// The launch screen is released once the first framing has been drawn, or
// this long after the map loaded when there is still nothing to frame (the
// native side lets go after 10 s whatever happens).
export const FIRST_FRAME_WAIT_MS = 3000;
// When there is nothing to frame, the most the launch screen is held from the
// map's mount, whatever is still loading (the phone's first fix, tiles).
export const FRAMING_WAIT_MAX_MS = 9000;
// A fit is drawn within a frame or two; release the launch screen after it
// even if the map reports no camera change (the camera was already there).
const AFTER_FIT_MS = 250;
// The map's own padding at the sides (dp).
const MAP_SIDE_PADDING = layout.floatingGap;
// How long a map tap waits for a dog tap that came with it (066).
export const MAP_TAP_HOLD_MS = 250;
// Dogs' screen places are read again this often, at most this many times,
// until two reads agree (the camera stopped).
const POINTS_SETTLE_MS = 400;
const POINTS_SETTLE_READS = 10;
const POINTS_MIN_SETTLE_MS = 800;
const POINTS_SLOW_MS = 1500;
const POINTS_SLOW_READS = 20;
/** Two reads of the dogs' screen places agree (within 1 dp). */
export function pointsSettled(previous, next) {
  if (!previous) return false;
  const ids = Object.keys(next);
  if (ids.length !== Object.keys(previous).length) return false;
  return ids.every(id => previous[id] && Math.abs(previous[id].x - next[id].x) <= 1
    && Math.abs(previous[id].y - next[id].y) <= 1);
}
// History framing: 24dp all round, the cursor label on top, 框住全部 below.
// Coordinates are marker centres: reserve the complete stop circle above the panel.
const HISTORY_FRAME = { top: space.l, right: space.xl,
  bottom: sizes.stopMarker.size / 2 + space.s, left: space.xl };
// Coordinates all within about 30 m of each other.
const tinySpan = points => {
  const lat = points.map(p => p.latitude),
    lon = points.map(p => p.longitude);
  return (
    Math.max(...lat) - Math.min(...lat) < 0.0003 &&
    Math.max(...lon) - Math.min(...lon) < 0.0003
  );
};
// A tap this close to the route (dp) is a tap on it.
const ROUTE_TAP_DP = 24;
// A touch that let go within this time and this far from where it began is a
// tap (the map's own double-tap wait is about 300 ms).
const QUICK_TAP_MS = 250;
const QUICK_TAP_SLOP = 10;
// The map reports the same tap at most this long after the touch ended.
const QUICK_TAP_HANDLED_MS = 600;
// Metres between two coordinates (equirectangular: a few km at most).
const metresApartOf = (a, b) =>
  Math.hypot(
    (b.longitude - a.longitude) * Math.cos((a.latitude * Math.PI) / 180) * 111320,
    (b.latitude - a.latitude) * 110540,
  );

// Every marker on our maps (「地圖標記一律用自己的樣式」) goes through here and
// draws a view of its own: react-native-maps draws Google's red default pin
// for a marker with no view. Debug builds report a marker given nothing to
// draw (MarkerArchitecture.test.js checks every marker element in src).
// The SDK also has moments with no view at all: a new marker before its view
// arrives, and (Fabric) a marker whose view is removed before the marker
// itself. patches/react-native-maps+*.patch keeps the marker hidden then
// (ReactNativeMapsPatch.test.js).
export const StyledMarker = React.forwardRef(function StyledMarker(
  { children, ...props },
  ref,
) {
  if (__DEV__ && React.Children.count(children) === 0) {
    logger.error(
      `[Marker] ${
        props.identifier || 'a marker'
      } has no view of its own: it would be drawn as Google's default pin`,
    );
  }
  return (
    <GoogleMarker ref={ref} {...props}>
      {children}
    </GoogleMarker>
  );
});

const EMPTY_REGION = {
  latitude: 23.7,
  longitude: 121,
  latitudeDelta: 4,
  longitudeDelta: 4,
};
// A photo face reaches the marker's bitmap only once it has decoded and been
// drawn; a redraw at onLoad alone can still capture the empty frame. So while
// a photo is new the marker follows its view's changes, and a moment after the
// photo has loaded (or at the latest PHOTO_TRACK_MAX_MS) it goes back to a
// fixed bitmap.
export const PHOTO_SETTLE_MS = 600;
export const PHOTO_TRACK_MAX_MS = 4000;
function usePhotoMarker(avatar, ref) {
  const photo = avatar?.kind === 'photo' ? avatar.uri : '';
  const photoKey = photo ? `${photo.length}:${photo.slice(-24)}` : '';
  const [tracking, setTracking] = useState(!!photoKey);
  const timer = useRef(null);
  const settle = useCallback(
    delay => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setTracking(false);
        ref.current?.redraw?.();
      }, delay);
    },
    [ref],
  );
  useEffect(() => {
    if (!photoKey) return;
    setTracking(true);
    settle(PHOTO_TRACK_MAX_MS);
  }, [photoKey, settle]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const onLoad = useCallback(() => {
    ref.current?.redraw?.();
    settle(PHOTO_SETTLE_MS);
  }, [ref, settle]);
  return { tracking, onLoad };
}

// One dog on the live map. The marker view is not tracked for changes (that
// would redraw it on every frame), so every change of what it shows asks for
// one redraw. A tap opens the dog.
function DogMarker({ source, marker, tag, avatar, zIndex, onPress, label, shownKey = 0 }) {
  const { isDark, opacity } = useTheme();
  // The launch screen's handover draws a copy of each dog over the map while
  // it flies and pops them in; the real marker shows once they are in place.
  const handover = useSplashMarkersHidden();
  const ref = useRef(null);
  const photo = usePhotoMarker(avatar, ref);
  const settled = useSettledMarker(ref);
  const frame = markerFrame(marker.size);
  const look = [
    marker.size,
    marker.problem,
    marker.stale,
    marker.indoor,
    marker.selected,
    marker.staleRing,
    marker.tint,
    tag?.text,
    tag?.problem,
    avatar?.kind,
    avatar?.art,
    avatar?.color,
    avatar?.uri?.length,
  ].join('|');
  // Also each time the map is shown again: a bitmap taken while the map was
  // hidden under a page (or the app off screen) can be Google's default pin.
  useEffect(() => {
    ref.current?.redraw?.();
  }, [look, isDark, shownKey]);
  return (
    <StyledMarker
      ref={ref}
      identifier={source + '-dog-' + marker.slaveId}
      coordinate={marker.coordinate}
      anchor={frame.anchor}
      tracksViewChanges={photo.tracking || settled.tracking}
      // 070: dimmed, in its own colours, while a return to the app catches
      // the map up (the SDK's own opacity: no new bitmap, no redraw).
      opacity={handover ? 0 : marker.dimmed ? opacity.catchingUp : 1}
      zIndex={zIndex}
      // No title or description: those draw the SDK's own bubble, and a tap
      // already opens the dog. The label below is what TalkBack reads.
      onPress={onPress}
    >
      <View
        collapsable={false}
        accessible
        accessibilityLabel={label || marker.label}
        onLayout={settled.onLayout}
      >
        <DogMarkerView
          marker={marker}
          tag={tag}
          avatar={avatar}
          onAvatarLoad={photo.onLoad}
        />
      </View>
    </StyledMarker>
  );
}

// TalkBack for the face carrying a 「3 隻」 tag: the dogs in it, and what a
// double tap does (it opens the dog carrying the tag; no list, 066).
function groupSpeech(tag, markers, carrier) {
  const names = tag.members
    .map(id => markers.find(marker => marker.slaveId === id)?.name)
    .filter(Boolean);
  const name = markers.find(marker => marker.slaveId === carrier)?.name ?? names[0];
  return t("c1162", { text: tag.text, value: names.join('、'), name });
}

// ---- the history route (055a) -------------------------------------------
// A marker whose bitmap is taken before its view has been laid out is drawn
// as the SDK's default red pin for a moment (seen right after a fixture or a
// data switch). So a new marker follows its view until that view has been
// laid out once, then keeps a fixed bitmap (one redraw per change after).
function useSettledMarker(ref) {
  const [tracking, setTracking] = useState(true);
  const frame = useRef(null);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  const onLayout = useCallback(() => {
    if (!tracking) {
      ref.current?.redraw?.();
      return;
    }
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      setTracking(false);
      ref.current?.redraw?.();
    });
  }, [tracking, ref]);
  return { tracking, onLayout };
}

// Fixed bitmaps, like DogMarker: every change of what one shows asks for one
// redraw. Time markers sit under the stop numbers, the cursor on top.
function RouteMarker({
  coordinate,
  look,
  zIndex,
  anchor = CENTER,
  onPress,
  children,
  label,
}) {
  const { isDark } = useTheme();
  const ref = useRef(null);
  const settled = useSettledMarker(ref);
  useEffect(() => {
    ref.current?.redraw?.();
  }, [look, isDark]);
  return (
    <StyledMarker
      ref={ref}
      coordinate={coordinate}
      anchor={anchor}
      tracksViewChanges={settled.tracking}
      zIndex={zIndex}
      onPress={onPress}
      tappable={!!onPress}
    >
      <View
        collapsable={false}
        accessible={!!label}
        accessibilityLabel={label}
        onLayout={settled.onLayout}
      >
        {children}
      </View>
    </StyledMarker>
  );
}
const CENTER = { x: 0.5, y: 0.5 };

function CursorMarker({ cursor, color }) {
  const { isDark } = useTheme();
  const [labelHeight, setLabelHeight] = useState(44);
  const ref = useRef(null);
  const settled = useSettledMarker(ref);
  const face = cursor.face ?? null;
  const look = `${cursor.lines?.join('|')}:${
    cursor.stale
  }:${labelHeight}:${color}:${face?.name ?? ''}:${
    face?.avatar?.uri?.length ?? face?.avatar?.art ?? ''
  }`;
  useEffect(() => {
    ref.current?.redraw?.();
  }, [look, cursor.key, isDark]);
  const height = value => {
    if (Math.abs(value - labelHeight) > 0.5) setLabelHeight(value);
  };
  return (
    <StyledMarker
      ref={ref}
      coordinate={cursor.coordinate}
      anchor={cursorAnchor(labelHeight, !!face)}
      tracksViewChanges={settled.tracking}
      zIndex={60}
      tappable={false}
    >
      <View collapsable={false} onLayout={settled.onLayout}>
        {face ? (
          <CursorFaceView
            lines={cursor.lines}
            color={color}
            stale={cursor.stale}
            face={face}
            onLabelHeight={height}
          />
        ) : (
          <CursorMarkerView
            lines={cursor.lines}
            color={color}
            stale={cursor.stale}
            onLabelHeight={height}
          />
        )}
      </View>
    </StyledMarker>
  );
}

// A middle time marker keeps this far (dp) from a number, the ends and other
// times at the zoom shown — one 「08:00」 label wide.
const TIME_APART_DP = 48;

// One drawn piece of the history route. Re-rendered only when the piece
// itself changed (its id: times, length, width, colour, dash), so a cursor
// move leaves every other piece's thousands of points alone (067).
const HistoryLine = React.memo(
  function HistoryLine({ line, casing, dashed }) {
    return (
      <>
        {casing && (
          <Polyline
            coordinates={line.coordinates}
            strokeColor={casing}
            strokeWidth={line.width + 2}
            zIndex={Z.route - 0.6}
            lineDashPattern={line.dashed ? dashed : undefined}
            tappable={false}
          />
        )}
        <Polyline
          coordinates={line.coordinates}
          geodesic={false}
          strokeColor={line.color}
          strokeWidth={line.width}
          zIndex={line.dashed ? Z.route - 0.5 : Z.route}
          lineDashPattern={line.dashed ? dashed : undefined}
          lineCap={line.dashed ? 'butt' : 'round'}
          lineJoin="round"
          tappable={false}
        />
      </>
    );
  },
  (before, after) =>
    before.line.id === after.line.id &&
    before.casing === after.casing &&
    before.dashed === after.dashed,
);

function HistoryRoute({ route, onStopPress, metresPerDp = 0 }) {
  const { colors, isDark } = useTheme();
  const dashed = useMemo(
    () => [4, 4].map(length => PixelRatio.getPixelSizeForLayoutSize(length)),
    [],
  );
  // The model leaves out times within 150 m; zoomed out, 150 m is a few dp,
  // so the labels would sit on each other: the same rule in screen distance.
  const apartM = metresPerDp * TIME_APART_DP;
  // Until the map has told its zoom, only the ends (a middle time drawn and
  // then taken away again flickers).
  const times = useMemo(
    () =>
      !metresPerDp
        ? route.times.filter(marker => marker.end)
        : apartM > 150
        ? uncrowded(route.times, route.places, apartM)
        : route.times,
    [route.times, route.places, apartM, metresPerDp],
  );
  return (
    <>
      {route.lines.map(line => (
        // A dashed line and a solid one are never the same native line: the
        // SDK keeps an old dash pattern when it is taken away.
        <HistoryLine
          key={`route-${line.dashed ? 'dashed' : 'solid'}-${line.start}`}
          line={line}
          casing={isDark ? colors.routeCasing : null}
          dashed={dashed}
        />
      ))}
      {times.map(marker => (
        <RouteMarker
          key={marker.key}
          coordinate={marker.coordinate}
          look={`${marker.label}:${marker.end}`}
          zIndex={20}
        >
          <TimeMarkerView
            label={marker.label}
            end={marker.end}
            color={route.color}
          />
        </RouteMarker>
      ))}
      {route.places.map(place => (
        <RouteMarker
          key={place.key}
          coordinate={place.coordinate}
          look={`${place.kind}:${place.number}`}
          zIndex={place.kind === 'indoor' ? 26 : 25}
          label={place.kind === 'indoor' ? t('c114') : t('c136', { duration: place.number })}
          onPress={onStopPress ? () => onStopPress(place) : undefined}
        >
          {place.kind === 'indoor' ? (
            <IndoorMarkerView />
          ) : (
            <StopMarkerView number={place.number} color={route.color} />
          )}
        </RouteMarker>
      ))}
      {route.cursor && (
        <CursorMarker cursor={route.cursor} color={route.color} />
      )}
    </>
  );
}

/**
 * The dogs the launch screen hands over to: on screen (inside the map, clear
 * of the status bar and the bottom), the one nearest the middle first, then
 * the others nearest to it (they pop in in that order).
 */
export function splashTargets(inputs, points, fontScale = 1) {
  const { dogMarkers, avatars, width, height, top = 0, bottom = 0 } = inputs;
  if (!width || !height) return [];
  const tags = nameTags(dogMarkers, points, fontScale);
  const shown = dogMarkers
    .map(marker => ({ marker, point: points[marker.slaveId] }))
    .filter(
      ({ point }) =>
        point &&
        point.x >= 0 &&
        point.x <= width &&
        point.y >= top &&
        point.y <= height - bottom,
    );
  if (!shown.length) return [];
  const distance = (a, x, y) => Math.hypot(a.point.x - x, a.point.y - y);
  const first = shown.reduce((best, item) =>
    distance(item, width / 2, height / 2) <
    distance(best, width / 2, height / 2)
      ? item
      : best,
  );
  const rest = shown
    .filter(item => item !== first)
    .sort(
      (a, b) =>
        distance(a, first.point.x, first.point.y) -
        distance(b, first.point.x, first.point.y),
    );
  return [first, ...rest].map(({ marker, point }) => ({
    slaveId: marker.slaveId,
    x: point.x,
    y: point.y,
    marker,
    tag: tags[marker.slaveId] ?? null,
    avatar: avatars[marker.slaveId] ?? null,
  }));
}

function GoogleTrackingMapRenderer({
  source,
  presentation,
  topInset,
  bottomInset,
  // The base map's state for the top card (TopAlerts): 'loading', 'ok',
  // 'load-failed' (no tiles: the map still draws on grey), 'retrying' or
  // 'unavailable' (the map itself cannot open).
  onMapState,
  // A new value is a press on the card's 重試: the map is opened again.
  retryKey = 0,
  // Debug screen fixtures only: 'tiles' draws the map without a base map
  // (as when it cannot load), 'component' as if the map could not open.
  failure = null,
  // How far down the top cards reach (0: none). Like coverBottom the map's
  // own padding stays put; hints, framing and the compass keep clear of them.
  coverTop = 0,
  // Where the compass sits (12dp under the gear or under the top cards).
  compassTop = null,
  onReadyChange,
  foreground,
  dataReady = true,
  framingReady = true,
  onNativePhone,
  phoneEnabled,
  livePhone,
  onDogPress,
  // A sheet is open over the map (history): hidden from TalkBack.
  a11yHidden = false,
  // A tap on the map itself (not on a dog): closes the open card.
  onMapPress,
  // The map's rotation in degrees (the card's direction arrow follows it).
  onHeading,
  // { key, coordinate }: a dog's card just opened; bring the dog into view
  // above it if the card or the screen edge hides it (once per key).
  focusDog,
  // { key, receiverId }: frame that receiver's located dogs once (back from
  // D3 opened by A6); nothing located leaves the map where it is.
  frameRequest = null,
  // How much of the bottom an open card covers (0: none). The map's own
  // padding stays at bottomInset — changing it would shift the whole map each
  // time a card opens — so only what is drawn over the map (buttons, hints,
  // the overlap menu) and the moves the user asks for keep clear of the card.
  coverBottom = 0,
  // 「今天 x km」 (TodayDistance.todayPill) beside 我的位置, and its tap.
  today = null,
  onToday,
  // The history screen (presentation.historyRoute): a tap on the route or a
  // drag of the cursor (time, 'route' | 'drag'), a stop number tapped,
  // { key, coordinate } to bring the cursor into view (220 ms), { key } to
  // frame the route (框住全部).
  onCursorMove,
  onStopPress,
  historyFocus = null,
  historyFrame = null,
  supported,
  configured,
}) {
  const { appColors: colors, colors: tokens } = useTheme();
  const { isDark, mapStyle } = useTheme();
  const NO_BASE_MAP = useStyles(getNO_BASE_MAP);
  const RANGE_RING = useStyles(getRANGE_RING);
  const styles = useStyles(getStyles);
  const {
    slaveSegments,
    rangeRing,
    rangeLines = [],
    cameraPositions: positions,
  } = presentation;
  const mapRef = useRef(null);
  const [cursorLayout, setCursorLayout] = useState({ width: 0, height: 0 });
  // Metres per dp at the zoom shown (the history's time markers keep apart).
  const [metresPerDp, setMetresPerDp] = useState(0);
  const [cursorRevision, setCursorRevision] = useState(0);
  const [cursorDragging, setCursorDragging] = useState(false);
  const historyRoute = presentation.historyRoute || null;
  const [attempt, setAttempt] = useState(0);
  const nativePhone = useRef(null);
  const phoneCentered = useRef(false);
  const [readyInstance, setReadyInstance] = useState(null);
  const [loadedInstance, setLoadedInstance] = useState(null);
  const [timedOut, setTimedOut] = useState(false);
  const instance = String(attempt);
  // Where each dog is on screen, read after every camera move, so name tags
  // that would run into each other merge into one 「3 隻」 tag.
  const dogMarkers = useMemo(
    () => presentation.dogMarkers || [],
    [presentation.dogMarkers],
  );
  // { source, points }: points from another source (a fixture or data
  // source switch moves every dog) are never used for this one.
  const [dogPoints, setDogPoints] = useState({ source: null, points: {} });
  const [displayDogPoints, setDisplayDogPoints] = useState(null);
  // The last read places and the re-reads made while they still change.
  const lastRead = useRef(null);
  const settleReads = useRef(0);
  const settleTimer = useRef(null);
  useEffect(() => () => clearTimeout(settleTimer.current), []);
  // While the camera moves (a drag, or a move the user asked for) the screen
  // points are out of date: the off-screen hints wait for the next read.
  const moving = useRef(false);
  const [movingState, setMovingState] = useState(false);
  const movingTimer = useRef(null);
  const moveStartedAt = useRef(0);
  const startMoving = useCallback(() => {
    moveStartedAt.current = Date.now();
    settleReads.current = 0;
    if (moving.current) return;
    moving.current = true;
    setMovingState(true);
    // A move to where the camera already is reports no change: read again
    // after a moment anyway, so the hints never stay hidden.
    clearTimeout(movingTimer.current);
    movingTimer.current = setTimeout(() => {
      if (moving.current) setCursorRevision(value => value + 1);
    }, POINTS_SETTLE_MS);
  }, []);
  useEffect(() => () => clearTimeout(movingTimer.current), []);
  const pointsKey = dogMarkers
    .map(
      marker =>
        `${marker.slaveId}:${marker.coordinate.latitude},` +
        `${marker.coordinate.longitude}:${marker.size}`,
    )
    .join('|');
  // Counts the times the map came back on screen (DogMarker redraws then).
  const [shownKey, setShownKey] = useState(0);
  const wasShown = useRef(foreground);
  useEffect(() => {
    if (foreground && !wasShown.current) setShownKey(value => value + 1);
    wasShown.current = foreground;
  }, [foreground]);
  const activeInstance = useRef(instance);
  activeInstance.current = instance;
  const ready = readyInstance === instance;
  const loaded = loadedInstance === instance;
  // onMapReady can precede native layout under Fabric. onMapLoaded is the first
  // callback after which bounds-based camera commands are safe on Android.
  const usable = ready && loaded;
  const [mountedMap, setMountedMap] = useState(false);
  const [needsFirstPositionFit, setNeedsFirstPositionFit] = useState(false);
  const interacted = useRef(false);
  const savedView = useRef(null);
  const framed = useRef(false);
  const afterFit = useRef(null);
  useEffect(() => () => clearTimeout(afterFit.current), []);
  const splashReleased = useRef(false);
  // The latest the launch screen is held when there is nothing to frame.
  const splashDeadline = useRef(Date.now() + FRAMING_WAIT_MAX_MS);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // What the launch screen's handover needs (「D0 → 地圖銜接（C）」): the dogs
  // on screen where they are drawn, the nearest to the middle first.
  const splashInputs = useRef({});
  splashInputs.current = {
    dogMarkers,
    avatars: presentation.dogAvatars || {},
    width: cursorLayout.width,
    height: cursorLayout.height,
    top: topInset,
    bottom: bottomInset,
  };
  const releaseSplash = useCallback(() => {
    if (splashReleased.current) return;
    splashReleased.current = true;
    const map = mapRef.current;
    const inputs = splashInputs.current;
    if (!inputs.dogMarkers.length || !map?.pointForCoordinate) {
      reportMapFramed([]);
      return;
    }
    Promise.all(
      inputs.dogMarkers.map(marker =>
        map
          .pointForCoordinate(marker.coordinate)
          .then(point => [marker.slaveId, point])
          .catch(() => null),
      ),
    )
      .then(entries => {
        // The map was replaced or closed meanwhile (a new source, a fixture
        // switch): its next framing reports instead.
        if (!mounted.current || mapRef.current !== map) {
          splashReleased.current = false;
          return;
        }
        reportMapFramed(
          splashTargets(
            inputs,
            Object.fromEntries(entries.filter(Boolean)),
            PixelRatio.getFontScale?.() || 1,
          ),
        );
      })
      .catch(() => reportMapFramed([]));
  }, []);
  const fontScale = PixelRatio.getFontScale?.() || 1;
  // Framing keeps clear of the bottom right buttons too (16dp + 48dp), and on
  // the live map of the bottom row they stand on (「今天 x km」 beside 我的位置,
  // 48dp), so no dog or name tag is framed under them.
  // The history screen, also while its day is still being read (no route
  // yet): never the live phone, its dot or the live buttons in between.
  const historyMode = !!historyRoute || !!presentation.historyMode;
  const bottomRow = historyMode ? 0 : sizes.floatingButton;
  const padding = useMemo(() => {
    const value = framePadding(dogMarkers, fontScale);
    return {
      ...value,
      right: value.right + layout.screenEdge + sizes.floatingButton,
      bottom: value.bottom + bottomRow,
    };
  }, [dogMarkers, fontScale, bottomRow]);
  const cameraRead = useRef(0);
  // Android owns pause/resume. Replacing a healthy map on every resume retains
  // old SDK frame callbacks and duplicates all history overlays. Recentring
  // the phone only moves the camera; it never replaces the map surface.
  useEffect(() => {
    if (!dataReady || mountedMap) return;
    // The first view is always one fit of what the presentation frames, made
    // under the launch screen (initialRegion only centres on the first point).
    setNeedsFirstPositionFit(true);
    setMountedMap(true);
  }, [dataReady, mountedMap]);
  useEffect(() => {
    const map = mapRef.current;
    // Read for one dog too: the off-screen hints need to know where it is.
    if (!usable || dogMarkers.length < 1 || !map?.pointForCoordinate)
      return undefined;
    let alive = true;
    Promise.all(
      dogMarkers.map(marker =>
        map
          .pointForCoordinate(marker.coordinate)
          .then(point => [marker.slaveId, point])
          .catch(() => null),
      ),
    ).then(entries => {
      if (!alive) return;
      const points = Object.fromEntries(entries.filter(Boolean));
      setDogPoints({ source, points });
      // A camera move does not always report its end (a move the app asked
      // for, on a busy phone): read again until two reads agree, so the
      // off-screen hints never use the places from before the move (066:
      // hints for dogs that were on screen after a card opened).
      // During a move, places read before the camera can have got going
      // (a busy phone) do not count as settled.
      const settled = pointsSettled(lastRead.current, points)
        && (!moving.current || Date.now() - moveStartedAt.current >= POINTS_MIN_SETTLE_MS);
      lastRead.current = points;
      clearTimeout(settleTimer.current);
      if (!settled && settleReads.current < POINTS_SETTLE_READS + POINTS_SLOW_READS) {
        // Quick re-reads first, then slower ones; the hints stay hidden
        // until two reads agree (or, at the very end, the last read is used).
        const delay = settleReads.current < POINTS_SETTLE_READS ? POINTS_SETTLE_MS : POINTS_SLOW_MS;
        settleReads.current += 1;
        settleTimer.current = setTimeout(
          () => setCursorRevision(value => value + 1),
          delay,
        );
        return;
      }
      settleReads.current = 0;
      // Read after the camera stopped: the off-screen hints are right again.
      if (moving.current) {
        moving.current = false;
        setMovingState(false);
      }
    });
    return () => {
      alive = false;
    };
    // pointsKey stands for dogMarkers' positions and sizes; a new size or
    // padding of the map moves every dog on screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    usable,
    pointsKey,
    cursorRevision,
    source,
    cursorLayout.width,
    cursorLayout.height,
    topInset,
    bottomInset,
  ]);
  // Where the history's stops are on screen, for TalkBack (MarkerA11yLayer):
  // read again whenever the camera stops.
  const [stopPoints, setStopPoints] = useState(null);
  const historyPlaces = historyRoute?.places;
  useEffect(() => {
    const map = mapRef.current;
    if (!usable || !historyPlaces?.length || !map?.pointForCoordinate) {
      setStopPoints(null);
      return undefined;
    }
    let alive = true;
    Promise.all(
      historyPlaces.map(place =>
        map
          .pointForCoordinate(place.coordinate)
          .then(point => ({
            id: place.key,
            label: stopSpeech(place),
            x: point.x,
            y: point.y,
            place,
          }))
          .catch(() => null),
      ),
    ).then(items => {
      if (alive) setStopPoints(items.filter(Boolean));
    });
    return () => {
      alive = false;
    };
  }, [usable, historyPlaces, cursorRevision, cursorLayout.width, cursorLayout.height]);
  const projecting =
    usable &&
    dogMarkers.length > 1 &&
    typeof mapRef.current?.pointForCoordinate === 'function';
  const tags = useMemo(() => {
    const points = dogPoints.source === source ? dogPoints.points : null;
    // Just switched source: no tags for the moment it takes to place them,
    // rather than separate tags that then jump into a group (or a group made
    // from where the previous source's dogs were).
    if (projecting && !points)
      return Object.fromEntries(
        dogMarkers.map(marker => [marker.slaveId, null]),
      );
    // Within one source a dog that moved keeps its last screen point until the
    // next read (a moment), so its tag does not blink on every new position.
    return nameTags(dogMarkers, points || {}, PixelRatio.getFontScale?.() || 1, {
      group: groupsAtZoom(metresPerDp),
    });
  }, [dogMarkers, dogPoints, source, projecting, metresPerDp]);
  useEffect(() => {
    onReadyChange?.(configured && usable);
  }, [configured, usable, onReadyChange]);
  const center = positions[0];
  const initialRegion = center
    ? { ...center, latitudeDelta: 0.045, longitudeDelta: 0.045 }
    : EMPTY_REGION;
  // 重試: open the map again (a new native instance), and wait for its tiles
  // as on the first start.
  const lastRetry = useRef(retryKey);
  useEffect(() => {
    if (lastRetry.current === retryKey) return;
    lastRetry.current = retryKey;
    setTimedOut(false);
    setAttempt(value => value + 1);
  }, [retryKey]);
  const component = !supported || !configured || failure === 'component';
  useEffect(() => {
    setTimedOut(false);
    if (component || loaded || !foreground || !mountedMap) return undefined;
    // No tiles after this long: the map is drawn on grey and the top card says so.
    const timer = setTimeout(() => setTimedOut(true), MAP_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [component, loaded, instance, foreground, mountedMap]);
  let mapState;
  if (component) mapState = 'unavailable';
  else if (failure === 'tiles')
    mapState = loaded ? 'load-failed' : attempt > 0 ? 'retrying' : 'loading';
  else if (loaded) mapState = 'ok';
  else if (timedOut) mapState = 'load-failed';
  else mapState = attempt > 0 ? 'retrying' : 'loading';
  useEffect(() => {
    onMapState?.(mapState);
  }, [mapState, onMapState]);
  const priorSource = useRef(source);
  const sourceToFit = useRef(null);
  // Bumped after each framing fit, so a card's dog is brought into view only
  // once the new source has been framed (never framed from the old view).
  const [fitCount, setFitCount] = useState(0);
  useEffect(() => {
    if (priorSource.current === source) return;
    priorSource.current = source;
    sourceToFit.current = source;
    interacted.current = false;
    phoneCentered.current = false;
    // The blue dot's last fix belongs to the source it was seen with.
    nativePhone.current = null;
    setNativeFixAt(null);
  }, [source]);
  // initialRegion frames the first source without a visible post-load jump.
  // A source switch, or the first position after an initially empty DB, gets
  // one bounds fit only after native tiles/layout are ready.
  useEffect(() => {
    const shouldFit = sourceToFit.current === source || needsFirstPositionFit;
    // A switched source frames once what it will keep drawing: wait until
    // whatever decides that (the receiver's link, for the range ring) is known.
    if (
      !usable ||
      !shouldFit ||
      !framingReady ||
      interacted.current ||
      !positions.length
    )
      return;
    // One place only (只有一筆, a day indoors): a street-level view of it, not
    // the closest zoom.
    if (historyRoute && tinySpan(positions)) {
      mapRef.current?.animateCamera(
        { center: positions[0], zoom: 16 },
        { duration: 0 },
      );
    } else
      mapRef.current?.fitToCoordinates(positions, {
        animated: false,
        // Room for the faces' "!" and name tags; in history for the cursor's
        // label over the route's newest fix (判定表「地圖相機」).
        edgePadding: historyRoute
          ? overlayFramePadding(historyFramePadding(positions, historyRoute.cursor?.coordinate, HISTORY_FRAME), {
              topInset, bottomInset, overlayTop: Math.max(topInset, coverTop || 0),
              overlayBottom: Math.max(bottomInset, coverBottom || 0),
            })
          : {
              ...padding,
              top: padding.top + Math.max(0, (coverTop || 0) - topInset),
            },
      });
    sourceToFit.current = null;
    setFitCount(value => value + 1);
    if (needsFirstPositionFit) {
      setNeedsFirstPositionFit(false);
      // The first framing is in place: the launch screen can go once it is
      // drawn (onRegionChangeComplete), so the first frame seen is framed.
      framed.current = true;
      clearTimeout(afterFit.current);
      afterFit.current = setTimeout(releaseSplash, AFTER_FIT_MS);
    }
    // padding follows dogMarkers, which change with every position; only a
    // new reason to fit (positions, source, readiness) refits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usable, positions, source, needsFirstPositionFit, framingReady]);
  // Nothing to frame yet (no dog, no phone fix): let the app through after a
  // short wait rather than holding the launch screen.
  useEffect(() => {
    if (!configured) {
      releaseSplash();
      return undefined;
    }
    // With something to frame the launch screen waits for the framing (the
    // native side still lets go after 10 s).
    if (positions.length) return undefined;
    // Nothing to frame yet. The launch screen waits for the map to load and
    // for what it frames to be known (the phone's first fix, MapScreen's
    // PHONE_ALONE_WAIT_MS), then 3 s more at most — and never past one
    // deadline counted from the map's mount (FRAMING_WAIT_MAX_MS).
    const remaining = Math.max(0, splashDeadline.current - Date.now());
    const wait =
      loaded && framingReady
        ? Math.min(FIRST_FRAME_WAIT_MS, remaining)
        : remaining;
    const timer = setTimeout(releaseSplash, wait);
    return () => clearTimeout(timer);
  }, [configured, loaded, positions.length, releaseSplash, framingReady]);
  // ---- the live map's own controls (A1) ----------------------------------
  const live = !historyMode;
  const screenPoints = dogPoints.source === source ? dogPoints.points : null;
  const displayKey = `${source}:${pointsKey}`;
  const markerScreenPoints = displayDogPoints?.key === displayKey ? displayDogPoints.points : screenPoints;
  const overlayBottom = Math.max(bottomInset, coverBottom || 0);
  const overlayTop = Math.max(topInset, coverTop || 0);
  const hints = useMemo(
    () =>
      live && screenPoints
        ? edgeHints(dogMarkers, screenPoints, {
            width: cursorLayout.width,
            height: cursorLayout.height,
            top: overlayTop,
            bottom: overlayBottom,
            bottomRow,
            fontScale,
            shownTop: coverTop || 0,
          })
        : [],
    [
      live,
      screenPoints,
      dogMarkers,
      cursorLayout.width,
      cursorLayout.height,
      overlayTop,
      overlayBottom,
      bottomRow,
      fontScale,
      coverTop,
    ],
  );
  // When the map's own blue dot last reported (kept coarse: one update a
  // minute is enough to know whether there is a fix).
  const [nativeFixAt, setNativeFixAt] = useState(null);
  // The phone's position now: the recording service's fix (10 minutes at
  // most), else the map's own blue dot from the last 10 minutes.
  const currentPhone = () => {
    const recorded = phoneFix(livePhone);
    if (recorded) return recorded;
    const native = nativePhone.current;
    return native &&
      Date.now() - native.receivedAt <= PHONE_FIX_MAX_AGE_S * 1000 &&
      Number.isFinite(native.latitude) &&
      Number.isFinite(native.longitude)
      ? { latitude: native.latitude, longitude: native.longitude }
      : null;
  };
  const phoneAvailable =
    !!phoneFix(livePhone) ||
    (nativeFixAt != null &&
      Date.now() - nativeFixAt <= PHONE_FIX_MAX_AGE_S * 1000);
  const [tip, setTip] = useState(null);
  // The map's rotation: the compass shows only while it is turned.
  const [heading, setHeading] = useState(0);
  const turned = Math.abs((((heading % 360) + 540) % 360) - 180) > 1;
  const clearTip = useCallback(() => setTip(null), []);
  const showTip = text => setTip({ text, key: Date.now() });
  // A move the user asked for: from now on nothing automatic moves the map.
  const takeCamera = () => {
    startMoving();
    interacted.current = true;
    phoneCentered.current = true;
    setNeedsFirstPositionFit(false);
  };
  const frame = coordinates => {
    if (!usable || !coordinates?.length) return;
    takeCamera();
    const points = framedCoordinates(coordinates);
    // Inside the map's own padding, and above an open card.
    const framing = overlayFramePadding(padding, { topInset, bottomInset, overlayTop, overlayBottom });
    // 300 ms (motion.camera).
    const region = regionForFrame(points, framing, {
      width: cursorLayout.width - 2 * MAP_SIDE_PADDING,
      height: cursorLayout.height - topInset - bottomInset,
    });
    if (region) mapRef.current?.animateToRegion(region, moveDuration(motion.camera.duration));
    else
      mapRef.current?.fitToCoordinates(points, {
        animated: moveDuration(motion.camera.duration) > 0,
        edgePadding: framing,
      });
  };
  // The camera centre that puts a point now at `point` in the middle of
  // what the map shows above an open card (and below the top cards): the
  // camera's centre is the middle of the padded map, so it moves by how far
  // the point is from where it should be.
  const centreInView = useCallback(point => {
    const map = mapRef.current;
    if (!map?.coordinateForPoint) return Promise.resolve(null);
    const { width, height } = cursorLayout;
    const target = { x: width / 2, y: (overlayTop + height - overlayBottom) / 2 };
    const middle = {
      x: width / 2,
      y: topInset + (height - topInset - bottomInset) / 2,
    };
    return map.coordinateForPoint({
      x: middle.x + point.x - target.x,
      y: middle.y + point.y - target.y,
    });
  }, [cursorLayout, overlayTop, overlayBottom, topInset, bottomInset]);
  // A dog whose card just opened: when the card (or a screen edge) covers it,
  // move the map so it shows in the middle of what is left above the card
  // (300 ms). Asked once per opening.
  const focused = useRef(null);
  useEffect(() => {
    if (
      !focusDog ||
      focused.current === focusDog.key ||
      !usable ||
      !cursorLayout.height
    )
      return;
    // A source switch (or the first view) is still to be framed: wait for it,
    // or this move would count as the user's and cancel that framing.
    if (
      (sourceToFit.current === source && !interacted.current) ||
      needsFirstPositionFit
    )
      return;
    focused.current = focusDog.key;
    const map = mapRef.current;
    if (!map?.pointForCoordinate) return;
    const { width, height } = cursorLayout;
    map
      .pointForCoordinate(focusDog.coordinate)
      .then(async point => {
        const margin = sizes.marker.attention + layout.framePadding;
        // Below the face: its name tag (two lines at most, growing with the
        // system font) and, on the live map, the button row standing on the
        // card (「今天 x km」, 我的位置) — a dog under them is hidden too.
        const tag =
          (type.mapLabel.lineHeight * sizes.mapLabel.maxLines +
            2 * sizes.mapLabel.paddingV) *
          fontScale;
        const buttons = historyMode ? 0 : sizes.floatingButton + layout.floatingGap;
        const selected = dogMarkers.find(marker => marker.slaveId === focusDog.slaveId)
          || dogMarkers.find(marker => marker.selected);
        const box = point && markerBox(selected || { name: '', size: sizes.marker.attention }, point, fontScale);
        const occluded = box && [...mapControlBoxes({ width, height, bottom: overlayBottom, bottomRow }), ...hints.map(hintBox)]
          .some(other => boxesOverlap(box, other));
        const hidden =
          !point || occluded ||
          point.x < margin ||
          point.x > width - margin ||
          point.y < overlayTop + margin ||
          point.y > height - overlayBottom - margin - buttons - tag;
        if (!hidden || focused.current !== focusDog.key) return;
        const moved = point ? await centreInView(point) : null;
        if (focused.current !== focusDog.key) return;
        takeCamera();
        map.animateCamera(
          { center: moved || focusDog.coordinate },
          { duration: moveDuration(motion.camera.duration) },
        );
      })
      .catch(() => {});
    // takeCamera only flips refs; the effect runs per opening (focusDog.key).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    focusDog,
    usable,
    cursorLayout.height,
    overlayTop,
    overlayBottom,
    fitCount,
    needsFirstPositionFit,
  ]);
  // ---- the history screen -------------------------------------------------
  // A tap on the map: on the route (within 24dp of a fix) moves the cursor
  // there; anywhere else is a tap on empty map.
  // Google reports a tap only once it is sure it is not a double tap (about
  // 300 ms). A quick tap on the route is answered from the touch itself
  // (068: tap → cursor under 100 ms); the map's own report of the same tap
  // then does nothing. A tap on a stop number is left to its marker.
  const quickTap = useRef({ start: null, gesture: null, recent: [] });
  const touchSurface = useRef(null);
  const tapContext = useRef(null);
  tapContext.current = { route: routeGeometryIdentity(historyRoute?.points) };
  const validTap = gesture => quickTap.current.gesture === gesture &&
    tapContext.current.route === gesture.route && mapRef.current === gesture.map;
  const STOP_TAP_DP = 20;
  const touchStart = event => {
    const finger = event.nativeEvent;
    if (!Number.isFinite(finger.pageX) || !Number.isFinite(finger.pageY)) {
      quickTap.current.start = null;
      quickTap.current.gesture = null;
      return;
    }
    const gesture = {
      x: finger.pageX, y: finger.pageY, at: Date.now(),
      route: tapContext.current.route, map: mapRef.current, owner: null,
    };
    gesture.origin = new Promise(resolve => {
      if (!touchSurface.current?.measure) { resolve(null); return; }
      // measure's page origin shares the touch pageX/pageY frame, including
      // configurations where the app root does not start at the window origin.
      touchSurface.current.measure((_x, _y, _width, _height, x, y) => {
        gesture.windowOrigin = { x, y };
        resolve(gesture.windowOrigin);
      });
    });
    quickTap.current.recent = quickTap.current.recent.filter(tap => Date.now() - (tap.endedAt ?? tap.at) < QUICK_TAP_HANDLED_MS);
    quickTap.current.recent.push(gesture);
    quickTap.current.gesture = gesture;
    quickTap.current.start = historyRoute && !(finger.touches?.length > 1) ? gesture : null;
  };
  const touchMove = event => {
    const start = quickTap.current.start;
    const finger = event.nativeEvent;
    if (start && Math.hypot(finger.pageX - start.x, finger.pageY - start.y) > QUICK_TAP_SLOP)
      quickTap.current.start = null;
  };
  const touchEnd = async () => {
    const start = quickTap.current.start;
    quickTap.current.start = null;
    const map = mapRef.current;
    const points = historyRoute?.points;
    if (!start || Date.now() - start.at > QUICK_TAP_MS || !points?.length) return;
    if (!map?.coordinateForPoint || !map?.pointForCoordinate) return;
    start.endedAt = Date.now();
    try {
      const origin = await start.origin;
      if (!Number.isFinite(origin?.x) || !Number.isFinite(origin?.y) || !validTap(start) || start.owner) return;
      const at = { x: start.x - origin.x, y: start.y - origin.y };
      start.position = at;
      const coordinate = await map.coordinateForPoint(at);
      if (!validTap(start) || start.owner) return;
      if (metresPerDp > 0 && (historyRoute.places || []).some(place =>
        metresApartOf(place.coordinate, coordinate) / metresPerDp <= STOP_TAP_DP)) return;
      const found = nearestRouteSpot(points, coordinate, historyRoute?.cursor?.time ?? null);
      if (!found) return;
      const point = await map.pointForCoordinate(found.coordinate);
      if (!(Math.hypot(point.x - at.x, point.y - at.y) <= ROUTE_TAP_DP)) return;
      if (!validTap(start) || start.owner) return;
      start.owner = 'quick';
      onCursorMove?.(found.point.time, 'route');
    } catch {
      /* The map's own report of the tap decides. */
    }
  };
  const pressHistoryMap = async event => {
    const gesture = quickTap.current.gesture;
    const map = mapRef.current;
    const route = tapContext.current.route;
    const receivedAt = Date.now();
    const nativeScale = Platform.OS === 'android' ? PixelRatio.get() : 1;
    const position = event?.position && {
      x: event.position.x / nativeScale, y: event.position.y / nativeScale,
    };
    const origin = gesture ? await gesture.origin : null;
    // Native coordinates are usable against the route current at handler
    // start, even if it changed since touchStart. Reject later async changes.
    if (gesture && (quickTap.current.gesture !== gesture || mapRef.current !== gesture.map)) return;
    if (tapContext.current.route !== route) return;
    if (!position) {
      if (gesture?.owner) return;
      if (gesture) gesture.owner = 'native';
      onMapPress?.();
      return;
    }
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return;
    // The current touch token proves ownership even if the JS thread delays
    // delivery beyond 600 ms. Time bounds associate reports with older tokens.
    const matching = gesture && origin &&
      Math.hypot(position.x - (gesture.x - origin.x), position.y - (gesture.y - origin.y)) <= QUICK_TAP_SLOP;
    const earlier = quickTap.current.recent.find(tap => tap !== gesture && tap.windowOrigin && position &&
      receivedAt - (tap.endedAt ?? tap.at) <= QUICK_TAP_HANDLED_MS &&
      Math.hypot(position.x - (tap.x - tap.windowOrigin.x), position.y - (tap.y - tap.windowOrigin.y)) <= QUICK_TAP_SLOP);
    if (!matching && earlier) return; // A delayed report from an older gesture has no authority.
    if (matching && gesture.owner) return;
    // Claim before projection: a pending quick result cannot also act.
    if (matching) gesture.owner = 'native';
    const nativeToken = {};
    quickTap.current.native = nativeToken;
    const active = () => quickTap.current.native === nativeToken && mapRef.current === map && tapContext.current.route === route &&
      quickTap.current.gesture === gesture;
    const found = nearestRouteSpot(
      historyRoute?.points,
      event?.coordinate,
      historyRoute?.cursor?.time ?? null,
    );
    if (found && map?.pointForCoordinate && event?.position) {
      try {
        // The place on the drawn line, not its nearest fix: a tap in the
        // middle of a long segment is on the route.
        const point = await map.pointForCoordinate(found.coordinate);
        const scale = nativeScale;
        // Android emits pixels; iOS emits points. Projection uses map dp/points.
        if (
          Math.hypot(
            point.x - event.position.x / scale,
            point.y - event.position.y / scale,
          ) <= ROUTE_TAP_DP
        ) {
          if (active()) onCursorMove?.(found.point.time, 'route');
          return;
        }
      } catch {
        /* Fall through: an empty tap. */
      }
    }
    if (active()) onMapPress?.();
  };
  const routeCamera = historyRoute?.camera;
  const frameRoute = (animated = true) => {
    if (!usable || !routeCamera?.length) return;
    const room = historyFramePadding(routeCamera, historyRoute?.cursor?.coordinate, HISTORY_FRAME);
    const framing = overlayFramePadding(room, { topInset, bottomInset, overlayTop, overlayBottom });
    // Held days retain many identical fixes; framedCoordinates only expands
    // a single point. Preserve street context for every tiny history span,
    // while keeping the half-screen padding/centering and larger routes intact.
    const latitudes = tinySpan(routeCamera) ? routeCamera.map(point => point.latitude) : null;
    const longitudes = latitudes ? routeCamera.map(point => point.longitude) : null;
    const points = framedCoordinates(latitudes ? [{
      latitude: (Math.min(...latitudes) + Math.max(...latitudes)) / 2,
      longitude: (Math.min(...longitudes) + Math.max(...longitudes)) / 2,
    }] : routeCamera);
    const region = regionForFrame(points, framing, {
      width: cursorLayout.width - 2 * MAP_SIDE_PADDING,
      height: cursorLayout.height - topInset - bottomInset,
    });
    if (region) mapRef.current?.animateToRegion(region,
      animated ? moveDuration(motion.camera.duration) : 0);
    else mapRef.current?.fitToCoordinates(points, { animated, edgePadding: framing });
  };
  const historyFramed = useRef(null);
  useEffect(() => {
    if (!historyFrame || historyFramed.current === historyFrame.key || !usable)
      return;
    historyFramed.current = historyFrame.key;
    takeCamera();
    frameRoute();
    // Once per press of 框住全部.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyFrame?.key, usable]);
  // A node of the list or a stop number: the cursor point comes into the
  // middle of the map above the panel (220 ms, motion.cursorJump).
  // 判定表「使用者拖過地圖之後的游標」: otherwise the map moves only when the
  // cursor point or its label (about 60dp above it) would be out of sight.
  const showCursor = useCallback(
    async (coordinate, centre) => {
      const map = mapRef.current;
      if (!map || !coordinate) return;
      if (!centre && map.pointForCoordinate) {
        try {
          const point = await map.pointForCoordinate(coordinate);
          const seen =
            point.x >= 24 &&
            point.x <= cursorLayout.width - 24 &&
            point.y >= overlayTop + 72 &&
            point.y <= cursorLayout.height - overlayBottom - 24;
          if (seen) return;
        } catch {
          /* Move anyway. */
        }
      }
      let cursorCenter = coordinate;
      if (map.pointForCoordinate) {
        try {
          const point = await map.pointForCoordinate(coordinate);
          cursorCenter = await centreInView(point) || coordinate;
        } catch { /* Keep the requested coordinate if projection fails. */ }
      }
      map.animateCamera(
        { center: cursorCenter },
        { duration: moveDuration(motion.cursorJump.duration) },
      );
    },
    [cursorLayout.width, cursorLayout.height, overlayTop, overlayBottom, centreInView],
  );
  const focusedHistory = useRef(null);
  useEffect(() => {
    if (!historyFocus || focusedHistory.current === historyFocus.key || !usable)
      return;
    focusedHistory.current = historyFocus.key;
    showCursor(historyFocus.coordinate, historyFocus.centre);
  }, [historyFocus, usable, showCursor]);
  const framedRequest = useRef(null);
  useEffect(() => {
    if (!frameRequest || framedRequest.current === frameRequest.key || !usable)
      return;
    framedRequest.current = frameRequest.key;
    // { all: true }: everything, as the 框住全部 button (a notification's
    // 「打開地圖」); else one receiver's dogs.
    const points = frameRequest.all
      ? frameAllCoordinates(dogMarkers, currentPhone())
      : receiverDogsCoordinates(dogMarkers, frameRequest.receiverId);
    if (points.length) frame(points);
    // Once per request; the markers are read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameRequest?.key, usable]);
  const pressFrameAll = () =>
    frame(frameAllCoordinates(dogMarkers, currentPhone()));
  const pressMyLocation = () => {
    const position = currentPhone();
    if (!position) {
      showTip(t("c726"));
      return;
    }
    if (!usable) return;
    takeCamera();
    const map = mapRef.current;
    const animate = to =>
      map?.animateCamera(
        { center: to },
        { duration: moveDuration(motion.camera.duration) },
      );
    // With a card open the phone goes to the middle of the map left above
    // it (as an opened dog does), not the middle of the screen (066).
    if (!map?.pointForCoordinate || !map.coordinateForPoint) {
      animate(position);
      return;
    }
    map
      .pointForCoordinate(position)
      .then(point => (point ? centreInView(point) : null))
      .then(to => animate(to || position))
      .catch(() => animate(position));
  };
  // A tap on a dog always opens that dog's card (no list of dogs, 066).
  // Google reports a map tap for a tap on a marker too while a card is open
  // (the card then closed and the dog's own card needed a second tap): a map
  // tap is held back a moment and dropped when a dog was tapped around it.
  const lastDogPress = useRef(0);
  const mapPressTimer = useRef(null);
  useEffect(() => () => clearTimeout(mapPressTimer.current), []);
  const pressDog = slaveId => {
    lastDogPress.current = Date.now();
    clearTimeout(mapPressTimer.current);
    onDogPress?.(slaveId);
  };
  const pressMapLive = event => {
    // Google can report a tap on a dog as a tap on the map (a card open):
    // a tap on a dog's face opens that dog.
    const position = event?.nativeEvent?.position;
    const scale = PixelRatio.get?.() || 1;
    const hit = position && markerScreenPoints
      ? dogAtPoint(dogMarkers, markerScreenPoints, { x: position.x / scale, y: position.y / scale })
      : null;
    if (hit != null) {
      pressDog(hit);
      return;
    }
    const at = Date.now();
    // A dog tap just before it (the marker reported first): this map tap
    // belongs to it.
    if (at - lastDogPress.current < 2 * MAP_TAP_HOLD_MS) return;
    clearTimeout(mapPressTimer.current);
    // A dog tap after it (the map reported first) cancels it.
    mapPressTimer.current = setTimeout(() => {
      if (lastDogPress.current < at) onMapPress?.();
    }, MAP_TAP_HOLD_MS);
  };
  return (
    <View
      style={StyleSheet.absoluteFill}
      testID="tracking-map-container"
      onLayout={event => setCursorLayout(event.nativeEvent.layout)}
    >
      {/* Hidden from TalkBack while a sheet (history) or the overlap menu is
          over it: Android ignores accessibilityViewIsModal. */}
      <View
        style={StyleSheet.absoluteFill}
        ref={touchSurface}
        collapsable={false}
        pointerEvents="box-none"
        importantForAccessibility={behindSheet(a11yHidden)}
        onTouchStart={historyRoute ? touchStart : undefined}
        onTouchMove={historyRoute ? touchMove : undefined}
        onTouchEnd={historyRoute ? touchEnd : undefined}
      >
      {!component && mountedMap ? (
        <MapView
          key={instance}
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          provider={PROVIDER_GOOGLE}
          initialRegion={initialRegion}
          initialCamera={
            savedView.current?.source === source
              ? savedView.current.camera
              : undefined
          }
          // Without a base map (a fixture of a failed load) the dogs, the phone
          // and the ring are drawn on plain grey, as when no tile arrives.
          mapType="standard"
          // Google's own scheme for the frames before customMapStyle lands
          // (loading tiles drew a light-grey grid on a dark cold start).
          userInterfaceStyle={isDark ? 'dark' : 'light'}
          // Apply the theme style again after a failed-tile fixture.
          customMapStyle={
            failure === 'tiles'
              ? isDark
                ? mapStyle.noBaseMap
                : NO_BASE_MAP
              : mapStyle.google
          }
          // Dark: no 3D buildings. Google draws them as light-grey blocks the
          // dark style cannot recolour (DESIGN.md 深色模式「地圖」: land, roads,
          // water and parks only).
          showsBuildings={failure !== 'tiles' && !isDark}
          moveOnMarkerPress={false}
          // Google reports a tap only (a drag or a long press is not one).
          onPress={
            historyRoute
              ? event => pressHistoryMap(event.nativeEvent)
              : onMapPress
              ? pressMapLive
              : undefined
          }
          showsUserLocation={
            ready &&
            foreground &&
            phoneEnabled &&
            !historyMode &&
            !(livePhone?.running && livePhone.position)
          }
          userLocationPriority="high"
          userLocationUpdateInterval={1000}
          toolbarEnabled={false}
          showsMyLocationButton={false}
          onUserLocationChange={event => {
            const value = event.nativeEvent?.coordinate;
            if (!value) return;
            const receivedAt = Date.now();
            nativePhone.current = { ...value, receivedAt };
            onNativePhone?.(value);
            if (nativeFixAt == null || receivedAt - nativeFixAt > 60000)
              setNativeFixAt(receivedAt);
          }}
          // The compass is ours (CompassButton): Android's own sits top left
          // and cannot be moved under the gear.
          showsCompass={false}
          rotateEnabled={!cursorDragging}
          pitchEnabled={!cursorDragging}
          scrollEnabled={!cursorDragging}
          zoomEnabled={!cursorDragging}
          // Native padding dereferences GoogleMap. Never send it before this
          // specific map instance is ready, including retry/source replacement.
          mapPadding={
            ready
              ? {
                  top: topInset,
                  right: MAP_SIDE_PADDING,
                  bottom: bottomInset,
                  left: MAP_SIDE_PADDING,
                }
              : undefined
          }
          onMapReady={() => {
            if (activeInstance.current === instance) setReadyInstance(instance);
          }}
          onPanDrag={() => {
            interacted.current = true;
            startMoving();
          }}
          onRegionChangeComplete={(_, details) => {
            if (framed.current) releaseSplash();
            if (activeInstance.current !== instance || !foreground) return;
            setCursorRevision(value => value + 1);
            if (details?.isGesture) interacted.current = true;
            const request = ++cameraRead.current;
            mapRef.current
              ?.getCamera?.()
              .then(camera => {
                if (
                  activeInstance.current === instance &&
                  cameraRead.current === request &&
                  camera
                ) {
                  savedView.current = { source, camera };
                  // The live map too: name tags group only when zoomed out.
                  if (Number.isFinite(camera.zoom) && camera.center) {
                    // A Google map is 256 dp wide at zoom 0. Rounded so a small
                    // pan does not redraw the markers.
                    const value = Number(
                      (
                        (40075016 *
                          Math.cos((camera.center.latitude * Math.PI) / 180)) /
                        (256 * 2 ** camera.zoom)
                      ).toPrecision(2),
                    );
                    setMetresPerDp(current =>
                      current === value ? current : value,
                    );
                  }
                  if (Number.isFinite(camera.heading)) {
                    onHeading?.(camera.heading);
                    setHeading(camera.heading);
                  }
                }
              })
              .catch(() => {
                // Keep the last successful camera snapshot if native teardown
                // races this read. A map with no snapshot uses SQLite framing.
              });
          }}
          onMapLoaded={() => {
            // The launch screen stays until the first framing is drawn (see
            // the fit above), so the whole of Taiwan never shows first.
            if (activeInstance.current === instance)
              setLoadedInstance(instance);
          }}
        >
          {/* History draws no live phone (flow.txt: 只有可以拖的游標點). */}
          {!historyMode && livePhone?.running && livePhone.position && (
            <PhoneLocationOverlay
              Circle={Circle}
              Marker={StyledMarker}
              location={livePhone}
              active={foreground}
            />
          )}
          {historyRoute && (
            <HistoryRoute
              route={historyRoute}
              onStopPress={onStopPress}
              metresPerDp={metresPerDp}
            />
          )}
          {slaveSegments.map((segment, index) => (
            <React.Fragment key={index}>
              {isDark && (
                <Polyline
                  coordinates={segment}
                  strokeColor={tokens.routeCasing}
                  strokeWidth={6}
                  zIndex={Z.route - 0.1}
                />
              )}
              <Polyline
                key={source + '-slave-' + index}
                coordinates={segment}
                geodesic={false}
                strokeColor={colors.dog}
                strokeWidth={4}
                zIndex={Z.route}
              />
            </React.Fragment>
          ))}
          {/* The receiver itself is not drawn: no marker, no name tag, no track
           (v3). Only its 1 km range ring, which cannot be turned off. */}
          {/* Fabric's Polygon ignores dash patterns and zIndex: the fill is a
           polygon with no outline, the dashed outline a closed polyline.
           Butt caps, or Android turns every dash into a dot. */}
          {rangeRing && (
            <Polygon
              key="range-ring-fill"
              coordinates={rangeRing.coordinates}
              strokeColor="transparent"
              strokeWidth={0}
              fillColor={RANGE_RING.fill}
              tappable={false}
            />
          )}
          {rangeRing && isDark && (
            <Polyline
              coordinates={[...rangeRing.coordinates, rangeRing.coordinates[0]]}
              strokeColor={tokens.routeCasing}
              strokeWidth={RANGE_RING.width + 2}
              lineDashPattern={dash()}
              lineCap="butt"
              zIndex={Z.ring - 0.1}
            />
          )}
          {rangeRing && (
            <Polyline
              // One ring at a time: a stable key moves it instead of replacing
              // the native overlay on every source switch.
              key="range-ring"
              testID="range-ring"
              coordinates={[...rangeRing.coordinates, rangeRing.coordinates[0]]}
              geodesic={false}
              strokeColor={RANGE_RING.stroke}
              strokeWidth={RANGE_RING.width}
              lineDashPattern={dash()}
              lineCap="butt"
              zIndex={Z.ring}
              tappable={false}
            />
          )}
          {rangeLines.map(line => (
            <Polyline
              key={source + '-out-of-range-' + line.slaveId}
              coordinates={line.coordinates}
              geodesic={false}
              strokeColor={tokens.critLine}
              strokeWidth={OUT_OF_RANGE_WIDTH}
              lineDashPattern={dash()}
              lineCap="butt"
              zIndex={Z.rangeLine}
              tappable={false}
            />
          ))}
          {(presentation.dogPaths || []).map(track => (
            <React.Fragment key={source + '-dogpath-' + track.slaveId}>
              {track.segments.map((segment, index) => (
                <React.Fragment key={index}>
                  {isDark && (
                    <Polyline
                      coordinates={segment}
                      strokeColor={tokens.routeCasing}
                      strokeWidth={5}
                      zIndex={Z.route - 0.1}
                    />
                  )}
                  <Polyline
                    coordinates={segment}
                    geodesic={false}
                    strokeColor={track.color}
                    strokeWidth={3}
                    zIndex={Z.route}
                  />
                </React.Fragment>
              ))}
            </React.Fragment>
          ))}
          <SeparatedDogMarkers mapRef={mapRef} revision={cursorRevision}
            width={cursorLayout.width} height={cursorLayout.height} ready={usable && foreground}
            MarkerComponent={StyledMarker} CircleComponent={Circle} PolylineComponent={Polyline}
            top={overlayTop} bottom={overlayBottom}
            identityKey={displayKey} onPlacement={setDisplayDogPoints}
            items={dogMarkers.map(marker => ({
              id: source + '-dog-' + marker.slaveId, coordinate: marker.coordinate, marker,
              size: marker.size,
              label: marker.tag || marker.name, color: colors.dog,
              onPress: onDogPress ? () => pressDog(marker.slaveId) : undefined,
            }))}
            renderMarker={(item, coordinate, separated) => {
              const marker = item.marker;
              return (<DogMarker
              key={item.id}
              source={source}
              marker={{ ...marker, coordinate }}
              tag={separated ? null : tags[marker.slaveId]}
              avatar={presentation.dogAvatars?.[marker.slaveId]}
              shownKey={shownKey + (separated ? 1 : 0)}
              // Above the phone's dot (30), whose name tag layer they carry:
              // the open dog on top, then problems, then the dog carrying a
              // group tag over the faces it covers.
              zIndex={
                marker.selected
                  ? 40
                  : (marker.problem ? 34 : 31) +
                    (tags[marker.slaveId]?.group > 1 ? 2 : 0)
              }
              label={
                !separated && tags[marker.slaveId]?.group > 1
                  ? groupSpeech(tags[marker.slaveId], dogMarkers, marker.slaveId)
                  : undefined
              }
              onPress={onDogPress ? () => pressDog(marker.slaveId) : undefined}
            />);
            }}
          />
        </MapView>
      ) : component ? (
        // 地圖打不開: grey only; the top card says so (no list, no new page).
        <View testID="map-unavailable" style={styles.fallback} />
      ) : (
        <View style={styles.unavailable}>
          <Text style={styles.unavailableText}>{t("c752")}</Text>
        </View>
      )}
      {usable && cursorLayout.width > 0 && historyRoute?.cursor && (
        <HistoryCursor
          key={source + ':' + instance}
          mapRef={mapRef}
          cursor={historyRoute.cursor}
          points={historyRoute.points}
          hidden={!foreground}
          onMove={onCursorMove}
          onDraggingChange={setCursorDragging}
          revision={cursorRevision}
          width={cursorLayout.width}
          height={cursorLayout.height}
          top={topInset}
          bottom={overlayBottom}
        />
      )}
      {!component && mountedMap && !loaded && !timedOut && (
        <View
          style={[styles.loading, { top: topInset + touch.subpageHeader }]}
          pointerEvents="none"
        >
          <ActivityIndicator
            size="small"
            color={colors.master}
            accessibilityLabel={t('c425')}
          />
        </View>
      )}
      {/* The launch screen's handover fades these in (splashChrome). */}
      <Animated.View
        pointerEvents="box-none"
        style={[StyleSheet.absoluteFill, { opacity: splashChrome }]}
      >
        {!live && usable && foreground && onStopPress && stopPoints && (
          <MarkerA11yLayer
            items={stopPoints.filter(
              item =>
                item.x >= 0 &&
                item.y >= 0 &&
                item.x <= cursorLayout.width &&
                item.y <= cursorLayout.height,
            )}
            onActivate={key =>
              onStopPress(stopPoints.find(item => item.id === key)?.place)
            }
          />
        )}
        {live && usable && foreground && !movingState && onDogPress && (
          <MarkerA11yLayer
            items={markerA11yItems(dogMarkers, markerScreenPoints, {
              width: cursorLayout.width,
              height: cursorLayout.height,
              // Every dog its own TalkBack item, also inside a 「N 隻」 tag:
              // there is no list to reach the others from (066).
              groupLabel: () => null,
              grouped: () => false,
            })}
            onActivate={pressDog}
          />
        )}
        {live &&
          usable &&
          foreground &&
          !movingState &&
          hints.map(value => (
            <EdgeHintView
              key={value.side}
              value={value}
              avatars={presentation.dogAvatars || {}}
              onPress={() => frame(value.coordinates)}
            />
          ))}
        {live && !component && foreground && (loaded || timedOut) && (
          // 框住全部, 我的位置 and 「今天 x km」 (A1), 12dp above the card; above the tip
          // while it shows.
          <MapButtons
            bottom={
              overlayBottom +
              (tip ? sizes.floatingButton + layout.floatingGap : 0)
            }
            phoneAvailable={phoneAvailable}
            onFrameAll={pressFrameAll}
            onMyLocation={pressMyLocation}
            today={today}
            onToday={onToday}
          />
        )}
      </Animated.View>
      {live && (
        <MapTip message={tip} bottom={overlayBottom} onDone={clearTip} />
      )}
      {usable && foreground && compassTop != null && turned && (
        <CompassButton
          top={compassTop}
          heading={heading}
          onPress={() =>
            mapRef.current?.animateCamera(
              { heading: 0 },
              { duration: moveDuration(motion.camera.duration) },
            )
          }
        />
      )}
      </View>
    </View>
  );
}

// The App polls SQLite frequently. Keep those
// parent renders from reconciling thousands of unchanged native coordinates.
const MemoizedGoogleTrackingMap = React.memo(GoogleTrackingMapRenderer);

export default function GoogleTrackingMap(props) {
  return <MemoizedGoogleTrackingMap {...props} />;
}
const getStyles = makeStyles(theme => {
  const {
    colors: tokens,
    literalColors: themeLiteral,
    appColors: colors,
    floatingShadow,
  } = theme;
  return StyleSheet.create({
    fallback: { flex: 1, backgroundColor: tokens.mapFallback },
    unavailable: {
      flex: 1,
      backgroundColor: themeLiteral.mapUnavailableBackground,
      alignItems: 'center',
      justifyContent: 'center',
    },
    unavailableText: { color: colors.master, fontWeight: type.title.fontWeight, fontSize: type.title.fontSize },
    loading: {
      position: 'absolute',
      left: space.m,
      width: sizes.mapLoading.spinnerDisc,
      height: sizes.mapLoading.spinnerDisc,
      backgroundColor: colors.surface,
      borderRadius: sizes.mapLoading.spinnerDisc / 2,
      justifyContent: 'center',
      ...floatingShadow,
    },
  });
});
