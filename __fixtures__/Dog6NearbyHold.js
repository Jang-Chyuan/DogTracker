import { offset } from './IndoorScenarios';

// Deidentified Dog 6 GPS excerpt: 13 minutes around two near-anchor holds.
// Only relative geometry/intervals and telemetry are retained; date, receiver
// IDs and real coordinates are removed. No-fix/USB packets were absent from
// the export. Synthetic placement is near Taoyuan station.
const ORIGIN = { latitude: 24.9892, longitude: 121.3132 };
// seconds, north metres, east metres, satellites, HDOP, RSSI, SNR
const samples = [
  [0, -1.2, 4, 6, 2.1, -35, 4.75],
  [30, 6.1, 0.8, 7, 1.7, -35, 6],
  [40, 6.1, 0.2, 7, 1.7, -35, 5.5],
  [60, 6.4, -9.6, 7, 1.7, -35, 4.75],
  [70, 5.4, -14.6, 7, 1.7, -35, 6],
  [90, 3.5, -24.7, 7, 1.7, -35, 6.25],
  [110, 2.2, -27.6, 7, 1.7, -35, 5],
  [150, -1.1, -30.8, 7, 1.7, -35, 5.25],
  [170, 0.8, -27.3, 7, 1.7, -35, 5],
  [180, 2.1, -25, 7, 1.7, -35, 4.75],
  [210, 9.3, -7.9, 7, 1.7, -35, 5.75],
  [230, 12.2, -0.2, 7, 1.7, -35, 5.5],
  [240, 12.1, 1.5, 7, 1.7, -35, 5.75],
  [290, 10.7, 15.7, 7, 1.7, -35, 5],
  [310, 14.3, 22.9, 7, 1.7, -35, 5.25],
  [350, 16.8, 34.7, 7, 1.7, -35, 6],
  [370, 18.6, 35.2, 6, 1.7, -35, 5.75],
  [380, 19, 36.2, 6, 1.7, -35, 5.75],
  [390, 19, 36.6, 6, 1.7, -35, 5],
  [410, 11.3, 45.6, 6, 1.7, -35, 6],
  [420, 11.7, 45.3, 6, 1.7, -35, 6.25],
  [470, 13.7, 45, 5, 2, -36, 5],
  [500, 17.5, 54.9, 6, 2, -35, 5],
  [530, 22.2, 63.5, 7, 1.7, -35, 5.25],
  [540, 23, 65.3, 7, 1.7, -35, 5.5],
  [560, 26, 63.4, 7, 1.7, -35, 4.25],
  [570, 28.6, 54, 7, 1.7, -35, 5.75],
  [620, 38.3, 38.3, 7, 1.7, -35, 5.5],
  [650, 44.6, 29.4, 7, 1.7, -35, 5],
  [660, 46.4, 29, 7, 1.7, -35, 6],
  [680, 48.4, 29.3, 7, 1.7, -35, 5.5],
  [690, 46.5, 29, 7, 1.7, -35, 5],
  [700, 45.6, 27.8, 7, 1.7, -36, 5.5],
  [710, 46.5, 27.4, 7, 1.7, -35, 4.5],
  [740, 52.6, 17.8, 7, 1.7, -35, 5.75],
  [750, 50.9, 21.8, 7, 1.7, -35, 5.5],
  [790, 55.9, 23.8, 6, 2.4, -35, 5.5],
];

export function dog6NearbyExcerpt(startTime) {
  return samples.map(([seconds, north, east, satellites, hdop, rssi, snr]) => ({
    time: startTime + seconds * 1000, ...offset(ORIGIN, north, east),
    satellites, hdop, rssi, snr, master_id: 1, slave_id: 6,
  }));
}
