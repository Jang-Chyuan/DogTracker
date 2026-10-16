import { markStartupPhase } from '../diagnostics/StartupPhases';
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
import { cursorProjectionKey, cursorLabelPlacement, cursorCameraTarget, measuredCursorFrame, labelBoxAround, timeUnderLabel } from '../mapHistory/CursorLabelPlacement';
import {
  CursorFaceView,
  CursorMarkerView,
  cursorAnchor,
  cursorLabelFootprint,
  IndoorMarkerView,
  MovementIconView,
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
import { dogAtPoint, dogUnderTouch, dogZIndexes, groupsAtZoom, nameTags } from './DogMarkers';
import {
  reportMapFramed,
  getSplashState,
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
  focusPointY,
} from './MapFraming';
import { edgeHints, markerBox, boxesOverlap, mapControlBoxes, hintBox, compassBox } from './EdgeHints';
import { CompassButton, EdgeHintView, MapButtons, MapTip } from './MapControls';

/**
 * The street view: one place in history (只有一筆) is shown at this zoom, and
 * 我的位置 zooms in to it when the map is zoomed out further.
 */
export const STREET_ZOOM = 16;

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
// The history cursor's marker, above every dog face (DogMarkers.DOG_Z_BASE and up).
const CURSOR_Z_INDEX = 1000;
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

// The longest the handover waits for the dogs' screen places (the flying
// artwork's targets) once the first framing is drawn; then a plain fade.
export const FIRST_FRAME_WAIT_MS = 3000;
// How long after the finger came down a native marker tap still counts as
// that touch (a long press is not a tap; a busy bridge can be slow).
const MARKER_TOUCH_MAX_MS = 1500;
// When there is nothing to frame, the most the launch screen is held from the
// map's mount, whatever is still loading (the phone's first fix, tiles).
export const FRAMING_WAIT_MAX_MS = 9000;
// A fit is drawn within a frame or two; release the launch screen after it
// even if the map reports no camera change (the camera was already there).
const AFTER_FIT_MS = 250;
// Nothing to frame once everything it waits for is known (the map loaded,
// the latest positions, the phone): release after the view is drawn. Its
// wait for the phone is MapScreen's PHONE_ALONE_WAIT_MS, not more here.
export const EMPTY_FRAME_SETTLE_MS = AFTER_FIT_MS;
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
/**
 * The camera a new map instance opens on: the last one read for this same
 * source, else none (initialRegion). Nothing saved yet with an undefined
 * source must not read `.camera` of null (a TypeError is 「地圖打不開」).
 */
export function savedCamera(saved, source) {
  return saved && saved.source === source ? saved.camera ?? undefined : undefined;
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
const DogMarker = React.memo(function DogMarker({ source, marker, tag, avatar, zIndex, onPress, label, shownKey = 0,
  compact = false }) {
  const { isDark, opacity } = useTheme();
  // The launch screen's handover draws a copy of each dog over the map while
  // it flies and pops them in; the real marker shows once they are in place.
  const handover = useSplashMarkersHidden();
  const ref = useRef(null);
  const photo = usePhotoMarker(avatar, ref);
  const settled = useSettledMarker(ref);
  const frame = markerFrame(marker.size, compact);
  const look = [
    compact,
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
      onPress={onPress ? () => onPress(marker.slaveId) : undefined}
    >
      <View
        collapsable={false}
        accessible
        accessibilityLabel={label || marker.label}
        onLayout={settled.onLayout}
      >
        <DogMarkerView
          marker={marker}
          compact={compact}
          tag={tag}
          avatar={avatar}
          onAvatarLoad={photo.onLoad}
        />
      </View>
    </StyledMarker>
  );
}, sameDogMarker);

// A dog's marker draws again only when something it shows changes
// (2026-10-16: on every switch of the card's dog — a new selection, the
// camera moving to it — every marker was drawn again). The marker and its
// name tag are new objects each time the map's dogs are worked out; they
// count as the same when every value in them is.
const sameShown = (left, right) => left === right
  || (!!left && !!right && typeof left === 'object' && typeof right === 'object'
    && JSON.stringify(left) === JSON.stringify(right));
function sameDogMarker(previous, next) {
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  for (const key of keys) {
    const same = key === 'marker' || key === 'tag' ? sameShown(previous[key], next[key]) : previous[key] === next[key];
    if (!same) return false;
  }
  return true;
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

function CursorMarker({ cursor, color, labelHidden = false, measurementKey, onLabelMetrics }) {
  const { isDark } = useTheme();
  const [labelHeight, setLabelHeight] = useState(44);
  const [labelSize, setLabelSize] = useState(null);
  const [markerSize, setMarkerSize] = useState(null);
  const ref = useRef(null);
  const settled = useSettledMarker(ref);
  const face = cursor.face ?? null;
  const hasFace = !!face;
  useEffect(() => {
    if (labelSize?.key === measurementKey && markerSize) onLabelMetrics?.({ key: measurementKey, size: cursorLabelFootprint(labelSize, hasFace, markerSize) });
  }, [measurementKey, labelSize, markerSize, hasFace, onLabelMetrics]);
  const labelLayout = value => setLabelSize(previous => previous?.key === measurementKey && previous?.width === value.width && previous?.height === value.height
    ? previous : { key: measurementKey, width: value.width, height: value.height });
  const look = `${cursor.lines?.join('|')}:${
    cursor.stale
  }:${labelHeight}:${color}:${face?.name ?? ''}:${
    face?.avatar?.uri?.length ?? face?.avatar?.art ?? ''
  }:${labelHidden}`;
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
      zIndex={CURSOR_Z_INDEX}
      tappable={false}
    >
      <View collapsable={false} onLayout={event => {
        settled.onLayout(event);
        const value = event.nativeEvent.layout;
        setMarkerSize(previous => previous?.width === value.width && previous?.height === value.height
          ? previous : { width: value.width, height: value.height });
      }}>
        {face ? (
          <CursorFaceView
            lines={cursor.lines}
            color={color}
            stale={cursor.stale}
            face={face}
            onLabelHeight={height}
            onLabelLayout={labelLayout}
            labelLayoutKey={measurementKey}
            labelHidden={labelHidden}
          />
        ) : (
          <CursorMarkerView
            lines={cursor.lines}
            color={color}
            stale={cursor.stale}
            onLabelHeight={height}
            onLabelLayout={labelLayout}
            labelLayoutKey={measurementKey}
            labelHidden={labelHidden}
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
// itself changed (its id: times, coordinates, width, colour, dash, dots,
// casing; HistoryMapModel.drawnLine), so a cursor move or a new selection
// leaves every other piece's thousands of points alone (067). A line without
// an id is always redrawn (the other dogs' lines had none and went stale).
// Dots (the list's walking track, 2026-10-14): round caps with a pattern,
// which react-native-maps turns into Google's Dot (a circle as wide as the
// line) and Gap items; the pattern is in pixels, so the dots keep their size
// at every zoom. The selected segment has its own wide halo (route.halo, its
// colour at opacity.routeHalo) under it, above the rest of the route.
export const sameHistoryLine = (before, after) =>
  before.line.id != null &&
  before.line.id === after.line.id &&
  before.casing === after.casing &&
  before.dashed === after.dashed;
const HistoryLine = React.memo(
  function HistoryLine({ line, casing, dashed }) {
    const dots = line.dotted ? dottedPattern(line.width) : undefined;
    return (
      <>
        {line.halo ? (
          <Polyline
            coordinates={line.coordinates}
            strokeColor={line.halo}
            strokeWidth={sizes.route.halo}
            zIndex={Z.route + 0.4}
            lineCap="round"
            lineJoin="round"
            tappable={false}
          />
        ) : casing ? (
          <Polyline
            coordinates={line.coordinates}
            strokeColor={casing}
            strokeWidth={line.width + 2}
            zIndex={Z.route - 0.6}
            lineDashPattern={line.dashed ? dashed : undefined}
            lineCap={line.dashed ? 'butt' : 'round'}
            lineJoin="round"
            tappable={false}
          />
        ) : null}
        <Polyline
          coordinates={line.coordinates}
          geodesic={false}
          strokeColor={line.color}
          strokeWidth={line.width}
          zIndex={line.selected ? Z.route + 0.5 : line.dashed ? Z.route - 0.5 : Z.route}
          lineDashPattern={line.dashed ? dashed : dots}
          lineCap={line.dashed ? 'butt' : 'round'}
          lineJoin="round"
          tappable={false}
        />
      </>
    );
  },
  sameHistoryLine,
);

// A dotted line's pattern: a Dot (its length is ignored) and a gap of
// dotGapScale line widths, in pixels.
const dottedPattern = width => [1, PixelRatio.getPixelSizeForLayoutSize(Math.round(width * sizes.route.dotGapScale))];

// Live snapshot age still updates the map controls. Reuse unchanged history
// geometry until its route, stop handler, zoom or theme context changes.
const HistoryRoute = React.memo(function HistoryRoute({ route, onStopPress, metresPerDp = 0, cursorDragging = false, cursorLabelHidden = false, measurementKey, onLabelMetrics, labelBox = null, heading = 0 }) {
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
  const spaced = useMemo(
    () =>
      !metresPerDp
        ? route.times.filter(marker => marker.end)
        : apartM > 150
        ? uncrowded(route.times, route.places, apartM)
        : route.times,
    [route.times, route.places, apartM, metresPerDp],
  );
  // A time marker under the cursor's label is left out until the label moves
  // on (2026-10-14: 「09:00」 sat under 「09:00 走路・已走 1.4 km」).
  const cursorAt = route.cursor?.coordinate;
  const times = useMemo(
    () => (labelBox && cursorAt && metresPerDp
      ? spaced.filter(marker => !timeUnderLabel(marker.coordinate, cursorAt, labelBox, metresPerDp, heading))
      : spaced),
    [spaced, labelBox, cursorAt, metresPerDp, heading],
  );
  return (
    <>
      {route.lines.map(line => (
        // A dashed line and a solid one are never the same native line: the
        // SDK keeps an old dash pattern when it is taken away.
        <HistoryLine
          key={line.key ?? `route-${line.dashed ? 'dashed' : line.dotted ? 'dotted' : 'solid'}-${line.start}`}
          line={line}
          casing={isDark ? colors.routeCasing : null}
          dashed={dashed}
        />
      ))}
      {times.map(marker => (
        <RouteMarker
          key={marker.key}
          coordinate={marker.coordinate}
          look={`${marker.label}:${marker.end}:${!!marker.last}:${!!marker.first}`}
          zIndex={20}
        >
          <TimeMarkerView
            label={marker.label}
            end={marker.end}
            last={!!marker.last}
            first={!!marker.first}
            color={route.color}
          />
        </RouteMarker>
      ))}
      {route.places.map(place => (
        <RouteMarker
          key={place.key}
          coordinate={place.coordinate}
          look={`${place.kind}:${place.label ?? place.number}:${!!place.selected}`}
          zIndex={place.kind === 'indoor' ? 26 : 25}
          label={place.kind === 'indoor' ? t('c114') : t('c136', { duration: place.label ?? place.number })}
          onPress={onStopPress ? event => onStopPress(place, event) : undefined}
        >
          {place.kind === 'indoor' ? (
            <IndoorMarkerView />
          ) : (
            <StopMarkerView number={place.number} label={place.label ?? null} color={route.color} selected={!!place.selected} />
          )}
        </RouteMarker>
      ))}
      {route.icon && (
        <RouteMarker key={route.icon.key} coordinate={route.icon.coordinate} look={route.icon.glyph} zIndex={22}>
          <MovementIconView glyph={route.icon.glyph} color={route.color} />
        </RouteMarker>
      )}
      {route.cursor && (
        <CursorMarker cursor={route.cursor} color={route.color} labelHidden={cursorDragging || cursorLabelHidden}
          measurementKey={measurementKey} onLabelMetrics={onLabelMetrics} />
      )}
    </>
  );
});

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
  coldStartReady = true,
  coldStartScope = null,
  framingReady = true,
  onNativePhone,
  phoneEnabled,
  phoneProblem = false,
  livePhone,
  // Every live snapshot, for the phone's dot only (LivePhoneFeed).
  livePhoneFeed = null,
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
  // A tapped movement / 沒有資料 row's segment ({ key, coordinates }): framed
  // once per key, with the room the route framing leaves (2026-10-14).
  historySegmentFrame = null,
  historyFrame = null,
  historyControls = [],
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
  const [cursorMeasurement, setCursorMeasurement] = useState(null);
  const [cursorProjection, setCursorProjection] = useState(null);
  // Between a camera start and its idle, every screen point read before is
  // stale: the collision-only label must not stay at the old place.
  const [historyCameraMoving, setHistoryCameraMoving] = useState(false);

  const [attempt, setAttempt] = useState(0);
  const nativePhone = useRef(null);
  const phoneCentered = useRef(false);
  const [readyInstance, setReadyInstance] = useState(null);
  const [loadedInstance, setLoadedInstance] = useState(null);
  const [nativeLayout, setNativeLayout] = useState(null);
  const [timedOut, setTimedOut] = useState(false);
  const instance = String(attempt);
  // A new map/source never inherits the previous map's camera motion.
  useEffect(() => { setHistoryCameraMoving(false); }, [source, instance]);
  const cursorMeasurementKey = `${source}:${instance}:${historyRoute?.cursor?.lines?.[1]}:${historyRoute?.cursor?.face?.name ?? ''}:${!!historyRoute?.cursor?.face}`;
  // Where each dog is on screen, read after every camera move, so name tags
  // that would run into each other merge into one 「3 隻」 tag.
  const dogMarkers = useMemo(
    () => presentation.dogMarkers || [],
    [presentation.dogMarkers],
  );
  // { source, points }: points from another source (a fixture or data
  // source switch moves every dog) are never used for this one.
  const [dogPoints, setDogPoints] = useState({ source: null, points: {} });
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
  // An offline SDK may never report tiles loaded. After its existing failure
  // deadline a genuinely ready, laid-out instance can still frame the grey map.
  // Keep all ordinary projection/render paths on the stronger loaded fence.
  const coldFitUsable = usable || (coldStartScope != null && coldStartReady && ready && timedOut
    && nativeLayout?.instance === instance && Number.isFinite(nativeLayout.width) && nativeLayout.width > 0
    && Number.isFinite(nativeLayout.height) && nativeLayout.height > 0);
  const [mountedMap, setMountedMap] = useState(false);
  const [needsFirstPositionFit, setNeedsFirstPositionFit] = useState(false);
  const interacted = useRef(false);
  const savedView = useRef(null);
  const framed = useRef(false);
  const afterFit = useRef(null);
  const projectionTimer = useRef(null);
  const projectionRequest = useRef(null);
  useEffect(() => () => {
    clearTimeout(afterFit.current);
    clearTimeout(projectionTimer.current);
    projectionRequest.current = null;
  }, []);
  const splashReleased = useRef(false);
  const coldFrame = useRef({ scope: coldStartScope, ready: coldStartReady });
  coldFrame.current = { scope: coldStartScope, ready: coldStartReady };
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
    if (!coldFrame.current.ready || splashReleased.current) return;
    const scope = coldFrame.current.scope;
    splashReleased.current = true;
    const map = mapRef.current;
    const inputs = splashInputs.current;
    if (!inputs.dogMarkers.length || !map?.pointForCoordinate) {
      reportMapFramed([]);
      return;
    }
    const request = {};
    projectionRequest.current = request;
    const finish = targets => {
      if (projectionRequest.current !== request) return;
      projectionRequest.current = null;
      clearTimeout(projectionTimer.current);
      if (coldFrame.current.scope !== scope || !coldFrame.current.ready) return;
      if (!mounted.current || mapRef.current !== map) {
        splashReleased.current = false;
        return;
      }
      reportMapFramed(targets);
    };
    // The camera has already framed; projection is only the optional flying
    // artwork's target. A stalled bridge must not keep that real frame covered.
    projectionTimer.current = setTimeout(() => finish([]), FIRST_FRAME_WAIT_MS);
    Promise.all(
      inputs.dogMarkers.map(marker =>
        Promise.resolve().then(() => map.pointForCoordinate(marker.coordinate))
          .then(point => [marker.slaveId, point])
          .catch(() => null),
      ),
    )
      .then(entries => {
        finish(
          splashTargets(
            inputs,
            Object.fromEntries(entries.filter(Boolean)),
            PixelRatio.getFontScale?.() || 1,
          ),
        );
      })
      .catch(() => finish([]));
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
  const previousColdScope = useRef(coldStartScope);
  useEffect(() => {
    const changed = previousColdScope.current !== coldStartScope;
    previousColdScope.current = coldStartScope;
    if (getSplashState().phase !== 'waiting' || (!coldStartScope && !changed)) return;
    splashReleased.current = false;
    framed.current = false;
    clearTimeout(afterFit.current);
    clearTimeout(projectionTimer.current);
    projectionRequest.current = null;
    splashDeadline.current = Date.now() + FRAMING_WAIT_MAX_MS;
    if (coldStartReady) setNeedsFirstPositionFit(true);
  }, [coldStartScope, coldStartReady]);
  // Android owns pause/resume. Replacing a healthy map on every resume retains
  // old SDK frame callbacks and duplicates all history overlays. Recentring
  // the phone only moves the camera; it never replaces the map surface.
  // Mounted while the cold start's latest positions were still coming (the
  // map loads under the launch screen meanwhile): its initialRegion was
  // centred on what was there before them, which the first fit replaces.
  const centredBeforeColdStart = useRef(false);
  useEffect(() => {
    if (!dataReady || mountedMap) return;
    // The first view is always one fit of what the presentation frames, made
    // under the launch screen (initialRegion only centres on the first point).
    centredBeforeColdStart.current = !coldStartReady && positions.length > 0;
    setNeedsFirstPositionFit(true);
    setMountedMap(true);
    markStartupPhase('map-mounted');
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  // Each dog's own zIndex, in the order the faces are drawn (DogMarkers).
  const dogZ = useMemo(
    () => dogZIndexes(dogMarkers, dogPoints.source === source ? dogPoints.points : {}, tags),
    [dogMarkers, dogPoints, source, tags],
  );
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
      !coldFitUsable ||
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
        { center: positions[0], zoom: STREET_ZOOM },
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
    centredBeforeColdStart.current = false;
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
  }, [coldFitUsable, positions, source, needsFirstPositionFit, framingReady]);
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
    // for what it frames to be known (the latest positions, the phone's first
    // fix or MapScreen's PHONE_ALONE_WAIT_MS), then a moment for the view to
    // be drawn — and never past one deadline counted from the map's mount
    // (FRAMING_WAIT_MAX_MS).
    const remaining = Math.max(0, splashDeadline.current - Date.now());
    const settled = loaded && framingReady && coldStartReady;
    if (settled && centredBeforeColdStart.current && getSplashState().phase === 'waiting') {
      // Mounted on the positions from before the latest ones, which have
      // none: the same default view a map mounted now would open on.
      centredBeforeColdStart.current = false;
      mapRef.current?.animateToRegion?.(EMPTY_REGION, 0);
    }
    const wait = settled ? Math.min(EMPTY_FRAME_SETTLE_MS, remaining) : remaining;
    const timer = setTimeout(releaseSplash, wait);
    return () => clearTimeout(timer);
  }, [configured, loaded, positions.length, releaseSplash, framingReady, coldStartReady]);
  // ---- the live map's own controls (A1) ----------------------------------
  const live = !historyMode;
  // The compass is a separate root overlay, not part of HistoryScreen's row.
  const [heading, setHeading] = useState(0);
  const turned = Math.abs((((heading % 360) + 540) % 360) - 180) > 1;
  const compassVisible = usable && foreground && compassTop != null && turned;
  const compassKey = `${source}:${instance}:${cursorLayout.width}:${cursorLayout.height}:${compassTop}:${compassVisible}`;
  const compassGeneration = useRef({ key: compassKey, value: 0 });
  if (compassGeneration.current.key !== compassKey) compassGeneration.current = {
    key: compassKey, value: compassGeneration.current.value + 1,
  };
  const compassScope = `${compassKey}:${compassGeneration.current.value}`;
  const compassOwner = useRef(compassScope);
  compassOwner.current = compassScope;
  const [compassLayout, setCompassLayout] = useState(null);
  const measureCompass = useCallback(event => {
    if (compassOwner.current !== compassScope) return;
    const rect = event.nativeEvent.layout;
    const next = { scope: compassScope, rect: {
      x: rect.x - space.xs, y: rect.y - space.xs,
      width: rect.width + space.xs * 2, height: rect.height + space.xs * 2,
    } };
    setCompassLayout(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
  }, [compassScope]);
  const compassRect = compassVisible && compassLayout?.scope === compassScope ? compassLayout.rect : null;
  const screenPoints = dogPoints.source === source ? dogPoints.points : null;
  const overlayBottom = Math.max(bottomInset, coverBottom || 0);
  const overlayTop = Math.max(topInset, coverTop || 0);
  const historyControlRects = Array.isArray(historyControls) ? historyControls : historyControls.boxes;
  const topControlRects = Array.isArray(historyControls) ? historyControls : historyControls.topBoxes ?? historyControls.boxes;
  const controlRects = useMemo(() => [...historyControlRects, ...(!live && compassRect ? [compassRect] : [])],
    [historyControlRects, live, compassRect]);
  const controlsReady = (Array.isArray(historyControls) || historyControls.ready === true)
    && (live || !compassVisible || !!compassRect);
  const measuredHistoryUI = !Array.isArray(historyControls);
  const cursorView = useMemo(() => ({ left: space.s, right: cursorLayout.width - space.s,
    top: overlayTop, bottom: cursorLayout.height - overlayBottom }), [cursorLayout, overlayTop, overlayBottom]);
  const cursorSize = cursorMeasurement?.key === cursorMeasurementKey ? cursorMeasurement.size : null;
  const projectedKey = cursorProjectionKey(historyRoute?.cursor, cursorRevision, cursorLayout.width,
    cursorLayout.height, overlayTop, overlayBottom, `${source}:${instance}`);
  const currentProjection = cursorProjection?.key === projectedKey ? cursorProjection.point : null;
  const cursorCameraRequest = useRef(0);
  const cameraScope = useRef(null);
  cameraScope.current = `${source}:${instance}:${projectedKey}:${cursorMeasurementKey}:${JSON.stringify(historyControls)}:${!live && compassScope}:${JSON.stringify(!live && compassRect)}`;
  const cursorPlacement = controlsReady && cursorSize && currentProjection
    ? cursorLabelPlacement(currentProjection, cursorSize, cursorView, controlRects)
    : { hidden: true, box: null, pinSafe: true };
  const shownCursorPlacement = historyCameraMoving && cursorPlacement.box
    ? { ...cursorPlacement, box: null } : cursorPlacement;
  // The label's box around the cursor point, the same object while it does
  // not move: HistoryRoute (every marker of a long day) re-renders only then.
  const labelAround = labelBoxAround(currentProjection, cursorSize, shownCursorPlacement);
  const labelBoxKey = labelAround ? [labelAround.x, labelAround.y, labelAround.width, labelAround.height].map(Math.round).join(':') : '';
  const labelBox = useMemo(() => labelAround, [labelBoxKey]); // eslint-disable-line react-hooks/exhaustive-deps
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
            // The turned map's compass sits under the gear, where a top
            // right hint would go.
            obstacles: compassVisible ? [compassBox(cursorLayout.width, compassTop)] : [],
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
      compassVisible,
      compassTop,
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
  const centreInView = useCallback((point, requestedTarget = null) => {
    const map = mapRef.current;
    if (!map?.coordinateForPoint) return Promise.resolve(null);
    const { width, height } = cursorLayout;
    // Above the card and, on the live map, above its bottom row (「今天 x
    // km」, 我的位置) too: a point brought there is never under them.
    const freeBottom = height - overlayBottom - (bottomRow ? bottomRow + layout.floatingGap : 0);
    const target = requestedTarget ?? { x: width / 2, y: focusPointY({ top: overlayTop, bottom: freeBottom }) };
    const middle = {
      x: width / 2,
      y: topInset + (height - topInset - bottomInset) / 2,
    };
    return map.coordinateForPoint({
      x: middle.x + point.x - target.x,
      y: middle.y + point.y - target.y,
    });
  }, [cursorLayout, overlayTop, overlayBottom, topInset, bottomInset, bottomRow]);
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
        // A dog switched to from the card always comes to the middle.
        const hidden =
          focusDog.always || !point || occluded ||
          point.x < margin ||
          point.x > width - margin ||
          point.y < overlayTop + margin ||
          point.y > height - overlayBottom - margin - buttons - tag;
        if (!hidden || focused.current !== focusDog.key) return;
        // Its face and name tag in the middle of the map left above the card
        // and the bottom row (at 200% font the card is tall and the band
        // small: the face is kept clear of 「今天 x km」).
        const freeBottom = height - overlayBottom - (bottomRow ? bottomRow + layout.floatingGap : 0);
        const moved = point ? await centreInView(point, { x: width / 2,
          y: focusPointY({ top: overlayTop, bottom: freeBottom, up: point.y - box.top, down: box.bottom - point.y }) }) : null;
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
  const pressHistoryStop = useCallback((place, event) => {
    // Marker selection wins over projections already awaiting the native map.
    // Keep ownership on this touch token; a new touch starts a new token.
    event?.stopPropagation?.();
    if (event && quickTap.current.gesture) quickTap.current.gesture.owner = 'marker';
    quickTap.current.start = null;
    quickTap.current.native = null;
    onStopPress?.(place);
  }, [onStopPress]);
  const touchSurface = useRef(null);
  // Where the last finger came down on the map (page dp) and the map's page
  // origin: Google's marker tap does not say where it was, and its pick among
  // overlapping marker canvases is not the face drawn on top (pressDogMarker).
  const lastTouch = useRef(null);
  const surfaceOrigin = useRef(null);
  const recordTouch = event => {
    const finger = event?.nativeEvent;
    if (!finger || !Number.isFinite(finger.pageX) || !Number.isFinite(finger.pageY)
      || finger.touches?.length > 1) {
      lastTouch.current = null;
      return;
    }
    lastTouch.current = { x: finger.pageX, y: finger.pageY, at: Date.now() };
    touchSurface.current?.measure?.((_x, _y, _width, _height, x, y) => {
      if (Number.isFinite(x) && Number.isFinite(y)) surfaceOrigin.current = { x, y };
    });
  };
  const tapContext = useRef(null);
  tapContext.current = { route: routeGeometryIdentity(historyRoute?.points) };
  const validTap = gesture => quickTap.current.gesture === gesture &&
    tapContext.current.route === gesture.route && mapRef.current === gesture.map;
  const STOP_TAP_DP = 20;
  const touchStart = event => {
    recordTouch(event);
    cursorCameraRequest.current += 1;
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
    // Android emits a second map event for the same native marker click.
    if (event?.action === 'marker-press') return;
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
  const frameRoute = (animated = true, camera = routeCamera, segment = false) => {
    if (!usable || !camera?.length) return;
    const routeCamera = camera; // eslint-disable-line no-shadow
    const originalRoom = historyFramePadding(routeCamera, historyRoute?.cursor?.coordinate, HISTORY_FRAME);
    // A short map (a phone in landscape at half height) may not fit the whole
    // pin+label below the top band, or at all. 框住全部 still frames the route
    // there, as before measured framing: the label moves aside or hides on its
    // own. Only a sliver (expanded) is left alone instead of a 1dp fit.
    const viewRoom = (cursorView.bottom - cursorView.top - originalRoom.top - originalRoom.bottom >= touch.min)
      && (cursorView.right - cursorView.left - originalRoom.left - originalRoom.right >= touch.min);
    const room = cursorSize
      ? measuredCursorFrame(originalRoom, cursorSize, cursorView, controlRects, topControlRects)
        ?? measuredCursorFrame(originalRoom, cursorSize, cursorView, controlRects, [])
        ?? (viewRoom ? originalRoom : null)
      : originalRoom;
    if (!room) return;
    // A segment keeps clear of 框住全部 at the lower right too: it can end in
    // that corner, where a whole route rarely does.
    const framing = overlayFramePadding(segment
      ? { ...room, right: Math.max(room.right, touch.min + space.l + space.s) } : room,
    { topInset, bottomInset, overlayTop, overlayBottom });
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
    if (!historyFrame || historyFramed.current === historyFrame.key || !usable
      || (measuredHistoryUI && (!controlsReady || !cursorSize)))
      return;
    historyFramed.current = historyFrame.key;
    takeCamera();
    frameRoute();
    // Once per press of 框住全部.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyFrame?.key, usable, measuredHistoryUI, controlsReady, cursorSize]);
  const segmentFramed = useRef(null);
  useEffect(() => {
    if (!historySegmentFrame || segmentFramed.current === historySegmentFrame.key || !usable
      || (measuredHistoryUI && (!controlsReady || !cursorSize)))
      return;
    segmentFramed.current = historySegmentFrame.key;
    takeCamera();
    frameRoute(true, historySegmentFrame.coordinates, true);
    // Once per tapped row.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historySegmentFrame?.key, usable, measuredHistoryUI, controlsReady, cursorSize]);
  // A node of the list or a stop number: the cursor point comes into the
  // middle of the map above the panel (220 ms, motion.cursorJump).
  // 判定表「使用者拖過地圖之後的游標」: otherwise the map moves only when the
  // cursor point or its label (about 60dp above it) would be out of sight.
  const showCursor = useCallback(
    async (coordinate, centre) => {
      const map = mapRef.current;
      if (!map || !coordinate) return;
      const request = ++cursorCameraRequest.current;
      const scope = cameraScope.current;
      const active = () => request === cursorCameraRequest.current && scope === cameraScope.current && map === mapRef.current;
      if (!centre && map.pointForCoordinate) {
        try {
          const point = await map.pointForCoordinate(coordinate);
          if (!active()) return;
          const seen = cursorSize
            ? !cursorLabelPlacement(point, cursorSize, cursorView, controlRects).hidden
            : point.x >= 24 && point.x <= cursorLayout.width - 24
              && point.y >= overlayTop + 72 && point.y <= cursorLayout.height - overlayBottom - 24;
          if (seen) return;
        } catch {
          /* Move anyway. */
        }
      }
      const target = cursorSize ? cursorCameraTarget(cursorSize, cursorView, controlRects) : null;
      if (cursorSize && !target) return;
      let cursorCenter = coordinate;
      if (map.pointForCoordinate) {
        try {
          const point = await map.pointForCoordinate(coordinate);
          if (!active()) return;
          cursorCenter = await centreInView(point, target) || coordinate;
        } catch { /* Keep the requested coordinate if projection fails. */ }
      }
      if (!active()) return;
      map.animateCamera(
        { center: cursorCenter },
        { duration: moveDuration(motion.cursorJump.duration) },
      );
    },
    [cursorLayout.width, cursorLayout.height, overlayTop, overlayBottom, centreInView, cursorSize, cursorView, controlRects],
  );
  const focusedHistory = useRef(null);
  useEffect(() => {
    if (!historyFocus || focusedHistory.current === historyFocus.key || !usable
      || (measuredHistoryUI && (!controlsReady || !cursorSize)))
      return;
    focusedHistory.current = historyFocus.key;
    showCursor(historyFocus.coordinate, historyFocus.centre);
  }, [historyFocus, usable, showCursor, measuredHistoryUI, controlsReady, cursorSize]);
  // A released (or cancelled) cursor drag that left the point, its face/name
  // or its label under the panel or a control moves the map, never the
  // marker (判定表: 拖游標 is one of the history's camera exceptions).
  const cursorWasDragged = useRef(false);
  const revealDraggedCursor = useRef(false);
  useEffect(() => {
    if (cursorDragging) { cursorWasDragged.current = true; revealDraggedCursor.current = false; }
    else if (cursorWasDragged.current) { cursorWasDragged.current = false; revealDraggedCursor.current = true; }
  }, [cursorDragging]);
  const draggedCoordinate = historyRoute?.cursor?.coordinate;
  const cursorNeedsRoom = cursorPlacement.hidden && (!cursorPlacement.box || !cursorPlacement.pinSafe);
  useEffect(() => {
    if (!revealDraggedCursor.current || cursorDragging || !usable || !draggedCoordinate
      || !controlsReady || !cursorSize || !currentProjection) return;
    revealDraggedCursor.current = false;
    if (cursorNeedsRoom) showCursor(draggedCoordinate, false);
  }, [cursorDragging, usable, draggedCoordinate, controlsReady, cursorSize, currentProjection, cursorNeedsRoom, showCursor]);
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
    // As Google Maps: zoomed out further than the street view, it zooms in to
    // STREET_ZOOM on the way; at or closer than that it keeps the zoom.
    const zoomNow = Promise.resolve(map?.getCamera?.())
      .then(camera => (Number.isFinite(camera?.zoom) ? camera.zoom : null))
      .catch(() => null);
    zoomNow.then(zoom => {
      const zoomIn = zoom != null && zoom < STREET_ZOOM;
      const animate = to =>
        map?.animateCamera(
          zoomIn ? { center: to, zoom: STREET_ZOOM } : { center: to },
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
        .then(to => {
          if (!to || !zoomIn) return animate(to || position);
          // centreInView's offset from the phone is at today's zoom; the
          // same offset on screen covers 2^(zoom − 16) as much ground at 16.
          const scale = 2 ** (zoom - STREET_ZOOM);
          return animate({
            latitude: position.latitude + (to.latitude - position.latitude) * scale,
            longitude: position.longitude + (to.longitude - position.longitude) * scale,
          });
        })
        .catch(() => animate(position));
    });
  };
  // A tap on a dog always opens that dog's card (no list of dogs, 066).
  // Google reports a map tap for a tap on a marker too while a card is open
  // (the card then closed and the dog's own card needed a second tap): a map
  // tap is held back a moment and dropped when a dog was tapped around it.
  const lastDogPress = useRef(0);
  const lastDogId = useRef(null);
  const mapPressTimer = useRef(null);
  useEffect(() => () => clearTimeout(mapPressTimer.current), []);
  const pressDog = slaveId => {
    lastDogPress.current = Date.now();
    lastDogId.current = slaveId;
    clearTimeout(mapPressTimer.current);
    onDogPress?.(slaveId);
  };
  // A native tap on a dog's marker opens the dog drawn where the finger was:
  // a face drawn over another dog's name tag canvas is that face's dog, and a
  // name tag showing over the empty canvas of a marker drawn above it is the
  // tag's dog. Without a recent touch or screen points, Google's pick stands.
  // One function for every marker (kept by ref), so a marker is not drawn
  // again only because the map was.
  const pressLatest = useRef(null);
  const pressMarker = useCallback(slaveId => pressLatest.current?.(slaveId), []);
  const pressDogMarker = slaveId => {
    const finger = lastTouch.current;
    const origin = surfaceOrigin.current;
    const tap = finger && origin && Date.now() - finger.at <= MARKER_TOUCH_MAX_MS
      ? { x: finger.x - origin.x, y: finger.y - origin.y } : null;
    const drawn = tap && screenPoints
      ? dogUnderTouch(dogMarkers, screenPoints, tags, tap, dogZ, fontScale) : null;
    // The finger was on no face and no name tag, only a marker's transparent
    // canvas (174dp wide on Android): what the eye sees there is empty map,
    // so it is an empty-map tap — it closes an open card instead of opening
    // (or keeping) that marker's dog.
    if (tap && screenPoints && drawn == null) {
      clearTimeout(mapPressTimer.current);
      onMapPress?.();
      return;
    }
    pressDog(drawn ?? slaveId);
  };
  pressLatest.current = pressDogMarker;
  // Whether `tap` (dp) falls inside the full marker bitmap (face plus name
  // tag canvas) of the dog last opened by a marker tap; unknown counts as inside.
  const insidePressedMarker = tap => {
    const marker = dogMarkers.find(dog => dog.slaveId === lastDogId.current);
    const point = marker && screenPoints?.[marker.slaveId];
    if (!tap || !point) return true;
    const box = markerFrame(marker.size);
    const left = point.x - box.width * box.anchor.x;
    const top = point.y - box.height * box.anchor.y;
    return tap.x >= left && tap.x <= left + box.width && tap.y >= top && tap.y <= top + box.height;
  };
  const pressMapLive = event => {
    // Android also reports a marker's tap as a map tap ('marker-press'), at
    // the marker's anchor rather than the finger: the marker's own onPress
    // (pressDogMarker) answers it. Taken as a tap on that point it re-opened
    // the dog under a card that a tap beside it had just closed.
    if (event?.nativeEvent?.action === 'marker-press') return;
    const at = Date.now();
    // Google can report a tap on a dog as a tap on the map (a card open):
    // a tap on a dog's face opens that dog.
    const position = event?.nativeEvent?.position;
    const scale = Platform.OS === 'android' ? PixelRatio.get?.() || 1 : 1;
    const tap = position ? { x: position.x / scale, y: position.y / scale } : null;
    const hit = tap && screenPoints ? dogAtPoint(dogMarkers, screenPoints, tap) : null;
    // Just after a dog tap (the marker reported first) a map tap inside that
    // dog's marker bitmap is Google's duplicate of the same touch: dropped, so
    // the native marker identity wins even over a face nearer the finger.
    // A map tap on another dog's face outside it is a second tap: dog A then
    // dog B within the hold opens B (the hit-test runs before the hold).
    if (at - lastDogPress.current < 2 * MAP_TAP_HOLD_MS
      && (hit == null || insidePressedMarker(tap))) return;
    if (hit != null) {
      pressDog(hit);
      return;
    }
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
        onTouchStart={historyRoute ? touchStart : recordTouch}
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
          initialCamera={savedCamera(savedView.current, source)}
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
          onLayout={event => {
            if (activeInstance.current !== instance) return;
            const { width, height } = event.nativeEvent.layout;
            setNativeLayout({ instance, width, height });
          }}
          onPanDrag={() => {
            cursorCameraRequest.current += 1;
            interacted.current = true;
            startMoving();
          }}
          onRegionChangeStart={historyMode ? () => setHistoryCameraMoving(true) : undefined}
          onRegionChangeComplete={(_, details) => {
            setHistoryCameraMoving(false);
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
            if (activeInstance.current === instance) {
              setLoadedInstance(instance);
              markStartupPhase('map-loaded');
            }
          }}
        >
          {/* History draws no live phone (flow.txt: 只有可以拖的游標點). */}
          {!historyMode && livePhone?.running && livePhone.position && (
            <PhoneLocationOverlay
              feed={livePhoneFeed}
              redrawKey={`${shownKey}:${instance}:${loaded}`}
              Circle={Circle}
              Marker={StyledMarker}
              location={livePhone}
              phoneProblem={phoneProblem}
              active={foreground}
            />
          )}
          {historyRoute && (
            <HistoryRoute
              route={historyRoute}
              cursorDragging={cursorDragging}
              cursorLabelHidden={cursorPlacement.hidden}
              measurementKey={cursorMeasurementKey}
              onLabelMetrics={setCursorMeasurement}
              onStopPress={onStopPress ? pressHistoryStop : undefined}
              metresPerDp={metresPerDp}
              labelBox={cursorDragging ? null : labelBox}
              heading={heading}
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
              shownKey={shownKey}
              // Above the phone's dot (30), whose name tag layer they carry:
              // the open dog on top, then problems, then the dog carrying a
              // group tag over the faces it covers; each dog its own zIndex
              // (DogMarkers.dogZIndexes), so what is drawn on top is what a
              // tap opens.
              zIndex={dogZ[marker.slaveId]}
              label={
                tags[marker.slaveId]?.group > 1
                  ? groupSpeech(tags[marker.slaveId], dogMarkers, marker.slaveId)
                  : undefined
              }
              onPress={onDogPress ? pressMarker : undefined}
            />
          ))}
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
          onProjection={setCursorProjection}
          projectionScope={`${source}:${instance}`}
          labelPlacement={shownCursorPlacement}
          revision={cursorRevision}
          width={cursorLayout.width}
          height={cursorLayout.height}
          top={overlayTop}
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
            items={markerA11yItems(dogMarkers, screenPoints, {
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
              key={value.key}
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
            phoneProblem={phoneProblem}
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
      {compassVisible && (
        <CompassButton
          key={compassScope}
          onLayout={!live ? measureCompass : undefined}
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
