// Is a dog within reach of the receiver that hears it? One judgement shared by
// the live map (range ring, red dashed line), the dog's card (接收範圍 row) and
// the alerts. Pure: no React, no SQLite, no map SDK.
//
// The rules (design v3, 判定表「接收範圍的狀態轉換」「圈外」「停在原處時用哪個
// 位置和時間」「圈外遇到換來源」「卡片上雲端狗的接收範圍」):
//
// - The judgement is made only when a new valid position of the dog arrives
//   from this phone's own receiver, against where that receiver was at that
//   moment (both are in the same dog_status row). The receiver moving on its
//   own never changes it; a dog without new positions (including one that
//   has gone stale) keeps the judgement of its last valid position.
// - in → near when farther than 800 m; in or near → out when farther than
//   1 km. near → in only after 2 positions in a row within 800 m.
// - out clears only after at least 2 new positions, spanning at least
//   2 minutes, all within 900 m; one position beyond 900 m starts that count
//   again. On clearing, 800–900 m is near, closer is in.
// - While the dog is held where it was last seen clearly (indoor hold, #50)
//   nothing is re-judged and positions during the hold do not count towards
//   clearing; counting starts again once it is released.
// - Positions downloaded from the cloud carry no receiver position: they never
//   judge, and they never clear. Once the dog is only heard through the cloud
//   (this phone has not heard it for LOCAL_SILENCE_MS before the cloud
//   position), the clearing count starts over when this phone hears it again.

export const RANGE = Object.freeze({
  // Beyond this the dog is out of range (and the ring has this radius).
  radiusM: 1000,
  // Beyond this, but within radiusM, the dog is near the edge (快離開).
  nearM: 800,
  // An out-of-range dog must come back within this to clear.
  clearM: 900,
  clearFixes: 2,
  clearSpanMs: 2 * 60000,
  // A near dog must come back within nearM this many positions in a row.
  nearClearFixes: 2,
  // The phone stopped hearing the dog when a cloud position is this much newer
  // than the last packet the phone received itself (the live map's own
  // "still communicating" window).
  localSilenceMs: 3 * 60000,
});

export const RANGE_STATUS = Object.freeze({ IN: 'in', NEAR: 'near', OUT: 'out' });

const EARTH_RADIUS_M = 6371000;
const radians = degrees => (degrees * Math.PI) / 180;

const validPosition = (latitude, longitude) =>
  Number.isFinite(latitude) && Number.isFinite(longitude)
  && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
  // A tracker without a fix reports 0,0.
  && !(latitude === 0 && longitude === 0);

/** Great-circle distance in metres (haversine). */
export function distanceMeters(a, b) {
  const dLat = radians(b.latitude - a.latitude);
  const dLon = radians(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A dog nobody has judged yet. */
export function emptyRange() {
  return Object.freeze({
    status: null,
    // Time of the last position that was judged (shown as 最後確認 for an
    // out-of-range dog the phone no longer hears itself).
    judgedAt: null,
    // When the dog last became out of range (null while it is not).
    outSince: null,
    // Times of the positions counting towards clearing out / near.
    clearing: Object.freeze([]),
    nearBack: 0,
    // The last packet this phone heard itself, and the newest row processed.
    lastLocalAt: null,
    lastTime: null,
    // The dog is now only heard through the cloud, since that cloud position.
    cloudOnly: false,
    cloudSince: null,
  });
}

function judgeFresh(distance, config) {
  if (distance > config.radiusM) return RANGE_STATUS.OUT;
  if (distance > config.nearM) return RANGE_STATUS.NEAR;
  return RANGE_STATUS.IN;
}

/**
 * The judgement after one more row of this dog. Rows come in time order per
 * source; a BLE row not newer than the last BLE row, or a cloud row not newer
 * than the last row of either source, is ignored (a replay, a late download,
 * or this phone's own upload coming back from the cloud).
 *
 * row: {
 *   time, source: 'ble' | 'cloud',
 *   latitude, longitude,                  the dog (0,0 or missing: no fix)
 *   receiverLatitude, receiverLongitude,  the receiver that delivered it (BLE)
 *   held,                                 the dog is held in place (indoor hold)
 * }
 */
export function advanceRange(state = emptyRange(), row, config = RANGE) {
  const time = Number(row?.time);
  if (!Number.isFinite(time)) return state;
  const local = row.source === 'ble';
  // Each source in its own time order: a BLE row is never late against
  // another BLE row, but can be written after a cloud row with a later time.
  if (local ? state.lastLocalAt != null && time <= state.lastLocalAt
    : state.lastTime != null && time <= state.lastTime) return state;
  const next = { ...state, lastTime: Math.max(time, state.lastTime ?? -Infinity) };
  const hasFix = validPosition(row.latitude, row.longitude);
  if (!local) {
    // A cloud position: no receiver position, so it neither judges nor
    // clears. Once the phone has stopped hearing the dog, whatever was
    // counting towards clearing is void.
    if (hasFix && (next.lastLocalAt == null || time - next.lastLocalAt > config.localSilenceMs)) {
      next.cloudOnly = true;
      next.cloudSince = time;
      next.clearing = Object.freeze([]);
      next.nearBack = 0;
    }
    return Object.freeze(next);
  }
  next.lastLocalAt = time;
  // Heard by this phone again (not an older row written late).
  if (!(next.cloudSince > time)) {
    next.cloudOnly = false;
    next.cloudSince = null;
  }
  if (row.held) {
    // Positions while held are drift, not where the dog is: nothing judged,
    // nothing counted, and counting restarts after the release.
    next.clearing = Object.freeze([]);
    next.nearBack = 0;
    return Object.freeze(next);
  }
  if (!hasFix || !validPosition(row.receiverLatitude, row.receiverLongitude)) {
    // No new valid position, or no receiver position to measure from.
    return Object.freeze(next);
  }
  const distance = distanceMeters(
    { latitude: row.latitude, longitude: row.longitude },
    { latitude: row.receiverLatitude, longitude: row.receiverLongitude },
  );
  next.judgedAt = time;
  const fresh = judgeFresh(distance, config);
  switch (state.status) {
    case RANGE_STATUS.OUT: {
      if (distance > config.clearM) {
        next.clearing = Object.freeze([]);
        break;
      }
      const clearing = [...state.clearing, time];
      if (clearing.length >= config.clearFixes && time - clearing[0] >= config.clearSpanMs) {
        next.status = distance > config.nearM ? RANGE_STATUS.NEAR : RANGE_STATUS.IN;
        next.outSince = null;
        next.clearing = Object.freeze([]);
        next.nearBack = 0;
      } else {
        next.clearing = Object.freeze(clearing);
      }
      break;
    }
    case RANGE_STATUS.NEAR:
      if (fresh === RANGE_STATUS.OUT) {
        next.status = RANGE_STATUS.OUT;
        next.outSince = time;
        next.nearBack = 0;
      } else if (fresh === RANGE_STATUS.IN) {
        next.nearBack = state.nearBack + 1;
        if (next.nearBack >= config.nearClearFixes) {
          next.status = RANGE_STATUS.IN;
          next.nearBack = 0;
        }
      } else {
        next.nearBack = 0;
      }
      break;
    default:
      // In range, or the first position this phone has judged.
      next.status = fresh;
      next.outSince = fresh === RANGE_STATUS.OUT ? time : null;
      next.nearBack = 0;
      next.clearing = Object.freeze([]);
  }
  return Object.freeze(next);
}

/** The judgement after a whole list of rows (sorted here by time). */
export function judgeRange(rows, config = RANGE, state = emptyRange()) {
  return [...rows]
    .sort((left, right) => Number(left.time) - Number(right.time))
    .reduce((current, row) => advanceRange(current, row, config), state);
}

/**
 * What the dog's card shows in its 接收範圍 row, or null for no row:
 * - only for a dog this phone hears itself and that is not held in place;
 * - except out of range, which stays (red, with the time it was last
 *   confirmed) when the dog is held, or only heard through the cloud, until
 *   this phone hears it again and it clears;
 * - a disconnected receiver keeps the last judgement as it was.
 *
 * Returns { status, problem, warning, confirmedAt, showConfirmedAt }.
 */
export function rangeView(state, { held = false } = {}) {
  if (!state || state.status == null) return null;
  if (state.status === RANGE_STATUS.OUT) {
    return {
      status: RANGE_STATUS.OUT, problem: true, warning: false,
      confirmedAt: state.judgedAt, showConfirmedAt: !!held || !!state.cloudOnly,
    };
  }
  if (held || state.cloudOnly) return null;
  return {
    status: state.status, problem: false, warning: state.status === RANGE_STATUS.NEAR,
    confirmedAt: state.judgedAt, showConfirmedAt: false,
  };
}

/** The row's words (copy deck c348, c067, c078, c353). */
export function rangeLabel(view, formatClock) {
  if (!view) return null;
  if (view.status === RANGE_STATUS.IN) return '在範圍內';
  if (view.status === RANGE_STATUS.NEAR) return '快離開接收範圍';
  if (view.showConfirmedAt && Number.isFinite(view.confirmedAt) && formatClock) {
    return `不在接收範圍・最後確認 ${formatClock(view.confirmedAt)}`;
  }
  return '不在接收範圍';
}

/**
 * The point on a circle (centre, radius) nearest to `target`: where the line
 * from the centre to the target crosses the circle. Null when the target is
 * the centre itself.
 */
export function ringEdgePoint(center, target, radiusM = RANGE.radiusM) {
  const distance = distanceMeters(center, target);
  if (!(distance > 0)) return null;
  // Over a kilometre a local flat projection is accurate to centimetres.
  const ratio = radiusM / distance;
  return {
    latitude: center.latitude + (target.latitude - center.latitude) * ratio,
    longitude: center.longitude + (target.longitude - center.longitude) * ratio,
  };
}

/** A circle as a closed list of `points` coordinates (for a dashed outline). */
export function circleCoordinates(center, radiusM = RANGE.radiusM, points = 96) {
  const latDelta = (radiusM / EARTH_RADIUS_M) * (180 / Math.PI);
  const lonDelta = latDelta / Math.max(0.01, Math.cos(radians(center.latitude)));
  const result = [];
  for (let index = 0; index < points; index += 1) {
    const angle = (2 * Math.PI * index) / points;
    result.push({
      latitude: center.latitude + latDelta * Math.sin(angle),
      longitude: center.longitude + lonDelta * Math.cos(angle),
    });
  }
  return result;
}
