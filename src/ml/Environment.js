import model from './model.json';
import { predictWindow } from './inference';

export function predictEnvironment(rows) {
  if (!rows.length) return null;
  const observations = rows.map(row => {
    const lat = row.slave_lat, lon = row.slave_lon;
    return {
      master_id: row.master_id, slave_id: row.slave_id,
      observation_at: new Date(row.track_at ?? row.received_at).toISOString(),
      satellites: row.satellites, hdop: row.hdop, rssi: row.rssi, snr: row.snr,
      coordinate_valid: Number.isFinite(lat) && Number.isFinite(lon)
        ? Number(Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0)) : null,
      raw_payload: { usbPresent: row.usb_present },
    };
  });
  const result = predictWindow(model, observations);
  // Entirely absent readings must not turn imputed values into a live answer.
  const hasSignal = observations.some(row =>
    ['satellites', 'hdop', 'rssi', 'snr', 'coordinate_valid'].some(key => Number.isFinite(row[key])));
  return { ...result, environment: hasSignal || result.source === 'usb_rule'
    ? result.environment : 'unknown',
  hasSignal,
  windowStart: Math.floor((rows[0].track_at ?? rows[0].received_at) / 60000) * 60000,
  observedAt: Math.max(...rows.map(row => row.track_at ?? row.received_at)) };
}

export function environmentLabel(result, now = Date.now()) {
  if (!result) return '等待完整分鐘資料';
  if (now - result.observedAt > 120000) return '無法判斷（資料已超過 2 分鐘）';
  const label = { indoor: '室內', outdoor: '室外', window: '窗邊', unknown: '無法判斷' }[result.environment];
  if (result.source === 'usb_rule') return `${label}（USB 已連接）`;
  if (result.environment === 'unknown' && result.hasSignal && result.modelEnvironment) {
    const candidate = { indoor: '室內', outdoor: '室外', window: '窗邊' }[result.modelEnvironment];
    return `疑似${candidate}（信心 ${Math.round(result.modelConfidence * 100)}%，低於 60%）`;
  }
  return result.environment === 'unknown' ? label
    : `${label}（信心 ${Math.round(result.modelConfidence * 100)}%）`;
}

export function environmentEvidence(result) {
  if (!result) return null;
  const percent = key => Number.isFinite(result.probabilities?.[key])
    ? `${Math.round(result.probabilities[key] * 100)}%` : '—';
  return `模型機率：室內 ${percent('indoor')} · 窗邊 ${percent('window')} · 室外 ${percent('outdoor')}`;
}
