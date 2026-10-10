import { offset } from './IndoorScenarios';

// Independently invented, regular 20-second observations. Two alternating
// lobes lie outside the 60m nearby radius but inside the 80m far radius.
// Their median is displaced, yet they never agree within 30m: this is not
// proof of departure. No real trajectory, date or device telemetry is used.
const ORIGIN = { latitude: 24.9892, longitude: 121.3132 };
export function nearbyOpposedFixes(startTime) {
  return Array.from({ length: 40 }, (_, index) => ({
    time: startTime + index * 20000, ...offset(ORIGIN, 66, index % 2 ? -38 : 38),
    satellites: 9, hdop: 1, rssi: -70, snr: 8, master_id: 1, slave_id: 6,
  }));
}
