'use strict';

const SIGNALS = ['satellites', 'hdop', 'rssi', 'snr', 'coordinate_valid'];
function numeric(value) {
  if (value === null || value === undefined || typeof value === 'boolean' || (typeof value === 'string' && value.trim() === '')) return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}
function usbPresent(row) {
  let payload = row.raw_payload;
  try { if (typeof payload === 'string') payload = JSON.parse(payload); }
  catch (_) { return null; }
  const value = payload && payload.usbPresent;
  return value === 1 || value === '1' ? 1 : value === 0 || value === '0' ? 0 : null;
}
function stats(values) {
  const valid = values.filter(v => v !== null);
  if (!valid.length) return [null, null];
  const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
  // pandas std uses ddof=1; one observation has a missing std.
  const std = valid.length > 1 ? Math.sqrt(valid.reduce((s, v) => s + (v - mean) ** 2, 0) / (valid.length - 1)) : null;
  return [mean, std];
}
function aggregateWindow(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('A window must contain observations');
  let group;
  for (const row of rows) {
    const time = Date.parse(row.observation_at);
    if (!Number.isFinite(time)) throw new Error('Invalid observation_at; use an ISO timestamp with timezone');
    const key = JSON.stringify([row.session_name ?? 'prediction', String(row.master_id), String(row.slave_id), Math.floor(time / 60000)]);
    if (group && key !== group) throw new Error('Use one session, Master, Slave and UTC minute per window');
    group = key;
  }
  const features = {};
  for (const signal of SIGNALS) {
    const values = rows.map(row => {
      const value = numeric(row[signal]);
      return signal === 'hdop' && value !== null && (value < 0 || value >= 655.35) ? null : value;
    });
    const [mean, std] = stats(values);
    features[signal + '_mean'] = mean;
    features[signal + '_std'] = std;
  }
  return { features, usbRule: rows.every(row => usbPresent(row) === 1), samples: rows.length };
}
function predictFeatures(model, input, { usbRule = false, threshold = 0.6 } = {}) {
  if (model.version !== 1 || !model.trees.length) throw new Error('Unsupported or empty forest');
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error('Invalid threshold');
  const values = Array.isArray(input) ? input : model.features.map(name => input[name]);
  if (values.length !== model.features.length) throw new Error('Incorrect feature count');
  if (!Array.isArray(input) && model.features.some(name => !(name in input))) throw new Error('Missing feature keys; use null for unavailable values');
  const original = values.map(numeric);
  const transformed = original.map((value, i) => value === null ? model.imputer.statistics[i] : value);
  for (const i of model.imputer.indicators) transformed.push(original[i] === null ? 1 : 0);
  // sklearn casts forest input to float32 after imputation.
  const x = transformed.map(Math.fround);
  const probability = model.classes.map(() => 0);
  for (const tree of model.trees) {
    let node = 0;
    while (tree.left[node] !== -1) {
      node = x[tree.feature[node]] <= tree.threshold[node] ? tree.left[node] : tree.right[node];
    }
    const leaf = tree.probabilities[node];
    for (let i = 0; i < probability.length; i++) probability[i] += leaf[i];
  }
  for (let i = 0; i < probability.length; i++) probability[i] /= model.trees.length;
  let best = 0;
  for (let i = 1; i < probability.length; i++) if (probability[i] > probability[best]) best = i;
  return {
    environment: usbRule ? 'indoor' : probability[best] >= threshold ? model.classes[best] : 'unknown',
    source: usbRule ? 'usb_rule' : 'random_forest',
    modelEnvironment: model.classes[best],
    modelConfidence: probability[best],
    probabilities: Object.fromEntries(model.classes.map((label, i) => [label, probability[i]])),
  };
}
function predictWindow(model, rows, options = {}) {
  const window = aggregateWindow(rows);
  return { ...predictFeatures(model, window.features, { ...options, usbRule: window.usbRule }), samples: window.samples };
}
// Converts Supabase telemetry to the same units as the exported training CSV.
function telemetryToObservation(row, sessionName = 'prediction') {
  const payload = row.payload || {};
  const scaled = (v, scale) => typeof v === 'number' && Number.isFinite(v) ? v / scale : null;
  const lat = scaled(payload.lat, 1e6), lon = scaled(payload.lon, 1e6);
  return {
    master_id: row.master_id, slave_id: row.slave_id, session_name: sessionName,
    observation_at: row.upload_source === 'phone' ? row.phone_received_at || row.received_at : row.received_at,
    satellites: scaled(payload.satellites, 1), hdop: payload.hdop === 65535 ? null : scaled(payload.hdop, 100),
    rssi: scaled(row.rssi, 1), snr: scaled(row.snr, 1),
    coordinate_valid: lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0) ? 1 : 0,
    raw_payload: payload,
  };
}
module.exports = { aggregateWindow, predictFeatures, predictWindow, telemetryToObservation, usbPresent };
