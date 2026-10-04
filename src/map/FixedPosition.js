import { coordinate } from '../tracking/RouteSamples';
import { predictEnvironment } from '../ml/Environment';

export function fixedPosition(setting, usb, environment, time) {
  if (!setting?.enabled || !coordinate(setting.latitude, setting.longitude)) return null;
  const charging = usb === 1 || usb === true
    || (usb !== 0 && usb !== false && environment?.source === 'usb_rule');
  const reason = charging ? '充電（USB 已連接）'
    : environment && time - environment.observedAt >= 0 && time - environment.observedAt <= 120000
      ? { indoor: '室內', window: '窗邊' }[environment.environment] : null;
  return reason ? { latitude: setting.latitude, longitude: setting.longitude,
    fixedReason: reason, fixedName: setting.name } : null;
}

// Historical classification uses the last completed minute, never future rows.
export function applyHistoryFixedPositions(points, settings, now) {
  const windows = new Map();
  for (const point of points) {
    const minute = Math.floor(point.time / 60000) * 60000;
    const key = `${point.master_id}:${point.slave_id}:${minute}`;
    if (!windows.has(key)) windows.set(key, []);
    windows.get(key).push({ ...point, track_at: point.time,
      slave_lat: point.raw_latitude ?? point.latitude,
      slave_lon: point.raw_longitude ?? point.longitude });
  }
  const results = new Map();
  for (const [key, rows] of windows) {
    if (Math.floor(rows[0].time / 60000) * 60000 + 60000 <= now) {
      results.set(key, predictEnvironment(rows));
    }
  }
  const last = new Map();
  return points.map(point => {
    const pair = `${point.master_id}:${point.slave_id}`;
    const previousMinute = Math.floor(point.time / 60000) * 60000 - 60000;
    const result = results.get(`${pair}:${previousMinute}`);
    if (result) last.set(pair, result);
    const setting = settings.find(row => row.slave_id === point.slave_id);
    const fixed = fixedPosition(setting, point.usb_present, last.get(pair), point.time);
    return fixed ? { ...point, ...fixed, speed_kmh: null } : point;
  });
}
