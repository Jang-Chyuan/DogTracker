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
import { layout, motion, size as sizes } from '../theme/tokens';

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
  HISTORY_FRAME_PADDING,
  historyFramePadding,
  nearestRouteSpot,
  uncrowded,
} from '../history/screen/HistoryMapModel';
import DogMarkerView, { markerFrame } from './DogMarkerView';
import { nameTags } from './DogMarkers';
import {
  reportMapFramed,
  splashChrome,
  useSplashMarkersHidden,
} from '../app/hideSplash';
import {
  framedCoordinates,
  framePadding,
  frameAllCoordinates,
  receiverDogsCoordinates,
  phoneFix,
  PHONE_FIX_MAX_AGE_S,
  regionForFrame,
} from './MapFraming';
import { edgeHints } from './EdgeHints';
import { CompassButton, EdgeHintView, MapButtons, MapTip } from './MapControls';
import OverlapPicker, { overlapMenuPlace } from './OverlapPicker';

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
    width: 1.5,
  };
});
const OUT_OF_RANGE_WIDTH = 2;
const dash = () =>
  [6, 4].map(length => PixelRatio.getPixelSizeForLayoutSize(length));
// Drawing order: base map, ring, red lines, routes, dogs and phone.
const Z = { ring: 1, rangeLine: 2, route: 3 };
// A base map that draws nothing but grey (design #ECEEEC): what a map without
// tiles looks like, for the 地圖載入失敗 fixture.
const PLAIN_MAP = [];
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
// A fit is drawn within a frame or two; release the launch screen after it
// even if the map reports no camera change (the camera was already there).
const AFTER_FIT_MS = 250;
// The map's own padding at the sides (dp).
const MAP_SIDE_PADDING = 12;
// History framing: 24dp all round, the cursor label on top, 框住全部 below.
const HISTORY_FRAME = HISTORY_FRAME_PADDING;
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

// Every marker on our maps (「地圖標記一律用自己的樣式」) goes through here and
// draws a view of its own: react-native-maps draws Google's red default pin
// for a marker with no view. Debug builds report a marker given nothing to
// draw (MarkerArchitecture.test.js checks every marker element in src).
export const StyledMarker = React.forwardRef(function StyledMarker(
  { children, ...props },
  ref,
) {
  if (__DEV__ && React.Children.count(children) === 0) {
    console.error(
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
function DogMarker({ source, marker, tag, avatar, zIndex, onPress, label }) {
  const { isDark } = useTheme();
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
  useEffect(() => {
    ref.current?.redraw?.();
  }, [look, isDark]);
  return (
    <StyledMarker
      ref={ref}
      identifier={source + '-dog-' + marker.slaveId}
      coordinate={marker.coordinate}
      anchor={frame.anchor}
      tracksViewChanges={photo.tracking || settled.tracking}
      opacity={handover ? 0 : 1}
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
// double tap does.
function groupSpeech(tag, markers) {
  const names = tag.members
    .map(id => markers.find(marker => marker.slaveId === id)?.name)
    .filter(Boolean);
  return `${tag.text}：${names.join('、')}，點兩下選一隻`;
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
      {route.lines.map((line, index) => (
        // A dashed line and a solid one are never the same native line: the
        // SDK keeps an old dash pattern when it is taken away.
        <React.Fragment key={`route-${index}-${line.start}`}>
          {isDark && (
            <Polyline
              coordinates={line.coordinates}
              strokeColor={colors.routeCasing}
              strokeWidth={line.width + 2}
              zIndex={Z.route - 0.6}
              lineDashPattern={line.dashed ? dashed : undefined}
              tappable={false}
            />
          )}
          <Polyline
            key={`route-${line.dashed ? 'dashed' : 'solid'}-${index}-${
              line.start
            }`}
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
        </React.Fragment>
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
          label={place.kind === 'indoor' ? '室內' : `停留 ${place.number}`}
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
  phoneEnabled,
  livePhone,
  onDogPress,
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
  // frame the route (框住全部), and the panel at { level, extraBottom }.
  onCursorMove,
  onStopPress,
  historyFocus = null,
  historyFrame = null,
  historyPanel = null,
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
  // While the camera moves (a drag, or a move the user asked for) the screen
  // points are out of date: the off-screen hints wait for the next read.
  const moving = useRef(false);
  const [movingState, setMovingState] = useState(false);
  const movingTimer = useRef(null);
  const startMoving = useCallback(() => {
    if (moving.current) return;
    moving.current = true;
    setMovingState(true);
    // A move to where the camera already is reports no change: read again
    // after a moment anyway, so the hints never stay hidden.
    clearTimeout(movingTimer.current);
    movingTimer.current = setTimeout(() => {
      if (moving.current) setCursorRevision(value => value + 1);
    }, 1500);
  }, []);
  useEffect(() => () => clearTimeout(movingTimer.current), []);
  const pointsKey = dogMarkers
    .map(
      marker =>
        `${marker.slaveId}:${marker.coordinate.latitude},` +
        `${marker.coordinate.longitude}:${marker.size}`,
    )
    .join('|');
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
      .then(entries =>
        reportMapFramed(
          splashTargets(
            inputs,
            Object.fromEntries(entries.filter(Boolean)),
            PixelRatio.getFontScale?.() || 1,
          ),
        ),
      )
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
      setDogPoints({
        source,
        points: Object.fromEntries(entries.filter(Boolean)),
      });
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
    return nameTags(dogMarkers, points || {}, PixelRatio.getFontScale?.() || 1);
  }, [dogMarkers, dogPoints, source, projecting]);
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
          ? historyFramePadding(positions, historyRoute.cursor?.coordinate)
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
    if (!loaded || positions.length) return undefined;
    const timer = setTimeout(releaseSplash, FIRST_FRAME_WAIT_MS);
    return () => clearTimeout(timer);
  }, [configured, loaded, positions.length, releaseSplash]);
  // ---- the live map's own controls (A1) ----------------------------------
  const live = !historyMode;
  const screenPoints = dogPoints.source === source ? dogPoints.points : null;
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
    const framing = {
      ...padding,
      top: padding.top + overlayTop - topInset,
      bottom: padding.bottom + overlayBottom - bottomInset,
    };
    // 300 ms (motion.camera).
    const region = regionForFrame(points, framing, {
      width: cursorLayout.width - 2 * MAP_SIDE_PADDING,
      height: cursorLayout.height - topInset - bottomInset,
    });
    if (region) mapRef.current?.animateToRegion(region, motion.camera.duration);
    else
      mapRef.current?.fitToCoordinates(points, {
        animated: true,
        edgePadding: framing,
      });
  };
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
        const hidden =
          !point ||
          point.x < margin ||
          point.x > width - margin ||
          point.y < overlayTop + margin ||
          point.y > height - overlayBottom - margin;
        if (!hidden || focused.current !== focusDog.key) return;
        // The camera's centre is the middle of the padded map; move it by how
        // far the dog is from where it should be.
        const target = {
          x: width / 2,
          y: (overlayTop + height - overlayBottom) / 2,
        };
        const middle = {
          x: width / 2,
          y: topInset + (height - topInset - bottomInset) / 2,
        };
        const moved =
          point && map.coordinateForPoint
            ? await map.coordinateForPoint({
                x: middle.x + point.x - target.x,
                y: middle.y + point.y - target.y,
              })
            : null;
        if (focused.current !== focusDog.key) return;
        takeCamera();
        map.animateCamera(
          { center: moved || focusDog.coordinate },
          { duration: motion.camera.duration },
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
  const pressHistoryMap = async event => {
    const found = nearestRouteSpot(
      historyRoute?.points,
      event?.coordinate,
      historyRoute?.cursor?.time ?? null,
    );
    const map = mapRef.current;
    if (found && map?.pointForCoordinate && event?.position) {
      try {
        // The place on the drawn line, not its nearest fix: a tap in the
        // middle of a long segment is on the route.
        const point = await map.pointForCoordinate(found.coordinate);
        const scale = PixelRatio.get();
        // position is in pixels, the projection in dp.
        if (
          Math.hypot(
            point.x - event.position.x / scale,
            point.y - event.position.y / scale,
          ) <= ROUTE_TAP_DP
        ) {
          onCursorMove?.(found.point.time, 'route');
          return;
        }
      } catch {
        /* Fall through: an empty tap. */
      }
    }
    onMapPress?.();
  };
  const routeCamera = historyRoute?.camera;
  const frameRoute = (extraBottom = 0, animated = true) => {
    if (!usable || !routeCamera?.length) return;
    if (tinySpan(routeCamera)) {
      mapRef.current?.animateCamera(
        { center: routeCamera[0], zoom: 16 },
        { duration: motion.camera.duration },
      );
      return;
    }
    // At 75% little map is left: a slim frame, or the SDK refuses the fit.
    const room = historyFramePadding(
      routeCamera,
      historyRoute?.cursor?.coordinate,
      extraBottom > 0
        ? { top: 16, right: 24, bottom: 8, left: 24 }
        : HISTORY_FRAME,
    );
    mapRef.current?.fitToCoordinates(routeCamera, {
      animated,
      edgePadding: { ...room, bottom: room.bottom + extraBottom },
    });
  };
  const historyFramed = useRef(null);
  useEffect(() => {
    if (!historyFrame || historyFramed.current === historyFrame.key || !usable)
      return;
    historyFramed.current = historyFrame.key;
    takeCamera();
    frameRoute(historyPanel?.extraBottom || 0);
    // Once per press of 框住全部.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyFrame?.key, usable]);
  // 判定表「面板高度」: at 75% the route is framed again above the panel —
  // unless the user moved the map, then only the padding changes.
  const panelLevel = historyPanel?.level;
  const lastLevel = useRef(panelLevel);
  useEffect(() => {
    if (lastLevel.current === panelLevel) return;
    const was = lastLevel.current;
    lastLevel.current = panelLevel;
    if (!historyRoute || !usable) return;
    // Moved by hand: the map stays, unless the panel now covers the cursor.
    if (interacted.current) {
      if (historyRoute.cursor)
        showCursor(historyRoute.cursor.coordinate, false);
      return;
    }
    if (panelLevel === 'full' || was === 'full')
      frameRoute(historyPanel?.extraBottom || 0);
    // On a new level only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelLevel]);
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
      map.animateCamera(
        { center: coordinate },
        { duration: motion.cursorJump.duration },
      );
    },
    [cursorLayout.width, cursorLayout.height, overlayTop, overlayBottom],
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
    const points = receiverDogsCoordinates(dogMarkers, frameRequest.receiverId);
    if (points.length) frame(points);
    // Once per request; the markers are read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameRequest?.key, usable]);
  const pressFrameAll = () =>
    frame(frameAllCoordinates(dogMarkers, currentPhone()));
  const pressMyLocation = () => {
    const position = currentPhone();
    if (!position) {
      showTip('手機沒有定位');
      return;
    }
    if (!usable) return;
    takeCamera();
    mapRef.current?.animateCamera(
      { center: position },
      { duration: motion.camera.duration },
    );
  };
  // The overlap menu: which group tag was tapped (by the dog carrying it).
  const [picker, setPicker] = useState(null);
  const closePicker = useCallback(() => setPicker(null), []);
  const pressDog = slaveId => {
    const tag = tags[slaveId];
    if (tag?.group > 1)
      setPicker({ source, lead: slaveId, members: tag.members });
    else onDogPress?.(slaveId);
  };
  const pickerMarkers = useMemo(() => {
    if (!picker || picker.source !== source) return null;
    const byId = new Map(dogMarkers.map(marker => [marker.slaveId, marker]));
    const members = picker.members.map(id => byId.get(id)).filter(Boolean);
    return members.length > 1 ? members : null;
  }, [picker, source, dogMarkers]);
  const leadPoint = picker && screenPoints?.[picker.lead];
  const leadSize =
    picker && dogMarkers.find(marker => marker.slaveId === picker.lead)?.size;
  const pickerPlace =
    pickerMarkers && leadPoint
      ? overlapMenuPlace(
          { ...leadPoint, size: leadSize },
          // Above the card: the card is drawn over the map and would cover it.
          pickerMarkers.length,
          {
            width: cursorLayout.width,
            height: cursorLayout.height,
            top: overlayTop,
            bottom: overlayBottom,
          },
        )
      : null;
  // The menu goes when its dogs no longer overlap, on a source switch, and
  // when a dog is opened some other way (its card row).
  useEffect(() => {
    if (picker && !pickerMarkers) setPicker(null);
  }, [picker, pickerMarkers]);
  const openDogId = dogMarkers.find(marker => marker.selected)?.slaveId ?? null;
  useEffect(() => setPicker(null), [openDogId]);
  return (
    <View
      style={StyleSheet.absoluteFill}
      testID="tracking-map-container"
      onLayout={event => setCursorLayout(event.nativeEvent.layout)}
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
          // An empty style puts the normal map back (undefined would keep the grey).
          customMapStyle={
            failure === 'tiles'
              ? isDark
                ? mapStyle.noBaseMap
                : NO_BASE_MAP
              : isDark
              ? mapStyle.google
              : PLAIN_MAP
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
              ? () => onMapPress()
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
                  if (
                    historyRoute &&
                    Number.isFinite(camera.zoom) &&
                    camera.center
                  ) {
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
          {dogMarkers.map(marker => (
            <DogMarker
              key={source + '-dog-' + marker.slaveId}
              source={source}
              marker={marker}
              tag={tags[marker.slaveId]}
              avatar={presentation.dogAvatars?.[marker.slaveId]}
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
                tags[marker.slaveId]?.group > 1
                  ? groupSpeech(tags[marker.slaveId], dogMarkers)
                  : undefined
              }
              onPress={onDogPress ? () => pressDog(marker.slaveId) : undefined}
            />
          ))}
        </MapView>
      ) : component ? (
        // 地圖打不開: grey only; the top card says so (no list, no new page).
        <View testID="map-unavailable" style={styles.fallback} />
      ) : (
        <View style={styles.unavailable}>
          <Text style={styles.unavailableText}>正在讀取本機位置…</Text>
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
          style={[styles.loading, { top: topInset + 56 }]}
          pointerEvents="none"
        >
          <ActivityIndicator
            size="small"
            color={colors.master}
            accessibilityLabel="底圖載入中"
          />
        </View>
      )}
      {/* The launch screen's handover fades these in (splashChrome). */}
      <Animated.View
        pointerEvents="box-none"
        style={[StyleSheet.absoluteFill, { opacity: splashChrome }]}
      >
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
              { duration: motion.camera.duration },
            )
          }
        />
      )}
      {pickerMarkers && pickerPlace && (
        <OverlapPicker
          markers={pickerMarkers}
          place={pickerPlace}
          avatars={presentation.dogAvatars || {}}
          onClose={closePicker}
          onPick={slaveId => {
            setPicker(null);
            onDogPress?.(slaveId);
          }}
        />
      )}
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
    unavailableText: { color: colors.master, fontWeight: '700', fontSize: 20 },
    loading: {
      position: 'absolute',
      left: 14,
      width: 36,
      height: 36,
      backgroundColor: colors.surface,
      borderRadius: 18,
      justifyContent: 'center',
      ...floatingShadow,
    },
  });
});
