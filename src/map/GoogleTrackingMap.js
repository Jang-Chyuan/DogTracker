import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  PixelRatio,
  Pressable,
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
import { colors as tokens, opacity } from '../theme/tokens';
import { floatingShadow, mapColors as colors } from './MapTheme';
import { MAP_LOAD_TIMEOUT_MS } from './TrackingMap';
import PhoneLocationOverlay from './PhoneLocationOverlay';
import HistoryCursor from '../mapHistory/HistoryCursor';
import DogMarkerView, { markerFrame } from './DogMarkerView';
import { INDOOR_WORD, nameTags } from './DogMarkers';
import { dogMapLabel } from '../mapHistory/DogAliases';
import { hideSplash } from '../app/hideSplash';

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

const EMPTY_REGION = {
  latitude: 23.7,
  longitude: 121,
  latitudeDelta: 4,
  longitudeDelta: 4,
};
// One dog on the live map. The marker view is not tracked for changes (that
// would redraw it on every frame), so every change of what it shows asks for
// one redraw. A tap opens the dog.
function DogMarker({ source, marker, tag, avatar, zIndex, onPress }) {
  const ref = useRef(null);
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
      tracksViewChanges={false}
      zIndex={zIndex}
      // No title or description: those draw the SDK's own bubble, and a tap
      // already opens the dog. The label below is what TalkBack reads.
      onPress={onPress}
    >
      <View collapsable={false} accessible accessibilityLabel={marker.label}
        onLayout={() => ref.current?.redraw?.()}>
        <DogMarkerView marker={marker} tag={tag} avatar={avatar}
          onAvatarLoad={() => ref.current?.redraw?.()} />
      </View>
    </Marker>
  );
}

// The history track's last drawn position: the same face and name tag as the
// live map (house and 「名字・室內」 when it was held there), without the
// live problem badges. Same redraw dance as DogMarker.
function TrackMarker({ track, onPress }) {
  const ref = useRef(null);
  const { latest } = track;
  const indoor = !!latest.heldReason;
  const marker = { slaveId: track.name, size: 40, problem: false, stale: false, indoor, selected: false };
  const frame = markerFrame(marker.size);
  const name = dogMapLabel(track.name);
  const text = indoor ? `${name}・${INDOOR_WORD}` : name;
  useEffect(() => { ref.current?.redraw?.(); }, [text]);
  return (
    <Marker
      ref={ref}
      coordinate={latest}
      anchor={frame.anchor}
      tracksViewChanges={false}
      onPress={onPress}
    >
      <View collapsable={false} accessible accessibilityLabel={`${text}，${new Date(latest.time).toLocaleString()}`}
        onLayout={() => ref.current?.redraw?.()}>
        <DogMarkerView marker={marker} tag={{ text, group: 1 }} avatar={track.avatar} />
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
  const cameraRead = useRef(0);
  // Android owns pause/resume. Replacing a healthy map on every resume retains
  // old SDK frame callbacks and duplicates all history overlays. Recentring
  // the phone only moves the camera; it never replaces the map surface.
  useEffect(() => {
    if (!dataReady || mountedMap) return;
    setNeedsFirstPositionFit(positions.length === 0 || !!presentation.historyTracks);
    setMountedMap(true);
  }, [dataReady, mountedMap, positions.length, presentation.historyTracks]);
  useEffect(() => {
    const map = mapRef.current;
    if (!usable || dogMarkers.length < 2 || !map?.pointForCoordinate) return undefined;
    let alive = true;
    Promise.all(dogMarkers.map(marker => map.pointForCoordinate(marker.coordinate)
      .then(point => [marker.slaveId, point]).catch(() => null)))
      .then(entries => {
        if (alive) setDogPoints({ source, points: Object.fromEntries(entries.filter(Boolean)) });
      });
    return () => { alive = false; };
    // pointsKey stands for dogMarkers' positions and sizes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usable, pointsKey, cursorRevision, source]);
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
  // Following a dog re-centres the map on each new position of that dog, at the
  // user's own zoom. Panning in between is left alone — the next position pulls
  // the camera back — and the card's dog row is what ends following.
  const follow = presentation.follow || null;
  const followed = useRef('');
  useEffect(() => {
    if (!usable || !follow) {
      followed.current = '';
      phoneCentered.current = false;
      return;
    }
    if (phoneCentered.current) return;
    const key = `${follow.slaveId}:${follow.coordinate.latitude},${follow.coordinate.longitude}`;
    if (followed.current === key) return;
    followed.current = key;
    mapRef.current?.animateCamera({ center: follow.coordinate }, { duration: 400 });
  }, [usable, follow]);
  const priorSource = useRef(source);
  const sourceToFit = useRef(null);
  useEffect(() => {
    if (priorSource.current === source) return;
    priorSource.current = source;
    sourceToFit.current = source;
    interacted.current = false;
    phoneCentered.current = false;
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
      edgePadding: { top: 24, right: 24, bottom: 24, left: 24 },
    });
    sourceToFit.current = null;
    if (needsFirstPositionFit) setNeedsFirstPositionFit(false);
  }, [usable, positions, source, needsFirstPositionFit, framingReady]);
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
          showsUserLocation={ready && foreground && phoneEnabled && !(livePhone?.running && livePhone.position)}
          userLocationPriority="high"
          userLocationUpdateInterval={1000}
          toolbarEnabled={false}
          showsMyLocationButton={false}
          onUserLocationChange={event => {
            const value = event.nativeEvent?.coordinate;
            if (value) nativePhone.current = { ...value, receivedAt: Date.now() };
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
              ? { top: topInset, right: 12, bottom: bottomInset, left: 12 }
              : undefined
          }
          onMapReady={() => {
            if (activeInstance.current === instance) setReadyInstance(instance);
          }}
          onPanDrag={() => {
            interacted.current = true;
          }}
          onRegionChangeComplete={(_, details) => {
            if (activeInstance.current !== instance || !foreground) return;
            setCursorRevision(value => value + 1);
            if (details?.isGesture) interacted.current = true;
            const request = ++cameraRead.current;
            mapRef.current?.getCamera?.().then(camera => {
              if (
                activeInstance.current === instance &&
                cameraRead.current === request &&
                camera
              )
                savedView.current = { source, camera };
            }).catch(() => {
              // Keep the last successful camera snapshot if native teardown
              // races this read. A map with no snapshot uses SQLite framing.
            });
          }}
          onMapLoaded={() => {
            // The first drawn map lets the launch screen go (no-op afterwards).
            hideSplash();
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
              onPress={onDogPress ? () => onDogPress(marker.slaveId) : undefined}
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
      {configured && foreground && (loaded || timedOut) && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="本機位置"
          style={[styles.retry, { top: topInset + 56 }]}
          onPress={() => {
            const live = livePhone?.running && livePhone.ageSeconds != null && livePhone.ageSeconds <= 30
              ? livePhone.position : null;
            const position = live || (nativePhone.current && Date.now() - nativePhone.current.receivedAt <= 30000
              ? nativePhone.current : null);
            if (!position || !Number.isFinite(position.latitude) || !Number.isFinite(position.longitude)
              || Math.abs(position.latitude) > 90 || Math.abs(position.longitude) > 180) {
              Alert.alert('本機位置', '尚無有效的手機定位，請確認已開啟定位與定位權限。');
              return;
            }
            if (!ready) {
              Alert.alert('本機位置', '地圖尚未準備完成，請稍候再試。');
              return;
            }
            interacted.current = true;
            phoneCentered.current = true;
            setNeedsFirstPositionFit(false);
            mapRef.current?.animateCamera({ center: {
              latitude: position.latitude, longitude: position.longitude,
            } }, { duration: 400 });
          }}
        >
          <Text style={styles.retryText}>本機位置</Text>
        </Pressable>
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
  retry: {
    position: 'absolute',
    left: 14,
    padding: 12,
    minHeight: 44,
    borderRadius: 14,
    backgroundColor: colors.surface,
    ...floatingShadow,
  },
  retryText: { color: colors.ink, fontWeight: '600' },
});
