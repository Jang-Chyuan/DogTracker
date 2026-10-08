// #44's moving/still speed buffer (plan §4 item 11). v3 no longer shows
// 移動中／靜止 on the live map or the card (design 「移動中／靜止」: 活動量看卡片
// 那一列); the rule only stays here, on 設定 → 診斷 (S8), as a diagnostic line.
//
// Hysteresis around MOVING_KMH: start moving at 1.5 km/h, stop at 0.5 km/h;
// in between the previous state holds. GPS speed jitters by about half a
// km/h while a dog stands still, so one threshold alone would flicker.

export const MOVING_KMH = 1;
export const START_MOVING_KMH = 1.5;
export const STOP_MOVING_KMH = 0.5;

/** The settled state after one more reading: 'moving' | 'still' | null. */
export function settleMovement(previous, speedKmh) {
  if (speedKmh == null || speedKmh === '' || !Number.isFinite(Number(speedKmh))) return null;
  const speed = Number(speedKmh);
  if (speed >= START_MOVING_KMH) return 'moving';
  if (speed <= STOP_MOVING_KMH) return 'still';
  if (previous === 'moving' || previous === 'still') return previous;
  return speed >= MOVING_KMH ? 'moving' : 'still';
}

/**
 * A dog's readings folded through the buffer, oldest first: { state,
 * lastSpeed, readings } — `readings` counts the ones with a speed; a packet
 * without a fix has no speed and does not move the state. null with none.
 */
export function settleSeries(speeds) {
  let state = null, lastSpeed = null, readings = 0;
  for (const speed of speeds) {
    const next = settleMovement(state, speed);
    if (next == null) continue;
    state = next;
    lastSpeed = Number(speed);
    readings += 1;
  }
  return readings ? { state, lastSpeed, readings } : null;
}

export const MOVEMENT_WORDS = { moving: '移動中', still: '靜止' };
