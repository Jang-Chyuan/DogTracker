// Route state belongs to the tracking domain and contains no map-SDK types.
export function coordinate(latitude, longitude) {
  if (
    typeof latitude !== 'number' ||
    typeof longitude !== 'number' ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  )
    return null;
  return { latitude, longitude };
}

export function toRouteSample(point) {
  return {
    id: point.id,
    receivedAt: point.receivedAt,
    masterId: point.masterId,
    slaveId: point.slaveId,
    master: coordinate(point.masterLat, point.masterLon),
    slave: coordinate(point.slaveLat, point.slaveLon),
  };
}

function compareSamples(a, b) {
  // Invalid times create route gaps later, while ID keeps ordering stable.
  return (a.receivedAt ?? 0) - (b.receivedAt ?? 0) || a.id - b.id;
}

// Marker fallback is independent from the route window and keeps at most one
// latest valid sample for each endpoint.
export function mergePositionSamples(current, rows, currentPoint = null) {
  if (!rows.length) return current;
  const candidates = [...current, ...rows.map(toRouteSample)];
  const selected = new Map();
  for (const role of ['master', 'slave']) {
    let latest = null;
    for (const sample of candidates) {
      if (
        sample[role] &&
        (!currentPoint ||
          (sample.id <= currentPoint.id &&
            sample[`${role}Id`] === currentPoint[`${role}Id`])) &&
        (!latest || sample.id > latest.id)
      )
        latest = sample;
    }
    if (latest) selected.set(latest.id, latest);
  }
  return [...selected.values()].sort(compareSamples);
}

// React only needs the newest status plus one valid fallback per endpoint.
// Do not queue an entire raw history page (including BLE payloads) in state.
export function selectStatusRows(rows) {
  if (!rows.length) return rows;
  const newest = rows.reduce((a, b) => (a.id > b.id ? a : b));
  const ids = new Set([
    newest.id,
    // A catch-up batch can switch devices and then switch back. Select fallback
    // rows for its final devices before dropping the rest of the raw page.
    ...mergePositionSamples([], rows, newest).map(sample => sample.id),
  ]);
  return rows.filter(row => ids.has(row.id));
}
