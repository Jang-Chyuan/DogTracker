import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Circle, Marker, Polyline } from 'react-native-maps';
import { spreadDogIcons, placeDogLabel, labelLineEnd } from './DogLabelLayout';
import { dogMapLabel } from '../mapHistory/DogAliases';

// Native projection keeps spacing in pixels even with a rotated/tilted camera.
// Only display coordinates change; each item retains its identity and GPS fix.
export default function SeparatedDogMarkers({ items, mapRef, revision, width, height, ready, renderMarker }) {
  const [layout, setLayout] = useState(null);
  const key = JSON.stringify(items.map(item => [item.id, item.coordinate, item.label, item.status]));
  useEffect(() => {
    let alive = true;
    if (!ready || !width || !height || !items.length) return undefined;
    async function arrange() {
      try {
        const map = mapRef.current;
        const origins = await Promise.all(items.map(item => map.pointForCoordinate(item.coordinate)));
        const points = spreadDogIcons(origins);
        const icons = points.map(p => ({ left: p.x - 24, right: p.x + 24, top: p.y - 24, bottom: p.y + 24 }));
        const placed = [];
        const lines = origins.map((start, i) => ({ start, end: points[i] }));
        const boxes = items.map((item, i) => {
          const labelWidth = Math.min(148, Math.max(60, dogMapLabel(item.label).length * 12 + 12));
          const box = placeDogLabel(points[i], labelWidth, item.status ? 40 : 24, placed, icons,
            { left: 8, top: 8, right: width - 8, bottom: height - 8 }, lines);
          placed.push(box);
          lines.push({ start: points[i], end: labelLineEnd(points[i], box) });
          return box;
        });
        const result = await Promise.all(items.map(async (item, i) => ({
          coordinate: await map.coordinateForPoint(points[i]),
          labelCoordinate: await map.coordinateForPoint({ x: (boxes[i].left + boxes[i].right) / 2, y: (boxes[i].top + boxes[i].bottom) / 2 }),
          labelEnd: await map.coordinateForPoint(labelLineEnd(points[i], boxes[i])),
          shifted: Math.hypot(points[i].x - origins[i].x, points[i].y - origins[i].y) > 1,
          width: boxes[i].right - boxes[i].left,
        })));
        if (alive) setLayout({ key, result });
      } catch { /* A pending native projection may be canceled by map teardown. */ }
    }
    arrange();
    return () => { alive = false; };
  }, [key, mapRef, revision, width, height, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  return items.map((item, i) => {
    const placement = layout?.key === key ? layout.result[i] : null;
    if (!placement) return <React.Fragment key={item.id}>{renderMarker(item, item.coordinate, false)}</React.Fragment>;
    const color = item.color || '#64748B';
    const connectors = [[placement.coordinate, placement.labelEnd]];
    if (placement.shifted) connectors.push([item.coordinate, placement.coordinate]);
    return <React.Fragment key={item.id}>
      {connectors.map((coordinates, index) => <React.Fragment key={index}>
        <Polyline coordinates={coordinates} strokeColor="#FFFFFF" strokeWidth={3} zIndex={25} geodesic={false} />
        <Polyline coordinates={coordinates} strokeColor={color} strokeWidth={1} zIndex={26} geodesic={false} />
      </React.Fragment>)}
      {placement.shifted && <Circle center={item.coordinate} radius={1} strokeColor={color} fillColor={color} zIndex={26} />}
      {renderMarker(item, placement.coordinate, true)}
      <Marker coordinate={placement.labelCoordinate} anchor={{ x: 0.5, y: 0.5 }} zIndex={30} onPress={item.onPress}>
        <View collapsable={false} style={[styles.label, { width: placement.width, borderColor: color }]}>
          <Text numberOfLines={1} style={styles.text}>{dogMapLabel(item.label)}</Text>
          {!!item.status && <Text numberOfLines={1} style={styles.text}>{item.status}</Text>}
        </View>
      </Marker>
    </React.Fragment>;
  });
}
const styles = StyleSheet.create({
  label: { backgroundColor: '#FFFFFF', borderWidth: 1, borderRadius: 10, paddingHorizontal: 4, paddingVertical: 2 },
  text: { color: '#0F172A', fontSize: 12, lineHeight: 16, textAlign: 'center' },
});
