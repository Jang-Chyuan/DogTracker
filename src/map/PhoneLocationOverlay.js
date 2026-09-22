import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Circle, Marker } from 'react-native-maps';
import { locationTrackerNative } from '../locationTracker/LocationTrackerService';
import { stablePhoneDisplay } from './PhoneDisplayPosition';

// Publish only live display coordinates to native memory; the recorder owns SQLite cadence.
export default function PhoneLocationOverlay({ location, active = true, historical = false, onPress }) {
  const { position, ageSeconds } = location;
  const stale = !historical && (ageSeconds == null || ageSeconds > 3);
  const target = { latitude: position.latitude, longitude: position.longitude };
  const [coordinate, setCoordinate] = useState(target);
  const current = useRef(target);
  const previousTime = useRef(null);
  const previousSession = useRef(location.sessionId);
  const marker = useRef(null);
  useEffect(() => {
    if (historical || !active || stale || !location.running || !location.sessionId) return undefined;
    const publish = () => locationTrackerNative?.displayPosition?.(location.sessionId,
      position.timestamp, current.current.latitude, current.current.longitude);
    // Runs after each rendered animation frame; no SQLite work occurs here.
    publish();
    const timer = setInterval(publish, 100);
    return () => {
      clearInterval(timer);
      locationTrackerNative?.clearDisplayPosition?.(location.sessionId);
    };
  }, [historical, active, stale, location.running, location.sessionId, position.timestamp]);
  useEffect(() => {
    const destination = { latitude: position.latitude, longitude: position.longitude };
    const previous = previousTime.current;
    const sessionChanged = previousSession.current !== location.sessionId;
    previousSession.current = location.sessionId;
    previousTime.current = position.timestamp;
    const publish = value => { current.current = value; setCoordinate(value); };
    if (!active || stale || sessionChanged || position.motionState === 'stationary' || previous == null ||
        position.timestamp - previous > (historical ? 120000 : 3000) || position.timestamp < previous) {
      publish(destination);
      return undefined;
    }
    if (!historical) Object.assign(destination, stablePhoneDisplay(current.current, {
      latitude: position.latitude, longitude: position.longitude,
      rawSpeedKmh: position.rawSpeedKmh, accuracy: position.accuracy,
    }));
    const from = current.current;
    if (from.latitude === destination.latitude && from.longitude === destination.longitude) return undefined;
    const duration = position.rawSpeedKmh > 20 ? 300 : 800;
    const started = Date.now();
    const longitudeDelta = ((destination.longitude - from.longitude + 540) % 360) - 180;
    const timer = setInterval(() => {
      const fraction = Math.min(1, (Date.now() - started) / duration);
      publish(fraction === 1 ? destination : {
        latitude: from.latitude + (destination.latitude - from.latitude) * fraction,
        longitude: ((from.longitude + longitudeDelta * fraction + 540) % 360) - 180,
      });
      if (fraction === 1) clearInterval(timer);
    }, 50);
    return () => clearInterval(timer);
  }, [active, stale, historical, location.sessionId, position.latitude, position.longitude, position.timestamp, position.motionState, position.rawSpeedKmh, position.accuracy]);
  useEffect(() => { marker.current?.redraw?.(); }, [stale]);
  const title = historical ? '手機 · 歷史最後位置' : stale ? '手機 · 最後合格位置（已過期）'
    : position.motionState === 'stationary' ? '手機 · 靜止鎖定位置' : '手機 · 目前位置';
  return <>
    {!historical && Number.isFinite(position.accuracy) && position.accuracy >= 0 && <Circle
      center={coordinate} radius={position.accuracy}
      fillColor={stale ? 'rgba(100,116,139,0.12)' : 'rgba(37,99,235,0.12)'}
      strokeColor={stale ? 'rgba(100,116,139,0.4)' : 'rgba(37,99,235,0.4)'}
      strokeWidth={1} zIndex={2} />}
    <Marker ref={marker} identifier={historical ? 'phone-history-last' : 'phone-timeline-live'} coordinate={coordinate}
      anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} zIndex={historical ? 25 : 30}
      onPress={onPress} title={onPress ? undefined : title} description={onPress ? undefined : historical
        ? `${new Date(position.timestamp).toLocaleString()} · ${position.rawSpeedKmh == null ? '速度未知' : position.rawSpeedKmh.toFixed(1) + ' km/h'}`
        : `估計精度 ${position.accuracy.toFixed(1)} m · ${new Date(position.timestamp).toLocaleTimeString()}`}>
      <View collapsable={false} style={styles.container} onLayout={() => marker.current?.redraw?.()}>
        <View style={[styles.dot, stale && styles.stale]} />
      </View>
    </Marker>
  </>;
}

const styles = StyleSheet.create({
  container: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 20, height: 20, borderRadius: 10, borderWidth: 3, borderColor: '#FFFFFF', backgroundColor: '#2563EB' },
  stale: { backgroundColor: '#64748b' },
});
