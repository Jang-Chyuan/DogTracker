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

const EMPTY_REGION = {
  latitude: 23.7,
  longitude: 121,
  latitudeDelta: 4,
  longitudeDelta: 4,
};
function DeviceMarker({ source, role, position, onPress, identifier, title, description }) {
  const marker = useRef(null);
  return (
    <Marker
      ref={marker}
      identifier={identifier || source + '-' + role}
      coordinate={position.coordinate}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={false}
      zIndex={role === 'slave' ? 20 : 10}
      title={title || (role === 'master' ? '領犬員 · Master' : '狗 · Slave')}
      description={description || (
        position.retained ? '最後有效位置，非最新定位' : 'SQLite 定位'
      )}
      onPress={onPress}
    >
      <View
        collapsable={false}
        style={styles.marker}
        onLayout={() => marker.current?.redraw()}
      >
        <TrackingAvatar role={role} size={40} />
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
    <View style={StyleSheet.absoluteFill} testID="tracking-map-container">
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
          onRegionChangeComplete={(_, details) => {
            if (activeInstance.current !== instance || !foreground) return;
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
          {livePhone?.running && livePhone.position && <Marker identifier="phone-timeline-live"
            coordinate={livePhone.position} pinColor={livePhone.ageSeconds > 3 ? '#64748b' : '#2563EB'}
            title={livePhone.ageSeconds > 3 ? '手機 · 最後合格位置（已過期）' : '手機 · 即時平滑位置'}
            description={`估計精度 ${livePhone.position.accuracy.toFixed(1)} m · ${new Date(livePhone.position.timestamp).toLocaleTimeString()}`} />}
          {(presentation.historyTracks || []).map(track => (
            <React.Fragment key={track.name}>
              {track.segments.filter(segment => segment.length > 1).map((segment, index) => (
                <Polyline key={index} coordinates={segment} strokeColor={track.color} strokeWidth={4} geodesic={false} />
              ))}
              {track.latest && <Marker coordinate={track.latest} pinColor={track.color} title={track.name + ' · 最後位置'}
                description={`${new Date(track.latest.time).toLocaleString()} · ${track.latest.speed_kmh == null ? '速度未知' : track.latest.speed_kmh.toFixed(1) + ' km/h'}`} />}
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
          {(presentation.dogs || []).map(dog => (
            <DeviceMarker
              key={source + '-dog-' + dog.slaveId}
              identifier={source + '-dog-' + dog.slaveId}
              source={source}
              role="slave"
              position={dog}
              title={'狗 ' + dog.slaveId}
              description={describeDogSource(dog) + ' · '
                + new Date(dog.receivedAt).toLocaleTimeString()}
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
  marker: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
