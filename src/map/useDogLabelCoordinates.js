import { useEffect, useRef, useState } from 'react';
import { size } from '../theme/tokens';

// Labels have their own tightly cropped SDK hit rectangles. Only their
// presentation coordinate moves: the face/fix and all map framing stay exact.
// The SDK inverse projection avoids negative anchors or a wide transparent
// spacer above the label covering a neighbouring head.
export default function useDogLabelCoordinates({ mapRef, markers, tags, enabled,
  source, scope, instance, revision, fontScale }) {
  const requests = markers.filter(marker => tags[marker.slaveId]).map(marker => ({
    slaveId: marker.slaveId, coordinate: marker.coordinate,
    offset: marker.size / 2 + size.marker.labelGap,
    text: tags[marker.slaveId].text,
  }));
  // Native polling may replace marker objects without changing the display.
  // Do not restart projection or blank names just because object identity changed.
  const key = JSON.stringify([source, scope, instance, revision, fontScale, requests]);
  const latest = useRef(null);
  latest.current = { key, enabled };
  const [published, setPublished] = useState(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!enabled || !requests.length || !map?.pointForCoordinate || !map?.coordinateForPoint) {
      // A same-key resume may precede the new camera revision. Old inverse
      // projection is not proof of the label's current screen position.
      setPublished(null);
      return undefined;
    }
    let alive = true;
    const valid = () => alive && mapRef.current === map && latest.current.enabled && latest.current.key === key;
    Promise.all(requests.map(async request => {
      try {
        const point = await map.pointForCoordinate(request.coordinate);
        if (!valid() || !Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return null;
        const coordinate = await map.coordinateForPoint({ x: point.x, y: point.y + request.offset });
        return valid() && Number.isFinite(coordinate?.latitude) && Number.isFinite(coordinate?.longitude)
          ? { slaveId: request.slaveId, coordinate } : null;
      } catch { return null; }
    })).then(items => {
      if (valid()) setPublished({ key, map, items: items.filter(Boolean) });
    });
    return () => { alive = false; };
    // `key` contains every request value, not just dog IDs or rounded positions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, mapRef]);
  return enabled && published?.key === key && published.map === mapRef.current ? published.items : [];
}
