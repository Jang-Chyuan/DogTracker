import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useTheme, useStyles, makeStyles } from '../theme/ThemeProvider';
import { size as sizes, space, border, type } from '../theme/tokens';
import { spreadDogIcons, placeDogLabel, labelLineEnd } from './DogLabelLayout';
import { dogMapLabel } from '../mapHistory/DogAliases';

// Native projection keeps spacing in pixels even with a rotated/tilted camera.
// Only display coordinates change; each item retains its identity and GPS fix.
export default function SeparatedDogMarkers({ items, mapRef, revision, width, height, ready, renderMarker,
  MarkerComponent, CircleComponent, PolylineComponent, top = 0, bottom = 0,
  identityKey, onPlacement }) {
  const { colors } = useTheme();
  const styles = useStyles(getStyles);
  const [layout, setLayout] = useState(null);
  const key = JSON.stringify(items.map(item => [item.id, item.coordinate, item.label, item.status, item.size]));
  const notify = useRef(onPlacement);
  notify.current = onPlacement;
  useEffect(() => {
    let alive = true;
    if (!ready || !width || !height || !items.length) return undefined;
    async function arrange() {
      try {
        const map = mapRef.current;
        const origins = await Promise.all(items.map(item => map.pointForCoordinate(item.coordinate)));
        const side = Math.max(sizes.marker.attention, ...items.map(item => (item.size || sizes.marker.normal) + space.s));
        const points = spreadDogIcons(origins, side, side + 4);
        const icons = points.map(p => ({ left: p.x - side / 2, right: p.x + side / 2, top: p.y - side / 2, bottom: p.y + side / 2 }));
        const placed = [];
        const lines = origins.map((start, i) => ({ start, end: points[i] }));
        const boxes = items.map((item, i) => {
          const labelWidth = Math.min(148, Math.max(60, dogMapLabel(item.label).length * 12 + 12));
          const box = placeDogLabel(points[i], labelWidth, item.status ? 40 : 24, placed, icons,
            { left: space.s, top: top + space.s, right: width - space.s, bottom: height - bottom - space.s }, lines);
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
        if (alive) {
          setLayout({ key, result });
          notify.current?.({ key: identityKey, points: Object.fromEntries(items.map((item, i) => [item.marker?.slaveId ?? item.id, points[i]])) });
        }
      } catch { /* A pending native projection may be canceled by map teardown. */ }
    }
    arrange();
    return () => { alive = false; };
  }, [key, mapRef, revision, width, height, ready, top, bottom, identityKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return items.map((item, i) => {
    const placement = layout?.key === key ? layout.result[i] : null;
    if (!placement) return <React.Fragment key={item.id}>{renderMarker(item, item.coordinate, false)}</React.Fragment>;
    const color = item.color || colors.textMuted;
    const connectors = [[placement.coordinate, placement.labelEnd]];
    if (placement.shifted) connectors.push([item.coordinate, placement.coordinate]);
    return <React.Fragment key={item.id}>
      {connectors.map((coordinates, index) => <React.Fragment key={index}>
        <PolylineComponent coordinates={coordinates} strokeColor={colors.mapLabelHalo} strokeWidth={border.heavy} zIndex={25} geodesic={false} />
        <PolylineComponent coordinates={coordinates} strokeColor={color} strokeWidth={border.hairline} zIndex={26} geodesic={false} />
      </React.Fragment>)}
      {placement.shifted && <CircleComponent center={item.coordinate} radius={1} strokeColor={color} fillColor={color} zIndex={26} />}
      {renderMarker(item, placement.coordinate, true)}
      <MarkerComponent coordinate={placement.labelCoordinate} anchor={{ x: 0.5, y: 0.5 }} zIndex={45} onPress={item.onPress}>
        <View collapsable={false} style={[styles.label, { width: placement.width, borderColor: color }]}>
          <Text numberOfLines={1} style={styles.text}>{dogMapLabel(item.label)}</Text>
          {!!item.status && <Text numberOfLines={1} style={styles.text}>{item.status}</Text>}
        </View>
      </MarkerComponent>
    </React.Fragment>;
  });
}
const getStyles = makeStyles(({ colors }) => ({
  label: { backgroundColor: colors.surface, borderWidth: sizes.mapLabel.border, borderRadius: sizes.mapLabel.radius,
    paddingHorizontal: sizes.mapLabel.paddingH, paddingVertical: sizes.mapLabel.paddingV },
  text: { ...type.mapLabel, color: colors.text, textAlign: 'center' },
}));
