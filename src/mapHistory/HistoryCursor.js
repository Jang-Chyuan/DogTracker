import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';
import { cursorLabelBox, snapToRoute } from './CursorGeometry';
import { dogMapLabel } from './DogAliases';

export default function HistoryCursor({ tracks, mapRef, revision, width, height, top, bottom,
  hidden = false, selection: savedSelection, onSelectionChange, onDraggingChange }) {
  const [projection, setProjection] = useState(null);
  const [localSelection, setLocalSelection] = useState(null);
  const selection = savedSelection === undefined ? localSelection : savedSelection;
  const [lockedPoint, setLockedPoint] = useState(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef(null), dragStart = useRef(null);
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;
  const geometryKey = JSON.stringify(tracks.map(t => [t.name, t.segments]));
  const notify = useRef(onSelectionChange);
  notify.current = onSelectionChange;
  const notifyDragging = useRef(onDraggingChange);
  notifyDragging.current = onDraggingChange;
  useEffect(() => () => notifyDragging.current?.(false), []);
  useEffect(() => {
    let alive = true;
    // Keep the responder mounted while native projection is pending. Clearing
    // this point on every drag update removes the handle and cancels Android's gesture.
    if (selection?.anchor) mapRef.current.pointForCoordinate(selection.anchor).then(point => {
      if (alive) setLockedPoint(point);
    }).catch(() => {});
    return () => { alive = false; };
  }, [selection, mapRef, revision, width, height]);
  useEffect(() => {
    let alive = true;
    async function project() {
      try {
        // Submit all segments together. Android resolves projection requests
        // on UI commits; awaiting one segment at a time can leave a multi-gap
        // route perpetually cancelled by the next history refresh.
        const result = await Promise.all(tracksRef.current.map(async track => ({
          ...track,
          segments: await Promise.all(track.segments.map(segment => Promise.all(
            segment.map(async p => ({ ...p, ...await mapRef.current.pointForCoordinate({
              latitude: p.latitude, longitude: p.longitude,
            }) })),
          ))),
        })));
        if (alive) setProjection(result);
      } catch { /* Map teardown cancels this projection. */ }
    }
    project();
    return () => { alive = false; };
  }, [geometryKey, mapRef, revision, width, height]);
  const track = projection?.find(t => t.name === selection?.name) || projection?.find(t => t.segments.length);
  const first = track?.segments.flat().find(p => p.x >= 0 && p.x <= width && p.y >= top && p.y <= height - bottom)
    || track?.segments[0]?.[0];
  const chosen = selection?.point || first;
  let cursor = selection?.anchor ? lockedPoint : null;
  if (!selection?.anchor && chosen) for (const segment of track?.segments || []) {
    for (let i = 0; i < segment.length; i += 1) {
      const a = segment[i], b = segment[Math.min(i + 1, segment.length - 1)];
      if (chosen.time >= a.time && chosen.time <= b.time) {
        const f = b.time === a.time ? 0 : (chosen.time - a.time) / (b.time - a.time);
        cursor = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }; break;
      }
    }
    if (cursor) break;
  }
  const allSegments = projection?.flatMap(t => t.segments) || [];
  const box = cursor && cursorLabelBox(allSegments, cursor, width, height, top, bottom);
  input.current = { track, cursor };
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      dragStart.current = { cursor: input.current.cursor, track: input.current.track };
      setDragging(true);
      notifyDragging.current?.(true);
    },
    onPanResponderMove: (_, gesture) => {
      const currentTrack = dragStart.current?.track, start = dragStart.current?.cursor;
      if (!currentTrack || !start) return;
      const snap = snapToRoute(currentTrack.segments, { x: start.x + gesture.dx, y: start.y + gesture.dy });
      if (!snap) return;
      const candidates = (currentTrack.sourcePoints || currentTrack.segments.flat()).filter(p =>
        p.time >= snap.a.time && p.time <= snap.b.time && Number.isFinite(p.latitude) && Number.isFinite(p.longitude));
      const point = candidates.reduce((best, p) => !best || Math.abs(p.time - snap.time) < Math.abs(best.time - snap.time) ? p : best, null);
      if (point) {
        const f = snap.b.time === snap.a.time ? 0 : (point.time - snap.a.time) / (snap.b.time - snap.a.time);
        const lon = ((snap.b.longitude - snap.a.longitude + 540) % 360) - 180;
        const next = { name: currentTrack.name, point: { ...point }, anchor: {
          latitude: snap.a.latitude + (snap.b.latitude - snap.a.latitude) * f,
          longitude: ((snap.a.longitude + lon * f + 540) % 360) - 180,
        } };
        setLockedPoint({ x: snap.a.x + (snap.b.x - snap.a.x) * f, y: snap.a.y + (snap.b.y - snap.a.y) * f });
        setLocalSelection(next);
        notify.current?.(next);
      }
    },
    onPanResponderRelease: () => { dragStart.current = null; setDragging(false); notifyDragging.current?.(false); },
    onPanResponderTerminate: () => { dragStart.current = null; setDragging(false); notifyDragging.current?.(false); },
    onShouldBlockNativeResponder: () => true,
    onPanResponderTerminationRequest: () => false,
  }), []);
  if (hidden || !cursor || !chosen || cursor.x < 0 || cursor.x > width || cursor.y < top || cursor.y > height - bottom) return null;
  // If no free area exists, omit the box until the user zooms/pans to make room.
  const end = box && { x: Math.max(box.x, Math.min(cursor.x, box.x + box.width)), y: Math.max(box.y, Math.min(cursor.y, box.y + box.height)) };
  const length = end ? Math.hypot(end.x - cursor.x, end.y - cursor.y) : 0;
  return <View collapsable={false} style={[StyleSheet.absoluteFill, styles.overlay]} pointerEvents="box-none">
    {box && <>
      <View pointerEvents="none" style={[styles.line, { left: (end.x + cursor.x - length) / 2, top: (end.y + cursor.y) / 2,
        width: length, transform: [{ rotate: `${Math.atan2(end.y - cursor.y, end.x - cursor.x)}rad` }] }]} />
      <View pointerEvents="none" style={[styles.label, { left: box.x, top: box.y, width: box.width, height: box.height }]}>
        <Text style={styles.name}>{dogMapLabel(selection?.name || track?.name)} · {dragging ? '拖動中' : selection ? '已固定，可再拖動' : '拖動三角形'}</Text>
        <Text style={styles.time}>{new Date(chosen.time).toLocaleDateString()}</Text>
        <Text style={styles.time}>{new Date(chosen.time).toLocaleTimeString()}</Text>
      </View>
    </>}
    <View collapsable={false} pointerEvents="box-only" hitSlop={12} testID="history-cursor-handle" accessibilityLabel={`歷史游標 ${new Date(chosen.time).toLocaleString()}`} {...responder.panHandlers}
      style={[styles.handle, { left: cursor.x - 24, top: cursor.y - 32 }]}>
      <View style={styles.triangle} />
    </View>
  </View>;
}
const styles = StyleSheet.create({
  overlay: { zIndex: 30, elevation: 30 },
  line: { position: 'absolute', height: 1, backgroundColor: '#9A3412' },
  handle: { position: 'absolute', width: 48, height: 48, alignItems: 'center', paddingTop: 15 },
  label: { position: 'absolute', backgroundColor: '#FFFFFF', borderColor: '#C2410C', borderWidth: 1, borderRadius: 6, padding: 3 },
  name: { color: '#9A3412', fontSize: 10, textAlign: 'center' },
  time: { color: '#0F172A', fontSize: 11, textAlign: 'center' },
  triangle: { width: 0, height: 0, borderLeftWidth: 10, borderRightWidth: 10, borderTopWidth: 17,
    borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#EA580C' },
});
