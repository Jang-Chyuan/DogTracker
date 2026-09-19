export function sameCoordinate(left, right) {
  return (
    left?.latitude === right?.latitude && left?.longitude === right?.longitude
  );
}

export function canJoinSamples(left, right, role) {
  return !!(
    left?.[role] &&
    right?.[role] &&
    Number.isFinite(left.receivedAt) &&
    Number.isFinite(right.receivedAt) &&
    left[`${role}Id`] === right[`${role}Id`]
  );
}

// Singletons are retained internally so a valid page boundary can join them.
export function buildRoutePieces(samples, role) {
  const pieces = [];
  let piece = [];
  let previous = null;
  for (const sample of samples) {
    if (!canJoinSamples(previous, sample, role)) {
      if (piece.length) pieces.push(piece);
      piece = [];
    }
    if (
      sample[role] &&
      Number.isFinite(sample.receivedAt) &&
      (!piece.length || !sameCoordinate(piece[piece.length - 1], sample[role]))
    )
      // Each drawn point keeps its own time, so the map can clip the line to
      // the selected window without rereading SQLite. Renderers read
      // latitude/longitude and ignore the extra field.
      piece.push({ ...sample[role], time: sample.receivedAt });
    previous = sample;
  }
  if (piece.length) pieces.push(piece);
  return pieces;
}

export function buildSegments(samples, role) {
  return buildRoutePieces(samples, role).filter(piece => piece.length > 1);
}
