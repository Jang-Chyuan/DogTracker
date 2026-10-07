import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  PixelRatio,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MapView, {
  Marker,
  Polygon,
  Polyline,
  PROVIDER_GOOGLE,
} from 'react-native-maps';
import { colors as tokens, layout, motion, opacity, size as sizes } from '../theme/tokens';
import { floatingShadow, mapColors as colors } from './MapTheme';
import { MAP_LOAD_TIMEOUT_MS } from './TrackingMap';
import PhoneLocationOverlay from './PhoneLocationOverlay';
import HistoryCursor from '../mapHistory/HistoryCursor';
import DogMarkerView, { markerFrame } from './DogMarkerView';
import { INDOOR_WORD, nameTags } from './DogMarkers';
import { dogMapLabel } from '../mapHistory/DogAliases';
import { hideSplash } from '../app/hideSplash';
import {
  framedCoordinates, framePadding, frameAllCoordinates, phoneFix, PHONE_FIX_MAX_AGE_S, regionForFrame,
} from './MapFraming';
import { edgeHints } from './EdgeHints';
import { EdgeHintView, MapButtons, MapTip } from './MapControls';
import OverlapPicker, { overlapMenuPlace } from './OverlapPicker';

// '#RRGGBB' at an opacity, as '#RRGGBBAA' for the map SDK.
const withOpacity = (hex, alpha) => hex + Math.round(alpha * 255).toString(16).padStart(2, '0').toUpperCase();
// Range ring (DESIGN.md 判定表「接收範圍圈」): 1.5dp dashed 6/4 in rangeRing at
// 55%, filled with the same colour at 6%. Out-of-range line: critLine, 2dp,
// dashed 6/4. Widths are dp; Android takes dash lengths in pixels.
const RANGE_RING = {
  stroke: withOpacity(tokens.rangeRing, opacity.rangeRingStroke),
  fill: withOpacity(tokens.rangeRing, opacity.rangeRingFill),
  width: 1.5,
};
const OUT_OF_RANGE_WIDTH = 2;
const dash = () => [6, 4].map(length => PixelRatio.getPixelSizeForLayoutSize(length));
// Drawing order: base map, ring, red lines, routes, dogs and phone.
const Z = { ring: 1, rangeLine: 2, route: 3 };

// The launch screen is released once the first framing has been drawn, or
// this long after the map loaded when there is still nothing to frame (the
// native side lets go after 10 s whatever happens).
export const FIRST_FRAME_WAIT_MS = 3000;
// A fit is drawn within a frame or two; release the launch screen after it
// even if the map reports no camera change (the camera was already there).
const AFTER_FIT_MS = 250;
// The map's own padding at the sides (dp).
const MAP_SIDE_PADDING = 12;

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
  const settle = useCallback(delay => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setTracking(false);
      ref.current?.redraw?.();
    }, delay);
  }, [ref]);
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
  const ref = useRef(null);
  const photo = usePhotoMarker(avatar, ref);
  const frame = markerFrame(marker.size);
  const look = [marker.size, marker.problem, marker.stale, marker.indoor, marker.selected,
    tag?.text, tag?.problem, avatar?.kind, avatar?.art, avatar?.color, avatar?.uri?.length].join('|');
  useEffect(() => { ref.current?.redraw?.(); }, [look]);
  return (
    <Marker
      ref={ref}
      identifier={source + '-dog-' + marker.slaveId}
      coordinate={marker.coordinate}
      anchor={frame.anchor}
      tracksViewChanges={photo.tracking}
      zIndex={zIndex}
      // No title or description: those draw the SDK's own bubble, and a tap
      // already opens the dog. The label below is what TalkBack reads.
      onPress={onPress}
    >
      <View collapsable={false} accessible accessibilityLabel={label || marker.label}
        onLayout={() => ref.current?.redraw?.()}>
        <DogMarkerView marker={marker} tag={tag} avatar={avatar} onAvatarLoad={photo.onLoad} />
      </View>
    </Marker>
  );
}

// TalkBack for the face carrying a 「3 隻」 tag: the dogs in it, and what a
// double tap does.
function groupSpeech(tag, markers) {
  const names = tag.members.map(id => markers.find(marker => marker.slaveId === id)?.name).filter(Boolean);
  return `${tag.text}：${names.join('、')}，點兩下選一隻`;
}

// The history track's last drawn position: the same face and name tag as the
// live map (house and 「名字・室內」 when it was held there), without the
// live problem badges. Same redraw dance as DogMarker.
function TrackMarker({ track, onPress }) {
  const ref = useRef(null);
  const photo = usePhotoMarker(track.avatar, ref);
  const { latest } = track;
  const indoor = !!latest.heldReason;
  const marker = { slaveId: track.name, size: 40, problem: false, stale: false, indoor, selected: false };
  const frame = markerFrame(marker.size);
  const name = dogMapLabel(track.name);
  const text = indoor ? `${name}・${INDOOR_WORD}` : name;
  const avatarKey = [track.avatar?.kind, track.avatar?.art, track.avatar?.color, track.avatar?.uri?.length].join('|');
  useEffect(() => { ref.current?.redraw?.(); }, [text, avatarKey]);
  return (
    <Marker
      ref={ref}
      coordinate={latest}
      anchor={frame.anchor}
      tracksViewChanges={photo.tracking}
      onPress={onPress}
    >
      <View collapsable={false} accessible accessibilityLabel={`${text}，${new Date(latest.time).toLocaleString()}`}
        onLayout={() => ref.current?.redraw?.()}>
        <DogMarkerView marker={marker} tag={{ text, group: 1 }} avatar={track.avatar} onAvatarLoad={photo.onLoad} />
      </View>
    </Marker>
  );
}

function GoogleTrackingMapRenderer({
  source,
  presentation,
  topInset,
  bottomInset,
  onStatus,
  onReadyChange,
  onSnapshotReady,
  foreground,
  dataReady = true,
  framingReady = true,
  phoneEnabled,
  livePhone,
  onDogPress,
  onTrackPress,
  // A tap on the map itself (not on a dog): closes the open card.
  onMapPress,
  // The map's rotation in degrees (the card's direction arrow follows it).
  onHeading,
  // { key, coordinate }: a dog's card just opened; bring the dog into view
  // above it if the card or the screen edge hides it (once per key).
  focusDog,
  // How much of the bottom an open card covers (0: none). The map's own
  // padding stays at bottomInset — changing it would shift the whole map each
  // time a card opens — so only what is drawn over the map (buttons, hints,
  // the overlap menu) and the moves the user asks for keep clear of the card.
  coverBottom = 0,
  supported,
  configured,
}) {
  const {
    slaveSegments,
    rangeRing,
    rangeLines = [],
    cameraPositions: positions,
  } = presentation;
  const mapRef = useRef(null);
  const [cursorLayout, setCursorLayout] = useState({ width: 0, height: 0 });
  const [cursorRevision, setCursorRevision] = useState(0);
  const [cursorDragging, setCursorDragging] = useState(false);
  const [cursorSelection, setCursorSelection] = useState(null);
  const [attempt] = useState(0);
  const nativePhone = useRef(null);
  const phoneCentered = useRef(false);
  const [readyInstance, setReadyInstance] = useState(null);
  const [loadedInstance, setLoadedInstance] = useState(null);
  const [timedOut, setTimedOut] = useState(false);
  const instance = String(attempt);
  // Where each dog is on screen, read after every camera move, so name tags
  // that would run into each other merge into one 「3 隻」 tag.
  const dogMarkers = useMemo(() => presentation.dogMarkers || [], [presentation.dogMarkers]);
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
  const pointsKey = dogMarkers.map(marker => `${marker.slaveId}:${marker.coordinate.latitude},`
    + `${marker.coordinate.longitude}:${marker.size}`).join('|');
  const activeInstance = useRef(instance);
  activeInstance.current = instance;
  const ready = readyInstance === instance;
  const loaded = loadedInstance === instance;
  // onMapReady can precede native layout under Fabric. onMapLoaded is the first
  // callback after which bounds-based camera commands are safe on Android.
  const usable = ready && loaded;
  useEffect(() => {
    onSnapshotReady?.(usable ? () => mapRef.current.takeSnapshot({ format: 'png', result: 'file' }) : null);
    return () => onSnapshotReady?.(null);
  }, [usable, instance, onSnapshotReady]);
  const [mountedMap, setMountedMap] = useState(false);
  const [needsFirstPositionFit, setNeedsFirstPositionFit] = useState(false);
  const interacted = useRef(false);
  const savedView = useRef(null);
  const framed = useRef(false);
  const afterFit = useRef(null);
  useEffect(() => () => clearTimeout(afterFit.current), []);
  const splashReleased = useRef(false);
  const releaseSplash = useCallback(() => {
    if (splashReleased.current) return;
    splashReleased.current = true;
    hideSplash();
  }, []);
  const fontScale = PixelRatio.getFontScale?.() || 1;
  // Framing keeps clear of the bottom right buttons too (16dp + 48dp), so no
  // dog or name tag is framed under them.
  const padding = useMemo(() => {
    const value = framePadding(dogMarkers, fontScale);
    return { ...value, right: value.right + layout.screenEdge + sizes.floatingButton };
  }, [dogMarkers, fontScale]);
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
    if (!usable || dogMarkers.length < 1 || !map?.pointForCoordinate) return undefined;
    let alive = true;
    Promise.all(dogMarkers.map(marker => map.pointForCoordinate(marker.coordinate)
      .then(point => [marker.slaveId, point]).catch(() => null)))
      .then(entries => {
        if (!alive) return;
        setDogPoints({ source, points: Object.fromEntries(entries.filter(Boolean)) });
        // Read after the camera stopped: the off-screen hints are right again.
        if (moving.current) {
          moving.current = false;
          setMovingState(false);
        }
      });
    return () => { alive = false; };
    // pointsKey stands for dogMarkers' positions and sizes; a new size or
    // padding of the map moves every dog on screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usable, pointsKey, cursorRevision, source, cursorLayout.width, cursorLayout.height, topInset, bottomInset]);
  const projecting = usable && dogMarkers.length > 1 && typeof mapRef.current?.pointForCoordinate === 'function';
  const tags = useMemo(() => {
    const points = dogPoints.source === source ? dogPoints.points : null;
    // Just switched source: no tags for the moment it takes to place them,
    // rather than separate tags that then jump into a group (or a group made
    // from where the previous source's dogs were).
    if (projecting && !points) return Object.fromEntries(dogMarkers.map(marker => [marker.slaveId, null]));
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
  useEffect(() => {
    setTimedOut(false);
    if (!supported) {
      onStatus('本平台尚未設定 Google Maps，仍可查看 SQLite 資料。');
      return undefined;
    }
    if (!configured) {
      onStatus('未設定 Google Maps Android key，仍可查看 SQLite 資料。');
      return undefined;
    }
    onStatus(null);
    if (loaded || !foreground || !mountedMap) return undefined;
    const timer = setTimeout(() => {
      setTimedOut(true);
      onStatus(
        '底圖尚未載入完成。請檢查網路、Google Maps key 與權限設定；SQLite 仍會更新。',
      );
    }, MAP_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [
    configured,
    supported,
    loaded,
    instance,
    foreground,
    mountedMap,
    onStatus,
  ]);
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
    if (!usable || !shouldFit || !framingReady || interacted.current || !positions.length)
      return;
    mapRef.current?.fitToCoordinates(positions, {
      animated: false,
      // Room for the faces' "!" and name tags (History tracks have none).
      edgePadding: presentation.historyTracks ? { top: 24, right: 24, bottom: 24, left: 24 } : padding,
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
  const live = !presentation.historyTracks;
  const screenPoints = dogPoints.source === source ? dogPoints.points : null;
  const overlayBottom = Math.max(bottomInset, coverBottom || 0);
  const hints = useMemo(() => (live && screenPoints ? edgeHints(dogMarkers, screenPoints, {
    width: cursorLayout.width, height: cursorLayout.height, top: topInset, bottom: overlayBottom,
  }) : []), [live, screenPoints, dogMarkers, cursorLayout.width, cursorLayout.height, topInset, overlayBottom]);
  // When the map's own blue dot last reported (kept coarse: one update a
  // minute is enough to know whether there is a fix).
  const [nativeFixAt, setNativeFixAt] = useState(null);
  // The phone's position now: the recording service's fix (10 minutes at
  // most), else the map's own blue dot from the last 10 minutes.
  const currentPhone = () => {
    const recorded = phoneFix(livePhone);
    if (recorded) return recorded;
    const native = nativePhone.current;
    return native && Date.now() - native.receivedAt <= PHONE_FIX_MAX_AGE_S * 1000
      && Number.isFinite(native.latitude) && Number.isFinite(native.longitude)
      ? { latitude: native.latitude, longitude: native.longitude } : null;
  };
  const phoneAvailable = !!phoneFix(livePhone)
    || (nativeFixAt != null && Date.now() - nativeFixAt <= PHONE_FIX_MAX_AGE_S * 1000);
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
    const framing = { ...padding, bottom: padding.bottom + overlayBottom - bottomInset };
    // 300 ms (motion.camera).
    const region = regionForFrame(points, framing, {
      width: cursorLayout.width - 2 * MAP_SIDE_PADDING,
      height: cursorLayout.height - topInset - bottomInset,
    });
    if (region) mapRef.current?.animateToRegion(region, motion.camera.duration);
    else mapRef.current?.fitToCoordinates(points, { animated: true, edgePadding: framing });
  };
  // A dog whose card just opened: when the card (or a screen edge) covers it,
  // move the map so it shows in the middle of what is left above the card
  // (300 ms). Asked once per opening.
  const focused = useRef(null);
  useEffect(() => {
    if (!focusDog || focused.current === focusDog.key || !usable || !cursorLayout.height) return;
    // A source switch (or the first view) is still to be framed: wait for it,
    // or this move would count as the user's and cancel that framing.
    if ((sourceToFit.current === source && !interacted.current) || needsFirstPositionFit) return;
    focused.current = focusDog.key;
    const map = mapRef.current;
    if (!map?.pointForCoordinate) return;
    const { width, height } = cursorLayout;
    map.pointForCoordinate(focusDog.coordinate).then(async point => {
      const margin = sizes.marker.attention + layout.framePadding;
      const hidden = !point || point.x < margin || point.x > width - margin
        || point.y < topInset + margin || point.y > height - overlayBottom - margin;
      if (!hidden || focused.current !== focusDog.key) return;
      // The camera's centre is the middle of the padded map; move it by how
      // far the dog is from where it should be.
      const target = { x: width / 2, y: (topInset + height - overlayBottom) / 2 };
      const middle = { x: width / 2, y: topInset + (height - topInset - bottomInset) / 2 };
      const moved = point && map.coordinateForPoint
        ? await map.coordinateForPoint({ x: middle.x + point.x - target.x, y: middle.y + point.y - target.y })
        : null;
      if (focused.current !== focusDog.key) return;
      takeCamera();
      map.animateCamera({ center: moved || focusDog.coordinate }, { duration: motion.camera.duration });
    }).catch(() => {});
    // takeCamera only flips refs; the effect runs per opening (focusDog.key).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusDog, usable, cursorLayout.height, overlayBottom, fitCount, needsFirstPositionFit]);
  const pressFrameAll = () => frame(frameAllCoordinates(dogMarkers, currentPhone()));
  const pressMyLocation = () => {
    const position = currentPhone();
    if (!position) {
      showTip('手機沒有定位');
      return;
    }
    if (!usable) return;
    takeCamera();
    mapRef.current?.animateCamera({ center: position }, { duration: motion.camera.duration });
  };
  // The overlap menu: which group tag was tapped (by the dog carrying it).
  const [picker, setPicker] = useState(null);
  const closePicker = useCallback(() => setPicker(null), []);
  const pressDog = slaveId => {
    const tag = tags[slaveId];
    if (tag?.group > 1) setPicker({ source, lead: slaveId, members: tag.members });
    else onDogPress?.(slaveId);
  };
  const pickerMarkers = useMemo(() => {
    if (!picker || picker.source !== source) return null;
    const byId = new Map(dogMarkers.map(marker => [marker.slaveId, marker]));
    const members = picker.members.map(id => byId.get(id)).filter(Boolean);
    return members.length > 1 ? members : null;
  }, [picker, source, dogMarkers]);
  const leadPoint = picker && screenPoints?.[picker.lead];
  const leadSize = picker && dogMarkers.find(marker => marker.slaveId === picker.lead)?.size;
  const pickerPlace = pickerMarkers && leadPoint ? overlapMenuPlace({ ...leadPoint, size: leadSize },
    // Above the card: the card is drawn over the map and would cover it.
    pickerMarkers.length, { width: cursorLayout.width, height: cursorLayout.height, top: topInset, bottom: overlayBottom })
    : null;
  // The menu goes when its dogs no longer overlap, on a source switch, and
  // when a dog is opened some other way (its card row).
  useEffect(() => {
    if (picker && !pickerMarkers) setPicker(null);
  }, [picker, pickerMarkers]);
  const openDogId = dogMarkers.find(marker => marker.selected)?.slaveId ?? null;
  useEffect(() => setPicker(null), [openDogId]);
  return (
    <View style={StyleSheet.absoluteFill} testID="tracking-map-container"
      onLayout={event => setCursorLayout(event.nativeEvent.layout)}>
      {configured && mountedMap ? (
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
          mapType="standard"
          moveOnMarkerPress={false}
          // Google reports a tap only (a drag or a long press is not one).
          onPress={onMapPress ? () => onMapPress() : undefined}
          showsUserLocation={ready && foreground && phoneEnabled && !(livePhone?.running && livePhone.position)}
          userLocationPriority="high"
          userLocationUpdateInterval={1000}
          toolbarEnabled={false}
          showsMyLocationButton={false}
          onUserLocationChange={event => {
            const value = event.nativeEvent?.coordinate;
            if (!value) return;
            const receivedAt = Date.now();
            nativePhone.current = { ...value, receivedAt };
            if (nativeFixAt == null || receivedAt - nativeFixAt > 60000) setNativeFixAt(receivedAt);
          }}
          // Google SDK handles rotation/tilt visibility and tap-to-north.
          showsCompass
          rotateEnabled={!cursorDragging}
          pitchEnabled={!cursorDragging}
          scrollEnabled={!cursorDragging}
          zoomEnabled={!cursorDragging}
          // Native padding dereferences GoogleMap. Never send it before this
          // specific map instance is ready, including retry/source replacement.
          mapPadding={
            ready
              ? { top: topInset, right: MAP_SIDE_PADDING, bottom: bottomInset, left: MAP_SIDE_PADDING }
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
            mapRef.current?.getCamera?.().then(camera => {
              if (
                activeInstance.current === instance &&
                cameraRead.current === request &&
                camera
              ) {
                savedView.current = { source, camera };
                if (Number.isFinite(camera.heading)) onHeading?.(camera.heading);
              }
            }).catch(() => {
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
          {livePhone?.running && livePhone.position && <PhoneLocationOverlay location={livePhone} active={foreground} />}
          {(presentation.historyTracks || []).map(track => (
            <React.Fragment key={track.name}>
              {track.segments.filter(segment => segment.length > 1).map((segment, index) => (
                <Polyline key={index} coordinates={segment} strokeColor={track.color} strokeWidth={4} geodesic={false}
                  zIndex={Z.route} />
              ))}
              {track.latest && (track.role === 'phone'
                ? <PhoneLocationOverlay key={source + ':' + (track.latest.session_id || '')} historical active={foreground}
                  onPress={onTrackPress ? () => onTrackPress(track.name) : undefined}
                  location={{ position: { latitude: track.latest.latitude, longitude: track.latest.longitude,
                    timestamp: track.latest.time, rawSpeedKmh: track.latest.speed_kmh } }} />
                : <TrackMarker track={track}
                  onPress={onTrackPress ? () => onTrackPress(track.name) : undefined} />)}
            </React.Fragment>
          ))}
          {slaveSegments.map((segment, index) => (
            <Polyline
              key={source + '-slave-' + index}
              coordinates={segment}
              geodesic={false}
              strokeColor={colors.dog}
              strokeWidth={4}
              zIndex={Z.route}
            />
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
                <Polyline key={index} coordinates={segment} geodesic={false}
                  strokeColor={track.color} strokeWidth={3} zIndex={Z.route} />
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
              zIndex={marker.selected ? 40 : (marker.problem ? 34 : 31) + (tags[marker.slaveId]?.group > 1 ? 2 : 0)}
              label={tags[marker.slaveId]?.group > 1 ? groupSpeech(tags[marker.slaveId], dogMarkers) : undefined}
              onPress={onDogPress ? () => pressDog(marker.slaveId) : undefined}
            />
          ))}
        </MapView>
      ) : (
        <View style={styles.unavailable}>
          <Text style={styles.unavailableText}>
            {configured ? '正在讀取本機位置…' : 'Google Maps'}
          </Text>
          {!configured && <Text style={styles.hint}>地圖設定尚未完成</Text>}
        </View>
      )}
      {usable && cursorLayout.width > 0 && presentation.historyTracks?.some(track => track.role === 'phone' && track.segments.length > 0) &&
        <HistoryCursor key={source + ':' + instance} tracks={presentation.historyTracks.filter(track => track.role === 'phone')} mapRef={mapRef}
          hidden={!foreground} selection={cursorSelection?.source === source ? cursorSelection.value : null}
          onDraggingChange={setCursorDragging}
          onSelectionChange={value => setCursorSelection({ source, value })}
          revision={cursorRevision} width={cursorLayout.width} height={cursorLayout.height} top={topInset} bottom={bottomInset} />}
      {configured && mountedMap && !loaded && !timedOut && (
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
      {live && usable && foreground && !movingState && hints.map(value => (
        <EdgeHintView key={value.side} value={value} avatars={presentation.dogAvatars || {}}
          onPress={() => frame(value.coordinates)} />
      ))}
      {live && configured && foreground && (loaded || timedOut) && (
        // 框住全部 and 我的位置 (A1), 12dp above the card; above the tip
        // while it shows.
        <MapButtons bottom={overlayBottom + (tip ? sizes.floatingButton + layout.floatingGap : 0)}
          phoneAvailable={phoneAvailable} onFrameAll={pressFrameAll} onMyLocation={pressMyLocation} />
      )}
      {live && <MapTip message={tip} bottom={overlayBottom} onDone={clearTip} />}
      {pickerMarkers && pickerPlace && (
        <OverlapPicker markers={pickerMarkers} place={pickerPlace} avatars={presentation.dogAvatars || {}}
          onClose={closePicker}
          onPick={slaveId => {
            setPicker(null);
            onDogPress?.(slaveId);
          }} />
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
const styles = StyleSheet.create({
  unavailable: {
    flex: 1,
    backgroundColor: '#E9EEEA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  unavailableText: { color: colors.master, fontWeight: '700', fontSize: 20 },
  hint: { color: colors.muted, marginTop: 8 },
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
