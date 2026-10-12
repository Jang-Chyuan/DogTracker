import { touch } from '../theme/tokens';
import { clock } from '../history/HistoryText';
import HistoryDragTimeTip from './HistoryDragTimeTip';
import { CursorLabelView } from './HistoryMapMarkers';
import { cursorProjectionKey } from './CursorLabelPlacement';
// The history cursor's touch handle (H1; 判定表「游標標籤」「操作與震動」): a
// 48dp invisible target over the cursor point (the point and its label are a
// marker of the map). Dragging it moves the cursor along the route: the
// finger's map coordinate snaps to the nearest fix (where the route passes
// twice, the pass nearest in time to the cursor). The map does not move
// while it is dragged. TalkBack steps fix by fix.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import { nearestRouteSpot } from '../history/screen/HistoryMapModel';

const TOUCH = touch.min;

export default function HistoryCursor({ mapRef, cursor, points, revision, width, height, top, bottom,
  hidden = false, onMove, onDraggingChange, onProjection, labelPlacement, projectionScope = '' }) {
  const [placeSnapshot, setPlace] = useState(null);
  const [dragging, setDragging] = useState(false);
  const hasCursor = !!cursor;
  const coordinateKey = cursor ? `${cursor.coordinate.latitude},${cursor.coordinate.longitude}` : '';
  const projectionKey = cursorProjectionKey(cursor, revision, width, height, top, bottom, projectionScope);
  const projectedPlace = placeSnapshot?.key === projectionKey ? placeSnapshot.point : null;
  // Cursor coordinates change during a drag. Only that in-progress gesture
  // may retain its valid start anchor while its new projection is pending.
  // Camera/source/viewport changes never borrow an old screen coordinate.
  const scene = `${projectionScope}:${revision}:${width}:${height}:${top}:${bottom}`;
  const drag = useRef({ origin: null, busy: false, pending: null, generation: 0, scene, mapRef, active: false });
  const generation = useRef(0);
  const sameGesture = dragging && drag.current.generation === generation.current
    && drag.current.scene === scene && drag.current.mapRef === mapRef && !hidden && !!cursor;
  const place = projectedPlace ?? (sameGesture ? drag.current.origin : null);
  const visible = point => point && Number.isFinite(point.x) && Number.isFinite(point.y)
    && point.x >= 0 && point.x <= width && point.y >= top && point.y <= height - bottom;
  const projectionReceiver = useRef(onProjection);
  projectionReceiver.current = onProjection;
  // Where the cursor point is on screen: after it moved, and after the map did.
  useEffect(() => {
    let alive = true;
    if (hidden || !cursor || !mapRef.current?.pointForCoordinate) { setPlace(null); return undefined; }
    mapRef.current.pointForCoordinate(cursor.coordinate)
      .then(point => {
        if (alive) { setPlace({ key: projectionKey, point }); projectionReceiver.current?.({ key: projectionKey, point }); }
      })
      .catch(() => {});
    return () => { alive = false; };
    // coordinateKey stands for the cursor's coordinate.
  }, [coordinateKey, revision, width, height, top, bottom, mapRef, projectionKey, hidden]); // eslint-disable-line react-hooks/exhaustive-deps
  const live = useRef({});
  live.current = { cursor, points, onMove, place, scene, mapRef, hidden, visible: visible(place) };
  // Each gesture has its own generation. The released final read may land;
  // cancellation or a new gesture rejects reads from the previous owner.
  useEffect(() => () => { generation.current += 1; }, []);
  const notify = useRef(onDraggingChange);
  notify.current = onDraggingChange;
  useEffect(() => () => notify.current?.(false), []);
  useEffect(() => {
    const d = drag.current;
    if (d.scene !== scene || d.mapRef !== mapRef || hidden || !cursor
      || (projectedPlace && !visible(projectedPlace))) {
      const owned = d.active || d.origin != null;
      generation.current += 1; d.pending = null; d.origin = null; d.active = false;
      d.scene = scene; d.mapRef = mapRef;
      setDragging(false);
      if (owned) notify.current?.(false);
    }
  }, [scene, mapRef, hidden, hasCursor, projectedPlace]); // eslint-disable-line react-hooks/exhaustive-deps
  const responder = useMemo(() => {
    const currentGesture = d => d.generation === generation.current
      && d.scene === live.current.scene && d.mapRef === live.current.mapRef
      && !live.current.hidden && !!live.current.cursor;
    // One coordinate read at a time; the newest finger position waits.
    const follow = async target => {
      const d = drag.current;
      if (d.busy) { d.pending = target; return; }
      d.busy = true;
      try {
        const coordinate = await mapRef.current?.coordinateForPoint?.(target);
        if (!currentGesture(d)) return;
        const { points: route, cursor: now, onMove: move } = live.current;
        const found = coordinate && nearestRouteSpot(route, coordinate, now?.time ?? null);
        if (found) move?.(found.point.time, 'drag');
      } catch { /* The map went away mid-drag. */ }
      d.busy = false;
      if (d.pending && currentGesture(d)) {
        const next = d.pending;
        d.pending = null;
        follow(next);
      }
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => !!live.current.visible && !live.current.hidden,
      onMoveShouldSetPanResponder: () => !!live.current.visible && !live.current.hidden,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: () => {
        if (!live.current.visible || live.current.hidden || !live.current.cursor) return;
        generation.current += 1;
        drag.current = { origin: live.current.place, busy: false, pending: null, generation: generation.current,
          scene: live.current.scene, mapRef: live.current.mapRef, active: true };
        setDragging(true);
        notify.current?.(true);
      },
      onPanResponderMove: (_, gesture) => {
        const d = drag.current, origin = d.origin;
        if (!origin || !d.active || !currentGesture(d)) return;
        follow({ x: origin.x + gesture.dx, y: origin.y + gesture.dy });
      },
      // The last read of a released drag still lands (the finger's last place).
      onPanResponderRelease: () => { drag.current.active = false; setDragging(false); notify.current?.(false); },
      onPanResponderTerminate: () => { generation.current += 1; drag.current.active = false; drag.current.pending = null;
        setDragging(false); notify.current?.(false); },
    });
  }, [mapRef]);
  if (hidden || !cursor || !visible(place)) {
    return null;
  }
  const step = direction => {
    const index = points.findIndex(p => p.time === cursor.time);
    const next = points[Math.max(0, Math.min(points.length - 1, index + direction))];
    if (next) onMove?.(next.time, 'drag');
  };
  return (
    <>
      {!dragging && labelPlacement?.box && <View testID="history-cursor-collision-label"
        pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
        style={[styles.label, { left: labelPlacement.box.x, top: labelPlacement.box.y,
          width: labelPlacement.box.width }]}>
        <CursorLabelView lines={cursor.lines} />
      </View>}
      {dragging && <HistoryDragTimeTip testID="history-cursor-drag-time" text={clock(cursor.time)}
      x={place.x} width={width} top={place.y - TOUCH / 2} minTop={top} />}
      <View testID="history-cursor-handle" collapsable={false} {...responder.panHandlers}
      accessible accessibilityRole="adjustable" accessibilityLabel={(cursor.lines || []).join('，')}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={event => step(event.nativeEvent.actionName === 'increment' ? 1 : -1)}
      style={[styles.handle, { left: place.x - TOUCH / 2, top: place.y - TOUCH / 2 }]} />
    </>
  );
}

const styles = StyleSheet.create({
  label: { position: 'absolute', zIndex: 30 },
  handle: { position: 'absolute', width: TOUCH, height: TOUCH, borderRadius: TOUCH / 2, zIndex: 30 },
});
