// The history cursor's touch handle (H1; 判定表「游標標籤」「操作與震動」): a
// 48dp invisible target over the cursor point (the point and its label are a
// marker of the map). Dragging it moves the cursor along the route: the
// finger's map coordinate snaps to the nearest fix (where the route passes
// twice, the pass nearest in time to the cursor). The map does not move
// while it is dragged. TalkBack steps fix by fix.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import { nearestRoutePoint } from '../history/screen/HistoryMapModel';

const TOUCH = 48;

export default function HistoryCursor({ mapRef, cursor, points, revision, width, height, top, bottom,
  hidden = false, onMove, onDraggingChange }) {
  const [place, setPlace] = useState(null);
  const coordinateKey = cursor ? `${cursor.coordinate.latitude},${cursor.coordinate.longitude}` : '';
  // Where the cursor point is on screen: after it moved, and after the map did.
  useEffect(() => {
    let alive = true;
    if (!cursor || !mapRef.current?.pointForCoordinate) { setPlace(null); return undefined; }
    mapRef.current.pointForCoordinate(cursor.coordinate)
      .then(point => { if (alive) setPlace(point); })
      .catch(() => {});
    return () => { alive = false; };
    // coordinateKey stands for the cursor's coordinate.
  }, [coordinateKey, revision, width, height, mapRef]); // eslint-disable-line react-hooks/exhaustive-deps
  const live = useRef({});
  live.current = { cursor, points, onMove, place };
  const drag = useRef({ origin: null, busy: false, pending: null });
  const notify = useRef(onDraggingChange);
  notify.current = onDraggingChange;
  useEffect(() => () => notify.current?.(false), []);
  const responder = useMemo(() => {
    // One coordinate read at a time; the newest finger position waits.
    const follow = async target => {
      const d = drag.current;
      if (d.busy) { d.pending = target; return; }
      d.busy = true;
      try {
        const coordinate = await mapRef.current?.coordinateForPoint?.(target);
        const { points: route, cursor: now, onMove: move } = live.current;
        const found = coordinate && nearestRoutePoint(route, coordinate, now?.time ?? null);
        if (found) move?.(found.point.time, 'drag');
      } catch { /* The map went away mid-drag. */ }
      d.busy = false;
      if (d.pending) {
        const next = d.pending;
        d.pending = null;
        follow(next);
      }
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: () => {
        drag.current = { origin: live.current.place, busy: false, pending: null };
        notify.current?.(true);
      },
      onPanResponderMove: (_, gesture) => {
        const origin = drag.current.origin;
        if (!origin) return;
        follow({ x: origin.x + gesture.dx, y: origin.y + gesture.dy });
      },
      onPanResponderRelease: () => notify.current?.(false),
      onPanResponderTerminate: () => notify.current?.(false),
    });
  }, [mapRef]);
  if (hidden || !cursor || !place || place.x < 0 || place.x > width || place.y < top || place.y > height - bottom) {
    return null;
  }
  const step = direction => {
    const index = points.findIndex(p => p.time === cursor.time);
    const next = points[Math.max(0, Math.min(points.length - 1, index + direction))];
    if (next) onMove?.(next.time, 'drag');
  };
  return (
    <View testID="history-cursor-handle" collapsable={false} {...responder.panHandlers}
      accessible accessibilityRole="adjustable" accessibilityLabel={(cursor.lines || []).join('，')}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={event => step(event.nativeEvent.actionName === 'increment' ? 1 : -1)}
      style={[styles.handle, { left: place.x - TOUCH / 2, top: place.y - TOUCH / 2 }]} />
  );
}

const styles = StyleSheet.create({
  handle: { position: 'absolute', width: TOUCH, height: TOUCH, borderRadius: TOUCH / 2, zIndex: 30 },
});
