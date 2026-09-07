// Display geometry uses straight Mercator lines, not geodesic polylines.
// Unscaled Mercator metres are conservative: ground distances on the sphere
// are no greater than projected distances. At Taoyuan this is ~0.91 m ground
// error for a 1 m tolerance. Never use this output for distance or export.
const RADIUS = 6378137;
const RADIANS = Math.PI / 180;

export function projectRoutePoint(point) {
  return {
    x: RADIUS * point.longitude * RADIANS,
    y:
      RADIUS * Math.log(Math.tan(Math.PI / 4 + (point.latitude * RADIANS) / 2)),
  };
}

export function squaredSegmentDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = dx * dx + dy * dy;
  const t =
    length === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((point.x - start.x) * dx + (point.y - start.y) * dy) / length,
          ),
        );
  return (point.x - start.x - t * dx) ** 2 + (point.y - start.y - t * dy) ** 2;
}

/** Iterative Douglas–Peucker, once per RAW chunk; never simplify its output. */
export function simplifyRoute(points, toleranceMeters = 1) {
  if (
    points.length < 3 ||
    !(toleranceMeters > 0) ||
    !Number.isFinite(toleranceMeters)
  )
    return points;
  // Avoid projection singularities and ambiguous date-line interpolation.
  // Keeping raw vertices here is safe and still subject to the display budget.
  if (
    points.some(
      (point, index) =>
        Math.abs(point.latitude) > 85 ||
        (index > 0 &&
          Math.abs(point.longitude - points[index - 1].longitude) > 180),
    )
  )
    return points;
  const projected = points.map(projectRoutePoint);
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [0, points.length - 1];
  const threshold = toleranceMeters * toleranceMeters;
  while (stack.length) {
    const end = stack.pop();
    const start = stack.pop();
    let furthest = -1;
    let maximum = threshold;
    for (let index = start + 1; index < end; index += 1) {
      const distance = squaredSegmentDistance(
        projected[index],
        projected[start],
        projected[end],
      );
      if (distance > maximum) {
        maximum = distance;
        furthest = index;
      }
    }
    if (furthest !== -1) {
      keep[furthest] = 1;
      stack.push(start, furthest, furthest, end);
    }
  }
  return points.filter((_, index) => keep[index]);
}
