import { t } from '../i18n';
import model from './model.json';
import { predictWindow } from './inference';

export const ENVIRONMENT_WINDOW_MS = 120000;

export function predictEnvironment(rows, windowMs = ENVIRONMENT_WINDOW_MS) {
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
  const result = predictWindow(model, observations, { windowSeconds: windowMs / 1000 });
  // Entirely absent readings must not turn imputed values into a live answer.
  const hasSignal = observations.some(row =>
    ['satellites', 'hdop', 'rssi', 'snr', 'coordinate_valid'].some(key => Number.isFinite(row[key])));
  return { ...result, environment: hasSignal || result.source === 'usb_rule'
    ? result.environment : 'unknown',
  hasSignal,
  windowStart: Math.floor((rows[0].track_at ?? rows[0].received_at) / windowMs) * windowMs,
  windowEnd: (Math.floor((rows[0].track_at ?? rows[0].received_at) / windowMs) + 1) * windowMs,
  observedAt: Math.max(...rows.map(row => row.track_at ?? row.received_at)) };
}

export function environmentLabel(result, now = Date.now()) {
  if (!result) return t("c846");
  if (now - result.observedAt > 120000) return t("c847");
  const label = { indoor: t('c114'), outdoor: t("c851"), window: t("c853"), unknown: t("c852") }[result.environment];
  if (result.source === 'usb_rule') return t("c848", { label: label });
  if (result.environment === 'unknown' && result.hasSignal && result.modelEnvironment) {
    const candidate = { indoor: t('c114'), outdoor: t("c851"), window: t("c853") }[result.modelEnvironment];
    return t("c849", { candidate: candidate, value: Math.round(result.modelConfidence * 100) });
  }
  return result.environment === 'unknown' ? label
    : t("c850", { label: label, value: Math.round(result.modelConfidence * 100) });
}

export function environmentEvidence(result) {
  if (!result) return null;
  const percent = key => Number.isFinite(result.probabilities?.[key])
    ? `${Math.round(result.probabilities[key] * 100)}%` : '—';
  return t("c845", { value: percent('indoor'), value2: percent('window'), value3: percent('outdoor') });
}
