// Independently invented indoor speed-recovery counterexample, not sampled or
// shifted from a recording. Relative five-second clock, straight six-metre
// steps, and a single noisy estimate whose lower bound does not prove walking.
const origin = { latitude: 24.989, longitude: 121.313 };
export default [0, 6, 12, 18].map((north, index) => ({
  time: index * 5000,
  latitude: origin.latitude + north / 111195,
  longitude: origin.longitude,
  raw_latitude: origin.latitude + north / 111195,
  raw_longitude: origin.longitude,
  accuracy_meters: 15,
  raw_speed_kmh: index === 2 ? 3 * 3.6 : 0,
  speed_accuracy_mps: index === 2 ? 2.5 : 0.5,
  session_id: 'invented-noisy-recovery',
}));
