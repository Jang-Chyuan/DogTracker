import { offset } from './IndoorScenarios';

// Independently invented compact clusters on perpendicular axes. Regular
// clocks and fixed telemetry are assumptions, not transformed field logs.
// A single nonzero speed does not outweigh sustained stationary evidence;
// both traces end before the bounded grace expires. Genuine walks and the
// grace deadline are tested independently in IndoorHoldStationaryTail.
export function compactStationaryFixes(origin, start, axis) {
  const north = axis === 'north';
  const count = north ? 14 : 12;
  const step = north ? 10000 : 15000;
  return Array.from({ length: count }, (_, index) => {
    const along = 69 + (index % 3 - 1);
    const across = index % 2 ? -2 : 2;
    return { time: start + index * step, ...offset(origin, north ? along : across, north ? across : along),
      satellites: 9, hdop: 1, speed_kmh: index === 2 ? 1.8 : 0,
      master_id: 1, slave_id: 6 };
  });
}
