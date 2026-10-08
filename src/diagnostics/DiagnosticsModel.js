// What 設定 → 診斷 (S8) says besides its three data pages (design S8 「診斷」,
// 「環境判斷」 「移動中／靜止」 「存不進手機的按鈕和去處」). Pure: App hands in what
// the map already reads.
//
// - storage: why dog positions cannot be written (TopAlerts.storageProblem),
//   where 「看原因」 leads (A2, S1's warning, the merged notification).
// - each dog's environment model result (室內／窗邊／室外, the bundled random
//   forest, src/ml): only a reference for the indoor hold, so the live map
//   never shows it; S8 does, with its probabilities and window.
// - each dog's moving/still state through #44's speed buffer (SpeedBuffer),
//   over this phone's newest receiver rows.

import { environmentEvidence, environmentLabel } from '../ml/Environment';
import { formatClock } from '../map/MapFormat';
import { displayName } from '../dogs/DogName';
import { MOVEMENT_WORDS, settleSeries } from './SpeedBuffer';

const hasFix = row => Number.isFinite(row?.slave_lat) && Number.isFinite(row?.slave_lon)
  && !(row.slave_lat === 0 && row.slave_lon === 0);
const timeOf = row => Number(row.track_at ?? row.received_at);

const SOURCE_WORDS = { ble: '接收器', cloud: '雲端' };

/**
 * Each dog's environment, from useCloudDogs' packets (one per dog and source,
 * a BLE dog twice: newest packet and newest fix, both carrying the same
 * window's result). The newest window wins when a dog comes from both.
 */
function environments(packets, now) {
  const byDog = new Map();
  for (const packet of packets || []) {
    const result = packet?.environment ?? null;
    const old = byDog.get(packet.slave_id);
    const newer = !old || (result && (!old.result || result.observedAt > old.result.observedAt));
    if (newer) byDog.set(packet.slave_id, { result, source: packet.source });
  }
  return new Map([...byDog].map(([slaveId, { result, source }]) => [slaveId, {
    label: environmentLabel(result, now),
    evidence: result ? environmentEvidence(result) : null,
    window: result ? `${formatClock(result.windowStart)}–${formatClock(result.windowEnd)}・${result.samples} 筆` : null,
    source: SOURCE_WORDS[source] || '',
  }]));
}

/**
 * Each dog's moving/still state, its rows (dog_status, any order) folded
 * oldest first; a packet without a fix carries no speed.
 */
function movements(rows) {
  const byDog = new Map();
  for (const row of [...(rows || [])].filter(hasFix)
    .sort((left, right) => timeOf(left) - timeOf(right) || (left.id ?? 0) - (right.id ?? 0))) {
    if (!byDog.has(row.slave_id)) byDog.set(row.slave_id, []);
    byDog.get(row.slave_id).push(row.speed_kmh);
  }
  const result = new Map();
  for (const [slaveId, speeds] of byDog) {
    const settled = settleSeries(speeds);
    if (!settled) continue;
    result.set(slaveId, {
      label: MOVEMENT_WORDS[settled.state],
      detail: `最近 ${settled.lastSpeed.toFixed(1)} km/h・${settled.readings} 筆`,
    });
  }
  return result;
}

/**
 * S8: { storage: { title, reason, full } | null, dogs: [{ slaveId, name,
 * environment: { label, evidence, window, source } | null, movement:
 * { label, detail } | null, label }] }, dogs by collar number.
 *
 * input: { packets, rows (this phone's newest receiver rows), aliases,
 * storage (storageProblem), now }.
 */
export function diagnosticsPage({ packets = [], rows = [], aliases = {}, storage = null, now = Date.now() }) {
  const environment = environments(packets, now);
  const movement = movements(rows);
  const ids = [...new Set([...environment.keys(), ...movement.keys()])]
    .filter(id => Number.isInteger(Number(id)) && Number(id) > 0).sort((left, right) => left - right);
  return {
    storage: storage ? { ...storage, title: storage.full ? '手機空間不足' : '寫入失敗' } : null,
    dogs: ids.map(slaveId => {
      const name = displayName(slaveId, aliases);
      const env = environment.get(slaveId) ?? null;
      const move = movement.get(slaveId) ?? null;
      return {
        slaveId, name, environment: env, movement: move,
        label: [`${name}，訊號源 ${slaveId}`, env && `環境 ${env.label}`, move && `速度緩衝 ${move.label}`]
          .filter(Boolean).join('，'),
      };
    }),
  };
}
