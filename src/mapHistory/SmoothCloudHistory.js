import { coordinate } from '../tracking/RouteSamples';

// Display only: use raw samples, never recursively smooth previous output.
// Cloud reports are sparser than phone fixes; retain the history gap rule.
export function smoothCloudHistory(points) {
  let window = [], previous = null;
  return points.map(point => {
    if (!coordinate(point.latitude, point.longitude)) {
      window = []; previous = null;
      return point;
    }
    if (previous && (point.time < previous.time || point.time - previous.time > 120000 ||
        point.master_id !== previous.master_id || Math.abs(point.longitude - previous.longitude) > 180)) window = [];
    window.push(point);
    if (window.length > 3) window.shift();
    previous = point;
    const fast = point.speed_kmh > 10 && window.length > 1;
    let latitude = 0, longitude = 0;
    window.forEach((sample, index) => {
      const weight = fast ? (index === window.length - 1 ? 0.9 : 0.1 / (window.length - 1)) : 1 / window.length;
      latitude += sample.latitude * weight;
      longitude += sample.longitude * weight;
    });
    return { ...point, latitude, longitude };
  });
}
