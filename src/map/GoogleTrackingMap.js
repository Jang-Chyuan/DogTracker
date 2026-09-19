import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MapView, {
  Circle,
  Marker,
  Polyline,
  PROVIDER_GOOGLE,
} from 'react-native-maps';
import { floatingShadow, mapColors as colors } from './MapTheme';
import { describeDogSource } from './DogMerge';
import { MAP_LOAD_TIMEOUT_MS } from './TrackingMap';
import TrackingAvatar from './TrackingAvatar';
import PhoneLocationOverlay from './PhoneLocationOverlay';
import HistoryCursor from '../mapHistory/HistoryCursor';

const EMPTY_REGION = {
  latitude: 23.7,
  longitude: 121,
  latitudeDelta: 4,
  longitudeDelta: 4,
};
function DeviceMarker({ source, role, position, onPress, identifier, title, description }) {
  // A position older than the selected window is drawn faded, so it reads as
  // "last seen here", not as where the dog is now. The followed dog gets a ring
  // so the camera's target is visible on the map, not only in the card.
  const faded = !!position.stale;
  const focused = !!position.focused;
  const marker = useRef(null);
  // The marker view is not tracked for changes (that would redraw it on every
  // frame), so fading and the follow ring have to ask for one redraw each.
  useEffect(() => {
    marker.current?.redraw?.();
  }, [faded, focused]);
  const name = title || (role === 'master' ? '領犬員 · Master' : '狗 · Slave');
  const detail = description || (
    position.retained ? '最後有效位置，非最新定位' : 'SQLite 定位'
  );
  return (
    <Marker
      ref={marker}
      identifier={identifier || source + '-' + role}
      coordinate={position.coordinate}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={false}
      zIndex={role === 'slave' ? 20 : 10}
      // No title or description: those draw the SDK's own bubble, and a tap
      // already opens this device's panel. Two boxes for one tap read as a bug.
      // The text they carried lives on the view below, for screen readers.
      onPress={onPress}
    >
      <View
        collapsable={false}
        accessible
        accessibilityLabel={`${name}。${detail}`}
        style={[styles.marker, focused && styles.focusedMarker, faded && styles.fadedMarker]}
        onLayout={() => marker.current?.redraw()}
      >
        <TrackingAvatar role={role} size={40} />
      </View>
    </Marker>
  );
}

// The history track's last drawn position. Same redraw dance as DeviceMarker:
// a custom marker view that is not tracked for changes can reach the native
// side before it has laid out, and then draws as a blank dot.
function TrackMarker({ track, onPress }) {
  const marker = useRef(null);
  const { latest } = track;
  const detail = `${new Date(latest.time).toLocaleString()} · ${
    latest.speed_kmh == null ? '速度未知' : latest.speed_kmh.toFixed(1) + ' km/h'}`;
  // The view is captured once, on layout: tracking it re-captures the bitmap on
  // every render, and during playback that is four times a second — the marker
  // visibly flickered while the scrubber moved.

  return (
    <Marker
      ref={marker}
      coordinate={latest}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={false}
      // Like the live map: no title or description, because the tap opens this
      // device's panel and the SDK's own bubble would be a second box.
      onPress={onPress}
    >
      <View
        collapsable={false}
        accessible
        accessibilityLabel={`${track.name} · 該時刻位置。${detail}`}
        style={styles.marker}
        onLayout={() => marker.current?.redraw?.()}
      >
        {track.role === 'slave' ? (
          <TrackingAvatar role="slave" size={36} />
        ) : (
          <View style={[styles.phoneDot, { backgroundColor: track.color }]} />
        )}
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
  appForeground = foreground,
  dataReady = true,
  phoneEnabled,
  livePhone,
  onMasterPress,
  onDogPress,
  onTrackPress,
  supported,
  configured,
}) {
  const {
    master,
    slave,
    masterSegments,
    slaveSegments,
    masterRangeMeters,
    cameraPositions: positions,
  } = presentation;
  const mapRef = useRef(null);
  const [cursorLayout, setCursorLayout] = useState({ width: 0, height: 0 });
  const [cursorRevision, setCursorRevision] = useState(0);
  const [cameraMoving, setCameraMoving] = useState(false);
  const [cursorSelection, setCursorSelection] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [readyInstance, setReadyInstance] = useState(null);
  const [loadedInstance, setLoadedInstance] = useState(null);
  const [timedOut, setTimedOut] = useState(false);
  const instance = String(attempt);
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
  const wasForeground = useRef(appForeground);
  useEffect(() => {
    const resumed = appForeground && !wasForeground.current;
    wasForeground.current = appForeground;
    if (!resumed || !configured || !mountedMap) return;
    // Recreate the native surface: a previously loaded map may lose its tiles
    // while Android suspends the activity, without another onMapLoaded event.
    activeInstance.current = String(attempt + 1);
    cameraRead.current += 1;
    setAttempt(value => value + 1);
  }, [appForeground, configured, mountedMap, attempt]);
  useEffect(() => {
    if (!dataReady || mountedMap) return;
    setNeedsFirstPositionFit(positions.length === 0 || !!presentation.historyTracks);
    setMountedMap(true);
  }, [dataReady, mountedMap, positions.length, presentation.historyTracks]);
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
      return;
    }
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
  }, [source]);
  // initialRegion frames the first source without a visible post-load jump.
  // A source switch, or the first position after an initially empty DB, gets
  // one bounds fit only after native tiles/layout are ready.
  useEffect(() => {
    const shouldFit = sourceToFit.current === source || needsFirstPositionFit;
    if (!usable || !shouldFit || interacted.current || !positions.length)
      return;
    mapRef.current?.fitToCoordinates(positions, {
      animated: false,
      edgePadding: { top: 24, right: 24, bottom: 24, left: 24 },
    });
    sourceToFit.current = null;
    if (needsFirstPositionFit) setNeedsFirstPositionFit(false);
  }, [usable, positions, source, needsFirstPositionFit]);
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
          // Google SDK handles rotation/tilt visibility and tap-to-north.
          showsCompass
          rotateEnabled
          pitchEnabled
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
          onRegionChange={() => setCameraMoving(true)}
          onRegionChangeComplete={(_, details) => {
            if (activeInstance.current !== instance || !foreground) return;
            setCameraMoving(false);
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
            if (activeInstance.current === instance)
              setLoadedInstance(instance);
          }}
        >
          {livePhone?.running && livePhone.position && <PhoneLocationOverlay location={livePhone} active={foreground} />}
          {(presentation.historyTracks || []).map(track => (
            <React.Fragment key={track.name}>
              {track.segments.filter(segment => segment.length > 1).map((segment, index) => (
                <Polyline key={index} coordinates={segment} strokeColor={track.color} strokeWidth={4} geodesic={false} />
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
            />
          ))}
          {masterSegments.map((segment, index) => (
            <Polyline
              key={source + '-master-' + index}
              coordinates={segment}
              geodesic={false}
              strokeColor={colors.master}
              strokeWidth={3}
            />
          ))}
          {master && (
            <Circle
              key={source + '-range'}
              center={master.coordinate}
              radius={masterRangeMeters}
              strokeColor="#397E9B88"
              fillColor="#397E9B10"
              strokeWidth={1}
            />
          )}
          {master && (
            <DeviceMarker
              key={source + '-master'}
              source={source}
              role="master"
              position={master}
              onPress={onMasterPress}
            />
          )}
          {slave && (
            <DeviceMarker
              key={source + '-slave'}
              source={source}
              role="slave"
              position={slave}
            />
          )}
          {(presentation.dogPaths || []).map(track => (
            <React.Fragment key={source + '-dogpath-' + track.slaveId}>
              {track.segments.map((segment, index) => (
                <Polyline key={index} coordinates={segment} geodesic={false}
                  strokeColor={track.color} strokeWidth={3} />
              ))}
            </React.Fragment>
          ))}
          {(presentation.dogs || []).map(dog => (
            <DeviceMarker
              key={source + '-dog-' + dog.slaveId}
              identifier={source + '-dog-' + dog.slaveId}
              source={source}
              role="slave"
              position={dog}
              onPress={onDogPress ? () => onDogPress(dog.slaveId) : undefined}
              title={'狗 ' + dog.slaveId}
              description={describeDogSource(dog) + ' · '
                + new Date(dog.receivedAt).toLocaleTimeString()
                + (dog.stale ? '（早於所選時間範圍）' : '')}
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
      {usable && cursorLayout.width > 0 && presentation.historyTracks?.length > 0 &&
        <HistoryCursor key={source + ':' + instance} tracks={presentation.historyTracks} mapRef={mapRef}
          hidden={!foreground || cameraMoving} selection={cursorSelection?.source === source ? cursorSelection.value : null}
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
      {configured && timedOut && !loaded && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="重試載入地圖"
          style={[styles.retry, { top: topInset + 56 }]}
          onPress={() => {
            // Invalidate callbacks synchronously, before the next React render.
            activeInstance.current = String(attempt + 1);
            setAttempt(value => value + 1);
          }}
        >
          <Text style={styles.retryText}>重試地圖</Text>
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
  fadedMarker: { opacity: 0.45 },
  phoneDot: { width: 18, height: 18, borderRadius: 9, borderWidth: 3, borderColor: '#FFFFFF' },
  focusedMarker: {
    borderRadius: 23,
    borderWidth: 3,
    borderColor: colors.dog,
    backgroundColor: '#FFFFFFAA',
  },
  marker: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
